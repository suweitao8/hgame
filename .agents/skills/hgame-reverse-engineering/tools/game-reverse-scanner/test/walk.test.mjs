import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walkInput, toInventoryEntry } from '../src/walk.mjs';

function makeTmp(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `grs-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root, rel, content = 'x') {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

test('inventories files with normalized relative paths and sizes', (t) => {
  const root = makeTmp(t, 'walk');
  write(root, 'game.exe', 'MZ');
  write(root, 'data/levels/level1.json', '{"a":1}');
  const res = walkInput(root);
  assert.equal(res.root, path.resolve(root));
  const paths = res.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['data/levels/level1.json', 'game.exe']);
  const exe = res.files.find((f) => f.path === 'game.exe');
  assert.equal(exe.sizeBytes, 2);
  assert.equal(exe.extension, '.exe');
  assert.ok(exe.absolutePath);
  assert.equal(exe.magic.id, 'pe');
  assert.equal(exe.kind, 'executable');
  const json = res.files.find((f) => f.path === 'data/levels/level1.json');
  assert.equal(json.magic, null);
  assert.equal(json.kind, 'other');
});

test('detects magic from a large file header without reading it fully', (t) => {
  const root = makeTmp(t, 'walkbig');
  const big = Buffer.concat([Buffer.from('PK\x03\x04', 'binary'), Buffer.alloc(1024 * 1024, 0)]);
  fs.writeFileSync(path.join(root, 'big.zip'), big);
  const res = walkInput(root);
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].magic.id, 'zip');
  assert.equal(res.files[0].sizeBytes, 1024 * 1024 + 4);
});

test('skips VCS and cache directories by default and records them', (t) => {
  const root = makeTmp(t, 'walkcache');
  write(root, 'game.pck', 'GDPC');
  write(root, '.git/HEAD', 'ref: refs/heads/main');
  write(root, 'node_modules/left-pad/index.js', 'x');
  const res = walkInput(root);
  assert.deepEqual(res.files.map((f) => f.path), ['game.pck']);
  const skippedPaths = res.skipped.map((s) => s.path).sort();
  assert.deepEqual(skippedPaths, ['.git', 'node_modules']);
  assert.ok(res.skipped.every((s) => s.reason === 'cache-excluded'));
});

test('cache directory matching is case-insensitive', (t) => {
  const root = makeTmp(t, 'walkcase');
  write(root, 'NODE_MODULES/left-pad/index.js', 'x');
  const res = walkInput(root);
  assert.deepEqual(res.files.map((f) => f.path), []);
  assert.ok(res.skipped.some((s) => s.path === 'NODE_MODULES'));
});

test('includes cache directories with includeCache option', (t) => {
  const root = makeTmp(t, 'walkcach2');
  write(root, 'game.pck', 'GDPC');
  write(root, '.git/HEAD', 'ref: refs/heads/main');
  const res = walkInput(root, { includeCache: true });
  assert.ok(res.files.some((f) => f.path === '.git/HEAD'));
  assert.equal(res.skipped.filter((s) => s.reason === 'cache-excluded').length, 0);
});

test('skips symbolic links without following them', (t) => {
  const root = makeTmp(t, 'walklink');
  write(root, 'real.txt', 'hello');
  write(root, 'sub/inside.txt', 'x');
  const created = [];
  try {
    fs.symlinkSync(path.join(root, 'real.txt'), path.join(root, 'link-file.txt'));
    created.push('link-file.txt');
  } catch {
    // symlink creation not permitted; handled below
  }
  try {
    fs.symlinkSync(path.join(root, 'sub'), path.join(root, 'link-dir'), 'dir');
    created.push('link-dir');
  } catch {
    // symlink creation not permitted; handled below
  }
  if (created.length === 0) {
    t.skip('symlink creation not permitted on this platform');
    return;
  }
  const res = walkInput(root);
  const paths = res.files.map((f) => f.path);
  const skippedPaths = res.skipped.filter((s) => s.reason === 'symlink').map((s) => s.path);
  for (const link of created) {
    assert.ok(!paths.some((p) => p === link || p.startsWith(`${link}/`)), `${link} must not be followed`);
    assert.ok(skippedPaths.includes(link), `${link} must be recorded as skipped`);
  }
  assert.ok(paths.includes('sub/inside.txt'));
});

test('skips NTFS junctions without following them (no privilege needed)', (t) => {
  const root = makeTmp(t, 'walkjunc');
  write(root, 'sub/inside.txt', 'x');
  let junctionMade = false;
  try {
    fs.symlinkSync(path.join(root, 'sub'), path.join(root, 'junction-dir'), 'junction');
    junctionMade = true;
  } catch {
    // junction creation not available; handled below
  }
  if (!junctionMade) {
    t.skip('junction creation not available on this platform');
    return;
  }
  const res = walkInput(root);
  const paths = res.files.map((f) => f.path);
  assert.ok(!paths.includes('junction-dir/inside.txt'), 'junction must not be followed');
  assert.ok(res.skipped.some((s) => s.path === 'junction-dir' && s.reason === 'symlink'));
});

test('stops at the file limit with a warning', (t) => {
  const root = makeTmp(t, 'walklimit');
  for (const n of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) write(root, n);
  const res = walkInput(root, { maxFiles: 2 });
  assert.equal(res.files.length, 2);
  assert.equal(res.stats.truncated, true);
  assert.ok(res.warnings.some((w) => w.code === 'file-limit-reached'));
});

test('stops at the depth limit with a warning', (t) => {
  const root = makeTmp(t, 'walkdepth');
  write(root, 'a/x.txt');
  write(root, 'a/b/c.txt');
  const res = walkInput(root, { maxDepth: 2 });
  const paths = res.files.map((f) => f.path);
  assert.ok(paths.includes('a/x.txt'));
  assert.ok(!paths.includes('a/b/c.txt'));
  assert.ok(res.warnings.some((w) => w.code === 'depth-limit-reached'));
  assert.equal(res.stats.truncated, true);
  assert.ok(res.skipped.some((s) => s.path === 'a/b' && s.reason === 'depth-limit'));
});

test('accepts a single file as input with root set to its parent directory', (t) => {
  const root = makeTmp(t, 'walkfile');
  const file = write(root, 'pak01_dir.vpk', Buffer.from([0x34, 0x12, 0xaa, 0x55]));
  const res = walkInput(file);
  assert.equal(res.root, path.dirname(file));
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].path, 'pak01_dir.vpk');
  assert.equal(res.files[0].magic.id, 'vpk');
});

test('throws a coded error for missing input', (t) => {
  const missing = path.join(os.tmpdir(), `grs-missing-${process.pid}-does-not-exist`);
  assert.throws(() => walkInput(missing), (e) => e.code === 'INPUT_NOT_FOUND');
});

test('scans an empty directory without warnings', (t) => {
  const root = makeTmp(t, 'walkempty');
  const res = walkInput(root);
  assert.deepEqual(res.files, []);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.stats.fileCount, 0);
  assert.equal(res.stats.truncated, false);
});

test('records unreadable directories instead of crashing', (t) => {
  if (process.platform === 'win32') {
    t.skip('requires POSIX permission semantics');
    return;
  }
  const root = makeTmp(t, 'walkperm');
  write(root, 'ok.txt');
  const locked = path.join(root, 'locked');
  fs.mkdirSync(locked);
  write(locked, 'hidden.txt');
  fs.chmodSync(locked, 0o000);
  try {
    const res = walkInput(root);
    assert.ok(res.warnings.some((w) => w.code === 'dir-unreadable'));
    assert.ok(!res.files.some((f) => f.path === 'locked/hidden.txt'));
  } finally {
    fs.chmodSync(locked, 0o755);
  }
});

test('serialized inventory entries omit absolute paths', (t) => {
  const root = makeTmp(t, 'walkpub');
  write(root, 'game.exe', 'MZ');
  const res = walkInput(root);
  const pub = toInventoryEntry(res.files[0]);
  assert.equal(pub.path, 'game.exe');
  assert.ok(!('absolutePath' in pub));
  assert.equal(pub.magic.id, 'pe');
  assert.equal(pub.kind, 'executable');
});
