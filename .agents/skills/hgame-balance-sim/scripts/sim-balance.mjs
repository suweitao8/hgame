#!/usr/bin/env node
// Zero-dependency Monte Carlo headless combat & gacha balance simulator.
import fs from 'node:fs';

function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv) {
  let configPath = '';
  let demo = false;
  let runs = 1000;
  let seed = 2026;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' || a === '-c') configPath = argv[++i] ?? '';
    else if (a === '--demo') demo = true;
    else if (a === '--runs' || a === '-n') runs = Math.max(10, parseInt(argv[++i] ?? '1000', 10) || 1000);
    else if (a === '--seed' || a === '-s') seed = parseInt(argv[++i] ?? '2026', 10) || 2026;
  }
  return { configPath, demo, runs, seed };
}

function simulateDuelRun(duel, rnd) {
  let pHp = duel.player.hp;
  let eHp = duel.enemy.hp;
  const pInt = Math.max(0.05, duel.player.atkInterval || 0.5);
  const eInt = Math.max(0.05, duel.enemy.atkInterval || 0.7);
  let pNext = pInt;
  let eNext = eInt;
  let t = 0;
  let crits = 0;
  let hits = 0;

  while (pHp > 0 && eHp > 0 && t < 300) {
    if (pNext <= eNext) {
      t = pNext;
      pNext += pInt;
      const isCrit = rnd() < (duel.player.critChance || 0);
      const mult = isCrit ? (duel.player.critMult || 2) : 1;
      const variance = 0.9 + rnd() * 0.2;
      eHp -= duel.player.atk * mult * variance;
      hits++;
      if (isCrit) crits++;
    } else {
      t = eNext;
      eNext += eInt;
      const isCrit = rnd() < (duel.enemy.critChance || 0);
      const mult = isCrit ? (duel.enemy.critMult || 1.5) : 1;
      const variance = 0.9 + rnd() * 0.2;
      pHp -= duel.enemy.atk * mult * variance;
    }
  }
  return { win: eHp <= 0 && pHp > 0, ttk: t, crits, hits };
}

function simulateGacha(gacha, runs, rnd) {
  const baseRate = gacha.baseRate ?? 0.015;
  const pity = gacha.pityThreshold ?? 60;
  const pullsPerRun = gacha.pullsPerRun ?? 100;
  let totalPulls = 0;
  let totalHits = 0;
  let pityTriggers = 0;

  for (let r = 0; r < runs; r++) {
    let sinceHit = 0;
    for (let i = 0; i < pullsPerRun; i++) {
      sinceHit++;
      totalPulls++;
      if (sinceHit >= pity || rnd() < baseRate) {
        if (sinceHit >= pity) pityTriggers++;
        totalHits++;
        sinceHit = 0;
      }
    }
  }
  return {
    totalPulls,
    totalHits,
    effectiveRate: totalHits / Math.max(1, totalPulls),
    pityShare: pityTriggers / Math.max(1, totalHits),
  };
}

const DEMO_CFG = {
  duel: {
    player: { hp: 120, atk: 18, atkInterval: 0.45, critChance: 0.2, critMult: 2.0 },
    enemy: { hp: 175, atk: 17, atkInterval: 0.6, critChance: 0.1, critMult: 1.6 },
    minWinRate: 0.45,
    maxWinRate: 0.9,
    maxTtkSec: 12.0,
  },
  gacha: { baseRate: 0.015, pityThreshold: 60, pullsPerRun: 100 },
};

const args = parseArgs(process.argv.slice(2));
const cfg = args.configPath
  ? JSON.parse(fs.readFileSync(args.configPath, 'utf8'))
  : (args.demo ? DEMO_CFG : null);

if (!cfg) {
  console.error('Usage: node sim-balance.mjs --config <balance.json> [--runs 1000] [--seed 2026] | --demo');
  process.exit(1);
}

const rnd = mulberry32(args.seed);
const report = { runs: args.runs, seed: args.seed, pass: true };

if (cfg.duel) {
  let wins = 0;
  let totalTtk = 0;
  const ttks = [];
  for (let i = 0; i < args.runs; i++) {
    const res = simulateDuelRun(cfg.duel, rnd);
    if (res.win) wins++;
    totalTtk += res.ttk;
    ttks.push(res.ttk);
  }
  ttks.sort((a, b) => a - b);
  const winRate = wins / args.runs;
  const avgTtkSec = totalTtk / args.runs;
  const p95TtkSec = ttks[Math.min(ttks.length - 1, Math.floor(ttks.length * 0.95))];
  const minW = cfg.duel.minWinRate ?? 0;
  const maxW = cfg.duel.maxWinRate ?? 1;
  const maxT = cfg.duel.maxTtkSec ?? Infinity;
  const ok = winRate >= minW && winRate <= maxW && avgTtkSec <= maxT;
  report.duel = {
    winRate: +winRate.toFixed(4),
    avgTtkSec: +avgTtkSec.toFixed(3),
    p95TtkSec: +p95TtkSec.toFixed(3),
    ok,
  };
  if (!ok) report.pass = false;
}

if (cfg.gacha) {
  report.gacha = simulateGacha(cfg.gacha, args.runs, rnd);
}

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(1);
