import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexZipFile } from '../src/zip-index.mjs';

function makeTmp(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `grs-zip-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}

function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
}

// Builds a real (stored, empty-member) ZIP: local headers, central directory,
// EOCD, trailing comment. Returns the raw bytes.
function craftZip(names, { comment = '', entriesTotal = null, cdOffset = null } = {}) {
  const locals = [];
  const cd = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(nameBytes.length, 26);
    locals.push(lfh, nameBytes);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(nameBytes.length, 28);
    cdh.writeUInt32LE(offset, 40);
    cd.push(cdh, nameBytes);
    offset += 30 + nameBytes.length;
  }
  const cdBytes = Buffer.concat(cd);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(names.length),
    u16(entriesTotal ?? names.length),
    u32(cdBytes.length),
    u32(cdOffset ?? offset),
    u16(Buffer.byteLength(comment, 'utf8')),
  ]);
  const tail = [cdBytes, eocd];
  if (comment) tail.push(Buffer.from(comment, 'utf8'));
  return Buffer.concat([...locals, ...tail]);
}

function zip64Locator() {
  const b = Buffer.alloc(20);
  b.writeUInt32LE(0x07064b50, 0);
  return b;
}

function writeFixture(t, name, bytes) {
  const file = path.join(makeTmp(t, name), 'fixture.bin');
  fs.writeFileSync(file, bytes);
  return file;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('indexes member names of a valid zip without extracting them', (t) => {
  const bytes = craftZip(['a.txt', 'data/b.bin']);
  const file = writeFixture(t, 'valid', bytes);
  const before = sha256(file);
  const res = indexZipFile(file, 'archives/archive.zip');
  assert.equal(res.path, 'archives/archive.zip');
  assert.equal(res.format, 'zip');
  assert.deepEqual(res.entries, ['a.txt', 'data/b.bin']);
  assert.deepEqual(res.warnings, []);
  assert.equal(sha256(file), before, 'source archive bytes must be unchanged');
});

test('indexes an empty zip archive', (t) => {
  const file = writeFixture(t, 'empty', craftZip([]));
  const res = indexZipFile(file, 'empty.zip');
  assert.deepEqual(res.entries, []);
  assert.deepEqual(res.warnings, []);
});

test('labels .jar archives and lists class member paths', (t) => {
  const bytes = craftZip(['META-INF/MANIFEST.MF', 'com/example/game/Main.class']);
  const file = writeFixture(t, 'jar', bytes);
  const res = indexZipFile(file, 'game.jar');
  assert.equal(res.format, 'jar');
  assert.ok(res.entries.includes('com/example/game/Main.class'));
  assert.deepEqual(res.warnings, []);
});

test('labels .apk archives and lists manifest and native-library member paths', (t) => {
  const bytes = craftZip([
    'AndroidManifest.xml',
    'lib/arm64-v8a/libgame.so',
    'assets/www/index.html',
  ]);
  const file = writeFixture(t, 'apk', bytes);
  const res = indexZipFile(file, 'game.apk');
  assert.equal(res.format, 'apk');
  assert.ok(res.entries.includes('AndroidManifest.xml'));
  assert.ok(res.entries.includes('lib/arm64-v8a/libgame.so'));
  assert.deepEqual(res.warnings, []);
});

test('finds the EOCD even with a trailing archive comment', (t) => {
  const bytes = craftZip(['a.txt'], { comment: 'packed-by-test-suite' });
  const file = writeFixture(t, 'comment', bytes);
  const res = indexZipFile(file, 'a.zip');
  assert.deepEqual(res.entries, ['a.txt']);
  assert.deepEqual(res.warnings, []);
});

test('warns and returns no entries when the EOCD is missing (corrupt archive)', (t) => {
  const bytes = craftZip(['a.txt', 'b.txt']).subarray(0, -22);
  const file = writeFixture(t, 'corrupt', bytes);
  const res = indexZipFile(file, 'broken.zip');
  assert.deepEqual(res.entries, []);
  assert.ok(res.warnings.some((w) => w.code === 'zip-eocd-not-found'));
});

test('warns when the EOCD points outside the file', (t) => {
  const bytes = craftZip(['a.txt'], { cdOffset: 99999 });
  const file = writeFixture(t, 'range', bytes);
  const res = indexZipFile(file, 'range.zip');
  assert.deepEqual(res.entries, []);
  assert.ok(res.warnings.some((w) => w.code === 'zip-central-directory-out-of-range'));
});

test('warns on ZIP64 sentinel values without a ZIP64 locator', (t) => {
  const bytes = craftZip(['a.txt'], { entriesTotal: 0xffff });
  const file = writeFixture(t, 'zip64a', bytes);
  const res = indexZipFile(file, 'zip64a.zip');
  assert.deepEqual(res.entries, []);
  assert.ok(res.warnings.some((w) => w.code === 'zip64-unsupported'));
});

test('warns on ZIP64 sentinel values with a ZIP64 locator present', (t) => {
  const bytes = Buffer.concat([craftZip(['a.txt'], { entriesTotal: 0xffff }), zip64Locator()]);
  const file = writeFixture(t, 'zip64b', bytes);
  const res = indexZipFile(file, 'zip64b.zip');
  assert.deepEqual(res.entries, []);
  assert.ok(res.warnings.some((w) => w.code === 'zip64-unsupported'));
});

test('warns when the central directory exceeds the configured size cap', (t) => {
  const bytes = craftZip(['a.txt', 'b.txt', 'c.txt']);
  const file = writeFixture(t, 'bigcd', bytes);
  const res = indexZipFile(file, 'big.zip', { cdMaxBytes: 8 });
  assert.deepEqual(res.entries, []);
  assert.ok(res.warnings.some((w) => w.code === 'zip-central-directory-too-large'));
});

test('warns on unreadable or missing archive files instead of throwing', (t) => {
  const missing = path.join(os.tmpdir(), `grs-zip-missing-${process.pid}.zip`);
  const res = indexZipFile(missing, 'missing.zip');
  assert.deepEqual(res.entries, []);
  assert.ok(res.warnings.some((w) => w.code === 'zip-read-failed'));
});

test('warns on non-zip content instead of guessing', (t) => {
  const file = writeFixture(t, 'notzip', Buffer.from('this is not a zip file\n'));
  const res = indexZipFile(file, 'notzip.zip');
  assert.deepEqual(res.entries, []);
  assert.ok(res.warnings.some((w) => w.code === 'zip-eocd-not-found'));
});
