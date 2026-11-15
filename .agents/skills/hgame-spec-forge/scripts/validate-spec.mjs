#!/usr/bin/env node
// Clean-room gameplay specification firewall & HGame project scaffolder.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const hgameRoot = path.resolve(scriptDir, '..', '..', '..', '..');
const createGameScript = path.join(hgameRoot, 'scripts', 'create-game.mjs');

const LOCAL_PATH_RE = /[A-Za-z]:\\[^\s"'`]+|(?:\/Users\/|\/home\/)[^\s"'`]+/;
const BINARY_NAME_RE = /\b[A-Za-z0-9_.-]+\.(?:dll|exe|pck|pak|utoc|ucas|uasset|uexp|rpa|rpyc|asar|assets|bundle|win|unx|so|dylib)\b/i;

const FALLBACK_MODULE_MAP = {
  'renderer-shader': 'integrations/three.js or integrations/webgl2d.js',
  'skeleton-state-machine': 'integrations/model3d.js (createBoneVatCrowd3D) / animation/player.js',
  'navmesh-solver': 'world/navmesh3d.js / world/tilemap.js (findGridPath) / world/swarm-ecs.js (FlowField2D)',
  'physics-solver': 'physics/rapier2d.js or physics/rapier3d.js',
  'vfx-particles': 'vfx/index.js (createVfxSystem)',
  'synth-audio': 'platform/audio.js (playSynth / createProceduralBgm)',
  'minimal-ui': 'ui/index.js + hgame-ui-ux zero-prose HUD',
  'crowd-swarm': 'world/swarm-ecs.js (createSwarmSimulation) / integrations/model3d.js',
  'camera-rig': 'integrations/camera3d.js (createCameraRig3D / createSpringArm3D) / integrations/canvas2d.js',
};

const DEMO_SPEC = {
  schemaVersion: 1,
  specKind: 'hgame-clean-spec',
  slug: 'demo-clean-arena',
  recommendedProfile: '2d',
  engineRecipe: { profile: '2d', renderer: 'webgl2d', physics: 'none', tickHz: 60 },
  mechanics: {
    coreLoop: { status: 'seen', waveDurationSec: 30 },
    threeC: { status: 'seen', moveSpeed: 220 },
  },
  tables: {
    weapons: [{ id: 'slash', damage: 24, cooldownSec: 0.45 }],
  },
  hgameFallbackModules: ['renderer-shader', 'vfx-particles', 'synth-audio', 'minimal-ui'],
};

function parseArgs(argv) {
  const opts = { specPath: null, demo: false, scaffold: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--demo') opts.demo = true;
    else if (token === '--spec') opts.specPath = argv[++i];
    else if (token === '--scaffold') opts.scaffold = argv[++i];
    else if (token === '--json') opts.json = true;
    else if (!token.startsWith('-') && !opts.specPath) opts.specPath = token;
    else throw new Error(`Unknown or incomplete argument: ${token}`);
  }
  if (!opts.demo && !opts.specPath) {
    throw new Error('Usage: node validate-spec.mjs <clean-spec.json> [--scaffold <project-dir>] [--json] | --demo');
  }
  return opts;
}

function scanCompliance(node, keyPath, violations) {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    if (LOCAL_PATH_RE.test(node)) {
      violations.push(`${keyPath}: local disk path detected`);
    }
    if (BINARY_NAME_RE.test(node)) {
      violations.push(`${keyPath}: proprietary binary/archive filename detected`);
    }
    const lines = node.split(/\r?\n/);
    if (lines.length > 3 && /[;{}]|\b(?:public|private|class|struct|function|void|return)\b/.test(node)) {
      violations.push(`${keyPath}: multi-line source/decompiled snippet (>3 lines) detected`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, idx) => scanCompliance(item, `${keyPath}[${idx}]`, violations));
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (LOCAL_PATH_RE.test(k) || BINARY_NAME_RE.test(k)) {
        violations.push(`${keyPath}.${k}: disallowed identifier`);
      }
      scanCompliance(v, `${keyPath}.${k}`, violations);
    }
  }
}

function validateCleanSpec(spec) {
  const violations = [];
  if (!spec || typeof spec !== 'object') throw new Error('Spec must be a JSON object');
  if (spec.schemaVersion !== 1) violations.push('schemaVersion must equal 1');
  if (spec.specKind !== 'hgame-clean-spec') violations.push('specKind must equal "hgame-clean-spec"');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(String(spec.slug || ''))) {
    violations.push('slug must be an ASCII identifier');
  }
  const profile = spec.engineRecipe?.profile || spec.recommendedProfile;
  if (!['2d', '3d', 'ui'].includes(profile)) {
    violations.push('engineRecipe.profile must be 2d, 3d, or ui');
  }
  scanCompliance(spec, 'spec', violations);

  const mappedFallbacks = (spec.hgameFallbackModules || []).map((mod) => ({
    module: mod,
    hgameTarget: FALLBACK_MODULE_MAP[mod] || 'native HGame runtime subsystem',
  }));
  return { valid: violations.length === 0, violations, profile, mappedFallbacks };
}

function scaffoldProject(spec, targetDir) {
  const recipe = spec.engineRecipe || { profile: spec.recommendedProfile || '2d' };
  const args = [createGameScript, targetDir, '--profile', recipe.profile, '--bare', '--with', 'audio,save', '--name', spec.slug];
  if (recipe.renderer) args.push('--renderer', recipe.renderer);
  if (recipe.physics && recipe.physics !== 'none') args.push('--physics', recipe.physics);
  if (recipe.profile === '3d') args.push('--quality', 'auto');
  const res = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    throw new Error(`create-game.mjs failed: ${res.stderr || res.error?.message || res.stdout}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const spec = opts.demo ? DEMO_SPEC : JSON.parse(await readFile(path.resolve(opts.specPath), 'utf8'));
  const check = validateCleanSpec(spec);

  if (!check.valid) {
    const fail = { ok: false, slug: spec.slug || null, violations: check.violations };
    console.error(JSON.stringify(fail, null, 2));
    process.exitCode = 1;
    return;
  }

  if (opts.scaffold && !opts.demo) {
    const dest = path.resolve(opts.scaffold);
    scaffoldProject(spec, dest);
    const simDir = path.join(dest, 'src', 'sim');
    await mkdir(simDir, { recursive: true });
    await writeFile(path.join(simDir, 'spec.json'), JSON.stringify(spec, null, 2) + '\n', 'utf8');
  }

  const out = {
    ok: true,
    mode: opts.demo ? 'demo' : 'spec',
    slug: spec.slug,
    profile: check.profile,
    mappedFallbacks: check.mappedFallbacks,
    scaffoldedTo: opts.scaffold && !opts.demo ? path.resolve(opts.scaffold) : null,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error('validate-spec failed: ' + err.message);
  process.exitCode = 1;
});
