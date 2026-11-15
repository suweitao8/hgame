#!/usr/bin/env node
// Playability Doctor (Gate 2 - `npm run re:doctor`):
// Runs 4 deterministic vital-sign tests against a forged HGame project using `scripts/snapshot.mjs`
// (`--freeze-time --steps --keys --eval`) and `window.__HGAME_DOCTOR__` (or `--sim` headless adapter).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const snapshotScript = path.join(rootDir, 'scripts', 'snapshot.mjs');

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isFiniteVec(v, requireZ = false) {
  if (!v || typeof v !== 'object') return false;
  if (!isFiniteNum(v.x) || !isFiniteNum(v.y)) return false;
  if (requireZ && !isFiniteNum(v.z)) return false;
  if (v.z !== undefined && !isFiniteNum(v.z)) return false;
  return true;
}

/**
 * Evaluates Test A [Move & Bounds] telemetry after 3s of continuous movement input.
 * @param {object | null} inspectData
 * @param {{ moveDurationSec?: number, maxSpeedError?: number }} [opts]
 */
export function evaluateMoveAndBounds(inspectData, opts = {}) {
  const moveDurationSec = opts.moveDurationSec ?? 3.0;
  const maxSpeedError = opts.maxSpeedError ?? 0.25;
  const reasons = [];

  if (!inspectData) {
    return { name: 'Test A [Move & Bounds]', pass: false, reasons: ['Missing window.__HGAME_DOCTOR__.inspect() telemetry'], metrics: {} };
  }
  if (inspectData.isStub) {
    return { name: 'Test A [Move & Bounds]', pass: false, reasons: [inspectData.reason || 'window.__HGAME_DOCTOR__ is still an unwired stub'], metrics: {} };
  }

  const profile = inspectData.profile || '2d';
  const is3D = profile === '3d';
  const { player, spawnPos, camera } = inspectData;
  const groundY = inspectData.groundY ?? 0;

  if (!isFiniteVec(player, is3D)) reasons.push('Player position contains NaN/Infinity or missing axes');
  if (!isFiniteVec(spawnPos, is3D)) reasons.push('Spawn position contains NaN/Infinity or missing axes');
  if (camera && !isFiniteVec(camera, is3D)) reasons.push('Camera position contains NaN/Infinity');
  if (inspectData.entityCoordsFinite === false) reasons.push('Active entity coordinates contain NaN/Infinity');

  let actualDisplacement = 0;
  let expectedDisplacement = 0;
  let errorRatio = 1;

  if (isFiniteVec(player, is3D) && isFiniteVec(spawnPos, is3D)) {
    const dx = player.x - spawnPos.x;
    const dAxis2 = is3D ? (player.z - spawnPos.z) : (player.y - spawnPos.y);
    actualDisplacement = Math.hypot(dx, dAxis2);
    const speed = player.theoreticalSpeed;
    if (!isFiniteNum(speed) || speed <= 0) {
      reasons.push(`Invalid player.theoreticalSpeed (${speed})`);
    } else {
      expectedDisplacement = speed * moveDurationSec;
      errorRatio = Math.abs(actualDisplacement - expectedDisplacement) / expectedDisplacement;
      if (actualDisplacement <= 0.05) {
        reasons.push(`Player appears stuck near spawn (${actualDisplacement.toFixed(3)}m moved in ${moveDurationSec}s)`);
      } else if (errorRatio >= maxSpeedError) {
        reasons.push(
          `Displacement mismatch ${(errorRatio * 100).toFixed(1)}% >= ${(maxSpeedError * 100).toFixed(0)}% (actual ${actualDisplacement.toFixed(2)}m vs expected ${expectedDisplacement.toFixed(2)}m)`,
        );
      }
    }

    if (is3D) {
      if (player.y < groundY - 0.5 || player.y > groundY + 50) {
        reasons.push(`Player Y (${player.y.toFixed(2)}) fell through ground or flew out of bounds (groundY=${groundY})`);
      }
    } else if (isFiniteNum(inspectData.arenaSpan) && inspectData.arenaSpan > 0) {
      const limit = inspectData.arenaSpan * 1.1;
      if (Math.abs(player.x) > limit || Math.abs(player.y) > limit) {
        reasons.push(`Player (${player.x.toFixed(2)}, ${player.y.toFixed(2)}) escaped 2D arena bounds (±${limit.toFixed(1)})`);
      }
    }
  }

  return {
    name: 'Test A [Move & Bounds]',
    pass: reasons.length === 0,
    reasons,
    metrics: {
      actualDisplacement: Number(actualDisplacement.toFixed(3)),
      expectedDisplacement: Number(expectedDisplacement.toFixed(3)),
      errorPct: Number((errorRatio * 100).toFixed(1)),
      playerPos: player || null,
    },
  };
}

/**
 * Evaluates Test B [Aim & Kill] telemetry over a 5s combat window.
 * @param {object | null} aimResult
 */
export function evaluateAimAndKill(aimResult) {
  const reasons = [];
  if (!aimResult) {
    return { name: 'Test B [Aim & Kill]', pass: false, reasons: ['Missing Test B combat telemetry'], metrics: {} };
  }
  if (aimResult.error) {
    return { name: 'Test B [Aim & Kill]', pass: false, reasons: [aimResult.error], metrics: aimResult };
  }
  if (aimResult.nanDetected) reasons.push('NaN/Infinity detected in enemy HP or combat state');
  if (!aimResult.damaged) {
    reasons.push(`Enemy took 0 damage (initialHp=${aimResult.initialHp}, minHp=${aimResult.minHp}) — suspect pass-through or hitbox/damage bug`);
  }
  if (!aimResult.killed) {
    reasons.push(`Enemy failed to die within ${(aimResult.maxWindowSec ?? 5.0).toFixed(2)}s window (minHp=${aimResult.minHp})`);
  } else if (!isFiniteNum(aimResult.killedAtSec) || aimResult.killedAtSec <= 0 || aimResult.killedAtSec > (aimResult.maxWindowSec ?? 5.0)) {
    reasons.push(`Enemy kill time ${aimResult.killedAtSec}s outside expected TTK window (0, ${aimResult.maxWindowSec ?? 5.0}]s`);
  }

  return {
    name: 'Test B [Aim & Kill]',
    pass: reasons.length === 0,
    reasons,
    metrics: {
      initialHp: aimResult.initialHp ?? null,
      minHp: aimResult.minHp ?? null,
      killed: Boolean(aimResult.killed),
      killedAtSec: aimResult.killedAtSec ?? null,
      maxWindowSec: aimResult.maxWindowSec ?? 5.0,
    },
  };
}

/**
 * Evaluates Test C [Threat & Defense] telemetry over a 5s chase + pushback/dodge window.
 * @param {object | null} threatResult
 */
export function evaluateThreatAndDefense(threatResult) {
  const reasons = [];
  if (!threatResult) {
    return { name: 'Test C [Threat & Defense]', pass: false, reasons: ['Missing Test C threat/defense telemetry'], metrics: {} };
  }
  if (threatResult.error) {
    return { name: 'Test C [Threat & Defense]', pass: false, reasons: [threatResult.error], metrics: threatResult };
  }
  if (threatResult.nanDetected) reasons.push('NaN/Infinity detected in player HP or enemy distance');
  if (!isFiniteNum(threatResult.hpAt05s) || threatResult.hpAt05s <= 0) {
    reasons.push(`Player died abnormally fast within 0.5s (hpAt05s=${threatResult.hpAt05s})`);
  }
  if (!threatResult.tookDamage) {
    reasons.push(`3 chaser enemies failed to reach/damage player during chase (initialHp=${threatResult.initialHp}, minHp=${threatResult.minHpDuringChase})`);
  }
  const gapDelta = (threatResult.postDefenseMaxDist ?? 0) - (threatResult.preDefenseDist ?? 0);
  if (!threatResult.defenseExpandedGap && gapDelta <= 0.35) {
    reasons.push(
      `Defense/pushback action failed to open safe distance (pre=${threatResult.preDefenseDist?.toFixed?.(2)}, postMax=${threatResult.postDefenseMaxDist?.toFixed?.(2)})`,
    );
  }

  return {
    name: 'Test C [Threat & Defense]',
    pass: reasons.length === 0,
    reasons,
    metrics: {
      hpAt05s: threatResult.hpAt05s ?? null,
      minHpDuringChase: threatResult.minHpDuringChase ?? null,
      preDefenseDist: threatResult.preDefenseDist ?? null,
      postDefenseMaxDist: threatResult.postDefenseMaxDist ?? null,
      gapDelta: Number(gapDelta.toFixed(3)),
    },
  };
}

/**
 * Evaluates Test D [Visual Framing] using snapshot pixel stats, console/HTTP errors, and camera framing.
 * @param {object | null} snapshotReport
 * @param {object | null} inspectData
 */
export function evaluateVisualFraming(snapshotReport, inspectData) {
  const reasons = [];
  if (!snapshotReport) {
    return { name: 'Test D [Visual Framing]', pass: false, reasons: ['Missing snapshot report'], metrics: {} };
  }
  const consoleErrors = snapshotReport.consoleErrors || [];
  const httpErrors = snapshotReport.httpErrors || [];
  if (consoleErrors.length > 0) reasons.push(`Console/page errors (${consoleErrors.length}): ${consoleErrors[0]}`);
  if (httpErrors.length > 0) reasons.push(`HTTP errors (${httpErrors.length}): ${httpErrors[0]}`);

  const stats = snapshotReport.stats || {};
  const uniqueColorsNum = stats.uniqueColors === '5000+' ? 5000 : Number(stats.uniqueColors || 0);
  if (!isFiniteNum(stats.nonBlankRatio) || stats.nonBlankRatio < 0.02) {
    reasons.push(`Canvas is blank or nearly uniform (nonBlankRatio=${stats.nonBlankRatio})`);
  }
  if (uniqueColorsNum < 4) {
    reasons.push(`Canvas is solid/monochrome (uniqueColors=${stats.uniqueColors})`);
  }
  if (!isFiniteNum(stats.meanLuma) || stats.meanLuma < 3 || stats.meanLuma > 252) {
    reasons.push(`Frame luminance out of bounds (meanLuma=${stats.meanLuma})`);
  }

  const camera = inspectData?.camera || null;
  const profile = inspectData?.profile || '2d';
  const groundY = inspectData?.groundY ?? 0;
  if (!camera) {
    reasons.push('Missing camera framing telemetry in inspect().camera');
  } else {
    if (!isFiniteNum(camera.distanceToPlayer)) {
      reasons.push(`Invalid camera.distanceToPlayer (${camera.distanceToPlayer})`);
    } else if (profile === '3d') {
      if (camera.distanceToPlayer < 1.2 || camera.distanceToPlayer > 100) {
        reasons.push(`3D camera distance ${camera.distanceToPlayer.toFixed(2)}m outside valid range [1.2, 100]`);
      }
      if (!isFiniteNum(camera.y) || camera.y <= groundY + 0.1) {
        reasons.push(`3D camera clipped underground (camera.y=${camera.y}, groundY=${groundY})`);
      }
    } else {
      if (camera.distanceToPlayer < 0 || camera.distanceToPlayer > 2000) {
        reasons.push(`2D camera offset ${camera.distanceToPlayer.toFixed(2)} outside valid range [0, 2000]`);
      }
      if (camera.zoom !== undefined && (!isFiniteNum(camera.zoom) || camera.zoom < 0.05 || camera.zoom > 20)) {
        reasons.push(`2D camera zoom ${camera.zoom} outside valid range [0.05, 20]`);
      }
    }
  }

  return {
    name: 'Test D [Visual Framing]',
    pass: reasons.length === 0,
    reasons,
    metrics: {
      nonBlankRatio: stats.nonBlankRatio ?? null,
      meanLuma: stats.meanLuma ?? null,
      uniqueColors: stats.uniqueColors ?? null,
      cameraDistance: camera?.distanceToPlayer ?? null,
      consoleErrorCount: consoleErrors.length,
      httpErrorCount: httpErrors.length,
    },
  };
}

/**
 * Formats a human-readable Playability Doctor Report.
 * @param {object} report
 */
export function formatDoctorReport(report) {
  const lines = [
    `=== HGame Playability Doctor Report (${report.gameDir}) ===`,
    `Mode: ${report.mode}  |  Profile: ${report.profile}  |  Verdict: ${report.ok ? 'HEALTHY (4/4 GREEN)' : 'UNHEALTHY (FAILED)'}`,
    '--- Vital Signs ---',
  ];
  for (const t of report.tests) {
    lines.push(`  ${t.pass ? '[PASS]' : '[FAIL]'} ${t.name}`);
    lines.push(`         metrics: ${JSON.stringify(t.metrics)}`);
    for (const r of t.reasons) {
      lines.push(`         -> ${r}`);
    }
  }
  return lines.join('\n');
}

function buildPhase2EvalExpr() {
  return `(async () => {
    const doc = window.__HGAME_DOCTOR__;
    if (!doc) return { missingDoctor: true };
    if (doc.isStub) return { missingDoctor: true, isStub: true, reason: doc.reason };
    const step = window.__hgameStep;
    if (typeof step !== 'function') return { missingStep: true };

    const finite = (v) => typeof v === 'number' && Number.isFinite(v);

    // Test B: Aim & Kill (5s max deterministic step window)
    let testB;
    try {
      const bSetup = await doc.setupAimTest();
      const maxWindowSec = Math.max(5.0, (bSetup.expectedTtkSec || 2.0) * 2.5);
      const maxFrames = Math.min(480, Math.ceil(maxWindowSec * 60));
      let minHp = bSetup.initialHp;
      let killed = false;
      let killedAtSec = null;
      let nanDetected = !finite(bSetup.initialHp);
      for (let f = 1; f <= maxFrames; f++) {
        if (typeof doc.aimAndFire === 'function') doc.aimAndFire(bSetup.enemyId);
        step(1);
        const st = doc.getEnemyState(bSetup.enemyId);
        if (!st || !finite(st.hp)) { nanDetected = true; break; }
        if (st.hp < minHp) minHp = st.hp;
        if (!st.alive || st.hp <= 0) {
          killed = true;
          killedAtSec = Number((f / 60).toFixed(3));
          break;
        }
      }
      testB = {
        initialHp: bSetup.initialHp,
        minHp,
        damaged: minHp < bSetup.initialHp,
        killed,
        killedAtSec,
        maxWindowSec,
        nanDetected,
      };
    } catch (e) {
      testB = { error: String(e?.message || e) };
    }

    // Test C: Threat & Defense (5s chase + pushback/dodge)
    let testC;
    try {
      const cSetup = await doc.setupThreatTest();
      let hpAt05s = cSetup.initialHp;
      let minHpDuringChase = cSetup.initialHp;
      let preDefenseDist = cSetup.initialMinDist ?? 0;
      let postDefenseMaxDist = 0;
      let nanDetected = !finite(cSetup.initialHp);
      for (let f = 1; f <= 300; f++) {
        step(1);
        const st = doc.getThreatState(cSetup.enemyIds);
        if (!st || !finite(st.playerHp) || !finite(st.minEnemyDist)) { nanDetected = true; break; }
        if (f === 30) hpAt05s = st.playerHp;
        if (f <= 180 && st.playerHp < minHpDuringChase) minHpDuringChase = st.playerHp;
        if (f === 180) {
          preDefenseDist = st.minEnemyDist;
          await doc.triggerDefense();
        }
        if (f > 180 && st.minEnemyDist > postDefenseMaxDist) {
          postDefenseMaxDist = st.minEnemyDist;
        }
      }
      testC = {
        initialHp: cSetup.initialHp,
        hpAt05s,
        minHpDuringChase,
        tookDamage: minHpDuringChase < cSetup.initialHp,
        preDefenseDist,
        postDefenseMaxDist,
        defenseExpandedGap: postDefenseMaxDist > preDefenseDist + 0.35,
        nanDetected,
      };
    } catch (e) {
      testC = { error: String(e?.message || e) };
    }

    return { testB, testC };
  })()`;
}

function runSnapshot(args) {
  const res = spawnSync(process.execPath, [snapshotScript, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    parsed = {
      ok: false,
      problems: [res.stderr || res.error?.message || `snapshot exited with code ${res.status}`],
      consoleErrors: [],
      httpErrors: [],
    };
  }
  return { status: res.status, report: parsed };
}

/**
 * Executes pure-Node headless simulation doctor checks when `--sim` is requested and `src/sim/doctor.js` exports `createDoctorSim`.
 * @param {string} gameDir
 */
export async function runSimDoctor(gameDir) {
  const resolved = path.resolve(gameDir);
  const simDoctorPath = path.join(resolved, 'src', 'sim', 'doctor.js');
  if (!existsSync(simDoctorPath)) {
    throw new Error(`--sim mode requires ${simDoctorPath} exporting createDoctorSim()`);
  }
  const mod = await import(pathToFileURL(simDoctorPath).href);
  if (typeof mod.createDoctorSim !== 'function') {
    throw new Error(`${simDoctorPath} does not export createDoctorSim()`);
  }
  const sim = await mod.createDoctorSim();
  // Phase 1: 3s move
  for (let f = 0; f < 180; f++) sim.step(1 / 60, { moveX: 1, moveY: 0 });
  const inspectData = sim.inspect();

  // Phase 2: Aim & Kill
  const bSetup = await sim.setupAimTest();
  const maxWindowSec = Math.max(5.0, (bSetup.expectedTtkSec || 2.0) * 2.5);
  let minHp = bSetup.initialHp;
  let killed = false;
  let killedAtSec = null;
  for (let f = 1; f <= Math.min(480, Math.ceil(maxWindowSec * 60)); f++) {
    if (typeof sim.aimAndFire === 'function') sim.aimAndFire(bSetup.enemyId);
    sim.step(1 / 60, {});
    const st = sim.getEnemyState(bSetup.enemyId);
    if (st.hp < minHp) minHp = st.hp;
    if (!st.alive || st.hp <= 0) { killed = true; killedAtSec = Number((f / 60).toFixed(3)); break; }
  }
  const aimResult = {
    initialHp: bSetup.initialHp,
    minHp,
    damaged: minHp < bSetup.initialHp,
    killed,
    killedAtSec,
    maxWindowSec,
    nanDetected: !isFiniteNum(minHp),
  };

  // Phase 3: Threat & Defense
  const cSetup = await sim.setupThreatTest();
  let hpAt05s = cSetup.initialHp;
  let minHpDuringChase = cSetup.initialHp;
  let preDefenseDist = cSetup.initialMinDist ?? 0;
  let postDefenseMaxDist = 0;
  for (let f = 1; f <= 300; f++) {
    sim.step(1 / 60, {});
    const st = sim.getThreatState(cSetup.enemyIds);
    if (f === 30) hpAt05s = st.playerHp;
    if (f <= 180 && st.playerHp < minHpDuringChase) minHpDuringChase = st.playerHp;
    if (f === 180) { preDefenseDist = st.minEnemyDist; await sim.triggerDefense(); }
    if (f > 180 && st.minEnemyDist > postDefenseMaxDist) postDefenseMaxDist = st.minEnemyDist;
  }
  const threatResult = {
    initialHp: cSetup.initialHp,
    hpAt05s,
    minHpDuringChase,
    tookDamage: minHpDuringChase < cSetup.initialHp,
    preDefenseDist,
    postDefenseMaxDist,
    defenseExpandedGap: postDefenseMaxDist > preDefenseDist + 0.35,
    nanDetected: !isFiniteNum(minHpDuringChase) || !isFiniteNum(postDefenseMaxDist),
  };

  const mockSnapshot = {
    consoleErrors: [],
    httpErrors: [],
    stats: { nonBlankRatio: 0.5, meanLuma: 60, uniqueColors: 128 },
  };

  const tests = [
    evaluateMoveAndBounds(inspectData),
    evaluateAimAndKill(aimResult),
    evaluateThreatAndDefense(threatResult),
    evaluateVisualFraming(mockSnapshot, inspectData),
  ];
  return {
    ok: tests.every((t) => t.pass),
    mode: 'sim',
    gameDir: resolved,
    profile: inspectData?.profile || '2d',
    tests,
  };
}

function parseArgs(argv) {
  const opts = { gameDir: null, chrome: null, ready: '#game[data-engine-ready=true]', outDir: null, sim: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--chrome') opts.chrome = argv[++i];
    else if (t === '--ready') opts.ready = argv[++i];
    else if (t === '--out-dir') opts.outDir = argv[++i];
    else if (t === '--sim') opts.sim = true;
    else if (t === '--json') opts.json = true;
    else if (t === '--help' || t === '-h') opts.help = true;
    else if (!t.startsWith('-') && !opts.gameDir) opts.gameDir = t;
    else throw new Error(`Unknown or incomplete argument: ${t}`);
  }
  if (!opts.help && !opts.gameDir) {
    throw new Error('Usage: node scripts/doctor-playability.mjs <game-dir> [--ready "<selector>"] [--chrome <path>] [--out-dir <dir>] [--sim] [--json]');
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/doctor-playability.mjs <game-dir> [--ready "<selector>"] [--chrome <path>] [--out-dir <dir>] [--sim] [--json]');
    return;
  }

  const resolvedDir = path.resolve(opts.gameDir);
  if (!existsSync(path.join(resolvedDir, 'index.html'))) {
    throw new Error(`Missing index.html in ${resolvedDir}`);
  }

  let profile = '2d';
  try {
    const cfg = JSON.parse(readFileSync(path.join(resolvedDir, 'engine.config.json'), 'utf8'));
    if (cfg?.profile) profile = cfg.profile;
  } catch { /* optional */ }

  let report;
  if (opts.sim) {
    report = await runSimDoctor(resolvedDir);
  } else {
    const outDir = path.resolve(opts.outDir || path.join(os.tmpdir(), `hgame-doctor-${Date.now()}`));
    mkdirSync(outDir, { recursive: true });
    const chromeArgs = opts.chrome ? ['--chrome', opts.chrome] : [];
    const readyArgs = opts.ready ? ['--ready', opts.ready] : [];

    // Phase 1: 3s real keyboard move + visual framing snapshot
    const phase1 = runSnapshot([
      resolvedDir,
      '--freeze-time',
      '--steps', '5',
      '--keys', 'd:3000',
      ...readyArgs,
      ...chromeArgs,
      '--out', path.join(outDir, 'doctor-move-framing.png'),
      '--eval', '(() => window.__HGAME_DOCTOR__ ? { isStub: Boolean(window.__HGAME_DOCTOR__.isStub), reason: window.__HGAME_DOCTOR__.reason || null, ...(typeof window.__HGAME_DOCTOR__.inspect === "function" ? window.__HGAME_DOCTOR__.inspect() : {}) } : null)()',
    ]);

    const inspectData = phase1.report?.eval || null;
    const testA = evaluateMoveAndBounds(inspectData);
    const testD = evaluateVisualFraming(phase1.report, inspectData);

    // Phase 2: Aim & Kill + Threat & Defense via deterministic stepping
    const phase2 = runSnapshot([
      resolvedDir,
      '--freeze-time',
      '--steps', '5',
      ...readyArgs,
      ...chromeArgs,
      '--out', path.join(outDir, 'doctor-combat.png'),
      '--eval', buildPhase2EvalExpr(),
    ]);

    const p2Eval = phase2.report?.eval || null;
    const combatMissingErr = p2Eval?.missingDoctor
      ? (p2Eval.reason || 'Missing or stub window.__HGAME_DOCTOR__')
      : p2Eval?.missingStep
        ? 'Missing window.__hgameStep in frozen-time snapshot'
        : null;

    const testB = evaluateAimAndKill(combatMissingErr ? { error: combatMissingErr } : p2Eval?.testB);
    const testC = evaluateThreatAndDefense(combatMissingErr ? { error: combatMissingErr } : p2Eval?.testC);

    const tests = [testA, testB, testC, testD];
    report = {
      ok: tests.every((t) => t.pass),
      mode: 'browser-snapshot',
      gameDir: resolvedDir,
      profile: inspectData?.profile || profile,
      snapshots: {
        moveFramingPng: path.join(outDir, 'doctor-move-framing.png'),
        combatPng: path.join(outDir, 'doctor-combat.png'),
      },
      tests,
    };
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report));
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error('re:doctor failed: ' + err.message);
    process.exitCode = 1;
  });
}
