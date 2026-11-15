import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/validate-packet.mjs', import.meta.url));
const ids = ['gameplay', 'levels', 'balance', 'ui', 'audio', 'vfx', 'asset-slots', 'narrative', 'engineering'];
async function fixture(fn) {
  // Test documents only; no project assets or source material outside Workspace.
  const root = await mkdtemp(path.join(path.dirname(script), '.packet-test-'));
  try {
    await writeFile(path.join(root, 'spec.md'), 'Explicit design decisions and verification plan.');
    const packet = { schemaVersion: 2, title: 'Example', status: 'ready', approval: 'pending',
      target: { project: 'example-game', profile: 'dom-svg', slice: 'one encounter', fullScope: 'three encounters' },
      documents: Object.fromEntries(['spec','evidence','assets','acceptance','prompt'].map(k => [k, 'spec.md'])),
      domains: ids.map(id => ({ id, status: 'covered', ref: 'spec.md' })),
      dataFiles: [], blockers: [], coldRead: { status: 'passed', report: 'spec.md' } };
    await fn(packet, root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function run(packet, root) {
  const file = path.join(root, 'packet.json');
  await writeFile(file, JSON.stringify(packet));
  return spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
}
test('ready with pending approval passes mechanical checks without granting approval', () => fixture(async (p,r) => {
  const x = await run(p,r); assert.equal(x.status,0,x.stderr); assert.match(x.stdout,/approval=pending/);
}));
test('replacement asset slots are required while visual-art fidelity is not a reverse domain', () => fixture(async (p,r) => {
  p.domains = p.domains.filter(d => d.id !== 'asset-slots');
  p.domains.push({ id:'art', status:'covered', ref:'spec.md' });
  const x = await run(p,r); assert.equal(x.status,1);
  assert.match(x.stderr,/unknown domain art/);
  assert.match(x.stderr,/missing domain asset-slots/);
}));
test('schema v1 packets retain their legacy art-domain compatibility', () => fixture(async (p,r) => {
  p.schemaVersion = 1;
  p.domains = p.domains.filter(d => d.id !== 'asset-slots');
  p.domains.push({ id:'art', status:'covered', ref:'spec.md' });
  const x = await run(p,r); assert.equal(x.status,0,x.stderr);
}));
test('missing domain, unresolved target and blockers are rejected together', () => fixture(async (p,r) => {
  p.domains.pop(); p.target.slice = ''; p.blockers = ['target formula undecided'];
  const x = await run(p,r); assert.equal(x.status,1); assert.match(x.stderr,/engineering/); assert.match(x.stderr,/slice/); assert.match(x.stderr,/blockers/);
}));
test('N/A requires a reason; duplicate domains and pending cold read fail', () => fixture(async (p,r) => {
  p.domains[0] = { id:'gameplay', status:'not-applicable' }; p.domains.push(p.domains[1]); p.coldRead.status='pending';
  const x=await run(p,r); assert.equal(x.status,1); assert.match(x.stderr,/reason/); assert.match(x.stderr,/duplicate/); assert.match(x.stderr,/coldRead/);
}));
test('missing, empty and outside packet references fail', () => fixture(async (p,r) => {
  await writeFile(path.join(r,'empty.md'),''); p.documents.spec='empty.md'; p.documents.evidence='missing.md'; p.documents.assets='../outside.csv';
  const x=await run(p,r); assert.equal(x.status,1); assert.match(x.stderr,/empty/); assert.match(x.stderr,/missing/); assert.match(x.stderr,/outside/);
}));
test('draft and malformed collections are rejected without crashing', () => fixture(async (p,r) => {
  p.status='draft'; p.domains=null; p.blockers={}; p.dataFiles='wrong';
  const x=await run(p,r); assert.equal(x.status,1); assert.match(x.stderr,/domains/); assert.match(x.stderr,/dataFiles/); assert.doesNotMatch(x.stderr,/TypeError/);
}));
