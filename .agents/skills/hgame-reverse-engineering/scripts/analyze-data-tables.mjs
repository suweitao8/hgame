#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
      if (row.some(v => v !== '')) rows.push(row);
      row = []; field = ''; afterQuote = false; continue;
    }
    if (afterQuote && ch !== ' ' && ch !== '\t') throw new Error('Invalid CSV character after closing quote');
    if (ch === '"' && field) throw new Error('Invalid CSV quote in unquoted field');
    if (!afterQuote) field += ch;
  }
  if (quoted) throw new Error('Unterminated CSV quoted field');
  row.push(field.trim());
  if (row.some(v => v !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift();
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate headers');
  return rows.map((values, i) => {
    if (values.length !== headers.length) throw new Error('CSV row ' + (i + 2) + ' has wrong column count');
    return Object.fromEntries(headers.map((key, n) => [key, values[n]]));
  });
}

function getPath(value, expression) {
  if (!expression || expression === '$') return value;
  return expression.replace(/^\$\.?/, '').split('.').filter(Boolean)
    .reduce((current, key) => current == null ? undefined : current[key], value);
}
function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
async function resolveFuture(target) {
  const tail = [];
  let parent = path.resolve(target);
  while (true) {
    try { return path.resolve(await realpath(parent), ...tail.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const up = path.dirname(parent);
      if (up === parent) throw error;
      tail.push(path.basename(parent)); parent = up;
    }
  }
}
function parseArgs(argv) {
  const o = { root: null, out: null, schema: null, maxFiles: 20000, maxFileBytes: 16 * 1024 * 1024, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--schema') o.schema = argv[++i];
    else if (a === '--max-files') o.maxFiles = Number(argv[++i]);
    else if (a === '--max-file-bytes') o.maxFileBytes = Number(argv[++i]);
    else if (a === '--json') o.json = true;
    else if (!a.startsWith('-') && !o.root) o.root = a;
    else throw new Error('Unknown or incomplete argument: ' + a);
  }
  if (!o.root || !o.out) throw new Error('Usage: node analyze-data-tables.mjs <data-root> --out <report.json> [--schema <schema.json>] [--json]');
  if (!Number.isInteger(o.maxFiles) || o.maxFiles < 1 || o.maxFiles > 500000) throw new Error('--max-files must be 1..500000');
  if (!Number.isInteger(o.maxFileBytes) || o.maxFileBytes < 1 || o.maxFileBytes > 256 * 1024 * 1024) throw new Error('--max-file-bytes must be 1..268435456');
  return o;
}
async function walk(root, maxFiles) {
  const files = [], warnings = [];
  let visited = 0, truncated = false;
  async function visit(dir, rel) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { warnings.push('Cannot read ' + rel + ': ' + error.message); return; }
    for (const entry of entries) {
      if (visited >= maxFiles) { truncated = true; return; }
      if (['.git', 'node_modules', '__pycache__'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name), relative = path.posix.join(rel, entry.name);
      let info;
      try { info = await lstat(full); } catch (error) { warnings.push('Cannot stat ' + relative + ': ' + error.message); continue; }
      if (info.isSymbolicLink()) { warnings.push('Skipped symlink: ' + relative); continue; }
      if (info.isDirectory()) await visit(full, relative);
      else if (info.isFile()) { visited++; if (/\.(json|csv)$/i.test(entry.name)) files.push(relative); }
      if (truncated) return;
    }
  }
  await visit(root, '');
  return { files, warnings, visited, truncated };
}
function discoverJsonTables(value) {
  if (Array.isArray(value) && value.every(v => v && typeof v === 'object' && !Array.isArray(v))) return [{ recordsPath: '$', records: value }];
  if (value && typeof value === 'object') return Object.entries(value)
    .filter(([, rows]) => Array.isArray(rows) && rows.length > 0 && rows.every(v => v && typeof v === 'object' && !Array.isArray(v)))
    .map(([key, records]) => ({ recordsPath: key, records }));
  return [];
}
function chooseIdField(records) {
  for (const key of ['id', 'ID', 'key', 'Key', 'guid', 'Guid', 'uuid', 'UUID']) {
    if (records.some(row => row[key] !== undefined && row[key] !== null && row[key] !== '')) return key;
  }
  return null;
}
function summarize(table, records) {
  const idField = table.idField || chooseIdField(records);
  const ids = idField ? records.map(row => row[idField]).filter(v => v !== undefined && v !== null && String(v) !== '').map(String) : [];
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
  return { name: table.name, file: table.file, format: table.format, recordsPath: table.recordsPath || '$',
    recordCount: records.length, fields: [...new Set(records.flatMap(row => Object.keys(row)))].sort(),
    idField, idCount: ids.length, missingIdCount: idField ? records.length - ids.length : null,
    duplicateIdCount: duplicates.length, duplicateIds: duplicates.slice(0, 50), _ids: new Set(ids) };
}
function referenceValues(record, field, separator) {
  const value = getPath(record, field);
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && separator && value.includes(separator)) return value.split(separator).map(v => v.trim()).filter(Boolean);
  return [String(value)];
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const root = await realpath(path.resolve(o.root));
  if (!(await stat(root)).isDirectory()) throw new Error('Data source must be a directory');
  const output = await resolveFuture(o.out);
  if (inside(root, output)) throw new Error('Report output must be outside the extracted data source');
  let schema = null;
  if (o.schema) {
    const schemaPath = await realpath(path.resolve(o.schema));
    if (inside(root, schemaPath)) throw new Error('Schema must be outside the extracted data source');
    schema = JSON.parse((await readFile(schemaPath, 'utf8')).replace(/^\uFEFF/, ''));
    if (schema.schemaVersion !== 1 || !Array.isArray(schema.tables) || schema.tables.some(table =>
      !table || typeof table.file !== 'string' || (table.references !== undefined && !Array.isArray(table.references)))) {
      throw new Error('Schema must use schemaVersion 1 and tables with file paths and optional references arrays');
    }
  }
  const scan = await walk(root, o.maxFiles);
  const specs = schema ? schema.tables : scan.files.map(file => ({ file, name: path.basename(file, path.extname(file)) }));
  const tables = [], errors = [], warnings = [...scan.warnings], byName = new Map(), recordsByName = new Map();
  if (scan.truncated) warnings.push('File scan reached --max-files; inventory is incomplete.');
  for (const spec of specs) {
    if (!spec.file || path.isAbsolute(spec.file) || spec.file.split(/[\\/]/).includes('..')) { errors.push('Invalid table file path: ' + spec.file); continue; }
    const full = path.resolve(root, spec.file);
    if (!inside(root, full)) { errors.push('Table escapes source root: ' + spec.file); continue; }
    let info, bytes;
    try {
      const canonicalFile = await realpath(full);
      if (!inside(root, canonicalFile)) throw new Error('symlink target escapes source root');
      info = await stat(canonicalFile);
      if (!info.isFile()) throw new Error('not a file');
      if (info.size > o.maxFileBytes) { warnings.push('Skipped oversized file: ' + spec.file); continue; }
      bytes = await readFile(canonicalFile);
    } catch (error) { errors.push('Cannot read ' + spec.file + ': ' + error.message); continue; }
    const format = (spec.format || path.extname(spec.file).slice(1)).toLowerCase();
    let records, recordsPath = spec.recordsPath || '$';
    try {
      if (format === 'json') {
        const doc = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
        if (schema) { records = getPath(doc, recordsPath); if (!Array.isArray(records)) throw new Error('recordsPath does not resolve to an array'); }
        else {
          const found = discoverJsonTables(doc);
          if (!found.length) { warnings.push('No record array detected: ' + spec.file); continue; }
          if (found.length > 1) {
            for (const item of found) {
              const name = spec.name + '.' + item.recordsPath;
              const summary = summarize({ ...spec, name, format, recordsPath: item.recordsPath }, item.records);
              summary.sha256 = createHash('sha256').update(bytes).digest('hex'); summary.bytes = info.size;
              tables.push(summary); byName.set(name, summary); recordsByName.set(name, item.records);
            }
            continue;
          }
          recordsPath = found[0].recordsPath; records = found[0].records;
        }
      } else if (format === 'csv') records = csvRows(bytes.toString('utf8'));
      else { warnings.push('Unsupported table format: ' + spec.file); continue; }
      if (!Array.isArray(records) || !records.every(row => row && typeof row === 'object' && !Array.isArray(row))) throw new Error('records must be an array of objects');
      const name = spec.name || path.basename(spec.file, path.extname(spec.file));
      const summary = summarize({ ...spec, name, format, recordsPath }, records);
      summary.sha256 = createHash('sha256').update(bytes).digest('hex'); summary.bytes = info.size;
      if (byName.has(name)) errors.push('Duplicate table name: ' + name);
      tables.push(summary); byName.set(name, summary); recordsByName.set(name, records);
    } catch (error) { errors.push(spec.file + ': ' + error.message); }
  }
  const references = [];
  if (schema) for (const spec of schema.tables) {
    const from = byName.get(spec.name || path.basename(spec.file, path.extname(spec.file)));
    if (!from) continue;
    const records = recordsByName.get(from.name);
    if (!records) continue;
    for (const ref of spec.references || []) {
      const target = byName.get(ref.target);
      if (!target) { errors.push('Reference target table not found: ' + ref.target); continue; }
      const unresolved = []; let checked = 0;
      for (let i = 0; i < records.length; i++) {
        const values = referenceValues(records[i], ref.field, ref.separator);
        if (!values.length && ref.required) unresolved.push({ row: i + 1, value: '(missing)' });
        for (const value of values) { checked++; if (!target._ids.has(value)) unresolved.push({ row: i + 1, value }); }
      }
      references.push({ fromTable: from.name, field: ref.field, toTable: target.name, checked,
        unresolvedCount: unresolved.length, unresolved: unresolved.slice(0, 100), required: !!ref.required });
    }
  }
  if (!schema) warnings.push('No schema supplied: record arrays are discovered heuristically; field semantics and references are not verified.');
  const publicTables = tables.map(({ _ids, ...table }) => table);
  const unresolvedReferenceCount = references.reduce((sum, ref) => sum + ref.unresolvedCount, 0);
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceRoot: root, schemaApplied: !!schema,
    filesVisited: scan.visited, candidateFiles: scan.files.length, truncated: scan.truncated,
    tableCount: publicTables.length, totalRecords: publicTables.reduce((sum, t) => sum + t.recordCount, 0),
    duplicateIdCount: publicTables.reduce((sum, t) => sum + t.duplicateIdCount, 0), unresolvedReferenceCount,
    tables: publicTables, references, errors, warnings };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const summary = { output, tableCount: report.tableCount, totalRecords: report.totalRecords,
    duplicateIdCount: report.duplicateIdCount, unresolvedReferenceCount, errors: errors.length,
    warnings: warnings.length, truncated: report.truncated };
  console.log(o.json ? JSON.stringify({ summary, report }, null, 2) : JSON.stringify(summary, null, 2));
  if (errors.length) process.exitCode = 1;
}
main().catch(error => { console.error('Data table analysis failed: ' + error.message); process.exitCode = 2; });
