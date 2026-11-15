#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const o = { expected: null, actual: null, map: null, json: false, maxDiffs: 100 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--map') o.map = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--max-diffs') o.maxDiffs = Number(argv[++i]);
    else if (!a.startsWith('-') && !o.expected) o.expected = a;
    else if (!a.startsWith('-') && !o.actual) o.actual = a;
    else throw new Error('Unknown or incomplete argument: ' + a);
  }
  if (!o.expected || !o.actual || !o.map) throw new Error('Usage: node compare-game-traces.mjs <original.jsonl> <html.jsonl> --map <trace-map.json> [--json] [--max-diffs N]');
  if (!Number.isInteger(o.maxDiffs) || o.maxDiffs < 1 || o.maxDiffs > 10000) throw new Error('--max-diffs must be 1..10000');
  return o;
}
function readPath(value, expression) {
  return String(expression).split('.').reduce((current, key) => current == null ? undefined : current[key], value);
}
async function readTrace(file) {
  const lines = (await readFile(path.resolve(file), 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 1) throw new Error('Empty trace: ' + file);
  const records = lines.map((line, i) => {
    try { return JSON.parse(line); } catch { throw new Error('Invalid JSON at ' + file + ':' + (i + 1)); }
  });
  const header = records.shift();
  if (header._type !== 'trace' || header.schemaVersion !== 1 || !header.gameId || !header.scenarioId) {
    throw new Error('Trace header requires _type=trace, schemaVersion=1, gameId and scenarioId: ' + file);
  }
  const events = records.map((event, i) => {
    if (event._type !== 'event' || !Number.isInteger(event.tick) || event.tick < 0 || !event.type || !event.actorId) {
      throw new Error('Invalid event at ' + file + ':' + (i + 2));
    }
    return event;
  });
  return { header, events };
}
function eventKey(event, fields, side) {
  const values = fields.map(field => {
    const value = readPath(event, field[side]);
    if (value === undefined) throw new Error('Missing key field ' + field[side]);
    if (side === 'actual' && field.actualAliases && Object.hasOwn(field.actualAliases, String(value))) return field.actualAliases[String(value)];
    return value;
  });
  return JSON.stringify(values);
}
function equalValue(a, b, tolerance) {
  if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= tolerance;
  return JSON.stringify(a) === JSON.stringify(b);
}
async function main() {
  const o = parseArgs(process.argv.slice(2));
  const [expected, actual, map] = await Promise.all([
    readTrace(o.expected), readTrace(o.actual), readFile(path.resolve(o.map), 'utf8').then(text => JSON.parse(text.replace(/^\uFEFF/, ''))),
  ]);
  if (map.schemaVersion !== 1 || !Array.isArray(map.keyFields) || !map.keyFields.length || !Array.isArray(map.compareFields) || !map.compareFields.length) {
    throw new Error('Trace map requires schemaVersion 1, keyFields and compareFields arrays');
  }
  if (map.keyFields.some(field => !field || typeof field.expected !== 'string' || typeof field.actual !== 'string') ||
      map.compareFields.some(field => !field || typeof field.expected !== 'string' || typeof field.actual !== 'string' ||
        (field.tolerance !== undefined && (!Number.isFinite(field.tolerance) || field.tolerance < 0)))) {
    throw new Error('Trace map fields require expected/actual paths and non-negative numeric tolerances');
  }
  for (const key of ['gameId', 'scenarioId']) if (expected.header[key] !== actual.header[key]) {
    throw new Error('Trace metadata mismatch: ' + key + ' expected=' + expected.header[key] + ' actual=' + actual.header[key]);
  }
  const actualByKey = new Map(), duplicateActualKeys = [];
  for (const event of actual.events) {
    const key = eventKey(event, map.keyFields, 'actual');
    if (actualByKey.has(key)) duplicateActualKeys.push(key);
    else actualByKey.set(key, event);
  }
  const expectedKeys = new Set(), differences = [];
  let matched = 0, missing = 0, mismatches = 0;
  const addDiff = diff => { if (differences.length < o.maxDiffs) differences.push(diff); };
  for (const key of duplicateActualKeys) addDiff({ kind: 'duplicate-actual-event-key', key });
  for (const event of expected.events) {
    const key = eventKey(event, map.keyFields, 'expected');
    if (expectedKeys.has(key)) throw new Error('Duplicate expected event key: ' + key);
    expectedKeys.add(key);
    const candidate = actualByKey.get(key);
    if (!candidate) { missing++; addDiff({ kind: 'missing-event', key, expected: event }); continue; }
    matched++;
    for (const field of map.compareFields) {
      const left = readPath(event, field.expected), right = readPath(candidate, field.actual);
      const tolerance = Number.isFinite(field.tolerance) ? field.tolerance : 0;
      if (!equalValue(left, right, tolerance)) {
        mismatches++;
        addDiff({ kind: 'field-mismatch', key, field: field.expected, actualField: field.actual,
          expected: left === undefined ? '(missing)' : left, actual: right === undefined ? '(missing)' : right, tolerance });
      }
    }
  }
  const extraEvents = [...actualByKey.keys()].filter(key => !expectedKeys.has(key));
  for (const key of extraEvents) addDiff({ kind: 'extra-event', key, actual: actualByKey.get(key) });
  const report = {
    schemaVersion: 1, gameId: expected.header.gameId, scenarioId: expected.header.scenarioId,
    expectedBuild: expected.header.build || null, actualBuild: actual.header.build || null,
    expectedEvents: expected.events.length, actualEvents: actual.events.length, matchedEvents: matched,
    missingEvents: missing, extraEvents: extraEvents.length, fieldMismatches: mismatches,
    duplicateActualKeys: duplicateActualKeys.length, match: missing === 0 && extraEvents.length === 0 && mismatches === 0 && duplicateActualKeys.length === 0,
    firstDivergence: differences[0] || null, differences, differencesTruncated: missing + extraEvents.length + mismatches > differences.length,
  };
  console.log(o.json ? JSON.stringify(report, null, 2) : [
    'Scenario: ' + report.gameId + '/' + report.scenarioId,
    'Events expected/actual/matched: ' + report.expectedEvents + '/' + report.actualEvents + '/' + report.matchedEvents,
    'Missing: ' + missing + ' | extra: ' + extraEvents.length + ' | field mismatches: ' + mismatches,
    'Duplicate actual keys: ' + duplicateActualKeys.length,
    'Result: ' + (report.match ? 'MATCH' : 'DIVERGED'),
    ...differences.slice(0, 20).map(diff => JSON.stringify(diff)),
  ].join('\n'));
  if (!report.match) process.exitCode = 1;
}
main().catch(error => { console.error('Game trace comparison failed: ' + error.message); process.exitCode = 2; });
