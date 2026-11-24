#!/usr/bin/env node
// Unified Fail-Closed Self-Test & Acceptance Gate for HGame projects and examples.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lintFiles, collectFiles as collectUiFiles } from './check-ui-resolve.mjs';
import { runAutoplayGate } from './check-autoplay.mjs';
import { auditDesignDocs } from './check-design-docs.mjs';
import { numberOption, viewportOption } from './lib/cli-numbers.mjs';
import { launchChromium, resolvePlaywright } from './lib/playwright-resolve.mjs';
import { resolveWebAssetGame, verifyWebAssetSource, webAssetOrigins } from './playtest.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const WEBASSET_ALLOWLIST_KEYS = new Set([
  'schemaVersion',
  'id',
  'name',
  'version',
  'entry',
  'renderer',
  'runtime',
  'standalone',
]);

const RENDERER_CATALOG_MAP = Object.freeze({
  canvas2d: 'canvas2d',
  webgl2d: 'webgl-custom',
  threejs: 'threejs',
  dom: 'dom',
});

async function loadDefineProject() {
  const candidates = [
    path.join(repoRoot, 'assets', 'runtime', 'core', 'config.js'),
    path.join(repoRoot, 'vendor', 'hgame', 'core', 'config.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const mod = await import(pathToFileURL(candidate).href);
      return mod.defineProject;
    }
  }
  throw new Error('Cannot find HGame core/config.js (expected assets/runtime or vendor/hgame)');
}

function resolveSiblingScript(name, fallbackRel = null) {
  const local = path.join(scriptDir, name);
  if (existsSync(local)) return local;
  if (fallbackRel) {
    const fb = path.join(repoRoot, fallbackRel);
    if (existsSync(fb)) return fb;
  }
  throw new Error(`Required verification script missing: ${name}`);
}

function parseArgs(argv) {
  const opts = {
    gameDir: '',
    quick: false,
    strict: false,
    webasset: false,
    skipWebasset: false,
    doctor: false,
    requireAutoplay: false,
    autoplayRuns: undefined,
    autoplayIdleRuns: undefined,
    packageCheck: false,
    release: false,
    verifyFresh: false,
    examples: false,
    allowSkips: false,
    allowIdMismatch: false,
    viewport: '960x540',
    mobileViewport: '360x800',
    skipMobilePlaytest: false,
    ready: '',
    chrome: '',
    out: '',
    json: false,
    help: false,
  };
  const takeValue = (i, flag) => {
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Error(`${flag} requires a value`);
    return val;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') opts.quick = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--webasset') opts.webasset = true;
    else if (a === '--skip-webasset') opts.skipWebasset = true;
    else if (a === '--doctor') opts.doctor = true;
    else if (a === '--require-autoplay') opts.requireAutoplay = true;
    else if (a === '--autoplay-runs') opts.autoplayRuns = numberOption(takeValue(i++, a), a, { integer: true, min: 1 });
    else if (a === '--autoplay-idle-runs') opts.autoplayIdleRuns = numberOption(takeValue(i++, a), a, { integer: true, min: 0 });
    else if (a === '--package') opts.packageCheck = true;
    else if (a === '--release') opts.release = true;
    else if (a === '--verify-fresh') opts.verifyFresh = true;
    else if (a === '--examples') opts.examples = true;
    else if (a === '--allow-skips') opts.allowSkips = true;
    else if (a === '--allow-id-mismatch') opts.allowIdMismatch = true;
    else if (a === '--viewport') opts.viewport = takeValue(i++, a);
    else if (a === '--mobile-viewport') opts.mobileViewport = takeValue(i++, a);
    else if (a === '--skip-mobile-playtest') opts.skipMobilePlaytest = true;
    else if (a === '--ready') opts.ready = takeValue(i++, a);
    else if (a === '--chrome') opts.chrome = takeValue(i++, a);
    else if (a === '--out') opts.out = takeValue(i++, a);
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (!a.startsWith('-') && !opts.gameDir) opts.gameDir = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (opts.release) {
    if (opts.quick || opts.allowSkips || opts.allowIdMismatch || opts.skipWebasset || opts.skipMobilePlaytest ||
        opts.examples) {
      throw new Error('--release cannot be combined with quick, skip, example, ID mismatch, or identical viewport options');
    }
    const desktop = viewportOption(opts.viewport);
    const mobile = viewportOption(opts.mobileViewport);
    if (mobile.width >= mobile.height || (desktop.width === mobile.width && desktop.height === mobile.height)) {
      throw new Error('--release requires a distinct portrait mobile viewport');
    }
    opts.strict = true;
    opts.webasset = true;
    opts.packageCheck = true;
  }
  viewportOption(opts.viewport);
  viewportOption(opts.mobileViewport);
  return opts;
}

const RELEASE_ARCHIVE = 'build/acceptance/release.zip';
const PLAYABLE_GATES = ['config', 'syntax', 'uiStatic', 'designDocs', 'tests', 'visual', 'playtest', 'webasset'];

async function loadReleaseRequirements(gameDir) {
  const filename = path.join(gameDir, 'tests', 'release.json');
  if (!existsSync(filename)) throw new Error('Release requires tests/release.json with explicit budgets');
  const spec = JSON.parse(await readFile(filename, 'utf8'));
  if (!['web', 'toy'].includes(spec?.target)) throw new Error('Release target must be web or toy');
  if (spec.gpu !== undefined && !['software', 'hardware'].includes(spec.gpu)) {
    throw new Error('Release gpu must be software or hardware');
  }
  if (spec.mobileTouch !== undefined && typeof spec.mobileTouch !== 'boolean') {
    throw new Error('Release mobileTouch must be a boolean');
  }
  if (spec.mobileMultiTouch !== undefined && typeof spec.mobileMultiTouch !== 'boolean') {
    throw new Error('Release mobileMultiTouch must be a boolean');
  }
  if (spec.mobileMultiTouch && spec.mobileTouch === false) {
    throw new Error('Release mobileMultiTouch requires mobileTouch to be enabled or omitted');
  }
  for (const gate of ['autoplay', 'doctor']) {
    const requirement = spec[gate];
    if (requirement !== true && (typeof requirement !== 'string' || !requirement.trim())) {
      throw new Error('Release ' + gate + ' must be true or explain why it does not apply');
    }
  }
  for (const viewport of ['desktop', 'mobile']) {
    for (const metric of ['readyMs', 'p95Ms']) {
      const max = spec.limits?.[viewport]?.[metric];
      if (!Number.isFinite(max) || max <= 0) throw new Error('Invalid release budget ' + viewport + '.' + metric);
    }
    for (const metric of ['p99Ms', 'minDurationMs', 'peakEstimatedGpuBytes']) {
      const value = spec.limits?.[viewport]?.[metric];
      if (value !== undefined && (!Number.isFinite(value) || value <= 0 ||
          (metric === 'peakEstimatedGpuBytes' && !Number.isSafeInteger(value)))) {
        throw new Error('Invalid release budget ' + viewport + '.' + metric);
      }
    }
  }
  if (!Number.isSafeInteger(spec.limits.zipBytes) || spec.limits.zipBytes <= 0) {
    throw new Error('Invalid release budget zipBytes');
  }
  if (!existsSync(path.join(gameDir, 'tests', 'acceptance.mjs'))) {
    throw new Error('Release requires tests/acceptance.mjs with observable input checkpoints');
  }
  return spec;
}

function hasMeasuredMobileTouch(profile) {
  return profile?.rendererEnvironment?.touch === true &&
    Number.isSafeInteger(profile.touchPresses) && profile.touchPresses > 0;
}

function requiresMobileTouch(spec) {
  return spec?.mobileTouch === true || spec?.mobileMultiTouch === true;
}

function hasMeasuredMobileMultiTouch(playtest) {
  const profile = playtest?.profiles?.mobile;
  const checkpoints = playtest?.mobileMeasuredCheckpoints;
  return hasMeasuredMobileTouch(profile) &&
    Number.isSafeInteger(profile.peakTouchContacts) &&
    profile.peakTouchContacts >= 2 && profile.peakTouchContacts <= profile.touchPresses &&
    Number.isSafeInteger(profile.multiTouchMoves) && profile.multiTouchMoves > 0 &&
    Array.isArray(checkpoints) && checkpoints.some(checkpoint => checkpoint?.ok === true &&
      Number.isSafeInteger(checkpoint.multiTouchMoves) && checkpoint.multiTouchMoves > 0 &&
      checkpoint.multiTouchMoves <= profile.multiTouchMoves);
}

function evaluateRelease(gates, spec) {
  const errors = [];
  const skipped = {};
  for (const name of [...PLAYABLE_GATES, 'package', 'autoplay', 'doctor']) {
    if (gates[name]?.status === 'passed') continue;
    if ((name === 'autoplay' || name === 'doctor') && typeof spec[name] === 'string' && gates[name]?.status === 'skipped') {
      skipped[name] = spec[name];
    } else {
      errors.push('Required release gate did not pass: ' + name);
    }
  }
  if (gates.autoplay.status === 'passed' &&
      ((gates.autoplay.bot?.runs ?? 0) < 2 || (gates.autoplay.idle?.runs ?? 0) < 2)) {
    errors.push('Release autoplay requires multiple bot and idle seeds');
  }
  const packaged = gates.package.playtest;
  const desktop = packaged?.profiles?.desktop;
  const mobile = packaged?.profiles?.mobile;
  const measured = { desktop, mobile, zipBytes: gates.package.zipBytes ?? null };
  if (spec.mobileMultiTouch && !hasMeasuredMobileMultiTouch(packaged)) {
    errors.push('mobile requires two concurrent trusted touch contacts with a move during a passing measured checkpoint');
  } else if (spec.mobileTouch && !hasMeasuredMobileTouch(mobile)) {
    errors.push('mobile requires a trusted touch press during the measured run');
  }
  for (const [name, profile, checkpoints] of [
    ['desktop', desktop, packaged?.measuredCheckpoints], ['mobile', mobile, packaged?.mobileMeasuredCheckpoints],
  ]) {
    if (!checkpoints?.some(checkpoint => checkpoint.ok === true)) errors.push(name + ' needs a passing authored checkpoint within the measured run');
    if (!Number.isFinite(profile?.frames) || profile.frames < 30) errors.push(name + ' needs at least 30 measured frames');
    if (spec.gpu === 'hardware' && profile?.rendererEnvironment?.actualGpu !== 'hardware') {
      errors.push(name + ' requires an actual hardware renderer');
    }
    const limits = spec.limits[name];
    if (limits.p99Ms !== undefined &&
        (profile?.quantilesApproximate !== false || profile.quantileSamples !== profile.frames)) {
      errors.push(name + '.p99Ms requires all measured frames');
    }
    for (const metric of ['readyMs', 'p95Ms', 'p99Ms']) {
      const value = profile?.[metric];
      const max = limits[metric];
      if (max !== undefined && (!Number.isFinite(value) || value > max)) {
        errors.push(name + '.' + metric + ' exceeded budget or is missing (limit ' + max + ')');
      }
    }
    if (limits.minDurationMs !== undefined &&
        (!Number.isFinite(profile?.durationMs) || profile.durationMs < limits.minDurationMs)) {
      errors.push(name + '.minDurationMs not met (minimum ' + limits.minDurationMs + ')');
    }
    const memoryBudget = limits.peakEstimatedGpuBytes;
    if (memoryBudget !== undefined) {
      const memory = profile?.renderMemory;
      if (memory?.error || !(memory?.samples >= 2) || !(memory?.maxSampleGapMs <= 2500) ||
          !Number.isFinite(memory?.peakEstimatedGpuBytes) ||
          memory.peakEstimatedGpuBytes > memoryBudget) {
        errors.push(name + '.peakEstimatedGpuBytes exceeded budget or is missing (limit ' + memoryBudget + ')');
      }
    }
  }
  if (!Number.isFinite(measured.zipBytes) || measured.zipBytes > spec.limits.zipBytes) {
    errors.push('Package exceeded byte budget or is missing (limit ' + spec.limits.zipBytes + ')');
  }
  return {
    status: errors.length ? 'failed' : 'passed', target: spec.target, gpu: spec.gpu ?? 'software', skipped,
    limits: spec.limits, measured, mobileTouch: requiresMobileTouch(spec), mobileMultiTouch: spec.mobileMultiTouch === true,
    environment: 'headless browser; viewport profiles, not physical devices', errors,
  };
}

function walkFiles(dir, { exts = null, skipDirs = new Set(['node_modules', 'vendor', 'dist', 'build', '.git', '.tools', '.cache']) } = {}) {
  const out = [];
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, { exts, skipDirs }));
    } else if (entry.isFile()) {
      if (!exts || exts.has(path.extname(entry.name).toLowerCase())) out.push(abs);
    }
  }
  return out;
}

/**
 * Computes a deterministic SHA-256 digest over authored source, config, HTML, CSS, and test files.
 * @param {string} gameDir
 */
export function computeSourceDigest(gameDir, { release = false } = {}) {
  const hash = createHash('sha256');
  if (release) {
    const files = walkFiles(gameDir, { skipDirs: new Set(['node_modules', 'build', '.git', '.tools', '.cache']) });
    const pixiBuild = path.join(gameDir, '.hgame-pixi-build.json');
    if (existsSync(pixiBuild)) files.push(pixiBuild);
    for (const file of files) {
      hash.update(path.relative(gameDir, file).replace(/\\/g, '/')).update('\0');
      hash.update(readFileSync(file)).update('\0');
    }
    return hash.digest('hex');
  }
  const rootFiles = [
    'index.html',
    'index.source.html',
    'style.css',
    'game.config.json',
    'engine.config.json',
    'hgame.project.json',
    'assets.manifest.json',
  ];
  const candidates = [];
  for (const rel of rootFiles) {
    const abs = path.join(gameDir, rel);
    if (existsSync(abs) && statSync(abs).isFile()) candidates.push([rel, abs]);
  }
  for (const rootEntry of readdirSync(gameDir, { withFileTypes: true })) {
    if (!rootEntry.isFile()) continue;
    const ext = path.extname(rootEntry.name).toLowerCase();
    if (['.css', '.html'].includes(ext) && !rootFiles.includes(rootEntry.name)) {
      candidates.push([rootEntry.name, path.join(gameDir, rootEntry.name)]);
    }
  }
  const sourceDirs = ['src', 'tests', 'docs/design'];
  for (const sub of sourceDirs) {
    for (const abs of walkFiles(path.join(gameDir, sub))) {
      candidates.push([path.relative(gameDir, abs).replace(/\\/g, '/'), abs]);
    }
  }
  candidates.sort((a, b) => a[0].localeCompare(b[0]));
  for (const [rel, abs] of candidates) {
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(abs));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function detectBareScaffold(gameDir) {
  for (const rel of ['src/bare.js', 'src/main.js']) {
    const abs = path.join(gameDir, rel);
    if (existsSync(abs)) {
      const text = readFileSync(abs, 'utf8');
      if (text.includes('TODO: add entities/components')) return true;
    }
  }
  return false;
}

function detectProjectMeta(gameDir, recipe, opts = {}) {
  const indexHtmlPath = path.join(gameDir, 'index.html');
  const sourceHtmlPath = path.join(gameDir, 'index.source.html');
  const htmlText = existsSync(sourceHtmlPath)
    ? readFileSync(sourceHtmlPath, 'utf8')
    : existsSync(indexHtmlPath)
      ? readFileSync(indexHtmlPath, 'utf8')
      : '';
  const isUi = recipe.profile === 'ui' || recipe.renderer === 'dom';
  const isPixi = existsSync(path.join(gameDir, '.hgame-pixi-build.json')) || htmlText.includes('id="game-canvas"');
  const srcFiles = walkFiles(path.join(gameDir, 'src'), { exts: new Set(['.js', '.mjs']) });
  let hasEngineReadyHook = htmlText.includes('data-engine-ready');
  let hasDoctorHook = false;
  let hasStateHook = false;
  for (const file of srcFiles) {
    const content = readFileSync(file, 'utf8');
    if (content.includes('engineReady') || content.includes('data-engine-ready')) hasEngineReadyHook = true;
    if (content.includes('__HGAME_DOCTOR__') && !content.includes('isStub: true')) hasDoctorHook = true;
    if (content.includes('__hgameState')) hasStateHook = true;
  }
  if (isPixi) {
    hasEngineReadyHook = true;
    hasStateHook = true;
  }
  const selector = isUi ? 'body' : isPixi ? '#game-canvas' : '#game';
  const ready = opts?.ready || (isUi
    ? (hasEngineReadyHook ? '[data-engine-ready=true]' : 'main, body')
    : isPixi
      ? '#game-canvas[data-engine-ready=true]'
      : (hasEngineReadyHook ? '#game[data-engine-ready=true]' : '#game'));

  return {
    isUi,
    isPixi,
    isBare: detectBareScaffold(gameDir),
    hasEngineReadyHook,
    hasDoctorHook,
    hasStateHook,
    selector,
    ready,
  };
}

async function runConfigGate(gameDir, opts, defineProject) {
  const errors = [];
  const warnings = [];
  let recipe = null;
  let gameConfig = null;

  const engineCfgPath = path.join(gameDir, 'engine.config.json');
  if (!existsSync(engineCfgPath)) {
    errors.push('Missing engine.config.json');
  } else {
    try {
      recipe = defineProject(JSON.parse(await readFile(engineCfgPath, 'utf8')));
    } catch (err) {
      errors.push(`Invalid engine.config.json: ${err.message}`);
    }
  }

  const gameCfgPath = path.join(gameDir, 'game.config.json');
  if (!existsSync(gameCfgPath)) {
    errors.push('Missing game.config.json');
  } else {
    try {
      gameConfig = JSON.parse(await readFile(gameCfgPath, 'utf8'));
      const keys = Object.keys(gameConfig);
      const extraKeys = keys.filter(k => !WEBASSET_ALLOWLIST_KEYS.has(k));
      if (extraKeys.length > 0) {
        errors.push(`game.config.json contains disallowed extra keys (WebAsset will skip): ${extraKeys.join(', ')}`);
      }
      if (gameConfig.schemaVersion !== 1) errors.push('game.config.json schemaVersion must be 1');
      if (typeof gameConfig.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(gameConfig.id)) {
        errors.push(`game.config.json id "${gameConfig.id}" must be an ASCII slug [A-Za-z0-9_-]`);
      } else if (!opts.allowIdMismatch && gameConfig.id !== path.basename(gameDir)) {
        errors.push(`game.config.json id "${gameConfig.id}" must match directory name "${path.basename(gameDir)}"`);
      }
      if (typeof gameConfig.name !== 'string' || !gameConfig.name.trim()) {
        errors.push('game.config.json name must be a non-empty string');
      }
      if (typeof gameConfig.version !== 'string' || !gameConfig.version.trim()) {
        errors.push('game.config.json version must be a non-empty string');
      }
      if (gameConfig.runtime !== 'webasset-v1') {
        errors.push(`game.config.json runtime must be "webasset-v1" (got ${JSON.stringify(gameConfig.runtime)})`);
      }
      if (typeof gameConfig.standalone !== 'boolean') {
        errors.push('game.config.json standalone must be boolean');
      }
      if (typeof gameConfig.entry !== 'string' || !gameConfig.entry.trim()) {
        errors.push('game.config.json entry must be a non-empty relative path');
      } else {
        const entryAbs = path.resolve(gameDir, gameConfig.entry);
        const rel = path.relative(gameDir, entryAbs);
        if (rel.startsWith('..') || path.isAbsolute(rel) || !existsSync(entryAbs)) {
          errors.push(`game.config.json entry "${gameConfig.entry}" does not exist inside project`);
        }
      }
      if (recipe) {
        const expectedCatalogRenderer = RENDERER_CATALOG_MAP[recipe.renderer];
        if (expectedCatalogRenderer && gameConfig.renderer !== expectedCatalogRenderer) {
          errors.push(`game.config.json renderer "${gameConfig.renderer}" mismatches engine.config.json "${recipe.renderer}" (expected "${expectedCatalogRenderer}")`);
        }
      }
    } catch (err) {
      errors.push(`Invalid game.config.json: ${err.message}`);
    }
  }

  const htmlTargets = new Set(['index.html', 'index.source.html']);
  if (typeof gameConfig?.entry === 'string' && gameConfig.entry.trim()) {
    htmlTargets.add(gameConfig.entry.trim().replace(/^\.\//, ''));
  }
  for (const htmlName of htmlTargets) {
    const htmlPath = path.join(gameDir, htmlName);
    if (!existsSync(htmlPath)) continue;
    const html = await readFile(htmlPath, 'utf8');
    const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, '');
    const assetRefRe = /<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = assetRefRe.exec(cleanHtml)) !== null) {
      const ref = m[1].trim();
      if (!ref || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('#')) continue;
      if (/^(?:https?:|\/\/)/i.test(ref)) {
        errors.push(`${htmlName} references external CDN/network URL "${ref}" (games must be self-contained)`);
        continue;
      }
      const cleanRef = ref.split(/[?#]/)[0];
      const absRef = path.resolve(gameDir, cleanRef.replace(/^\/+/, ''));
      if (!existsSync(absRef)) {
        errors.push(`${htmlName} references missing local file "${ref}"`);
      }
    }
  }

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    errors,
    warnings,
    recipe,
    gameConfig,
  };
}

async function runSyntaxGate(gameDir) {
  const errors = [];
  const checkedFiles = [];
  const srcFiles = walkFiles(path.join(gameDir, 'src'), { exts: new Set(['.js', '.mjs']) });
  const testFiles = walkFiles(path.join(gameDir, 'tests'), { exts: new Set(['.js', '.mjs']) });
  const rootJs = readdirSync(gameDir, { withFileTypes: true })
    .filter(e => e.isFile() && ['.js', '.mjs'].includes(path.extname(e.name).toLowerCase()))
    .map(e => path.join(gameDir, e.name));

  const allFiles = [...srcFiles, ...testFiles, ...rootJs];
  if (allFiles.length === 0) {
    errors.push('No JavaScript source files found in src/ or root');
  }

  for (const file of allFiles) {
    const rel = path.relative(gameDir, file).replace(/\\/g, '/');
    checkedFiles.push(rel);
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (res.status !== 0) {
      errors.push(`${rel}: ${(res.stderr || res.stdout || 'syntax error').trim().split('\n').slice(0, 3).join(' | ')}`);
    }
  }

  // Verify static relative ESM imports inside src/ resolve to real files on disk.
  const importRe = /(?:^|[;\n}])\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
  const dynamicStaticRe = /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const file of srcFiles) {
    const rel = path.relative(gameDir, file).replace(/\\/g, '/');
    const code = stripJsComments(await readFile(file, 'utf8'));
    for (const re of [importRe, dynamicStaticRe]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        const spec = m[1].split(/[?#]/)[0];
        const target = path.resolve(path.dirname(file), spec);
        if (!existsSync(target)) {
          errors.push(`${rel}: unresolved relative import "${m[1]}"`);
        }
      }
    }
  }

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    checkedCount: checkedFiles.length,
    errors,
  };
}

function runUiStaticGate(gameDir) {
  const files = collectUiFiles(gameDir);
  const report = lintFiles(files);
  const errors = report.violations.map(v => `${v.file}:${v.line} [${v.rule}] ${v.message}`);
  return {
    status: report.pass ? 'passed' : 'failed',
    scannedFiles: report.scannedFiles.length,
    violationCount: report.violationCount,
    errors,
  };
}

async function runTestsGate(gameDir, opts) {
  const testDir = path.join(gameDir, 'tests');
  const testFiles = walkFiles(testDir, { exts: new Set(['.mjs', '.cjs']) })
    .filter(f => /\.test\.(?:mjs|cjs)$/i.test(f));

  if (testFiles.length === 0) {
    return {
      status: 'failed',
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: ['No *.test.mjs or *.test.cjs files found under tests/'],
    };
  }

  const res = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', ...testFiles],
    {
      cwd: gameDir,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );

  const tap = res.stdout || '';
  const failLines = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let todo = 0;
  for (const line of tap.split(/\r?\n/)) {
    if (/^ok \d+ - /.test(line)) {
      if (/# SKIP\b/i.test(line)) skipped++;
      else if (/# TODO\b/i.test(line)) todo++;
      else passed++;
    } else if (/^not ok \d+ - /.test(line)) {
      if (/# TODO\b/i.test(line)) todo++;
      else {
        failed++;
        failLines.push(line.replace(/^not ok \d+ - /, '').trim());
      }
    }
  }

  const total = passed + failed + skipped + todo;
  const errors = [];
  if (res.error) errors.push(res.error.message);
  if (total === 0 && res.status !== 0) errors.push((res.stderr || tap || 'node --test failed').trim().slice(0, 400));
  if (total === 0) errors.push('Zero tests executed');
  if (failed > 0) errors.push(`${failed} test(s) failed: ${failLines.slice(0, 5).join('; ')}`);
  if (!opts.allowSkips && skipped > 0) errors.push(`${skipped} skipped test(s) disallowed by acceptance gate`);
  if (!opts.allowSkips && todo > 0) errors.push(`${todo} TODO test(s) disallowed by acceptance gate`);
  if (res.status !== 0 && errors.length === 0) errors.push(`node --test exited with code ${res.status}`);

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    files: testFiles.map(f => path.relative(gameDir, f).replace(/\\/g, '/')),
    total,
    passed,
    failed,
    skipped,
    todo,
    errors,
  };
}

function runJsonSubprocess(scriptPath, args, { cwd, timeoutMs = 120_000 } = {}) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    parsed = {
      ok: false,
      problems: [(res.stderr || res.stdout || res.error?.message || `Process exited ${res.status}`).trim().slice(0, 400)],
    };
  }
  return { exitCode: res.status, report: parsed };
}

async function runVisualGate(gameDir, opts, meta, snapshotScript, gameConfig) {
  const outDir = path.join(gameDir, 'build', 'acceptance');
  await mkdir(outDir, { recursive: true });
  const desktopPng = path.join(outDir, 'desktop.png');
  const mobilePng = path.join(outDir, 'mobile.png');
  const allowBlank = meta.isBare && !opts.strict;
  const minNonBlank = opts.strict ? 0.005 : 0.001;
  const minUniqueColors = opts.strict ? 4 : 2;
  const entryPath = typeof gameConfig?.entry === 'string' && gameConfig.entry.trim() && gameConfig.entry.trim() !== 'index.html'
    ? '/' + gameConfig.entry.trim().replace(/^\.?\/+/, '')
    : null;

  const commonArgs = [
    gameDir,
    '--selector', meta.selector,
    '--ready', meta.ready,
    '--check-ui',
    '--check-layout',
    ...(entryPath ? ['--entry', entryPath] : []),
    ...(meta.isUi ? ['--max-hud-ratio', '0.85', '--max-hud-buttons', '4'] : []),
    ...(allowBlank ? ['--allow-blank'] : []),
    ...(opts.chrome ? ['--chrome', opts.chrome] : []),
  ];

  const runs = [
    { label: 'desktop', viewport: opts.viewport, out: desktopPng },
    { label: 'mobile', viewport: opts.mobileViewport, out: mobilePng },
  ];
  const errors = [];
  const captures = {};

  for (const r of runs) {
    const args = [...commonArgs, '--viewport', r.viewport, '--out', r.out];
    const { exitCode, report } = runJsonSubprocess(snapshotScript, args, { cwd: gameDir });
    const runErrors = [];
    if (exitCode !== 0 || report.ok !== true) {
      runErrors.push(...(report.problems?.length ? report.problems : [`snapshot failed (${exitCode})`]));
    }
    if (!allowBlank && report.stats) {
      if ((report.stats.nonBlankRatio ?? 0) < minNonBlank) {
        runErrors.push(`nonBlankRatio ${report.stats.nonBlankRatio} below ${minNonBlank}`);
      }
      const uniq = report.stats.uniqueColors === '5000+' ? 5000 : Number(report.stats.uniqueColors ?? 0);
      if (uniq < minUniqueColors) {
        runErrors.push(`uniqueColors ${report.stats.uniqueColors} below ${minUniqueColors} (monochrome frame)`);
      }
    }
    if (opts.strict && !meta.isBare && report.state == null) {
      runErrors.push('missing window.__hgameState() telemetry in strict mode');
    }
    for (const msg of runErrors) errors.push(`${r.label} (${r.viewport}): ${msg}`);
    captures[r.label] = {
      viewport: r.viewport,
      png: path.relative(gameDir, r.out).replace(/\\/g, '/'),
      ok: runErrors.length === 0,
      stats: report.stats ?? null,
      ui: report.diagnostics?.ui ?? null,
      consoleErrors: report.consoleErrors ?? [],
      httpErrors: report.httpErrors ?? [],
      errors: runErrors,
    };
  }

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    captures,
    errors,
  };
}

function runPlaytestGate(gameDir, opts, meta, playtestScript, { targetDir = gameDir, entry = null, releaseSpec = null } = {}) {
  const scenarioCandidates = [
    path.join(gameDir, 'tests', 'acceptance.mjs'),
    path.join(gameDir, 'playtest.mjs'),
  ];
  const scenario = scenarioCandidates.find(existsSync) ?? null;
  const allowBlank = meta.isBare && !opts.strict;
  const allowStatic = meta.isUi || (meta.isBare && !opts.strict);

  const buildArgs = (viewport, name) => [
    targetDir,
    ...(entry ? ['--entry', entry] : []),
    ...(releaseSpec?.gpu ? ['--gpu', releaseSpec.gpu] : []),
    ...(name === 'mobile' && requiresMobileTouch(releaseSpec) ? ['--touch'] : []),
    ...(releaseSpec?.limits?.[name]?.p99Ms !== undefined ? ['--exact-percentiles'] : []),
    ...(releaseSpec?.limits?.[name]?.peakEstimatedGpuBytes !== undefined ? ['--sample-render-memory'] : []),
    ...(opts.release ? ['--state-ready'] : []),
    '--selector', meta.selector,
    '--ready', meta.ready,
    '--viewport', viewport,
    '--check-ui',
    '--check-layout',
    ...(allowBlank ? ['--allow-blank'] : []),
    ...(allowStatic ? ['--allow-static'] : []),
    ...(opts.chrome ? ['--chrome', opts.chrome] : []),
    ...(scenario ? ['--scenario', scenario] : ['--duration', '1600']),
  ];

  const timeoutMs = name => {
    const minDuration = opts.releaseSpec?.limits?.[name]?.minDurationMs ?? 0;
    return Math.min(2_147_483_647, Math.max(150_000, Math.ceil(minDuration + 30_000)));
  };
  const { exitCode, report } = runJsonSubprocess(playtestScript, buildArgs(opts.viewport, 'desktop'), { cwd: gameDir, timeoutMs: timeoutMs('desktop') });
  const errors = [];
  if (exitCode !== 0 || report.ok !== true) {
    errors.push(...(report.problems?.length ? report.problems : [`playtest failed (${exitCode})`]));
  }
  if (opts.strict && !scenario) {
    errors.push('strict mode requires tests/acceptance.mjs scenario covering core gameplay loop');
  }
  if (opts.strict && !meta.isBare && report.stateAfter === null && report.stateBefore === null) {
    errors.push('strict mode requires window.__hgameState() telemetry');
  }

  let mobileReport = null;
  const runMobile = Boolean(scenario) && !opts.skipMobilePlaytest && opts.mobileViewport && opts.mobileViewport !== opts.viewport;
  if (runMobile) {
    const mobileRes = runJsonSubprocess(playtestScript, buildArgs(opts.mobileViewport, 'mobile'), { cwd: gameDir, timeoutMs: timeoutMs('mobile') });
    mobileReport = mobileRes.report;
    if (mobileRes.exitCode !== 0 || mobileRes.report?.ok !== true) {
      const probs = mobileRes.report?.problems?.length ? mobileRes.report.problems : [`mobile playtest failed (${mobileRes.exitCode})`];
      for (const p of probs) errors.push(`[${opts.mobileViewport}] ${p}`);
    }
  }

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    scenario: scenario ? path.relative(gameDir, scenario).replace(/\\/g, '/') : null,
    viewports: runMobile ? [opts.viewport, opts.mobileViewport] : [opts.viewport],
    visualChanged: report.visualChanged ?? null,
    stateChanged: report.stateChanged ?? null,
    checkpoints: report.checkpoints ?? null,
    measuredCheckpoints: report.measuredCheckpoints ?? null,
    uiAudits: report.uiAudits ?? null,
    ...(mobileReport ? {
      mobileCheckpoints: mobileReport.checkpoints ?? null,
      mobileMeasuredCheckpoints: mobileReport.measuredCheckpoints ?? null,
      mobileUiAudits: mobileReport.uiAudits ?? null,
    } : {}),
    frameStats: report.frameStats ?? null,
    profiles: Object.fromEntries([['desktop', report], ['mobile', mobileReport]]
      .filter(([, run]) => run)
      .map(([name, run]) => [name, {
        readyMs: run.readyMs ?? null, p95Ms: run.frameStats?.p95Ms ?? null,
        p99Ms: run.frameStats?.p99Ms ?? null, durationMs: run.actualDurationMs ?? null,
        quantileSamples: run.frameStats?.quantileSamples ?? null,
        quantilesApproximate: run.frameStats?.quantilesApproximate ?? null,
        frames: run.frameStats?.frames ?? null, browserVersion: run.browserVersion ?? null,
        rendererEnvironment: run.rendererEnvironment ?? null,
        ...(run.touchPresses !== undefined ? { touchPresses: run.touchPresses } : {}),
        ...(run.peakTouchContacts !== undefined ? { peakTouchContacts: run.peakTouchContacts } : {}),
        ...(run.multiTouchMoves !== undefined ? { multiTouchMoves: run.multiTouchMoves } : {}),
        ...(run.renderMemory ? { renderMemory: run.renderMemory } : {}),
      }])),
    consoleErrors: report.consoleErrors ?? [],
    httpErrors: report.httpErrors ?? [],
    errors,
  };
}

async function runAutoplayGateForAccept(gameDir, opts) {
  const specPath = path.join(gameDir, 'tests', 'autoplay.mjs');
  if (!existsSync(specPath)) {
    if (opts.requireAutoplay) {
      return {
        status: 'failed',
        errors: ['Missing tests/autoplay.mjs (--require-autoplay requires multi-seed clear-rate & difficulty verification)'],
      };
    }
    return {
      status: 'skipped',
      reason: 'no tests/autoplay.mjs (add to verify multi-seed clear-rate & difficulty)',
      errors: [],
    };
  }
  try {
    const res = await runAutoplayGate(gameDir, {
      runs: opts.autoplayRuns,
      idleRuns: opts.autoplayIdleRuns,
    });
    return {
      status: res.ok ? 'passed' : 'failed',
      spec: res.spec,
      thresholds: res.thresholds,
      bot: res.bot,
      idle: res.idle,
      skillDelta: res.skillDelta,
      errors: res.reasons,
    };
  } catch (err) {
    return {
      status: 'failed',
      errors: [err.message],
    };
  }
}

function runDoctorGate(gameDir, opts, meta, doctorScript) {
  if (!opts.doctor && !meta.hasDoctorHook) {
    return { status: 'skipped', reason: 'window.__HGAME_DOCTOR__ not present', errors: [] };
  }
  const { exitCode, report } = runJsonSubprocess(
    doctorScript,
    [gameDir, '--ready', meta.ready, ...(opts.chrome ? ['--chrome', opts.chrome] : []), '--json'],
    { cwd: gameDir, timeoutMs: 120_000 },
  );
  const errors = [];
  if (exitCode !== 0 || report.ok !== true) {
    for (const t of report.tests ?? []) {
      if (!t.pass) errors.push(`${t.name}: ${(t.reasons || []).join('; ')}`);
    }
    if (errors.length === 0) errors.push(...(report.problems ?? [`doctor exited ${exitCode}`]));
  }
  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    tests: report.tests ?? [],
    errors,
  };
}

export async function runWebAssetGate(gameDir, opts, meta, gameConfig) {
  if (opts.skipWebasset) {
    return { status: 'skipped', reason: '--skip-webasset', errors: [] };
  }
  const gameId = gameConfig?.id || path.basename(gameDir);
  const { catalog } = webAssetOrigins();
  let catalogOk = false;
  let listed = false;
  try {
    const res = await fetch(catalog + '/api/games', { signal: AbortSignal.timeout(2000) });
    catalogOk = res.ok;
    if (res.ok) {
      const data = await res.json();
      listed = Array.isArray(data?.items) && data.items.some(e => e?.source === 'local' && e.runtimeId === gameId);
    }
  } catch {
    catalogOk = false;
  }

  if (!catalogOk) {
    if (opts.webasset) {
      return { status: 'failed', errors: ['WebAsset is offline on ' + catalog + ' (--webasset required)'] };
    }
    return { status: 'skipped', reason: 'WebAsset offline on ' + catalog, errors: [] };
  }
  if (!listed && !opts.webasset) {
    return { status: 'skipped', reason: `Game "${gameId}" not in WebAsset catalog`, errors: [] };
  }

  const errors = [];
  let browser;
  let liveUrl = null;
  const consoleErrors = [];
  const httpErrors = [];
  try {
    const url = await resolveWebAssetGame(gameId);
    liveUrl = url.href;
    await verifyWebAssetSource(new URL(`/local-games/${gameId}/`, url), gameDir);

    const { chromium } = resolvePlaywright(import.meta.url, { cwd: gameDir });
    browser = await launchChromium(chromium, {
      executablePath: opts.chrome,
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'],
    });
    const page = await browser.newPage({ viewport: viewportOption(opts.viewport), deviceScaleFactor: 1 });
    page.on('pageerror', e => consoleErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) consoleErrors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) httpErrors.push(`HTTP ${r.status()} ${r.url()}`); });
    page.on('requestfailed', req => {
      const f = req.failure()?.errorText;
      if (f !== 'net::ERR_ABORTED' && !req.url().endsWith('/favicon.ico')) httpErrors.push(`${f || 'Request failed'} ${req.url()}`);
    });

    await page.goto(url.href, { waitUntil: 'load', timeout: 20_000 });
    await page.locator(meta.ready).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
  } catch (err) {
    errors.push(err.message);
  } finally {
    await browser?.close();
  }
  if (consoleErrors.length > 0) errors.push(`WebAsset consoleErrors: ${consoleErrors.slice(0, 3).join('; ')}`);
  if (httpErrors.length > 0) errors.push(`WebAsset httpErrors: ${httpErrors.slice(0, 3).join('; ')}`);

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    url: liveUrl,
    errors,
  };
}

async function runPackageGate(gameDir, opts, meta, packageScript, snapshotScript, playtestScript, sourceEntry) {
  if (!opts.packageCheck) {
    return { status: 'skipped', reason: 'pass --package to verify lean release packaging', errors: [] };
  }
  await mkdir(path.join(gameDir, 'build'), { recursive: true });
  const tmp = await mkdtemp(path.join(path.join(gameDir, 'build'), '.accept-pkg-'));
  const errors = [];
  let zipBytes = null;
  let archiveHash = null;
  let playtest = null;
  try {
    const pack = spawnSync(
      process.execPath,
      [packageScript, gameDir, '--version', opts.releaseVersion ?? '0.1.0', '--out-dir', tmp,
        ...(opts.releaseSpec?.target === 'toy' ? ['--target', 'toy', '--slug', path.basename(gameDir)] : [])],
      { cwd: repoRoot, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
    if (pack.status !== 0) {
      errors.push((pack.stderr || pack.stdout || 'package-game failed').trim().slice(0, 400));
    } else {
      const summary = JSON.parse(pack.stdout);
      zipBytes = statSync(summary.zipPath).size;
      const entry = opts.releaseSpec?.target === 'toy' ? 'index.html' : sourceEntry;
      if (opts.releaseSpec) {
        playtest = runPlaytestGate(gameDir, opts, meta, playtestScript, { targetDir: summary.outputDir, entry, releaseSpec: opts.releaseSpec });
        if (playtest.status !== 'passed') {
          errors.push(...playtest.errors.map(problem => 'Packaged playtest: ' + problem));
        } else {
          const archive = path.join(gameDir, RELEASE_ARCHIVE);
          await mkdir(path.dirname(archive), { recursive: true });
          await copyFile(summary.zipPath, archive);
          archiveHash = createHash('sha256').update(await readFile(archive)).digest('hex');
        }
      } else {
        const args = [
        summary.outputDir,
        '--selector', meta.selector,
        '--ready', meta.ready,
        '--viewport', opts.viewport,
        ...(entry ? ['--entry', entry] : []),
        ...(meta.isBare && !opts.strict ? ['--allow-blank'] : []),
        ...(opts.chrome ? ['--chrome', opts.chrome] : []),
        '--out', path.join(tmp, 'packaged.png'),
        ];
        const { exitCode, report } = runJsonSubprocess(snapshotScript, args, { cwd: repoRoot });
        if (exitCode !== 0 || report.ok !== true) {
          errors.push('Packaged build snapshot failed: ' + (report.problems || []).join('; '));
        }
      }
    }
  } catch (err) {
    errors.push(err.message);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    errors, zipBytes,
    ...(playtest ? { playtest } : {}),
    ...(archiveHash ? { archive: RELEASE_ARCHIVE, archiveHash } : {}),
  };
}

function runTaskManifestGate(gameDir, taskCheckScript) {
  const manifestPath = [path.join(gameDir, 'tests', 'acceptance.json'), path.join(gameDir, 'build', 'task.json')].find(existsSync);
  if (!manifestPath) {
    return { status: 'skipped', reason: 'no tests/acceptance.json or build/task.json present', errors: [] };
  }
  const { exitCode, report } = runJsonSubprocess(taskCheckScript, [manifestPath], { cwd: gameDir, timeoutMs: 180_000 });
  const errors = [];
  if (exitCode !== 0 || report.status !== 'passed') {
    for (const req of report.requirements ?? []) {
      if (req.status !== 'passed') {
        errors.push(`${req.id} (${req.status}): ${(req.checks || []).map(c => c.message || c.status).join('; ')}`);
      }
    }
    if (errors.length === 0) errors.push(report.message || `task-check exited ${exitCode} (${report.status})`);
  }
  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    manifest: path.relative(gameDir, manifestPath).replace(/\\/g, '/'),
    taskStatus: report.status ?? null,
    errors,
  };
}

async function verifyFreshAcceptance(gameDir, reportPath, requireRelease = false) {
  if (!existsSync(reportPath)) {
    return { ok: false, reason: `Missing acceptance report at ${reportPath}. Run "node scripts/accept.mjs ." first.` };
  }
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (!report.accepted || report.mode !== 'full') {
    return { ok: false, reason: `Last acceptance run did not pass full acceptance (accepted=${report.accepted}, mode=${report.mode}).` };
  }
  if (requireRelease && report.releaseReady !== true) {
    return { ok: false, reason: 'Last acceptance report has no passing release evidence.' };
  }
  if (report.releaseReady) {
    const archive = path.join(gameDir, RELEASE_ARCHIVE);
    const expected = report.gates?.package?.archiveHash;
    if (!existsSync(archive) || createHash('sha256').update(await readFile(archive)).digest('hex') !== expected) {
      return { ok: false, reason: 'Release archive is missing or no longer matches the report.' };
    }
  }
  const currentDigest = computeSourceDigest(gameDir, { release: report.releaseReady === true });
  if (report.sourceDigest !== currentDigest) {
    return { ok: false, reason: `Acceptance report is stale: source files changed since ${report.checkedAt}. Re-run acceptance.` };
  }
  if (report.releaseReady) {
    let spec;
    try {
      spec = await loadReleaseRequirements(gameDir);
    } catch (error) {
      return { ok: false, reason: error.message };
    }
    const playtest = report.gates?.package?.playtest;
    if (spec.mobileMultiTouch && !hasMeasuredMobileMultiTouch(playtest)) {
      return { ok: false, reason: 'Release report is missing mobile multi-touch evidence. Re-run acceptance.' };
    }
    if (spec.mobileTouch && !hasMeasuredMobileTouch(playtest?.profiles?.mobile)) {
      return { ok: false, reason: 'Release report is missing mobile touch evidence. Re-run acceptance.' };
    }
  }
  for (const key of ['desktop', 'mobile']) {
    const relPng = report.gates?.visual?.captures?.[key]?.png;
    if (!relPng || !existsSync(path.join(gameDir, relPng))) {
      return { ok: false, reason: `Missing acceptance screenshot artifact: ${relPng || key}` };
    }
  }
  return { ok: true, report };
}

export async function runAcceptForProject(targetDir, opts) {
  const gameDir = path.resolve(targetDir);
  if (!existsSync(gameDir)) throw new Error(`Target game directory does not exist: ${gameDir}`);
  const reportPath = opts.out ? path.resolve(opts.out) : path.join(gameDir, 'build', 'acceptance-report.json');

  if (opts.verifyFresh) {
    const check = await verifyFreshAcceptance(gameDir, reportPath, opts.release);
    if (!check.ok) {
      return {
        schemaVersion: 1,
        ok: false,
        accepted: false,
        mode: 'verify-fresh',
        gameDir,
        problems: [check.reason],
      };
    }
    return {
      schemaVersion: 1,
      ok: true,
      accepted: true,
      mode: 'verify-fresh',
      gameDir,
      gameId: check.report.gameId, releaseReady: check.report.releaseReady === true,
      sourceDigest: check.report.sourceDigest,
      checkedAt: check.report.checkedAt,
      problems: [],
    };
  }

  const defineProject = await loadDefineProject();
  const checkUiPath = resolveSiblingScript('check-ui.mjs', '.agents/skills/hgame-ui-ux/scripts/check-ui.mjs');
  void checkUiPath;
  const snapshotScript = resolveSiblingScript('snapshot.mjs', 'scripts/snapshot.mjs');
  const playtestScript = resolveSiblingScript('playtest.mjs', 'scripts/playtest.mjs');
  let releaseSpec = null;
  if (opts.release) {
    try {
      releaseSpec = await loadReleaseRequirements(gameDir);
      opts = { ...opts, releaseSpec,
        requireAutoplay: opts.requireAutoplay || releaseSpec.autoplay === true,
        doctor: opts.doctor || releaseSpec.doctor === true,
      };
    } catch (error) {
      const report = {
        schemaVersion: 1, ok: false, accepted: false, playable: false, releaseReady: false,
        mode: 'full', gameDir, gameId: path.basename(gameDir),
        gates: { release: { status: 'failed', errors: [error.message] } },
        problems: ['[release] ' + error.message],
      };
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
      return report;
    }
  }

  const doctorScript = resolveSiblingScript('doctor-playability.mjs', 'scripts/doctor-playability.mjs');
  const packageScript = resolveSiblingScript('package-game.mjs', 'scripts/package-game.mjs');
  const taskCheckScript = resolveSiblingScript('task-check.mjs', 'scripts/task-check.mjs');

  const digestBefore = releaseSpec ? computeSourceDigest(gameDir, { release: true }) : null;
  const gates = {};
  gates.config = await runConfigGate(gameDir, opts, defineProject);
  gates.syntax = await runSyntaxGate(gameDir);
  gates.uiStatic = runUiStaticGate(gameDir);
  if (existsSync(path.join(gameDir, 'docs', 'design')) || existsSync(path.join(gameDir, 'src', 'game.design.json')) || opts.strict) {
    const docAudit = await auditDesignDocs(gameDir, { strict: opts.strict });
    gates.designDocs = {
      status: docAudit.ok ? 'passed' : 'failed',
      docs: docAudit.docs,
      errors: docAudit.errors,
      warnings: docAudit.warnings,
    };
  } else {
    gates.designDocs = { status: 'skipped', reason: 'No docs/design/ directory (run --strict to require)', errors: [] };
  }
  gates.tests = await runTestsGate(gameDir, opts);

  const recipe = gates.config.recipe || { profile: '2d', renderer: 'canvas2d' };
  const gameConfig = gates.config.gameConfig;
  if (releaseSpec) opts.releaseVersion = gameConfig?.version;
  const meta = detectProjectMeta(gameDir, recipe, opts);

  if (opts.quick) {
    gates.autoplay = { status: 'skipped', reason: '--quick mode', errors: [] };
    gates.visual = { status: 'skipped', reason: '--quick mode', errors: [] };
    gates.playtest = { status: 'skipped', reason: '--quick mode', errors: [] };
    gates.doctor = { status: 'skipped', reason: '--quick mode', errors: [] };
    gates.webasset = { status: 'skipped', reason: '--quick mode', errors: [] };
    gates.package = { status: 'skipped', reason: '--quick mode', errors: [] };
    gates.taskManifest = { status: 'skipped', reason: '--quick mode', errors: [] };
  } else {
    gates.autoplay = await runAutoplayGateForAccept(gameDir, opts);
    gates.visual = await runVisualGate(gameDir, opts, meta, snapshotScript, gameConfig);
    gates.playtest = runPlaytestGate(gameDir, opts, meta, playtestScript, { entry: gameConfig?.entry });
    gates.doctor = runDoctorGate(gameDir, opts, meta, doctorScript);
    gates.webasset = await runWebAssetGate(gameDir, opts, meta, gameConfig);
    gates.package = await runPackageGate(gameDir, opts, meta, packageScript, snapshotScript, playtestScript, gameConfig?.entry);
    gates.taskManifest = runTaskManifestGate(gameDir, taskCheckScript);
  }

  const playable = !opts.quick && PLAYABLE_GATES.every(name => gates[name].status !== 'failed');
  const sourceDigest = computeSourceDigest(gameDir, { release: Boolean(releaseSpec) });
  if (releaseSpec) {
    gates.release = evaluateRelease(gates, releaseSpec);
    if (sourceDigest !== digestBefore) {
      gates.release.status = 'failed';
      gates.release.errors.push('Source or assets changed during release verification. Run acceptance again.');
    }
  }
  const problems = [];
  for (const [gateName, res] of Object.entries(gates)) {
    if (res.status === 'failed') {
      for (const err of res.errors ?? ['failed']) problems.push(`[${gateName}] ${err}`);
    }
  }

  const gateList = Object.values(gates);
  const ok = problems.length === 0;
  const accepted = ok && !opts.quick;
  const releaseReady = accepted && gates.release?.status === 'passed';
  const report = {
    schemaVersion: 1,
    ok,
    accepted, playable, releaseReady,
    mode: opts.quick ? 'quick' : 'full',
    gameDir,
    gameId: gameConfig?.id ?? path.basename(gameDir),
    profile: recipe.profile,
    renderer: recipe.renderer,
    bareScaffold: meta.isBare,
    sourceDigest,
    checkedAt: new Date().toISOString(),
    summary: {
      passed: gateList.filter(g => g.status === 'passed').length,
      failed: gateList.filter(g => g.status === 'failed').length,
      skipped: gateList.filter(g => g.status === 'skipped').length,
    },
    gates: {
      config: { status: gates.config.status, errors: gates.config.errors },
      syntax: gates.syntax,
      uiStatic: gates.uiStatic,
      designDocs: gates.designDocs,
      tests: gates.tests,
      autoplay: gates.autoplay,
      visual: gates.visual,
      playtest: gates.playtest,
      doctor: gates.doctor,
      webasset: gates.webasset,
      package: gates.package,
      taskManifest: gates.taskManifest,
      ...(gates.release ? { release: gates.release } : {}),
    },
    problems,
  };

  if (!opts.quick) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

function formatSummary(report) {
  if (report.mode === 'verify-fresh') {
    return report.ok
      ? `[ACCEPT:FRESH] ${report.gameId} (${report.sourceDigest.slice(0, 12)}) checkedAt=${report.checkedAt}`
      : `[ACCEPT:STALE] ${report.gameDir}: ${report.problems.join('; ')}`;
  }
  const lines = [
    `=== HGame Acceptance Report (${report.gameId} · ${report.mode}) ===`,
    `Verdict: ${report.releaseReady ? 'RELEASE READY' : report.accepted ? 'ACCEPTED (PLAYABLE)' : report.ok ? 'QUICK-OK (NOT ACCEPTED — run full accept)' : 'REJECTED'}`,
  ];
  for (const [name, gate] of Object.entries(report.gates)) {
    lines.push(`  [${gate.status.toUpperCase()}] ${name}`);
    for (const err of gate.errors ?? []) lines.push(`     -> ${err}`);
  }
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      'Usage: node scripts/accept.mjs [game-dir] [--quick] [--strict] [--webasset] [--doctor] [--package] [--release] [--verify-fresh] [--examples] [--json]\n' +
      'Defaults to "." when run inside a game project.',
    );
    return;
  }

  if (opts.examples) {
    const buildExamplesScript = path.join(repoRoot, 'scripts', 'build-examples.mjs');
    const { buildExample, listExamples } = await import(pathToFileURL(buildExamplesScript).href);
    const ids = await listExamples();
    const results = [];
    for (const id of ids) {
      await buildExample(id);
      const dir = path.join(repoRoot, 'examples', id);
      if (id === 'signal-vault') {
        const buildRes = spawnSync(process.execPath, [path.join(dir, 'build.mjs')], { cwd: dir, encoding: 'utf8', windowsHide: true });
        if (buildRes.status !== 0) throw new Error(`signal-vault build failed: ${buildRes.stderr}`);
      }
      const res = await runAcceptForProject(dir, { ...opts, skipWebasset: !opts.webasset });
      results.push(res);
    }
    const allOk = results.every(r => r.ok);
    if (opts.json) console.log(JSON.stringify({ ok: allOk, results }, null, 2));
    else for (const r of results) console.log(formatSummary(r));
    process.exitCode = allOk ? 0 : 1;
    return;
  }

  const targetDir = opts.gameDir || '.';
  const report = await runAcceptForProject(targetDir, opts);
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatSummary(report));
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('accept failed: ' + err.message);
    process.exitCode = 1;
  });
}
