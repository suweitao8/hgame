#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const o = { target: null, source: null, out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--json') o.json = true;
    else if (!a.startsWith('-') && !o.target) o.target = a;
    else if (!a.startsWith('-') && !o.source) o.source = a;
    else throw new Error('Unknown or incomplete argument: ' + a);
  }
  if (!o.target || !o.source || !o.out) throw new Error('Usage: node merge-function-index.mjs <curated-index.json> <imported-index.json> --out <merged-index.json> [--json]');
  return o;
}
function validate(index, label) {
  if (!index || index.schemaVersion !== 1 || !Array.isArray(index.functions) || !Array.isArray(index.calls)) {
    throw new Error(label + ' must use schemaVersion 1 and functions/calls arrays');
  }
  const ids = new Set();
  for (const fn of index.functions) {
    if (!fn || typeof fn.id !== 'string' || !fn.id) throw new Error(label + ' contains a function without id');
    if (ids.has(fn.id)) throw new Error(label + ' contains duplicate function id: ' + fn.id);
    ids.add(fn.id);
  }
  return ids;
}
async function main() {
  const o = parseArgs(process.argv.slice(2));
  const targetPath = path.resolve(o.target), sourcePath = path.resolve(o.source), outputPath = path.resolve(o.out);
  if (outputPath === targetPath || outputPath === sourcePath) throw new Error('Output must be a new file, not either input index');
  const [target, source] = await Promise.all([
    readFile(targetPath, 'utf8').then(text => JSON.parse(text.replace(/^\uFEFF/, ''))),
    readFile(sourcePath, 'utf8').then(text => JSON.parse(text.replace(/^\uFEFF/, ''))),
  ]);
  validate(target, 'Target index'); validate(source, 'Source index');
  const functions = new Map(target.functions.map(fn => [fn.id, { ...fn }]));
  const conflicts = [];
  for (const fn of source.functions) {
    const existing = functions.get(fn.id);
    if (!existing) { functions.set(fn.id, { ...fn }); continue; }
    if ((existing.address && fn.address && existing.address !== fn.address) ||
        (existing.name && fn.name && existing.name !== fn.name)) {
      conflicts.push({ id: fn.id, target: { name: existing.name, address: existing.address }, source: { name: fn.name, address: fn.address } });
      continue;
    }
    functions.set(fn.id, { ...fn, ...existing });
  }
  if (conflicts.length) throw new Error('Function identity conflicts: ' + JSON.stringify(conflicts.slice(0, 20)));
  const calls = new Map();
  for (const edge of [...target.calls, ...source.calls]) {
    const key = [edge.from, edge.to, edge.kind, edge.evidenceRef || ''].join('|');
    if (!calls.has(key)) calls.set(key, { ...edge });
  }
  const sources = new Map();
  for (const item of [...(target.sources || []), ...(source.sources || [])]) {
    const key = [item.id || '', item.path || '', item.tool || ''].join('|');
    if (!sources.has(key)) sources.set(key, { ...item });
  }
  const merged = {
    ...target,
    schemaVersion: 1,
    entryPoints: [...new Set([...(target.entryPoints || []), ...(source.entryPoints || [])])],
    sources: [...sources.values()],
    functions: [...functions.values()],
    calls: [...calls.values()],
    mergeHistory: [...(target.mergeHistory || []), { source: sourcePath, sourceGameId: source.gameId || null,
      addedFunctions: source.functions.filter(fn => !target.functions.some(existing => existing.id === fn.id)).length,
      importedCalls: source.calls.length }],
  };
  await writeFile(outputPath, JSON.stringify(merged, null, 2) + '\n', { flag: 'wx' });
  const summary = { output: outputPath, functions: merged.functions.length, calls: merged.calls.length,
    sources: merged.sources.length, addedFunctions: merged.mergeHistory.at(-1).addedFunctions,
    importedCalls: source.calls.length };
  console.log(o.json ? JSON.stringify(summary, null, 2) : JSON.stringify(summary));
}
main().catch(error => { console.error('Function index merge failed: ' + error.message); process.exitCode = 2; });
