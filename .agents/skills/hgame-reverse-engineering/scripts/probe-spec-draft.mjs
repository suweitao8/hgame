#!/usr/bin/env node
// Scans raw extraction outputs under <research-dir>/raw and synthesizes a unit-normalized 1-1-2-1 spec-draft.json.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveReConfig } from './local-config.mjs';

const CODE_SCAN_SUBDIRS = [
  'mono-csharp',
  'il2cpp-dump',
  'godot-recovered',
  'rpgmaker-data',
  'gamemaker-dump',
  'source-cfg',
  'vpk-subset',
  'web-bundle',
];
const TEXT_EXTS = new Set(['.cs', '.gd', '.txt', '.cfg', '.vdf', '.json', '.js', '.mjs', '.rpy', '.gml']);

const PARAM_PATTERNS = [
  { key: 'playerSpeed', re: /\b(?:playerSpeed|moveSpeed|walkSpeed|runSpeed|maxPlayerSpeed|MaxPlayerSpeed|speed)\b\s*[:=]\s*(\d+(?:\.\d+)?)/i },
  { key: 'playerHp', re: /\b(?:playerHp|maxHp|maxHealth|survivor_health|PlayerHealth)\b\s*[:=]\s*(\d+(?:\.\d+)?)/i },
  { key: 'playerRadius', re: /\b(?:playerRadius|capsuleRadius|bodyRadius|hull_radius)\b\s*[:=]\s*(\d+(?:\.\d+)?)/i },
  { key: 'damage', re: /\b(?:damage|baseDamage|attackDamage|Damage)\b\s*[:=]\s*(\d+(?:\.\d+)?)/i },
  { key: 'cooldownSec', re: /\b(?:cooldown|cooldownSec|cycleTime|CycleTime|fireInterval|attackDelay)\b\s*[:=]\s*(\d+(?:\.\d+)?)/i },
  { key: 'rangeM', re: /\b(?:range|attackRange|Range)\b\s*[:=]\s*(\d+(?:\.\d+)?)/i },
  { key: 'enemyHp', re: /\b(?:enemyHp|gruntHp|zombie_health|hp)\b\s*[:=]\s*(\d+(?:\.\d+)?)/i },
  { key: 'hitDamage', re: /\b(?:hitDamage|contactDamage|meleeDamage|biteDamage)\b\s*[:=]\s*(\d+(?:\.\d+)?)/i },
  { key: 'arenaSpanM', re: /\b(?:arenaWidth|arenaSpan|mapSize|arena_size)\b\s*[:=]\s*(\d+(?:\.\d+)?)/i },
];

function parseArgs(argv) {
  const opts = { researchDir: null, slug: null, out: null, force: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--slug') opts.slug = argv[++i];
    else if (token === '--out') opts.out = argv[++i];
    else if (token === '--force') opts.force = true;
    else if (token === '--json') opts.json = true;
    else if (token === '--help' || token === '-h') opts.help = true;
    else if (!token.startsWith('-') && !opts.researchDir) opts.researchDir = token;
    else throw new Error(`Unknown or incomplete argument: ${token}`);
  }
  if (opts.help) return opts;
  const cfg = resolveReConfig();
  if (!opts.researchDir && opts.slug) {
    opts.researchDir = path.join(cfg.reWorkspaceDir, 'projects', opts.slug);
  }
  if (!opts.researchDir) {
    throw new Error('Usage: node probe-spec-draft.mjs [<research-dir> | --slug <slug>] [--out <spec-draft.json>] [--force] [--json]');
  }
  return opts;
}

async function readJsonSafe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function walkBounded(dir, limit = 350, depth = 0, out = []) {
  if (depth > 5 || out.length >= limit) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= limit) break;
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkBounded(full, limit, depth + 1, out);
    } else if (TEXT_EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function inferUnitConversionHint(engineId) {
  if (engineId === 'source' || engineId === 'source2') {
    return {
      recommendedProfile: '3d',
      engineRecipe: { profile: '3d', renderer: 'threejs', physics: 'rapier3d', tickHz: 60 },
      distance: { sourceUnit: 'hammer-units', toMetersScale: 0.01905, reference: '16 hammer units = 0.3048m (1ft)' },
      time: { sourceUnit: 'seconds', tickHz: 60, toSecondsScale: 1 },
      angle: { sourceUnit: 'degrees', toRadiansScale: Number((Math.PI / 180).toFixed(8)) },
      isPixel2D: false,
      isHammer: true,
    };
  }
  if (engineId === 'unreal') {
    return {
      recommendedProfile: '3d',
      engineRecipe: { profile: '3d', renderer: 'threejs', physics: 'rapier3d', tickHz: 60 },
      distance: { sourceUnit: 'cm', toMetersScale: 0.01, reference: '100uu = 1.0m' },
      time: { sourceUnit: 'seconds', tickHz: 60, toSecondsScale: 1 },
      angle: { sourceUnit: 'degrees', toRadiansScale: Number((Math.PI / 180).toFixed(8)) },
      isPixel2D: false,
      isHammer: false,
    };
  }
  if (['godot', 'gamemaker', 'rpg-maker-mv', 'rpg-maker-mz', 'web-html5'].includes(engineId)) {
    return {
      recommendedProfile: '2d',
      engineRecipe: { profile: '2d', renderer: 'canvas2d', physics: 'none', tickHz: 60 },
      distance: { sourceUnit: 'px', toMetersScale: 0.02, reference: '50px = 1.0m (hgame-fallback scale)' },
      time: { sourceUnit: 'frames@60Hz', tickHz: 60, toSecondsScale: 1 / 60 },
      angle: { sourceUnit: 'degrees', toRadiansScale: Number((Math.PI / 180).toFixed(8)) },
      isPixel2D: true,
      isHammer: false,
    };
  }
  return {
    recommendedProfile: '2d',
    engineRecipe: { profile: '2d', renderer: 'canvas2d', physics: 'none', tickHz: 60 },
    distance: { sourceUnit: 'engine-units', toMetersScale: 1, reference: '1 unit = 1m (verify pixel vs meter before release)' },
    time: { sourceUnit: 'seconds', tickHz: 60, toSecondsScale: 1 },
    angle: { sourceUnit: 'degrees', toRadiansScale: Number((Math.PI / 180).toFixed(8)) },
    isPixel2D: false,
    isHammer: false,
  };
}

function normalizeSpeed(rawValue, hint) {
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null;
  if (hint.isHammer) return Number((rawValue * hint.distance.toMetersScale).toFixed(3));
  if (rawValue > 40) return Number((rawValue * (hint.isPixel2D ? hint.distance.toMetersScale : 0.02)).toFixed(3));
  return Number(rawValue.toFixed(3));
}

function normalizeWeaponRecords(rawTable, hint) {
  const entries = Array.isArray(rawTable)
    ? rawTable.map((v, i) => [v?.id || `weapon_${i + 1}`, v])
    : rawTable && typeof rawTable === 'object'
      ? Object.entries(rawTable)
      : [];

  const out = [];
  for (const [id, rec] of entries) {
    if (!rec || typeof rec !== 'object') continue;
    const damage = Number(rec.damage ?? rec.Damage ?? rec.dmg);
    const cd = Number(rec.cooldownSec ?? rec.CycleTime ?? rec.cooldown);
    const rangeRaw = Number(rec.rangeM ?? rec.Range ?? rec.range);
    if (!Number.isFinite(damage) || damage <= 0) continue;
    const cooldownSec = Number.isFinite(cd) && cd > 0 ? Number(cd.toFixed(3)) : 0.45;
    const rangeM = Number.isFinite(rangeRaw) && rangeRaw > 0
      ? Number((hint.isHammer && rangeRaw > 100 ? rangeRaw * hint.distance.toMetersScale : rangeRaw > 100 ? 12 : rangeRaw).toFixed(2))
      : 8;
    out.push({
      id: String(id).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || `weapon_${out.length + 1}`,
      status: 'inferred',
      damage,
      cooldownSec,
      rangeM: Math.max(1.5, Math.min(40, rangeM)),
    });
    if (out.length >= 2) break;
  }
  return out;
}

function normalizeEnemyRecords(rawTable, hint) {
  const entries = Array.isArray(rawTable)
    ? rawTable.map((v, i) => [v?.id || `enemy_${i + 1}`, v])
    : rawTable && typeof rawTable === 'object'
      ? Object.entries(rawTable)
      : [];

  const out = [];
  for (const [id, rec] of entries) {
    if (!rec || typeof rec !== 'object') continue;
    const hp = Number(rec.hp ?? rec.health ?? rec.maxHp ?? rec.MaxHp);
    const spd = normalizeSpeed(Number(rec.speed ?? rec.moveSpeed ?? 3.0), hint) || 3.0;
    const dmg = Number(rec.hitDamage ?? rec.damage ?? 10);
    if (!Number.isFinite(hp) || hp <= 0) continue;
    out.push({
      id: String(id).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || `enemy_${out.length + 1}`,
      role: out.length === 0 ? 'grunt' : 'elite',
      status: 'inferred',
      hp,
      speed: spd >= 1 && spd <= 15 ? spd : 3.0,
      hitDamage: Number.isFinite(dmg) && dmg > 0 ? dmg : 10,
      radius: 0.4,
    });
    if (out.length >= 3) break;
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node probe-spec-draft.mjs [<research-dir> | --slug <slug>] [--out <spec-draft.json>] [--force] [--json]');
    return;
  }

  const researchDir = path.resolve(opts.researchDir);
  const outPath = path.resolve(opts.out || path.join(researchDir, 'production', 'spec-draft.json'));

  if (!opts.force) {
    try {
      await stat(outPath);
      const result = { ok: true, skipped: true, reason: 'spec-draft.json already exists (pass --force to overwrite)', outPath };
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`[probe-spec-draft] Existing spec-draft.json kept -> ${outPath}`);
      return;
    } catch {
      // Proceed when missing
    }
  }

  const baseline = await readJsonSafe(path.join(researchDir, 'baseline.json'));
  const fastPlan = await readJsonSafe(path.join(researchDir, 'raw', 'fast-extract-plan.json'));
  const scannerProfile = await readJsonSafe(path.join(researchDir, 'raw', 'scanner', 'engine-profile.json'));
  const engineId = fastPlan?.engineId || scannerProfile?.engine?.id || baseline?.engine || 'unknown';
  const hint = inferUnitConversionHint(engineId);

  const candidates = {};
  for (const p of PARAM_PATTERNS) candidates[p.key] = [];

  // 1. Scan raw extracted code/text dirs (bounded to keep speed <1s)
  const filesToScan = [];
  for (const sub of CODE_SCAN_SUBDIRS) {
    await walkBounded(path.join(researchDir, 'raw', sub), 350, 0, filesToScan);
  }
  let scannedFiles = 0;
  for (const f of filesToScan.slice(0, 350)) {
    let text;
    try {
      const st = await stat(f);
      if (st.size > 512 * 1024) continue;
      text = await readFile(f, 'utf8');
      scannedFiles += 1;
    } catch {
      continue;
    }
    for (const pat of PARAM_PATTERNS) {
      if (candidates[pat.key].length >= 8) continue;
      const m = text.match(pat.re);
      if (m) {
        const val = Number(m[1]);
        if (Number.isFinite(val)) candidates[pat.key].push(val);
      }
    }
  }

  // 2. Load raw/extracted-data/*.json for candidate weapons/enemies
  const extractedDir = path.join(researchDir, 'raw', 'extracted-data');
  let weaponSlices = [];
  let enemySlices = [];
  try {
    const jsonFiles = (await readdir(extractedDir)).filter((f) => f.endsWith('.json'));
    for (const jf of jsonFiles) {
      const data = await readJsonSafe(path.join(extractedDir, jf));
      if (!data) continue;
      if (weaponSlices.length === 0 && /weapon/i.test(jf)) weaponSlices = normalizeWeaponRecords(data, hint);
      if (enemySlices.length === 0 && /enem|monster|zombie|mob/i.test(jf)) enemySlices = normalizeEnemyRecords(data, hint);
    }
  } catch {
    // optional extracted-data dir
  }

  const rawSpeed = candidates.playerSpeed[0];
  const probedSpeed = normalizeSpeed(rawSpeed, hint);
  const playerSpeed = probedSpeed && probedSpeed >= 2.0 && probedSpeed <= 12.0 ? probedSpeed : 5.0;
  const playerRadius = candidates.playerRadius[0] && candidates.playerRadius[0] > 0.1 && candidates.playerRadius[0] <= 2 ? candidates.playerRadius[0] : 0.4;
  const playerHp = candidates.playerHp[0] && candidates.playerHp[0] >= 20 && candidates.playerHp[0] <= 500 ? candidates.playerHp[0] : 100;

  if (weaponSlices.length === 0) {
    const dmg = candidates.damage[0] && candidates.damage[0] >= 5 && candidates.damage[0] <= 200 ? candidates.damage[0] : 25;
    const cd = candidates.cooldownSec[0] && candidates.cooldownSec[0] >= 0.05 && candidates.cooldownSec[0] <= 5 ? candidates.cooldownSec[0] : 0.5;
    weaponSlices.push({
      id: 'primary_weapon',
      status: candidates.damage.length > 0 ? 'inferred' : 'hgame-fallback',
      damage: dmg,
      cooldownSec: cd,
      rangeM: 6.0,
    });
  }

  if (enemySlices.length === 0) {
    const eHp = candidates.enemyHp[0] && candidates.enemyHp[0] >= 10 && candidates.enemyHp[0] <= 500 ? candidates.enemyHp[0] : 50;
    const hitDmg = candidates.hitDamage[0] && candidates.hitDamage[0] >= 5 && candidates.hitDamage[0] <= 40 ? candidates.hitDamage[0] : 10;
    enemySlices.push(
      { id: 'grunt', role: 'grunt', status: candidates.enemyHp.length > 0 ? 'inferred' : 'hgame-fallback', hp: eHp, speed: 3.0, hitDamage: hitDmg, radius: 0.4 },
      { id: 'elite', role: 'elite', status: 'hgame-fallback', hp: Math.round(eHp * 2.2), speed: 2.3, hitDamage: Math.round(hitDmg * 1.5), radius: 0.55 },
    );
  }

  const arenaSpanM = Math.max(playerSpeed * 10, Math.min(playerSpeed * 28, 72));
  const draft = {
    schemaVersion: 1,
    generatedBy: 'probe-spec-draft',
    engineHint: engineId,
    recommendedProfile: hint.recommendedProfile,
    recommendedRecipe: hint.engineRecipe,
    unitSystem: 'SI_METERS_SECONDS_RADIANS',
    unitConversions: {
      distance: hint.distance,
      time: hint.time,
      angle: hint.angle,
    },
    mechanics: {
      coreLoop: { status: 'inferred', arenaSpanM: Number(arenaSpanM.toFixed(1)), waveDurationSec: 60 },
      threeC: {
        status: probedSpeed ? 'inferred' : 'hgame-fallback',
        playerSpeed,
        playerRadius,
        playerHp,
        camera: { status: 'hgame-fallback', mode: hint.recommendedProfile === '3d' ? 'third-person-follow' : 'topdown-follow', orthoHeightM: 14 },
      },
      waveDirector: { status: 'hgame-fallback', waveDurationSec: 60, baseSpawnIntervalSec: 1.5 },
    },
    tables: {
      weapons: weaponSlices,
      enemies: enemySlices,
      upgrades: [
        { id: 'atk_spd', tag: '+25% 攻速', status: 'hgame-fallback' },
        { id: 'dmg_up', tag: '+20% 伤害', status: 'hgame-fallback' },
      ],
    },
    hgameFallbackModules: [
      'renderer-shader',
      'skeleton-state-machine',
      'navmesh-solver',
      'physics-solver',
      'vfx-particles',
      'synth-audio',
      'minimal-ui',
    ],
    probeSummary: {
      scannedFiles,
      candidateCounts: Object.fromEntries(Object.entries(candidates).map(([k, v]) => [k, v.length])),
      candidatesSample: Object.fromEntries(Object.entries(candidates).filter(([, v]) => v.length > 0).map(([k, v]) => [k, v.slice(0, 4)])),
      notes: 'Review unitConversions and confirm seen/inferred values before final production tuning.',
    },
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(draft, null, 2) + '\n', 'utf8');

  const result = { ok: true, skipped: false, outPath, engineId, scannedFiles, candidateCounts: draft.probeSummary.candidateCounts };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`[probe-spec-draft] engine=${engineId} scanned=${scannedFiles} -> ${outPath}`);
}

main().catch((err) => {
  console.error('probe-spec-draft failed: ' + err.message);
  process.exitCode = 1;
});
