#!/usr/bin/env node
// Headless multi-seed Autoplay & Difficulty/Clear-Rate Gate for HGame projects.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function hasNonFinite(val, seen = new Set()) {
  if (typeof val === 'number') return !Number.isFinite(val);
  if (!val || typeof val !== 'object' || seen.has(val)) return false;
  seen.add(val);
  if (Array.isArray(val)) return val.some(v => hasNonFinite(v, seen));
  for (const v of Object.values(val)) {
    if (hasNonFinite(v, seen)) return true;
  }
  return false;
}

function summarizeGroup(results) {
  const n = results.length;
  if (n === 0) {
    return {
      runs: 0,
      wins: 0,
      defeats: 0,
      timeouts: 0,
      winRate: 0,
      defeatRate: 0,
      timeoutRate: 0,
      avgDurationSec: 0,
      minDurationSec: 0,
      maxDurationSec: 0,
      avgScore: 0,
      avgKills: 0,
      avgLevel: 0,
      nonFiniteCount: 0,
    };
  }
  let wins = 0;
  let defeats = 0;
  let timeouts = 0;
  let sumDur = 0;
  let minDur = Infinity;
  let maxDur = 0;
  let sumScore = 0;
  let sumKills = 0;
  let sumLevel = 0;
  let nonFiniteCount = 0;

  for (const r of results) {
    if (r.outcome === 'victory') wins++;
    else if (r.outcome === 'defeat') defeats++;
    else timeouts++;
    const dur = Number.isFinite(r.durationSec) ? r.durationSec : 0;
    sumDur += dur;
    if (dur < minDur) minDur = dur;
    if (dur > maxDur) maxDur = dur;
    sumScore += Number.isFinite(r.score) ? r.score : 0;
    sumKills += Number.isFinite(r.kills) ? r.kills : 0;
    sumLevel += Number.isFinite(r.level) ? r.level : 1;
    if (r.nonFinite) nonFiniteCount++;
  }

  return {
    runs: n,
    wins,
    defeats,
    timeouts,
    winRate: +(wins / n).toFixed(4),
    defeatRate: +(defeats / n).toFixed(4),
    timeoutRate: +(timeouts / n).toFixed(4),
    avgDurationSec: +(sumDur / n).toFixed(2),
    minDurationSec: +(minDur === Infinity ? 0 : minDur).toFixed(2),
    maxDurationSec: +maxDur.toFixed(2),
    avgScore: +(sumScore / n).toFixed(2),
    avgKills: +(sumKills / n).toFixed(2),
    avgLevel: +(sumLevel / n).toFixed(2),
    nonFiniteCount,
  };
}

async function runSingleSeed(spec, seed, strategy) {
  if (typeof spec.runSeed === 'function') {
    const res = await spec.runSeed(seed, strategy);
    if (!res || typeof res !== 'object') {
      throw new Error(`runSeed(${seed}, "${strategy}") must return a result object`);
    }
    const nonFinite = Boolean(res.nonFinite) || hasNonFinite(res);
    return {
      seed,
      strategy,
      outcome: res.outcome === 'victory' || res.outcome === 'defeat' ? res.outcome : 'timeout',
      durationSec: Number(res.durationSec) || 0,
      score: Number(res.score) || 0,
      kills: Number(res.kills) || 0,
      level: Number(res.level) || 1,
      nonFinite,
    };
  }

  if (typeof spec.createSession !== 'function') {
    throw new Error('Autoplay spec must export createSession(seed, strategy) or runSeed(seed, strategy)');
  }

  const tickHz = spec.tickHz ?? 60;
  const dt = tickHz > 0 ? 1 / tickHz : 1;
  const maxSteps = spec.maxSteps ?? (tickHz > 0 ? Math.max(1, Math.round((spec.maxSeconds ?? 180) * tickHz)) : 500);
  const session = await spec.createSession(seed, strategy);
  if (!session || typeof session.step !== 'function' || typeof session.snapshot !== 'function') {
    throw new Error(`createSession(${seed}, "${strategy}") must return { step(dt, tick), snapshot() }`);
  }

  let nonFinite = false;
  let snap = session.snapshot();
  if (hasNonFinite(snap)) nonFinite = true;

  let stepCount = 0;
  while (!snap?.over && stepCount < maxSteps) {
    session.step(dt, stepCount);
    stepCount++;
    if (stepCount % 30 === 0 || stepCount === maxSteps) {
      snap = session.snapshot();
      if (hasNonFinite(snap)) {
        nonFinite = true;
        break;
      }
    } else if (typeof session.isOver === 'function' ? session.isOver() : false) {
      snap = session.snapshot();
      if (hasNonFinite(snap)) nonFinite = true;
      break;
    }
  }
  snap = session.snapshot();
  if (hasNonFinite(snap)) nonFinite = true;

  const outcome = snap?.outcome === 'victory'
    ? 'victory'
    : (snap?.outcome === 'defeat' || snap?.over)
      ? (snap?.outcome === 'victory' ? 'victory' : 'defeat')
      : 'timeout';

  return {
    seed,
    strategy,
    outcome,
    durationSec: Number.isFinite(snap?.time) ? snap.time : +(stepCount * dt).toFixed(2),
    score: Number(snap?.score) || 0,
    kills: Number(snap?.kills) || 0,
    level: Number(snap?.level) || 1,
    nonFinite,
  };
}

/**
 * Runs multi-seed autoplay & difficulty verification against a game directory or autoplay module.
 * @param {string} gameDir
 * @param {{ specPath?: string, runs?: number, idleRuns?: number }} [opts]
 */
export async function runAutoplayGate(gameDir, opts = {}) {
  const absDir = path.resolve(gameDir);
  const specPath = opts.specPath
    ? path.resolve(absDir, opts.specPath)
    : path.join(absDir, 'tests', 'autoplay.mjs');

  if (!existsSync(specPath)) {
    throw new Error(`Missing autoplay specification: ${specPath}`);
  }

  const mod = await import(pathToFileURL(specPath).href + `?t=${Date.now()}`);
  const rawSpec = mod.default ?? mod;
  const spec = rawSpec.config && typeof rawSpec.config === 'object'
    ? { ...rawSpec.config, ...rawSpec }
    : rawSpec;

  const botRunsCount = opts.runs ?? spec.runs ?? 20;
  const skipIdle = Boolean(spec.skipIdle) || (opts.idleRuns ?? spec.idleRuns ?? 10) <= 0;
  const idleRunsCount = skipIdle ? 0 : (opts.idleRuns ?? spec.idleRuns ?? 10);

  const botResults = [];
  for (let s = 1; s <= botRunsCount; s++) {
    botResults.push(await runSingleSeed(spec, s, 'bot'));
  }

  const idleResults = [];
  for (let s = 1; s <= idleRunsCount; s++) {
    idleResults.push(await runSingleSeed(spec, s, 'idle'));
  }

  const bot = summarizeGroup(botResults);
  const idle = skipIdle ? null : summarizeGroup(idleResults);
  const skillDelta = idle ? +(bot.winRate - idle.winRate).toFixed(4) : null;

  const minWinRate = spec.minWinRate ?? 0.30;
  const maxWinRate = spec.maxWinRate ?? 1.0;
  const maxIdleWinRate = spec.maxIdleWinRate ?? 0.15;
  const minSkillDelta = spec.minSkillDelta ?? (idle ? 0.20 : 0);
  const minAvgDurationSec = spec.minAvgDurationSec ?? 3;
  const maxTimeoutRate = spec.maxTimeoutRate ?? 0.15;

  const reasons = [];
  if (bot.nonFiniteCount > 0) {
    reasons.push(`Bot simulation produced NaN/Infinity in ${bot.nonFiniteCount} run(s)`);
  }
  if (idle && idle.nonFiniteCount > 0) {
    reasons.push(`Idle simulation produced NaN/Infinity in ${idle.nonFiniteCount} run(s)`);
  }
  if (bot.winRate < minWinRate) {
    reasons.push(`Bot clear rate ${(bot.winRate * 100).toFixed(1)}% below minWinRate ${(minWinRate * 100).toFixed(1)}% (game too hard or unbeatable)`);
  }
  if (bot.winRate > maxWinRate) {
    reasons.push(`Bot clear rate ${(bot.winRate * 100).toFixed(1)}% above maxWinRate ${(maxWinRate * 100).toFixed(1)}% (difficulty too trivial)`);
  }
  if (bot.avgDurationSec < minAvgDurationSec) {
    reasons.push(`Bot avg run duration ${bot.avgDurationSec}s below minimum ${minAvgDurationSec}s (suspected instant-death tuning)`);
  }
  if (bot.timeoutRate > maxTimeoutRate) {
    reasons.push(`Bot timeout rate ${(bot.timeoutRate * 100).toFixed(1)}% exceeds ${(maxTimeoutRate * 100).toFixed(1)}% (softlock or pacing stall)`);
  }
  if (idle && idle.winRate > maxIdleWinRate) {
    reasons.push(`Idle/AFK clear rate ${(idle.winRate * 100).toFixed(1)}% exceeds maxIdleWinRate ${(maxIdleWinRate * 100).toFixed(1)}% (insufficient threat/difficulty)`);
  }
  if (idle && skillDelta < minSkillDelta) {
    reasons.push(`Skill delta ${(skillDelta * 100).toFixed(1)}% (bot ${(bot.winRate * 100).toFixed(1)}% - idle ${(idle.winRate * 100).toFixed(1)}%) below ${(minSkillDelta * 100).toFixed(1)}%`);
  }
  if (spec.minKillsAvg !== undefined && bot.avgKills < spec.minKillsAvg) {
    reasons.push(`Bot avg kills ${bot.avgKills} below minKillsAvg ${spec.minKillsAvg}`);
  }

  return {
    ok: reasons.length === 0,
    spec: path.relative(absDir, specPath).replace(/\\/g, '/'),
    name: spec.name ?? path.basename(absDir),
    thresholds: {
      minWinRate,
      maxWinRate,
      maxIdleWinRate: idle ? maxIdleWinRate : null,
      minSkillDelta: idle ? minSkillDelta : null,
      minAvgDurationSec,
      maxTimeoutRate,
    },
    bot,
    idle,
    skillDelta,
    reasons,
  };
}

function parseArgs(argv) {
  const opts = { gameDir: '.', specPath: '', runs: undefined, idleRuns: undefined, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--spec') opts.specPath = argv[++i] ?? '';
    else if (a === '--runs') opts.runs = Math.max(1, parseInt(argv[++i] ?? '20', 10) || 20);
    else if (a === '--idle-runs') opts.idleRuns = Math.max(0, parseInt(argv[++i] ?? '10', 10) || 0);
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (!a.startsWith('-')) opts.gameDir = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/check-autoplay.mjs [game-dir] [--spec tests/autoplay.mjs] [--runs N] [--idle-runs N] [--json]');
    return;
  }
  const report = await runAutoplayGate(opts.gameDir, opts);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`=== Autoplay & Difficulty Report (${report.name}) ===`);
    console.log(`Verdict: ${report.ok ? 'PASS' : 'FAIL'}`);
    console.log(`  Bot (${report.bot.runs} runs): winRate=${(report.bot.winRate * 100).toFixed(1)}% avgDur=${report.bot.avgDurationSec}s avgKills=${report.bot.avgKills} timeouts=${report.bot.timeouts}`);
    if (report.idle) {
      console.log(`  Idle (${report.idle.runs} runs): winRate=${(report.idle.winRate * 100).toFixed(1)}% avgDur=${report.idle.avgDurationSec}s skillDelta=${(report.skillDelta * 100).toFixed(1)}%`);
    }
    for (const r of report.reasons) console.log(`  -> ${r}`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ ok: false, error: err.message, reasons: [err.message] }, null, 2));
    } else {
      console.error('check-autoplay failed: ' + err.message);
    }
    process.exitCode = 1;
  });
}
