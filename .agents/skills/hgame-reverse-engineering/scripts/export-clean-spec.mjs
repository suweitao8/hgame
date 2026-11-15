#!/usr/bin/env node
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveReConfig } from './local-config.mjs';

const WIN_PATH_RE = /[A-Za-z]:\\(?:[^\\\s"',;)}\]]+\\)*[^\\\s"',;)}\]]*/g;
const UNIX_USER_PATH_RE = /(?:\/Users\/|\/home\/|\/mnt\/[a-z]\/)[^\s"',;)}\]]+/g;
const BINARY_EXT_RE = /\b[A-Za-z0-9_.-]+\.(?:dll|exe|pck|pak|utoc|ucas|uasset|uexp|rpa|rpyc|asar|assets|bundle|win|unx|dat|so|dylib|jar|apk|ipa)\b/gi;

function parseArgs(argv) {
  const opts = { researchDir: null, slug: null, out: null, ipTerms: [], json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--slug') opts.slug = argv[++i];
    else if (token === '--out') opts.out = argv[++i];
    else if (token === '--ip-terms') {
      opts.ipTerms.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    } else if (token === '--json') opts.json = true;
    else if (token === '--help' || token === '-h') opts.help = true;
    else if (!token.startsWith('-') && !opts.researchDir) opts.researchDir = token;
    else throw new Error(`Unknown or incomplete argument: ${token}`);
  }
  if (opts.help) return opts;
  const localConfig = resolveReConfig();
  opts.workspaceDir = localConfig.reWorkspaceDir;
  if (!opts.researchDir && opts.slug) {
    opts.researchDir = path.join(opts.workspaceDir, 'projects', opts.slug);
  }
  if (!opts.researchDir) {
    throw new Error('Usage: node export-clean-spec.mjs [<research-dir> | --slug <slug>] [--out <clean-spec.json>] [--ip-terms "TermA,TermB"] [--json]');
  }
  return opts;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(relativeFix(rel)));
}

function relativeFix(r) { return r; }

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeString(value, ipMatchers, report) {
  let text = String(value);
  const lineCount = text.split(/\r?\n/).length;
  const looksLikeCode = /[;{}]|\b(?:public|private|protected|class|struct|function|void|return|import|export)\b/.test(text);
  if (lineCount > 3 && looksLikeCode) {
    report.redactedCodeSnippets += 1;
    return '[REDACTED_CODE_SNIPPET]';
  }
  if (lineCount > 3 && text.length > 240) {
    report.redactedCodeSnippets += 1;
    return text.split(/\r?\n/).slice(0, 3).join('\n') + '\n[TRUNCATED_MULTILINE]';
  }

  const binMatches = text.match(BINARY_EXT_RE);
  if (binMatches) {
    report.strippedBinaryRefs += binMatches.length;
  }
  text = text.replace(WIN_PATH_RE, () => {
    report.strippedPaths += 1;
    return '[LOCAL_PATH]';
  });
  text = text.replace(UNIX_USER_PATH_RE, () => {
    report.strippedPaths += 1;
    return '[LOCAL_PATH]';
  });
  text = text.replace(BINARY_EXT_RE, () => '[SOURCE_MODULE]');
  for (const re of ipMatchers) {
    text = text.replace(re, () => {
      report.strippedIpTerms += 1;
      return '[ENTITY]';
    });
  }
  return text;
}

function sanitizeValue(val, ipMatchers, report) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') return sanitizeString(val, ipMatchers, report);
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) return val.map((item) => sanitizeValue(item, ipMatchers, report));
  if (typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (['sourcePath', 'source_ref', 'evidence_ref', 'rawPath', 'decompiledCode'].includes(k)) {
        report.strippedPaths += 1;
        continue;
      }
      const cleanKey = sanitizeString(k, ipMatchers, report);
      out[cleanKey] = sanitizeValue(v, ipMatchers, report);
    }
    return out;
  }
  return val;
}

async function loadExtractedTables(extractedDir) {
  const tables = {};
  try {
    const entries = await readdir(extractedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const key = path.basename(entry.name, '.json');
      const parsed = await readJsonIfExists(path.join(extractedDir, entry.name));
      if (parsed !== null) tables[key] = parsed;
    }
  } catch {
    // extracted-data is optional
  }
  return tables;
}

function inferRecipe(rebuildPlan, engineProfile, specDraft) {
  if (rebuildPlan?.engineRecipe?.profile) {
    return rebuildPlan.engineRecipe;
  }
  if (specDraft?.recommendedRecipe?.profile) {
    return specDraft.recommendedRecipe;
  }
  const profile = specDraft?.recommendedProfile || '2d';
  const defaultRenderer = profile === '3d' ? 'threejs' : profile === 'ui' ? 'dom' : 'canvas2d';
  return {
    profile,
    renderer: defaultRenderer,
    physics: 'none',
    tickHz: profile === 'ui' ? 0 : 60,
    sourceEngineHint: engineProfile?.engine?.id || 'unknown',
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node export-clean-spec.mjs <research-dir> [--slug <slug>] [--out <clean-spec.json>] [--ip-terms "TermA,TermB"] [--json]');
    return;
  }

  const researchDir = await realpath(path.resolve(opts.researchDir));
  if (!(await stat(researchDir)).isDirectory()) throw new Error('Research directory does not exist');

  const baseline = await readJsonIfExists(path.join(researchDir, 'baseline.json'));
  const engineProfile = await readJsonIfExists(path.join(researchDir, 'production', 'engine-profile.json'));
  const rebuildPlan = await readJsonIfExists(path.join(researchDir, 'production', 'rebuild-plan.json'));
  const specDraft =
    (await readJsonIfExists(path.join(researchDir, 'production', 'spec-draft.json'))) ||
    (await readJsonIfExists(path.join(researchDir, 'production', 'mechanics.json'))) ||
    {};

  const slug = (opts.slug || baseline?.gameId || engineProfile?.game?.id || path.basename(researchDir))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(slug)) {
    throw new Error(`Invalid clean-spec slug: ${slug}`);
  }

  const outPath = path.resolve(opts.out || path.join(opts.workspaceDir, 'specs-out', `${slug}.clean-spec.json`));
  if (baseline?.sourcePath) {
    try {
      const srcReal = await realpath(baseline.sourcePath);
      if (isInside(srcReal.toLowerCase(), outPath.toLowerCase())) {
        throw new Error('Clean spec output must never be inside the original game directory');
      }
    } catch (err) {
      if (err.message.includes('never be inside')) throw err;
    }
  }

  const rawIpTerms = new Set(opts.ipTerms);
  if (Array.isArray(specDraft.ipTerms)) {
    for (const t of specDraft.ipTerms) if (t) rawIpTerms.add(String(t).trim());
  }
  if (baseline?.name && baseline.name !== slug && baseline.name.length >= 2) {
    rawIpTerms.add(baseline.name);
  }
  const ipMatchers = [...rawIpTerms]
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length)
    .map((term) => new RegExp(escapeRegExp(term), 'gi'));

  const report = {
    strippedPaths: 0,
    strippedBinaryRefs: 0,
    strippedIpTerms: 0,
    redactedCodeSnippets: 0,
    clean: true,
  };

  const extractedTables = await loadExtractedTables(path.join(researchDir, 'raw', 'extracted-data'));
  const recipe = inferRecipe(rebuildPlan, engineProfile, specDraft);

  const rawSpec = {
    schemaVersion: 1,
    specKind: 'hgame-clean-spec',
    slug,
    generatedAt: new Date().toISOString(),
    recommendedProfile: recipe.profile,
    engineRecipe: {
      profile: recipe.profile,
      renderer: recipe.renderer || (recipe.profile === '3d' ? 'threejs' : recipe.profile === 'ui' ? 'dom' : 'canvas2d'),
      physics: recipe.physics || 'none',
      tickHz: recipe.tickHz ?? (recipe.profile === 'ui' ? 0 : 60),
    },
    mechanics: specDraft.mechanics || {
      coreLoop: specDraft.coreLoop || { status: 'unknown' },
      threeC: specDraft.threeC || { status: 'unknown' },
      stateMachines: specDraft.stateMachines || [],
      waveDirector: specDraft.waveDirector || { status: 'unknown' },
      economy: specDraft.economy || { status: 'unknown' },
    },
    tables: Object.keys(specDraft.tables || {}).length > 0 ? specDraft.tables : extractedTables,
    levels: specDraft.levels || [],
    hgameFallbackModules: specDraft.hgameFallbackModules || [
      'renderer-shader',
      'skeleton-state-machine',
      'navmesh-solver',
      'physics-solver',
      'vfx-particles',
      'synth-audio',
      'minimal-ui',
    ],
  };

  const cleanSpec = sanitizeValue(rawSpec, ipMatchers, report);
  cleanSpec.sanitizationReport = report;

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(cleanSpec, null, 2) + '\n', 'utf8');

  const result = { success: true, slug, outPath, sanitizationReport: report };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`[export-clean-spec] Exported clean spec -> ${outPath}`);
}

main().catch((err) => {
  console.error('export-clean-spec failed: ' + err.message);
  process.exitCode = 1;
});
