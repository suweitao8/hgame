import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateMoveAndBounds,
  evaluateAimAndKill,
  evaluateThreatAndDefense,
  evaluateVisualFraming,
} from '../scripts/doctor-playability.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const validatorScript = path.join(repoRoot, '.agents', 'skills', 'hgame-spec-forge', 'scripts', 'validate-spec.mjs');
const pipelineScript = path.join(repoRoot, 'scripts', 're-pipeline.mjs');
const doctorScript = path.join(repoRoot, 'scripts', 'doctor-playability.mjs');

function makeCompliantMvpSpec(overrides = {}) {
  return {
    schemaVersion: 1,
    specKind: 'hgame-clean-spec',
    slug: 'arena-survivor-test',
    recommendedProfile: '2d',
    unitSystem: 'SI_METERS_SECONDS_RADIANS',
    unitConversions: {
      distance: { sourceUnit: 'px', toMetersScale: 0.02, reference: '1.6m hero = 80px' },
      time: { sourceUnit: 'frames@60Hz', tickHz: 60, toSecondsScale: 1 / 60 },
      angle: { sourceUnit: 'degrees', toRadiansScale: 0.01745329 },
    },
    engineRecipe: { profile: '2d', renderer: 'webgl2d', physics: 'none', tickHz: 60 },
    mechanics: {
      coreLoop: { status: 'seen', arenaSpanM: 60, waveDurationSec: 60 },
      threeC: {
        status: 'seen',
        playerSpeed: 5.0,
        playerRadius: 0.4,
        playerHp: 100,
        camera: { status: 'hgame-fallback', mode: 'topdown-follow', orthoHeightM: 14, lerp: 0.25 },
      },
      waveDirector: { status: 'inferred', waveDurationSec: 60, baseSpawnIntervalSec: 1.5 },
    },
    tables: {
      weapons: [{ id: 'slash', status: 'seen', damage: 25, cooldownSec: 0.5, rangeM: 3.0 }],
      enemies: [
        { id: 'grunt', role: 'grunt', status: 'seen', hp: 50, speed: 3.0, hitDamage: 10, radius: 0.4 },
        { id: 'brute', role: 'elite', status: 'inferred', hp: 120, speed: 2.2, hitDamage: 20, radius: 0.6 },
      ],
      upgrades: [
        { id: 'atk_spd', tag: '+25% 攻速' },
        { id: 'dmg', tag: '+20% 伤害' },
      ],
    },
    hgameFallbackModules: ['renderer-shader', 'vfx-particles', 'synth-audio'],
    ...overrides,
  };
}

test('hgame-spec-forge validator accepts clean demo spec with 100/100 graduation score', () => {
  const res = spawnSync(process.execPath, [validatorScript, '--demo', '--json'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.graduated, true);
  assert.equal(out.score, 100);
  assert.equal(out.slug, 'demo-clean-arena');
  assert.ok(out.mappedFallbacks.length >= 4);
});

test('hgame-spec-forge validator rejects local paths, binary names, and >3-line code snippets', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-spec-leak-'));
  try {
    const mockLocalPath = ['C:', 'Users', 'dev', 'Games', 'Sample', 'GameAssembly.dll'].join('\\');
    const leakySpec = {
      schemaVersion: 1,
      specKind: 'hgame-clean-spec',
      slug: 'leaky-test',
      recommendedProfile: '2d',
      mechanics: {
        note: `Pulled from ${mockLocalPath}`,
        snippet: 'public class Foo {\n  void Start() {\n    int x = 1;\n    return;\n  }\n}',
      },
      hgameFallbackModules: ['renderer-shader'],
    };
    const specPath = path.join(dir, 'leaky.clean-spec.json');
    writeFileSync(specPath, JSON.stringify(leakySpec, null, 2), 'utf8');

    const res = spawnSync(process.execPath, [validatorScript, specPath], { encoding: 'utf8' });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /local disk path detected/);
    assert.match(res.stderr, /proprietary binary\/archive filename detected/);
    assert.match(res.stderr, /multi-line source\/decompiled snippet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re:eval precisely intercepts unconverted 300m/s abnormal speed and blocks scaffolding', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-spec-speed-'));
  try {
    const badSpec = makeCompliantMvpSpec({ slug: 'unconverted-speed-test' });
    badSpec.mechanics.threeC.playerSpeed = 300; // Unconverted 300 px/s pasted directly as 300 m/s!
    const specPath = path.join(dir, 'bad-speed.clean-spec.json');
    writeFileSync(specPath, JSON.stringify(badSpec, null, 2), 'utf8');

    const res = spawnSync(process.execPath, [pipelineScript, 'eval', specPath, '--json'], { encoding: 'utf8' });
    assert.notEqual(res.status, 0, '300 m/s unconverted speed must fail re:eval');
    const out = JSON.parse(res.stderr);
    assert.equal(out.ok, false);
    assert.equal(out.graduated, false);
    assert.equal(out.ratios.relativeSpeedRatio.pass, false);
    assert.equal(out.ratios.relativeSpeedRatio.value, 375);
    assert.ok(out.ratios.relativeSpeedRatio.suspectedFields.includes('mechanics.threeC.playerSpeed'));
    assert.equal(out.ratios.arenaTraversalSec.pass, false);
    assert.ok(out.violations.some((v) => /playerSpeed/.test(v)));

    // Also confirm --scaffold refuses to generate from it
    const targetDir = path.join(dir, 'blocked-game');
    const scaffoldRes = spawnSync(process.execPath, [validatorScript, specPath, '--scaffold', targetDir, '--json'], {
      encoding: 'utf8',
    });
    assert.notEqual(scaffoldRes.status, 0);
    assert.equal(existsSync(targetDir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re:eval rejects unknown/null fields and warns on MVP 1-1-2-1 scope overflow, while passing 100/100 normalized specs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-spec-scope-'));
  try {
    // 1. Valid normalized spec -> 100/100 graduation
    const goodSpec = makeCompliantMvpSpec({ slug: 'mvp-ready-test' });
    const goodPath = path.join(dir, 'good.clean-spec.json');
    writeFileSync(goodPath, JSON.stringify(goodSpec, null, 2), 'utf8');
    const goodRes = spawnSync(process.execPath, [pipelineScript, 'eval', goodPath, '--json'], { encoding: 'utf8' });
    assert.equal(goodRes.status, 0, goodRes.stderr);
    const goodOut = JSON.parse(goodRes.stdout);
    assert.equal(goodOut.ok, true);
    assert.equal(goodOut.graduated, true);
    assert.equal(goodOut.score, 100);
    assert.match(goodOut.verdict, /逆向提取已达毕业线/);

    // 2. Unknown field in 3C -> rejected
    const unknownSpec = makeCompliantMvpSpec({ slug: 'unknown-3c-test' });
    unknownSpec.mechanics.threeC.dashCooldown = 'unknown';
    const unknownPath = path.join(dir, 'unknown.clean-spec.json');
    writeFileSync(unknownPath, JSON.stringify(unknownSpec, null, 2), 'utf8');
    const unknownRes = spawnSync(process.execPath, [pipelineScript, 'eval', unknownPath, '--json'], { encoding: 'utf8' });
    assert.notEqual(unknownRes.status, 0);
    const unknownOut = JSON.parse(unknownRes.stderr);
    assert.ok(unknownOut.violations.some((v) => /dashCooldown/.test(v) && /unknown/i.test(v)));

    // 3. MVP 1-1-2-1 scope overflow (>2 weapons, >3 enemies, >5 upgrades) -> blocked with warnings
    const bloatedSpec = makeCompliantMvpSpec({ slug: 'bloated-mvp-test' });
    bloatedSpec.tables.weapons.push(
      { id: 'w2', status: 'seen', damage: 20, cooldownSec: 0.4 },
      { id: 'w3', status: 'seen', damage: 30, cooldownSec: 0.6 },
    );
    bloatedSpec.tables.enemies.push(
      { id: 'e3', status: 'seen', hp: 60, speed: 3.5, hitDamage: 12 },
      { id: 'e4', status: 'seen', hp: 80, speed: 2.5, hitDamage: 15 },
    );
    bloatedSpec.tables.upgrades.push(
      { id: 'u3', tag: '+10% 范围' },
      { id: 'u4', tag: '+15% 护甲' },
      { id: 'u5', tag: '+1 穿透' },
      { id: 'u6', tag: '+20% 磁力' },
    );
    const bloatedPath = path.join(dir, 'bloated.clean-spec.json');
    writeFileSync(bloatedPath, JSON.stringify(bloatedSpec, null, 2), 'utf8');
    const bloatedRes = spawnSync(process.execPath, [pipelineScript, 'eval', bloatedPath, '--json'], { encoding: 'utf8' });
    assert.notEqual(bloatedRes.status, 0);
    const bloatedOut = JSON.parse(bloatedRes.stderr);
    assert.equal(bloatedOut.mvpSlice.ok, false);
    assert.ok(bloatedOut.mvpSlice.warnings.length >= 3);
    assert.ok(bloatedOut.score < 90);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hgame-spec-forge scaffolds an HGame project with spec.json and doctor.js from a graduated clean spec', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-spec-scaffold-'));
  const targetDir = path.join(dir, 'scaffolded-game');
  try {
    const cleanSpec = makeCompliantMvpSpec();
    const specPath = path.join(dir, 'arena-survivor-test.clean-spec.json');
    writeFileSync(specPath, JSON.stringify(cleanSpec, null, 2), 'utf8');

    const res = spawnSync(process.execPath, [validatorScript, specPath, '--scaffold', targetDir, '--json'], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.graduated, true);
    assert.equal(out.score, 100);
    assert.equal(out.scaffoldedTo, path.resolve(targetDir));
    assert.ok(existsSync(path.join(targetDir, 'package.json')));
    assert.ok(existsSync(path.join(targetDir, 'src', 'sim', 'spec.json')));
    assert.ok(existsSync(path.join(targetDir, 'src', 'sim', 'doctor.js')));
    const mainJs = readFileSync(path.join(targetDir, 'src', 'main.js'), 'utf8');
    assert.match(mainJs, /\.\/sim\/doctor\.js/);
    const syntax = spawnSync(process.execPath, ['--check', path.join(targetDir, 'src', 'main.js')], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re-pipeline forge orchestrates extract -> spec -> scaffold using HGAME_RE_WORKSPACE', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-re-pipeline-'));
  const sourceDir = path.join(dir, 'sample-game');
  const workspaceDir = path.join(dir, 're-workspace');
  const outGameDir = path.join(dir, 'forged-game');
  try {
    mkdirSync(path.join(sourceDir, 'Game_Data', 'Managed'), { recursive: true });
    writeFileSync(path.join(sourceDir, 'UnityPlayer.dll'), 'MZ');
    writeFileSync(path.join(sourceDir, 'Game_Data', 'Managed', 'Assembly-CSharp.dll'), 'MZ');

    const res = spawnSync(
      process.execPath,
      [pipelineScript, 'forge', '--source', sourceDir, '--slug', 'pipe-smoke', '--out', outGameDir, '--dry-run', '--json'],
      {
        encoding: 'utf8',
        env: { ...process.env, HGAME_RE_WORKSPACE: workspaceDir },
      },
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(existsSync(path.join(workspaceDir, 'projects', 'pipe-smoke', 'raw', 'fast-extract-plan.json')));
    assert.ok(existsSync(path.join(workspaceDir, 'specs-out', 'pipe-smoke.clean-spec.json')));
    assert.ok(existsSync(path.join(outGameDir, 'src', 'sim', 'spec.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor-playability evaluators detect 0-damage pass-through, NaN, instakill, and pass healthy --sim fixture', () => {
  // Unit evaluator checks
  assert.equal(
    evaluateMoveAndBounds({
      profile: '2d',
      arenaSpan: 60,
      spawnPos: { x: 0, y: 0 },
      player: { x: 15, y: 0, theoreticalSpeed: 5 },
      camera: { x: 15, y: 0, distanceToPlayer: 0, zoom: 1 },
    }).pass,
    true,
  );
  assert.equal(
    evaluateMoveAndBounds({
      profile: '2d',
      arenaSpan: 60,
      spawnPos: { x: 0, y: 0 },
      player: { x: 0, y: 0, theoreticalSpeed: 5 },
    }).pass,
    false,
  );
  assert.equal(
    evaluateAimAndKill({ initialHp: 40, minHp: 40, damaged: false, killed: false, maxWindowSec: 5 }).pass,
    false,
  );
  assert.equal(
    evaluateThreatAndDefense({
      initialHp: 100,
      hpAt05s: 0,
      minHpDuringChase: 0,
      tookDamage: true,
      preDefenseDist: 1,
      postDefenseMaxDist: 4,
      defenseExpandedGap: true,
    }).pass,
    false,
  );
  assert.equal(
    evaluateVisualFraming(
      { consoleErrors: [], httpErrors: [], stats: { nonBlankRatio: 0.4, meanLuma: 48, uniqueColors: 20 } },
      { profile: '3d', groundY: 0, camera: { x: 0, y: 6, z: 8, distanceToPlayer: 10 } },
    ).pass,
    true,
  );

  // End-to-end --sim mode check on temp fixture game
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-doctor-sim-'));
  try {
    mkdirSync(path.join(dir, 'src', 'sim'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><canvas id="game"></canvas>');
    writeFileSync(path.join(dir, 'engine.config.json'), JSON.stringify({ profile: '2d' }));
    writeFileSync(
      path.join(dir, 'src', 'sim', 'doctor.js'),
      `export function createDoctorSim() {
        const state = { px: 0, py: 0, hp: 100, maxHp: 100, enemies: [] };
        let nextId = 1;
        return {
          step(dt, input = {}) {
            state.px += (input.moveX || 0) * 5 * dt;
            state.py += (input.moveY || 0) * 5 * dt;
            for (const e of state.enemies) {
              if (!e.alive) continue;
              const dx = state.px - e.x, dy = state.py - e.y;
              const d = Math.hypot(dx, dy);
              if (d > 0.6) { e.x += (dx / d) * 3 * dt; e.y += (dy / d) * 3 * dt; }
              else { e.cd = (e.cd || 0) - dt; if (e.cd <= 0) { state.hp = Math.max(0, state.hp - 10); e.cd = 0.6; } }
            }
          },
          inspect() {
            return { profile: '2d', arenaSpan: 60, spawnPos: { x: 0, y: 0 }, player: { x: state.px, y: state.py, hp: state.hp, maxHp: state.maxHp, theoreticalSpeed: 5 }, camera: { x: state.px, y: state.py, distanceToPlayer: 0, zoom: 1 } };
          },
          setupAimTest() {
            state.enemies = [{ id: nextId++, x: state.px + 2, y: state.py, hp: 40, maxHp: 40, alive: true }];
            return { enemyId: state.enemies[0].id, initialHp: 40, expectedTtkSec: 0.8, maxWindowSec: 5 };
          },
          aimAndFire(id) {
            const e = state.enemies.find(x => x.id === id);
            if (e && e.alive) { e.hp -= 1; if (e.hp <= 0) e.alive = false; }
          },
          getEnemyState(id) {
            const e = state.enemies.find(x => x.id === id);
            return e ? { exists: true, alive: e.alive, hp: e.hp, maxHp: e.maxHp } : { exists: false, alive: false, hp: 0, maxHp: 0 };
          },
          setupThreatTest() {
            state.hp = 100;
            state.enemies = [
              { id: nextId++, x: state.px + 1.5, y: state.py, hp: 40, maxHp: 40, alive: true, cd: 0.55 },
              { id: nextId++, x: state.px - 1.5, y: state.py, hp: 40, maxHp: 40, alive: true, cd: 0.55 },
              { id: nextId++, x: state.px, y: state.py + 1.5, hp: 40, maxHp: 40, alive: true, cd: 0.55 },
            ];
            return { initialHp: 100, enemyIds: state.enemies.map(e => e.id), initialMinDist: 1.5 };
          },
          triggerDefense() {
            for (const e of state.enemies) {
              const dx = e.x - state.px, dy = e.y - state.py;
              const d = Math.hypot(dx, dy) || 1;
              e.x += (dx / d) * 4;
              e.y += (dy / d) * 4;
            }
          },
          getThreatState(ids) {
            const list = state.enemies.filter(e => ids.includes(e.id));
            const minEnemyDist = Math.min(...list.map(e => Math.hypot(e.x - state.px, e.y - state.py)));
            return { playerHp: state.hp, playerMaxHp: state.maxHp, minEnemyDist, aliveEnemies: list.filter(e => e.alive).length };
          },
        };
      }`,
      'utf8',
    );
    const res = spawnSync(process.execPath, [doctorScript, dir, '--sim', '--json'], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.tests.length, 4);
    assert.ok(out.tests.every((t) => t.pass));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HGame source files contain zero hardcoded machine-specific RE paths', (t) => {
  const trackedExts = new Set(['.md', '.mjs', '.js', '.json', '.ps1']);
  let candidates;
  if (existsSync(path.join(repoRoot, '.git'))) {
    const ls = spawnSync('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(ls.status, 0, ls.stderr);
    candidates = new Set(ls.stdout.split('\0').filter(Boolean));
    const untracked = spawnSync('git', ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard', '-z', '--', '.agents', 'scripts', 'tests', '.hgame.local.example.json'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(untracked.status, 0, untracked.stderr);
    for (const file of untracked.stdout.split('\0').filter(Boolean)) candidates.add(file);
  } else {
    const manifestPath = path.join(repoRoot, 'hgame.sdk-files.json');
    if (!existsSync(manifestPath)) {
      t.skip('Requires Git metadata or an SDK file manifest');
      return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    candidates = new Set(manifest.files);
  }

  const forbiddenLiterals = [
    ['C:', 'Users', ''].join('\\'),
    ['C:', 'Users', ''].join('/'),
    ['D:', 'Apps', 'RE'].join('\\'),
    ['D:', 'Apps', 'RE'].join('/'),
    ['D:', 'RE-Workspace'].join('\\'),
    ['D:', 'RE-Workspace'].join('/'),
  ];

  const hits = [];
  for (const rel of candidates) {
    if (!trackedExts.has(path.extname(rel).toLowerCase())) continue;
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, 'utf8');
    for (const needle of forbiddenLiterals) {
      if (content.includes(needle)) {
        hits.push(`${rel} contains forbidden path literal "${needle}"`);
      }
    }
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

test('re:forge defaults output directory to gamesRootDir/<slug> from HGAME_GAMES_ROOT or .hgame.local.json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-games-root-'));
  try {
    const wsDir = path.join(dir, 're-ws');
    const gamesDir = path.join(dir, 'html-games');
    const specsOut = path.join(wsDir, 'specs-out');
    mkdirSync(specsOut, { recursive: true });
    mkdirSync(gamesDir, { recursive: true });

    const slug = 'games-root-default-test';
    const specPath = path.join(specsOut, `${slug}.clean-spec.json`);
    writeFileSync(specPath, JSON.stringify(makeCompliantMvpSpec({ slug }), null, 2), 'utf8');

    const res = spawnSync(
      process.execPath,
      [pipelineScript, 'forge', '--slug', slug, '--json'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HGAME_RE_WORKSPACE: wsDir,
          HGAME_GAMES_ROOT: gamesDir,
        },
      },
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const out = JSON.parse(res.stdout);
    const expectedOutDir = path.join(gamesDir, slug);
    assert.equal(out.ok, true);
    assert.equal(path.resolve(out.scaffoldedTo), path.resolve(expectedOutDir));
    assert.equal(existsSync(path.join(expectedOutDir, 'index.html')), true);
    assert.equal(existsSync(path.join(expectedOutDir, 'game.config.json')), true);

    const exampleCfg = JSON.parse(readFileSync(path.join(repoRoot, '.hgame.local.example.json'), 'utf8'));
    assert.equal(typeof exampleCfg.gamesRootDir, 'string');
    assert.ok(exampleCfg.gamesRootDir.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re:probe -> re:spec -> re:eval graduates from raw data, and re:forge --assets-from copies only safe runtime files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-probe-assets-'));
  try {
    const wsDir = path.join(dir, 're-ws');
    const rawExtracted = path.join(wsDir, 'projects', 'auto-probe', 'raw', 'extracted-data');
    mkdirSync(path.join(wsDir, 'projects', 'auto-probe', 'raw', 'scanner'), { recursive: true });
    mkdirSync(rawExtracted, { recursive: true });
    writeFileSync(
      path.join(wsDir, 'projects', 'auto-probe', 'raw', 'scanner', 'engine-profile.json'),
      JSON.stringify({ engine: { id: 'godot', recommendedHGameProfile: '2d' } }),
    );
    writeFileSync(
      path.join(rawExtracted, 'weapons.kv.json'),
      JSON.stringify({ rifle: { Damage: 25, CycleTime: 0.12, clip_size: 30 } }),
    );

    const specRes = spawnSync(
      process.execPath,
      [pipelineScript, 'spec', '--slug', 'auto-probe', '--probe'],
      { encoding: 'utf8', env: { ...process.env, HGAME_RE_WORKSPACE: wsDir } },
    );
    assert.equal(specRes.status, 0, specRes.stderr || specRes.stdout);

    const evalRes = spawnSync(
      process.execPath,
      [pipelineScript, 'eval', '--slug', 'auto-probe', '--json'],
      { encoding: 'utf8', env: { ...process.env, HGAME_RE_WORKSPACE: wsDir } },
    );
    assert.equal(evalRes.status, 0, evalRes.stderr || evalRes.stdout);
    const evalJson = JSON.parse(evalRes.stdout);
    assert.equal(evalJson.graduated, true);
    assert.ok(evalJson.score >= 90);

    // Stage curated assets dir mixed with unsafe source/binary files
    const assetsSrc = path.join(dir, 'curated');
    mkdirSync(path.join(assetsSrc, 'sprites'), { recursive: true });
    writeFileSync(path.join(assetsSrc, 'sprites', 'hero.png'), Buffer.from([137, 80, 78, 71]));
    writeFileSync(path.join(assetsSrc, 'sfx.wav'), 'RIFF');
    writeFileSync(path.join(assetsSrc, 'leak.cs'), 'class Secret {}');
    writeFileSync(path.join(assetsSrc, 'native.dll'), 'MZ');

    const outGameDir = path.join(dir, 'forged-game');
    const forgeRes = spawnSync(
      process.execPath,
      [pipelineScript, 'forge', '--slug', 'auto-probe', '--out', outGameDir, '--assets-from', assetsSrc, '--json'],
      { encoding: 'utf8', env: { ...process.env, HGAME_RE_WORKSPACE: wsDir } },
    );
    assert.equal(forgeRes.status, 0, forgeRes.stderr || forgeRes.stdout);
    const forgeJson = JSON.parse(forgeRes.stdout);
    assert.equal(forgeJson.importedAssets.copied, 2);
    assert.equal(forgeJson.importedAssets.skipped, 2);
    assert.equal(existsSync(path.join(outGameDir, 'assets', 'sprites', 'hero.png')), true);
    assert.equal(existsSync(path.join(outGameDir, 'assets', 'sfx.wav')), true);
    assert.equal(existsSync(path.join(outGameDir, 'assets', 'leak.cs')), false);
    assert.equal(existsSync(path.join(outGameDir, 'assets', 'native.dll')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
