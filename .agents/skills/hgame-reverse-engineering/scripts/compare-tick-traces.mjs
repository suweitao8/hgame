#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_FILE_BYTES = 32 * 1024 * 1024;

async function parse(file) {
  const target = path.resolve(file);
  const info = await stat(target);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) {
    throw new Error('Expected a real CSV file at most 32 MiB: ' + target);
  }
  const text = (await readFile(target, 'utf8')).replace(/^\uFEFF/, '');
  const result = [];
  let previous = null;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (index === 0 && /^tick\s*,\s*(hash|checksum)$/i.test(trimmed)) continue;
    const parts = trimmed.split(',');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0].trim()) ||
        !/^-?\d+$/.test(parts[1].trim())) {
      throw new Error('Invalid tick,hash decimal CSV at line ' + (index + 1) + ' in ' + target);
    }
    const tick = Number(parts[0].trim());
    if (!Number.isSafeInteger(tick) || tick <= 0 ||
        (previous !== null && tick !== previous + 1)) {
      throw new Error('Tick gap, duplicate or invalid sequence at line ' + (index + 1) + ' in ' + target);
    }
    previous = tick;
    // The hash is kept as a decimal string to avoid IEEE-754 precision loss
    // and accidental 32-bit signed/unsigned coercion.
    result.push({ tick, hash: BigInt(parts[1].trim()).toString(10) });
  }
  if (!result.length) throw new Error('Empty Tick trace: ' + target);
  return result;
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const files = argv.filter(a => a !== '--json');
  if (files.length !== 2 || files.some(f => f.startsWith('--'))) {
    throw new Error('Usage: node compare-tick-traces.mjs <reference.csv> <candidate.csv> [--json]');
  }
  const [reference, candidate] = await Promise.all(files.map(parse));
  let comparedTicks = 0, firstDifferenceTick = null, expectedHash = null, actualHash = null;
  for (let i = 0; i < Math.max(reference.length, candidate.length); i++) {
    const a = reference[i], b = candidate[i];
    if (!a || !b || a.tick !== b.tick || a.hash !== b.hash) {
      firstDifferenceTick = a?.tick ?? b?.tick;
      expectedHash = a?.hash ?? null;
      actualHash = b?.hash ?? null;
      break;
    }
    comparedTicks++;
  }
  const report = {
    match: firstDifferenceTick === null,
    comparedTicks,
    referenceTicks: reference.length,
    candidateTicks: candidate.length,
    firstDifferenceTick,
    expectedHash,
    actualHash,
  };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log((report.match ? 'MATCH' : 'MISMATCH') +
      ' compared=' + report.comparedTicks +
      ' first_difference_tick=' + (report.firstDifferenceTick ?? 'none'));
    if (!report.match) console.log('reference=' + expectedHash + ' candidate=' + actualHash);
  }
  if (!report.match) process.exitCode = 1;
}
main().catch(error => {
  console.error('Tick trace comparison failed: ' + error.message);
  process.exitCode = 2;
});
