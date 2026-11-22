#!/usr/bin/env node
/**
 * HGame 3D Animation Pipeline CLI:
 * - bake:   Bake 90-bone UE GLBs -> 23-bone compressed GLBs + clean L0/L1/L2 indexes
 * - kits:   Print L0 standard archetype kits summary table (<= 60 lines)
 * - kit:    Print JSON slot map for a specific L0 kit
 * - search: Query L1 AI index (Top N, excludes pose & turn clips)
 * - verify: Fail-closed QA gate for 23-bone structure, IP/RM & L0 slot integrity
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import {
  CORE_23_BONES,
  CORE_23_SET,
  bakeGlbFileTo23,
  ensureCharacterRootNode,
} from './lib/anim-bake-core.mjs';
import { ANIM_CATEGORY_ORDER, classifyCleanAnimation } from './lib/anim-classify.mjs';
import {
  buildCuratedL1Index,
  flattenKitSlotSpecs,
  resolveAllL0Kits,
  searchAiIndex,
} from './lib/anim-kits.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const ANIM23_DIR = path.join(repoRoot, 'assets', 'anim23');
const INDEX_DIR = path.join(repoRoot, 'assets', 'runtime', 'animation', 'index');
const KITS_PATH = path.join(INDEX_DIR, 'anim-kits.json');
const AI_INDEX_PATH = path.join(INDEX_DIR, 'anim-ai-index.json');
const L2_CATALOG_PATH = path.join(ANIM23_DIR, 'catalog.json');

function resolveUnrealExportRoot() {
  if (process.env.HGAME_UNREAL_EXPORT_ROOT) {
    return path.resolve(process.env.HGAME_UNREAL_EXPORT_ROOT);
  }
  const localCfgPath = path.join(repoRoot, '.hgame.local.json');
  if (existsSync(localCfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(localCfgPath, 'utf8'));
      const runAnimGlb = cfg?.model3d?.runAnimGlb;
      if (typeof runAnimGlb === 'string' && runAnimGlb.includes('WebAssetExport')) {
        return path.resolve(path.dirname(path.dirname(runAnimGlb)));
      }
    } catch { /* ignore */ }
  }
  return null;
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) {
      flags._.push(tok);
      continue;
    }
    const eq = tok.indexOf('=');
    if (eq !== -1) {
      flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      continue;
    }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function loadSourceMetadata(unrealRoot) {
  const planPath = path.join(unrealRoot, 'full_export_plan.json');
  const catPath = path.join(unrealRoot, 'catalog.json');
  const ueManifestPath = path.join(unrealRoot, 'ue-source-manifest.json');

  const plan = existsSync(planPath) ? JSON.parse(readFileSync(planPath, 'utf8')) : { animations: [] };
  const rawCatalog = existsSync(catPath) ? JSON.parse(readFileSync(catPath, 'utf8')) : { animations: [] };
  const ueManifest = existsSync(ueManifestPath)
    ? JSON.parse(readFileSync(ueManifestPath, 'utf8'))
    : { animSequences: [], blendSpaces: [], montages: [] };

  const catById = new Map((rawCatalog.animations || []).map((a) => [a.id, a]));
  const ueById = new Map((ueManifest.animSequences || []).map((s) => [s.id, s]));

  // Map Montage hitWindows by referenced animation name
  const hitWindowByAnim = new Map();
  for (const m of ueManifest.montages || []) {
    const notifies = (m.notifies || []).filter((n) => /hit|damage|attack|strike|slash|window/i.test(n.name));
    if (notifies.length === 0) continue;
    for (const seg of m.segments || []) {
      if (!seg.animationName || hitWindowByAnim.has(seg.animationName)) continue;
      const n0 = notifies[0];
      const start = Math.max(0, Number((n0.time - (seg.startPos || 0)).toFixed(3)));
      const end = Number((start + Math.max(0.08, n0.duration || 0.12)).toFixed(3));
      hitWindowByAnim.set(seg.animationName, [start, end]);
    }
  }

  // Merge full_export_plan + catalog (full_export_plan preserves directional 8-way Strafe clips)
  const merged = [];
  const seen = new Set();
  for (const pEntry of plan.animations || []) {
    const absSrc = path.join(unrealRoot, pEntry.outputRel);
    if (!existsSync(absSrc)) continue;
    seen.add(pEntry.id);
    const catItem = catById.get(pEntry.id);
    const srcStat = statSync(absSrc);
    merged.push({
      id: pEntry.id,
      name: catItem?.name || pEntry.name || pEntry.assetName,
      assetName: pEntry.assetName,
      pack: pEntry.pack,
      sourceCategory: pEntry.sourceCategory,
      loop: Boolean(catItem?.loop ?? pEntry.loop),
      duration: Number(catItem?.duration ?? pEntry.duration ?? 0),
      srcAbsPath: absSrc,
      srcBytes: srcStat.size,
      ueEntry: ueById.get(pEntry.id) || null,
      hitWindow: hitWindowByAnim.get(pEntry.assetName) || null,
    });
  }
  for (const cEntry of rawCatalog.animations || []) {
    if (seen.has(cEntry.id)) continue;
    const rel = String(cEntry.url || '').replace(/^\/files\/hgame-unreal\//, '');
    const absSrc = path.join(unrealRoot, rel);
    if (!rel || !existsSync(absSrc)) continue;
    merged.push({
      id: cEntry.id,
      name: cEntry.name || cEntry.assetName,
      assetName: cEntry.assetName,
      pack: cEntry.pack,
      sourceCategory: cEntry.sourceCategory,
      loop: Boolean(cEntry.loop),
      duration: Number(cEntry.duration ?? 0),
      srcAbsPath: absSrc,
      srcBytes: cEntry.bytes || statSync(absSrc).size,
      ueEntry: ueById.get(cEntry.id) || null,
      hitWindow: hitWindowByAnim.get(cEntry.assetName) || null,
    });
  }

  return { merged, ueManifest };
}

function buildRelAnim23Path(entry) {
  return `anim23/${entry.sourceCategory}/${entry.pack}/${entry.assetName}.glb`;
}

async function runPool(items, concurrency, fn) {
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
}

async function cmdBake(flags) {
  const dryRun = Boolean(flags['dry-run']);
  const onlyKits = Boolean(flags['only-kits']);
  const force = Boolean(flags.force);
  const limit = flags.limit ? Number.parseInt(flags.limit, 10) : Infinity;
  const unrealRoot = resolveUnrealExportRoot();
  if (!unrealRoot) {
    throw new Error('Unreal export root not configured. Set HGAME_UNREAL_EXPORT_ROOT or .hgame.local.json.');
  }

  const { merged, ueManifest } = loadSourceMetadata(unrealRoot);
  if (merged.length === 0) {
    throw new Error(`No source animations found under Unreal export root: ${unrealRoot}`);
  }

  // First pass: clean classification & L0 kit resolution
  const records = merged.map((entry) => {
    const cls = classifyCleanAnimation(entry, { ueEntry: entry.ueEntry });
    const relPath = buildRelAnim23Path(entry);
    const dstAbsPath = path.join(repoRoot, 'assets', relPath);
    const isInPlaceName = /(_IP\b|InPlace|In_Place|^A_INP_|^IP_)/i.test(entry.assetName);
    const preliminaryMotion = entry.ueEntry?.enable_root_motion ? 'RM' : (isInPlaceName ? 'IP' : 'IP');
    return {
      ...entry,
      ...cls,
      motionType: preliminaryMotion,
      rootDisplacement: [0, 0, 0],
      avgSpeed: 0,
      path: relPath,
      dstAbsPath,
      sizeKB: Math.round(entry.srcBytes / 1024),
      aiVisible: !cls.excludedReason && cls.clipType === 'action',
    };
  });

  const { kits, slotAssignmentsById } = resolveAllL0Kits(records);

  const stats = {
    sourceCount: records.length,
    turnExcluded: records.filter((r) => r.excludedReason === 'turn_clip').length,
    poseIsolated: records.filter((r) => r.clipType === 'pose').length,
    longSequences: records.filter((r) => r.clipType === 'long_sequence').length,
    otherCategoryCount: records.filter((r) => r.category === '其他动作').length,
    bowCount: records.filter((r) => r.category === '弓箭').length,
    gunCount: records.filter((r) => r.category === '枪械射击').length,
    l0KitClips: slotAssignmentsById.size,
  };

  if (dryRun) {
    const l1Preview = buildCuratedL1Index(records, slotAssignmentsById);
    console.log(JSON.stringify({
      mode: 'dry-run',
      unrealRoot,
      ueManifestFound: (ueManifest.animSequences || []).length > 0,
      blendSpaces: (ueManifest.blendSpaces || []).length,
      montages: (ueManifest.montages || []).length,
      ...stats,
      l1CuratedCount: l1Preview.length,
      kitsSummary: kits.map((k) => ({
        kitId: k.kitId,
        style: k.style,
        filled: `${k.filledSlots}/${k.totalSlots}`,
        missing: k.missingSlots,
      })),
    }, null, 2));
    return;
  }

  let targets = onlyKits
    ? records.filter((r) => slotAssignmentsById.has(r.id))
    : records;
  if (Number.isFinite(limit) && limit > 0) {
    targets = targets.slice(0, limit);
  }

  console.log(`Baking ${targets.length} animations (onlyKits=${onlyKits}, force=${force})...`);
  let done = 0;
  let totalSrcBytes = 0;
  let totalDstBytes = 0;
  let failed = 0;

  await runPool(targets, 8, async (rec) => {
    totalSrcBytes += rec.srcBytes;
    const forceInPlace = Boolean(slotAssignmentsById.get(rec.id)?.forceInPlace);
    try {
      if (!force && existsSync(rec.dstAbsPath) && statSync(rec.dstAbsPath).size > 256) {
        const io = new NodeIO();
        const existingDoc = await io.read(rec.dstAbsPath);
        const existingSize = statSync(rec.dstAbsPath).size;
        const nodes = existingDoc.getRoot().listNodes();
        const anim = existingDoc.getRoot().listAnimations()[0];
        rec.rig = nodes.length === 23 && nodes.every((n) => CORE_23_SET.has(n.getName())) ? 'humanoid_23' : 'custom_monster';
        rec.channelCount = anim ? anim.listChannels().length : 0;
        rec.sizeKB = Number((existingSize / 1024).toFixed(1));
        rec.bakedBytes = existingSize;
        totalDstBytes += existingSize;
      } else {
        const baked = await bakeGlbFileTo23(rec.srcAbsPath, rec.dstAbsPath, {
          fps: 30,
          tolerance: 0.001,
          clipName: rec.assetName,
          ueEntry: rec.ueEntry,
          forceInPlace,
        });
        rec.rig = baked.rigType;
        rec.duration = baked.duration;
        rec.channelCount = baked.channelCount;
        rec.motionType = baked.motionType;
        rec.rootDisplacement = baked.rootDisplacement;
        rec.avgSpeed = baked.avgSpeed;
        rec.sizeKB = Number((baked.bytes / 1024).toFixed(1));
        rec.bakedBytes = baked.bytes;
        totalDstBytes += baked.bytes;

        // Re-evaluate pose/long classification with true baked duration & rigType
        const updatedCls = classifyCleanAnimation(rec, { ueEntry: rec.ueEntry, bakeMetrics: baked });
        rec.clipType = updatedCls.clipType;
        rec.excludedReason = updatedCls.excludedReason;
        rec.aiVisible = !updatedCls.excludedReason && updatedCls.clipType === 'action';
      }
    } catch (err) {
      failed++;
      rec.excludedReason = `bake_error:${err.message}`;
      rec.aiVisible = false;
    }
    done++;
    if (done % 500 === 0 || done === targets.length) {
      console.log(`  progress: ${done}/${targets.length} (failed=${failed})`);
    }
  });

  // Re-resolve kits after bake metrics update
  const { kits: finalKits, slotAssignmentsById: finalSlots } = resolveAllL0Kits(records);
  const l1Entries = buildCuratedL1Index(records, finalSlots);

  await mkdir(INDEX_DIR, { recursive: true });
  await mkdir(ANIM23_DIR, { recursive: true });

  await writeFile(KITS_PATH, JSON.stringify({
    version: 1,
    rig: 'humanoid_23',
    generatedAt: new Date().toISOString(),
    kitCount: finalKits.length,
    kits: finalKits,
  }, null, 2) + '\n');

  await writeFile(AI_INDEX_PATH, JSON.stringify({
    version: 1,
    rig: 'humanoid_23',
    generatedAt: new Date().toISOString(),
    totalCount: l1Entries.length,
    entries: l1Entries,
  }, null, 2) + '\n');

  // Build cleaned L2 catalog for WebAsset (only entries whose baked GLB exists, or all if full bake)
  const l2Animations = records
    .filter((r) => existsSync(r.dstAbsPath))
    .map((r) => ({
      id: r.id,
      name: r.name,
      assetName: r.assetName,
      pack: r.pack,
      sourceCategory: r.sourceCategory,
      category: r.category,
      style: r.style,
      rig: r.rig,
      loop: r.loop,
      duration: r.duration,
      channelCount: r.channelCount || 24,
      motionType: r.motionType,
      rootDisplacement: r.rootDisplacement,
      avgSpeed: r.avgSpeed,
      clipType: r.clipType,
      aiVisible: r.aiVisible,
      excludedReason: r.excludedReason,
      bytes: r.bakedBytes || Math.round(r.sizeKB * 1024),
      url: `/files/hgame-anim23/${r.sourceCategory}/${r.pack}/${r.assetName}.glb`,
    }));

  await writeFile(L2_CATALOG_PATH, JSON.stringify({
    version: 3,
    rig: 'humanoid_23',
    generatedAt: new Date().toISOString(),
    totalSourceBytes: totalSrcBytes,
    totalBakedBytes: totalDstBytes,
    animations: l2Animations,
  }, null, 2) + '\n');

  const srcMB = (totalSrcBytes / (1024 * 1024)).toFixed(2);
  const dstMB = (totalDstBytes / (1024 * 1024)).toFixed(2);
  const pct = totalSrcBytes > 0 ? ((1 - totalDstBytes / totalSrcBytes) * 100).toFixed(1) : '0.0';
  console.log(`Bake complete: baked=${l2Animations.length}, L0 kits=${finalKits.length}, L1 index=${l1Entries.length}, size=${srcMB}MB -> ${dstMB}MB (-${pct}%), failed=${failed}`);
}

function cmdKits() {
  if (!existsSync(KITS_PATH)) {
    throw new Error(`Missing ${KITS_PATH}. Run "npm run anim:bake -- --only-kits" first.`);
  }
  const data = JSON.parse(readFileSync(KITS_PATH, 'utf8'));
  const lines = [
    `HGame L0 角色标准动画套件 (${data.kits.length} 套 · ${data.rig})`,
    'kitId                    | style     | slots | missing',
    '-------------------------+-----------+-------+----------------------------------------',
  ];
  for (const k of data.kits) {
    const missingStr = k.missingSlots.length === 0
      ? 'none'
      : k.missingSlots.slice(0, 3).join(', ') + (k.missingSlots.length > 3 ? ` (+${k.missingSlots.length - 3})` : '');
    lines.push(`${k.kitId.padEnd(24)} | ${k.style.padEnd(9)} | ${String(`${k.filledSlots}/${k.totalSlots}`).padEnd(5)} | ${missingStr}`);
  }
  console.log(lines.join('\n'));
}

function cmdKit(flags) {
  const kitId = flags._[0];
  if (!kitId) {
    throw new Error('Usage: npm run anim:kit -- <kitId>');
  }
  if (!existsSync(KITS_PATH)) {
    throw new Error(`Missing ${KITS_PATH}. Run "npm run anim:bake -- --only-kits" first.`);
  }
  const data = JSON.parse(readFileSync(KITS_PATH, 'utf8'));
  const kit = data.kits.find((k) => k.kitId === kitId);
  if (!kit) {
    throw new Error(`Unknown kitId "${kitId}". Available: ${data.kits.map((k) => k.kitId).join(', ')}`);
  }
  console.log(JSON.stringify(kit, null, 2));
}

function cmdSearch(flags) {
  if (!existsSync(AI_INDEX_PATH)) {
    throw new Error(`Missing ${AI_INDEX_PATH}. Run "npm run anim:bake -- --only-kits" first.`);
  }
  const data = JSON.parse(readFileSync(AI_INDEX_PATH, 'utf8'));
  const loop = flags.loop === 'true' ? true : (flags.loop === 'false' ? false : null);
  const maxDuration = flags['max-duration'] !== undefined ? Number(flags['max-duration']) : null;
  const limit = flags.limit !== undefined ? Number.parseInt(flags.limit, 10) : 10;
  const results = searchAiIndex(data.entries || [], {
    style: flags.style || '',
    category: flags.category || '',
    motion: flags.motion || '',
    loop,
    maxDuration,
    q: flags.q || '',
    limit,
  });
  console.log(JSON.stringify({ count: results.length, results }, null, 2));
}

async function cmdVerify(flags) {
  const fixChars = Boolean(flags['fix-characters']);
  const errors = [];

  if (!existsSync(KITS_PATH)) errors.push(`Missing ${KITS_PATH}`);
  if (!existsSync(AI_INDEX_PATH)) errors.push(`Missing ${AI_INDEX_PATH}`);
  if (!existsSync(L2_CATALOG_PATH)) errors.push(`Missing ${L2_CATALOG_PATH}`);
  if (errors.length > 0) {
    console.error('ANIM_VERIFY_FAILED:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exitCode = 1;
    return;
  }

  const kitsData = JSON.parse(readFileSync(KITS_PATH, 'utf8'));
  const aiData = JSON.parse(readFileSync(AI_INDEX_PATH, 'utf8'));
  const l2Data = JSON.parse(readFileSync(L2_CATALOG_PATH, 'utf8'));
  const l2ByPath = new Map((l2Data.animations || []).map((a) => [`anim23/${a.sourceCategory}/${a.pack}/${a.assetName}.glb`, a]));

  // 1. Validate L0 kits
  const io = new NodeIO();
  const checkedGlbPaths = new Set();
  for (const kit of kitsData.kits || []) {
    const flat = flattenKitSlotSpecs({ slots: { locomotion: kit.locomotion, upperBody: kit.upperBody, combat: kit.combat } });
    for (const { slotPath } of flat) {
      const parts = slotPath.split('.');
      let val = kit;
      for (const p of parts) val = val?.[p];
      if (val === null) continue;
      if (typeof val !== 'string') {
        errors.push(`${kit.kitId}.${slotPath}: invalid slot value`);
        continue;
      }
      const absGlb = path.join(repoRoot, 'assets', val);
      if (!existsSync(absGlb)) {
        errors.push(`${kit.kitId}.${slotPath}: file missing (${val})`);
        continue;
      }
      const meta = l2ByPath.get(val);
      if (!meta) {
        errors.push(`${kit.kitId}.${slotPath}: missing from L2 catalog (${val})`);
        continue;
      }
      if (meta.clipType === 'pose') errors.push(`${kit.kitId}.${slotPath}: pose clip in active slot (${val})`);
      if (meta.excludedReason === 'turn_clip') errors.push(`${kit.kitId}.${slotPath}: turn_clip in active slot (${val})`);
      if ((slotPath.includes('strafe_') || slotPath === 'locomotion.sprint_f') && meta.motionType !== 'IP') {
        errors.push(`${kit.kitId}.${slotPath}: expected motionType=IP, got ${meta.motionType} (${val})`);
      }
      checkedGlbPaths.add(absGlb);
    }
  }

  // 2. Validate L1 AI index
  if ((aiData.entries || []).length > 1300) {
    errors.push(`anim-ai-index exceeds 1300 cap (${aiData.entries.length})`);
  }
  for (const entry of aiData.entries || []) {
    if (entry.clipType === 'pose') errors.push(`L1 entry is pose: ${entry.id}`);
    if (/turn_clip/.test(entry.excludedReason || '')) errors.push(`L1 entry is turn_clip: ${entry.id}`);
  }

  // 3. Validate baked GLB structure (sample or all L2 humanoid GLBs)
  let verifiedGlbs = 0;
  let totalBakedBytes = 0;
  for (const item of l2Data.animations || []) {
    const rel = `anim23/${item.sourceCategory}/${item.pack}/${item.assetName}.glb`;
    const absGlb = path.join(repoRoot, 'assets', rel);
    if (!existsSync(absGlb)) {
      errors.push(`Missing baked GLB: ${rel}`);
      continue;
    }
    totalBakedBytes += statSync(absGlb).size;
    if (item.rig === 'humanoid_23' && (checkedGlbPaths.has(absGlb) || verifiedGlbs < 400)) {
      const doc = await io.read(absGlb);
      const nodes = doc.getRoot().listNodes();
      const anim = doc.getRoot().listAnimations()[0];
      const channels = anim ? anim.listChannels() : [];
      const scaleChannels = channels.filter((c) => c.getTargetPath() === 'scale');
      const nodeNames = nodes.map((n) => n.getName());
      if (nodes.length !== 23 || !CORE_23_BONES.every((b) => nodeNames.includes(b))) {
        errors.push(`${rel}: expected exact 23 core bones, got ${nodes.length}`);
      }
      if (scaleChannels.length > 0) {
        errors.push(`${rel}: found ${scaleChannels.length} scale channels`);
      }
      if (channels.length < 23 || channels.length > 25) {
        errors.push(`${rel}: channelCount=${channels.length} outside [23, 25]`);
      }
      verifiedGlbs++;
    }
  }

  // 4. Optionally normalize/verify WebAsset self-created character low-poly GLBs
  const charsDir = path.join(repoRoot, 'webasset', 'assets', 'characters');
  let charIssues = 0;
  if (existsSync(charsDir)) {
    const fsSync = await import('node:fs');
    for (const slug of fsSync.readdirSync(charsDir)) {
      const mdir = path.join(charsDir, slug, 'models');
      if (!existsSync(mdir)) continue;
      for (const f of fsSync.readdirSync(mdir).filter((x) => x.startsWith('low-') && x.endsWith('.glb'))) {
        const glbPath = path.join(mdir, f);
        if (fixChars) {
          const fixRes = await ensureCharacterRootNode(glbPath);
          if (fixRes.changed) console.log(`Fixed character root node: ${slug}/${f}`, fixRes);
        }
        const doc = await io.read(glbPath);
        const nodeNames = new Set(doc.getRoot().listNodes().map((n) => n.getName()));
        if (!nodeNames.has('root')) {
          charIssues++;
          if (fixChars) errors.push(`Character ${slug}/${f} missing root node`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`ANIM_VERIFY_FAILED (${errors.length} errors):\n` + errors.slice(0, 30).map((e) => `  - ${e}`).join('\n'));
    process.exitCode = 1;
    return;
  }

  const srcMB = ((l2Data.totalSourceBytes || 0) / (1024 * 1024)).toFixed(2);
  const dstMB = (totalBakedBytes / (1024 * 1024)).toFixed(2);
  console.log(JSON.stringify({
    status: 'PASS',
    l0Kits: kitsData.kits.length,
    l1Entries: aiData.entries.length,
    l2BakedFiles: (l2Data.animations || []).length,
    structurallyVerifiedGlbs: verifiedGlbs,
    legacyCharsMissingRoot: charIssues,
    sourceMB: Number(srcMB),
    bakedMB: Number(dstMB),
  }, null, 2));
}

async function main() {
  const [subcmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (subcmd === 'bake') return cmdBake(flags);
  if (subcmd === 'kits') return cmdKits(flags);
  if (subcmd === 'kit') return cmdKit(flags);
  if (subcmd === 'search') return cmdSearch(flags);
  if (subcmd === 'verify') return cmdVerify(flags);
  console.error('Usage: node scripts/anim-cli.mjs <bake|kits|kit|search|verify> [flags]');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
