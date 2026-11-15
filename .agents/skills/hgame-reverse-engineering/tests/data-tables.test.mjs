import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/analyze-data-tables.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('schema audit counts records, catches duplicate IDs and unresolved cross-table references', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-data-audit-'));
  const source = path.join(root, 'extracted');
  try {
    await mkdir(path.join(source, 'tables'), { recursive: true });
    await writeFile(path.join(source, 'tables', 'items.json'), JSON.stringify({ items: [
      { id: 'item-a', categoryIds: ['cat-a', 'missing-cat'] },
      { id: 'item-a', categoryIds: ['cat-a'] },
    ] }));
    await writeFile(path.join(source, 'tables', 'categories.csv'), 'id,label\r\ncat-a,Food\r\n');
    const schema = path.join(root, 'data-schema.json');
    await writeFile(schema, JSON.stringify({ schemaVersion: 1, tables: [
      { name: 'items', file: 'tables/items.json', recordsPath: 'items', idField: 'id', references: [{ field: 'categoryIds', target: 'categories' }] },
      { name: 'categories', file: 'tables/categories.csv', idField: 'id', references: [] },
    ] }));
    const output = path.join(root, 'inventory.json');
    const result = run(source, '--schema', schema, '--out', output, '--json');
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.tableCount, 2);
    assert.equal(report.totalRecords, 3);
    assert.equal(report.duplicateIdCount, 1);
    assert.equal(report.unresolvedReferenceCount, 1);
    assert.equal(report.references[0].unresolved[0].value, 'missing-cat');
    assert.match(report.tables[0].sha256, /^[a-f0-9]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('heuristic mode discovers JSON record arrays and CSV but never claims schema validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-data-discovery-'));
  const source = path.join(root, 'source');
  try {
    await mkdir(source);
    await writeFile(path.join(source, 'levels.json'), JSON.stringify({ levels: [{ id: 'l1' }, { id: 'l2' }] }));
    await writeFile(path.join(source, 'items.csv'), 'id,name\ni1,Knife\n');
    const output = path.join(root, 'inventory.json');
    const result = run(source, '--out', output, '--json');
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.schemaApplied, false);
    assert.equal(report.tableCount, 2);
    assert.equal(report.totalRecords, 3);
    assert.ok(report.warnings.some(w => /not verified/.test(w)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('data report cannot be written inside source and schema paths cannot escape source root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-data-boundary-'));
  const source = path.join(root, 'source');
  try {
    await mkdir(source);
    await writeFile(path.join(root, 'secret.json'), JSON.stringify([{ id: 'secret' }]));
    const inside = run(source, '--out', path.join(source, 'report.json'));
    assert.notEqual(inside.status, 0);
    const schema = path.join(root, 'schema.json');
    await writeFile(schema, JSON.stringify({ schemaVersion: 1, tables: [{ name: 'secret', file: '../secret.json' }] }));
    const output = path.join(root, 'report.json');
    const escaped = run(source, '--schema', schema, '--out', output);
    assert.equal(escaped.status, 1);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.ok(report.errors.some(e => /Invalid table file path/.test(e)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
