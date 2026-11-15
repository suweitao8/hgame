#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const COLUMNS = [
  'id', 'domain', 'item', 'scope', 'source_ref', 'evidence_kind', 'evidence_ref',
  'extracted_output', 'target_path', 'reverse_status', 'implementation_status',
  'verification_status', 'blocker', 'notes',
];
const KNOWN = {
  scope: new Set(['offline-required', 'offline-adapter', 'excluded-online', 'unknown']),
  evidence_kind: new Set(['static', 'observed', 'inferred', 'unknown', '']),
  reverse_status: new Set(['unseen', 'indexed', 'extracted', 'understood', 'unknown', 'blocked']),
  implementation_status: new Set(['not-started', 'in-progress', 'implemented', 'not-applicable']),
  verification_status: new Set(['deferred', 'not-run', 'passed', 'failed']),
};

function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else field += ch;
      continue;
    }
    if (ch === '"' && !field && !afterQuote) { quoted = true; continue; }
    if (ch === ',') { row.push(field.trim()); field = ''; afterQuote = false; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = []; field = ''; afterQuote = false;
      continue;
    }
    if (afterQuote && ch !== ' ' && ch !== '\t') throw new Error('Invalid CSV character after closing quote');
    if (ch === '"' && field) throw new Error('Invalid CSV quote in unquoted field');
    if (!afterQuote) field += ch;
  }
  if (quoted) throw new Error('Unterminated CSV quoted field');
  row.push(field.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

function audit(text) {
  const parsed = csvRows(text);
  if (!parsed.length) throw new Error('Coverage CSV has no header');
  const headers = parsed.shift();
  const missing = COLUMNS.filter(column => !headers.includes(column));
  if (missing.length) throw new Error('Coverage CSV missing columns: ' + missing.join(', '));
  if (new Set(headers).size !== headers.length) throw new Error('Coverage CSV contains duplicate column names');

  const errors = [], warnings = [], entries = [], seen = new Set();
  const values = rows => Object.fromEntries(headers.map((key, i) => [key, rows[i] ?? '']));
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i], line = 'row ' + (i + 2);
    if (raw.length !== headers.length) {
      errors.push(line + ': CSV column count ' + raw.length + ' != ' + headers.length);
      continue;
    }
    const item = values(raw);
    if (!item.id) errors.push(line + ': missing id');
    if (seen.has(item.id)) errors.push(line + ': duplicate id ' + item.id);
    seen.add(item.id);
    if (!item.domain || !item.item) errors.push(line + ': domain and item are required');
    for (const [field, allowed] of Object.entries(KNOWN)) {
      if (!allowed.has(item[field])) errors.push(line + ': unknown status/value in ' + field + ': ' + item[field]);
    }
    if (item.reverse_status === 'understood') {
      if (!item.source_ref || !item.evidence_ref) errors.push(line + ': understood rule requires source_ref and evidence_ref');
      if (!['static', 'observed'].includes(item.evidence_kind)) {
        errors.push(line + ': understood rule needs static or observed evidence; inferred-only is not sufficient');
      }
    }
    if (item.implementation_status === 'implemented' && !item.target_path) {
      errors.push(line + ': implemented item needs target_path');
    }
    if (item.verification_status === 'passed') {
      if (item.scope === 'excluded-online') errors.push(line + ': excluded-online item must not be marked passed');
      if (item.implementation_status !== 'implemented' || item.reverse_status !== 'understood') {
        errors.push(line + ': passed requires implemented plus understood; otherwise verification is misleading');
      }
    }
    if (item.scope === 'unknown' && !item.blocker) warnings.push(line + ': unknown scope has no blocker');
    if (item.reverse_status === 'blocked' && !item.blocker) warnings.push(line + ': blocked reverse status has no blocker');
    entries.push(item);
  }
  const relevant = entries.filter(entry => entry.scope !== 'excluded-online');
  const count = (list, key, value) => list.filter(item => item[key] === value).length;
  const stats = {
    total: entries.length,
    inScope: relevant.length,
    excluded: entries.length - relevant.length,
    reverse: { understood: count(relevant, 'reverse_status', 'understood') },
    implementation: { implemented: count(relevant, 'implementation_status', 'implemented') },
    verification: { passed: count(relevant, 'verification_status', 'passed'), failed: count(relevant, 'verification_status', 'failed') },
    errors, warnings,
  };
  stats.reverseRate = relevant.length ? Math.round(stats.reverse.understood / relevant.length * 1000) / 10 : null;
  stats.implementedRate = relevant.length ? Math.round(stats.implementation.implemented / relevant.length * 1000) / 10 : null;
  stats.verifiedRate = relevant.length ? Math.round(stats.verification.passed / relevant.length * 1000) / 10 : null;
  stats.complete = relevant.length > 0 && !errors.length && relevant.every(item =>
    item.reverse_status === 'understood' && item.implementation_status === 'implemented' && item.verification_status === 'passed');
  return stats;
}

function parse(argv) {
  const args = { file: null, json: false, requireComplete: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--require-complete') args.requireComplete = true;
    else if (!arg.startsWith('-') && !args.file) args.file = arg;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (!args.file) throw new Error('Usage: node audit-coverage.mjs <production/coverage.csv> [--json] [--require-complete]');
  return args;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const summary = audit(await readFile(path.resolve(options.file), 'utf8'));
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log('Coverage items: ' + summary.total + ' | in-scope: ' + summary.inScope + ' | excluded-online: ' + summary.excluded);
    console.log('Reverse understood: ' + (summary.reverseRate ?? 'N/A') + '% | implemented: ' + (summary.implementedRate ?? 'N/A') + '% | verified: ' + (summary.verifiedRate ?? 'N/A') + '%');
    console.log('Audit errors: ' + summary.errors.length + ', warnings: ' + summary.warnings.length + ' | ' + (summary.complete ? 'complete' : 'incomplete'));
    for (const message of summary.errors) console.log('ERROR ' + message);
    for (const message of summary.warnings) console.log('WARN ' + message);
  }
  if (summary.errors.length || (options.requireComplete && !summary.complete)) process.exitCode = 1;
}

main().catch(error => { console.error('Coverage audit failed: ' + error.message); process.exitCode = 2; });
