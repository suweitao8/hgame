#!/usr/bin/env node
// Game-level composite score derived ONLY from build/acceptance-report.json evidence.
// Skipped gates earn 0 and lower `confidence` instead of silently counting as passed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GAME_SCORE_WEIGHTS = Object.freeze({
  correctness: { config: 6, syntax: 4, uiStatic: 8, tests: 8, designDocs: 4 },
  runtime: { visual: 12, playtest: 12, doctor: 6 },
  balance: { autoplay: 25 },
  delivery: { webasset: 6, package: 5, taskManifest: 4 }
});

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

// Quality factor in [0,1] for a PASSED gate; failed/skipped gates never reach here.
function qualityFactor(name, gate) {
  if (name === 'autoplay') {
    const bot = gate.bot ?? {};
    const winRate = bot.winRate ?? 0;
    const skill = clamp01((gate.skillDelta ?? 0) / 0.6);
    const band = winRate >= 0.5 && winRate <= 0.9 ? 1 : 0.7; // trivially easy / too hard feels worse
    const timeouts = 1 - clamp01((bot.timeoutRate ?? 0) / 0.1);
    return clamp01(0.5 + 0.2 * skill + 0.2 * band + 0.1 * timeouts);
  }
  if (name === 'playtest') {
    const p95 = gate.frameStats?.p95Ms;
    if (typeof p95 === 'number' && p95 > 33.4) return 0.7;
    if (typeof p95 === 'number' && p95 > 20) return 0.9;
  }
  if (name === 'visual') {
    const caps = Object.values(gate.captures ?? {});
    const warn = caps.some((c) => (c.ui?.hudAreaRatio ?? 0) > 0.1);
    return warn ? 0.8 : 1;
  }
  return 1;
}

function explainGate(name, status, gate, factor) {
  if (status === 'failed') {
    return { reason: `未通过：${(gate?.errors ?? []).slice(0, 2).join('；') || '见 acceptance-report'}`, improve: '修复报错后重跑 npm run accept' };
  }
  if (status !== 'passed') {
    return { reason: `未验证（${gate?.reason ?? status}）`, improve: `运行完整 accept（含 --webasset${name === 'package' ? ' --package' : ''}）补齐该门禁；补不齐则置信度保持偏低` };
  }
  if (factor >= 1) return { reason: '通过，满分', improve: '无需改进' };
  if (name === 'autoplay') {
    const bot = gate.bot ?? {};
    const tips = [];
    if ((gate.skillDelta ?? 0) < 0.6) tips.push(`拉大 bot 与挂机胜率差（现 ${gate.skillDelta}，目标 ≥ 0.6）`);
    if (bot.winRate < 0.5 || bot.winRate > 0.9) tips.push(`把 bot 通关率调进 50%–90%（现 ${(bot.winRate * 100).toFixed(0)}%${bot.winRate > 0.9 ? '，偏简单' : '，偏难'}）`);
    if ((bot.timeoutRate ?? 0) > 0) tips.push(`降低超时率（现 ${(bot.timeoutRate * 100).toFixed(0)}%）`);
    return { reason: `通过，但难度/技巧区分度未满：质量系数 ${factor.toFixed(2)}`, improve: tips.join('；') || '调整数值平衡' };
  }
  if (name === 'playtest') {
    return { reason: `帧时间偏高（p95 ${gate.frameStats?.p95Ms}ms），系数 ${factor}`, improve: '优化渲染/逻辑，使 p95 ≤ 20ms' };
  }
  if (name === 'visual') {
    return { reason: `HUD 面积超 10%，系数 ${factor}`, improve: '收缩边缘 HUD 至 ≤ 10% 画布面积' };
  }
  return { reason: `质量系数 ${factor}`, improve: '见 acceptance-report 细节' };
}

export function scoreAcceptanceReport(report) {
  const breakdown = [];
  let points = 0;
  let verifiedWeight = 0;
  let totalWeight = 0;
  for (const [category, gates] of Object.entries(GAME_SCORE_WEIGHTS)) {
    for (const [name, weight] of Object.entries(gates)) {
      totalWeight += weight;
      const gate = report?.gates?.[name];
      const status = gate?.status ?? 'missing';
      let earned = 0;
      let factor = 0;
      if (status === 'passed') {
        factor = qualityFactor(name, gate);
        earned = weight * factor;
        verifiedWeight += weight;
      } else if (status === 'failed') {
        verifiedWeight += weight;
      }
      points += earned;
      breakdown.push({ category, gate: name, status, weight, factor: +factor.toFixed(3), earned: +earned.toFixed(2), ...explainGate(name, status, gate, factor) });
    }
  }
  const score = +points.toFixed(1);
  const confidence = +(verifiedWeight / totalWeight).toFixed(3);
  const verifiedScore = verifiedWeight > 0 ? +((points / verifiedWeight) * 100).toFixed(1) : 0;
  const failed = breakdown.filter((b) => b.status === 'failed').map((b) => b.gate);
  return {
    gameId: report?.gameId ?? null,
    checkedAt: report?.checkedAt ?? null,
    mode: report?.mode ?? null,
    score, // absolute /100, unverified gates count as 0
    confidence, // share of weight actually verified
    verifiedScore, // score over verified gates only
    failedGates: failed,
    unverifiedGates: breakdown.filter((b) => b.status !== 'passed' && b.status !== 'failed').map((b) => b.gate),
    grade: failed.length > 0 ? 'F' : score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : 'D',
    breakdown
  };
}

function resolveReportPath(arg) {
  const p = path.resolve(arg);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return path.join(p, 'build', 'acceptance-report.json');
  return p;
}

function runCli() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  const minIdx = args.indexOf('--min');
  const min = minIdx >= 0 ? Number(args[minIdx + 1]) : null;
  if (!target) {
    console.error('Usage: node scripts/score-game.mjs <game-dir|acceptance-report.json> [--json] [--min <score>]');
    process.exit(2);
  }
  const reportPath = resolveReportPath(target);
  if (!fs.existsSync(reportPath)) {
    console.error(`No acceptance report at ${reportPath}. Run: npm run accept -- <game-dir> --webasset`);
    process.exit(2);
  }
  const result = scoreAcceptanceReport(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `[SCORE] ${result.gameId} ${result.score}/100 grade=${result.grade} confidence=${(result.confidence * 100).toFixed(0)}% verified=${result.verifiedScore}`
    );
    if (result.failedGates.length) console.log(`  failed: ${result.failedGates.join(', ')}`);
    if (result.unverifiedGates.length) console.log(`  unverified: ${result.unverifiedGates.join(', ')}`);
    console.log('  gate           得分/权重   原因 → 改进');
    for (const b of result.breakdown) {
      console.log(`  ${b.gate.padEnd(13)} ${String(b.earned).padStart(5)}/${String(b.weight).padEnd(3)}  ${b.reason} → ${b.improve}`);
    }
  }
  if (result.failedGates.length > 0 || (min !== null && result.score < min)) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) runCli();
