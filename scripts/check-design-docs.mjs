#!/usr/bin/env node
// Audit per-game holistic design documentation (docs/design/*) and blueprint consistency.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

async function loadKitModules(gameDir) {
  const roots = [
    path.join(repoRoot, 'assets', 'runtime', 'kit'),
    path.join(gameDir, 'vendor', 'hgame', 'kit'),
    path.join(repoRoot, 'vendor', 'hgame', 'kit'),
  ];
  for (const dir of roots) {
    const bpPath = path.join(dir, 'blueprint.js');
    const docsPath = path.join(dir, 'design-docs.js');
    const stagePath = path.join(dir, 'stage-architect.js');
    if (existsSync(bpPath) && existsSync(docsPath)) {
      const [bp, docs, stage] = await Promise.all([
        import(pathToFileURL(bpPath).href),
        import(pathToFileURL(docsPath).href),
        existsSync(stagePath) ? import(pathToFileURL(stagePath).href) : Promise.resolve({}),
      ]);
      return { ...bp, ...docs, ...stage };
    }
  }
  throw new Error('Cannot locate HGame kit/blueprint.js and kit/design-docs.js');
}

const PLACEHOLDER_RE = /\b(?:TODO|FIXME|TBD)\b|待补充|请填写/;

/**
 * Audit per-game design documents under `docs/design/` and optional `src/game.design.json`.
 * @param {string} targetDir
 * @param {{ strict?: boolean }} [options]
 */
export async function auditDesignDocs(targetDir, options = {}) {
  const gameDir = path.resolve(targetDir);
  const { defineGameBlueprint, evaluateBlueprintBalance, REQUIRED_DESIGN_DOCS, analyzeStageDesign, analyzeCampaignProgression } = await loadKitModules(gameDir);
  const errors = [];
  const warnings = [];
  const checkedDocs = [];

  const designDir = path.join(gameDir, 'docs', 'design');
  const designJsonPath = path.join(gameDir, 'src', 'game.design.json');
  const hasDesignDir = existsSync(designDir);
  const hasDesignJson = existsSync(designJsonPath);

  if (!hasDesignDir) {
    errors.push('Missing docs/design/ directory (expected GDD.md, ART-AND-AUDIO.md, UI-UX.md, LEVEL.md)');
    return { ok: false, status: 'failed', gameDir, docs: [], errors, warnings };
  }

  let gameConfig = null;
  const gameConfigPath = path.join(gameDir, 'game.config.json');
  if (existsSync(gameConfigPath)) {
    try {
      gameConfig = JSON.parse(await readFile(gameConfigPath, 'utf8'));
    } catch (err) {
      errors.push(`Invalid game.config.json: ${err.message}`);
    }
  }

  const contents = {};
  for (const name of REQUIRED_DESIGN_DOCS) {
    const abs = path.join(designDir, name);
    if (!existsSync(abs)) {
      errors.push(`Missing required design document: docs/design/${name}`);
      continue;
    }
    const text = await readFile(abs, 'utf8');
    contents[name] = text;
    checkedDocs.push(`docs/design/${name}`);
    if (text.trim().length < 120 || !/^#\s+\S/m.test(text)) {
      errors.push(`docs/design/${name} is incomplete (must have a Markdown heading and >= 120 chars)`);
    }
    if (PLACEHOLDER_RE.test(text)) {
      errors.push(`docs/design/${name} still contains unresolved placeholder (TODO/TBD/待补充/请填写)`);
    }
  }

  if (contents['GDD.md']) {
    if (!/(?:变更记录|Change Log)/i.test(contents['GDD.md'])) {
      errors.push('docs/design/GDD.md must include a Change Log / 变更记录 section');
    }
    if (gameConfig && path.basename(gameDir) !== 'template') {
      const hasIdentity = (gameConfig.id && contents['GDD.md'].includes(gameConfig.id))
        || (gameConfig.name && contents['GDD.md'].includes(gameConfig.name));
      if (!hasIdentity) {
        errors.push(`docs/design/GDD.md does not reference this game's id ("${gameConfig.id}") or name ("${gameConfig.name}")`);
      }
    }
  }

  let blueprint = null;
  if (hasDesignJson) {
    try {
      const rawBp = JSON.parse(await readFile(designJsonPath, 'utf8'));
      blueprint = defineGameBlueprint(rawBp);
      const evalRes = evaluateBlueprintBalance(blueprint);
      if (!evalRes.ok) {
        for (const err of evalRes.errors) errors.push(`src/game.design.json: ${err}`);
      }
      if (contents['GDD.md'] && !contents['GDD.md'].includes(blueprint.meta.genre)) {
        errors.push(`docs/design/GDD.md is out of sync with src/game.design.json genre "${blueprint.meta.genre}"`);
      }
      if (contents['ART-AND-AUDIO.md'] && !contents['ART-AND-AUDIO.md'].includes(blueprint.art.theme)) {
        errors.push(`docs/design/ART-AND-AUDIO.md is out of sync with src/game.design.json art.theme "${blueprint.art.theme}"`);
      }
    } catch (err) {
      errors.push(`Invalid src/game.design.json: ${err.message}`);
    }
  } else if (options.strict) {
    warnings.push('src/game.design.json not found (recommended for machine-checked 5-pillar balance)');
  }

  const levelJsonPath = path.join(gameDir, 'src', 'level.json');
  if (existsSync(levelJsonPath) && typeof analyzeStageDesign === 'function') {
    try {
      const rawLevel = JSON.parse(await readFile(levelJsonPath, 'utf8'));
      const levelAudit = analyzeStageDesign(rawLevel, { strictGameplay: Boolean(options.strict) });
      for (const err of levelAudit.errors) errors.push(`src/level.json: ${err}`);
      for (const w of levelAudit.warnings) warnings.push(`src/level.json: ${w}`);
    } catch (err) {
      errors.push(`Invalid src/level.json: ${err.message}`);
    }
  }

  const campaignJsonPath = path.join(gameDir, 'src', 'campaign.json');
  if (existsSync(campaignJsonPath) && typeof analyzeCampaignProgression === 'function') {
    try {
      const rawCamp = JSON.parse(await readFile(campaignJsonPath, 'utf8'));
      const campAudit = analyzeCampaignProgression(rawCamp, { strictGameplay: Boolean(options.strict) });
      for (const err of campAudit.errors) errors.push(`src/campaign.json: ${err}`);
      for (const w of campAudit.warnings) warnings.push(`src/campaign.json: ${w}`);
    } catch (err) {
      errors.push(`Invalid src/campaign.json: ${err.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 'passed' : 'failed',
    gameDir,
    docs: checkedDocs,
    hasDesignJson,
    blueprintMeta: blueprint?.meta ?? null,
    errors,
    warnings,
  };
}

function parseArgs(argv) {
  let targetDir = '.';
  let strict = false;
  let json = false;
  for (const arg of argv) {
    if (arg === '--strict') strict = true;
    else if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/check-design-docs.mjs [game-dir] [--strict] [--json]');
      process.exit(0);
    } else if (!arg.startsWith('-')) targetDir = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { targetDir, strict, json };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const { targetDir, strict, json } = parseArgs(process.argv.slice(2));
  const result = await auditDesignDocs(targetDir, { strict });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`[DESIGN-DOCS:OK] ${path.basename(result.gameDir)} (${result.docs.length} docs verified)`);
  } else {
    console.error(`[DESIGN-DOCS:FAILED] ${path.basename(result.gameDir)}`);
    for (const err of result.errors) console.error('  - ' + err);
  }
  if (!result.ok) process.exitCode = 1;
}
