#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CALL_KINDS = new Set(['static', 'observed', 'inferred']);
function parseArgs(argv) {
  const options = { file: null, entries: [], target: null, json: false, requireResolved: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--entry') options.entries.push(argv[++i]);
    else if (arg === '--target') options.target = argv[++i];
    else if (arg === '--json') options.json = true;
    else if (arg === '--require-resolved') options.requireResolved = true;
    else if (!arg.startsWith('-') && !options.file) options.file = arg;
    else throw new Error('Unknown or incomplete argument: ' + arg);
  }
  if (!options.file) throw new Error('Usage: node audit-function-index.mjs <function-index.json> [--entry function-id] [--target function-id] [--require-resolved] [--json]');
  return options;
}
function shortestPath(graph, start, target) {
  const queue = [[start]], visited = new Set([start]);
  while (queue.length) {
    const current = queue.shift(), last = current[current.length - 1];
    if (last === target) return current;
    for (const next of graph.get(last) || []) if (!visited.has(next)) {
      visited.add(next); queue.push([...current, next]);
    }
  }
  return null;
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = JSON.parse((await readFile(path.resolve(options.file), 'utf8')).replace(/^\uFEFF/, ''));
  if (input.schemaVersion !== 1 || !Array.isArray(input.functions) || !Array.isArray(input.calls)) {
    throw new Error('Function index must use schemaVersion 1 with functions and calls arrays');
  }
  if (input.entryPoints !== undefined && !Array.isArray(input.entryPoints)) throw new Error('entryPoints must be an array');
  const errors = [], warnings = [], functions = new Map(), graph = new Map();
  for (const fn of input.functions) {
    if (!fn || typeof fn.id !== 'string' || !fn.id.trim()) { errors.push('Function has no id'); continue; }
    if (functions.has(fn.id)) { errors.push('Duplicate function id: ' + fn.id); continue; }
    functions.set(fn.id, fn); graph.set(fn.id, new Set());
    if (!fn.name) warnings.push('Function ' + fn.id + ' has no display name');
    if (!fn.sourceRef && !fn.address && !fn.evidenceRef) warnings.push('Function ' + fn.id + ' has no source/address evidence anchor');
  }
  const edgeKinds = { static: 0, observed: 0, inferred: 0 }, unresolvedEdges = [], unanchoredEdges = [];
  for (let i = 0; i < input.calls.length; i++) {
    const edge = input.calls[i];
    if (!edge || !CALL_KINDS.has(edge.kind)) { errors.push('Call edge ' + i + ' has invalid kind'); continue; }
    edgeKinds[edge.kind]++;
    if (!functions.has(edge.from) || !functions.has(edge.to)) { unresolvedEdges.push({ index: i, from: edge.from, to: edge.to }); continue; }
    graph.get(edge.from).add(edge.to);
    if (edge.confidence === 'confirmed' && !edge.evidenceRef) unanchoredEdges.push({ index: i, from: edge.from, to: edge.to });
  }
  const entries = [...new Set([...options.entries, ...(input.entryPoints || [])])];
  for (const id of entries) if (!functions.has(id)) errors.push('Unknown entry point: ' + id);
  const reachable = new Set(), queue = entries.filter(id => functions.has(id));
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of graph.get(id) || []) if (!reachable.has(next)) queue.push(next);
  }
  if (options.target && !functions.has(options.target)) errors.push('Unknown target function: ' + options.target);
  const paths = options.target && entries.length
    ? entries.map(entry => shortestPath(graph, entry, options.target)).filter(Boolean).sort((a, b) => a.length - b.length)
    : [];
  const unreachable = entries.length ? [...functions.keys()].filter(id => !reachable.has(id)) : [];
  if (options.target && entries.length && !paths.length && functions.has(options.target)) warnings.push('No call path found from selected entries to target ' + options.target);
  const report = { schemaVersion: 1, source: path.resolve(options.file), functionCount: functions.size,
    externalFunctionCount: [...functions.values()].filter(fn => fn.external === true).length,
    callEdgeCount: input.calls.length, edgeKinds, entryPoints: entries, reachableFunctionCount: reachable.size,
    unreachableFunctionCount: unreachable.length, unreachableFunctions: unreachable.slice(0, 200),
    unresolvedEdges, unanchoredConfirmedEdges: unanchoredEdges, target: options.target || null,
    pathsToTarget: paths.slice(0, 10), errors, warnings };
  console.log(options.json ? JSON.stringify(report, null, 2) : [
    'Functions: ' + report.functionCount + ' (' + report.externalFunctionCount + ' external) | call edges: ' + report.callEdgeCount,
    'Edges static/observed/inferred: ' + edgeKinds.static + '/' + edgeKinds.observed + '/' + edgeKinds.inferred,
    'Reachable: ' + reachable.size + (entries.length ? '/' + functions.size : ' (no entry points supplied)'),
    'Unresolved edges: ' + unresolvedEdges.length + ' | unanchored confirmed edges: ' + unanchoredEdges.length,
    options.target ? 'Path: ' + (paths[0] ? paths[0].join(' -> ') : 'not found') : '',
    'Errors: ' + errors.length + ' | warnings: ' + warnings.length,
  ].filter(Boolean).join('\n'));
  if (errors.length || (options.requireResolved && (unresolvedEdges.length || unanchoredEdges.length))) process.exitCode = 1;
}
main().catch(error => { console.error('Function index audit failed: ' + error.message); process.exitCode = 2; });
