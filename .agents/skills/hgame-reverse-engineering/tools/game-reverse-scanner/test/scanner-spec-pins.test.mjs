// Spec-pinning tests written by the verification session AFTER adopting the
// parallel writer's Task 3 implementation. They encode design-spec behaviors
// that were implemented but not covered by the writer's own test files:
//   - mobile containers are reported separately from the engine inside them
//   - generic native signatures never become engine candidates
//   - candidates without metadata never show a fabricated version
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectEngines } from '../src/detect.mjs';
import { collectMetadata } from '../src/metadata.mjs';
import { ensureSafeOutputPath } from '../src/cli.mjs';

const fileEntry = (p, magicId, kind) => ({
  path: p,
  extension: p.slice(p.lastIndexOf('.')),
  magic: magicId ? { id: magicId, label: magicId, kind } : null,
  kind: magicId ? kind : 'other',
  sizeBytes: 64,
});

test('an APK container reports the Android platform without becoming an engine candidate', async () => {
  const files = [fileEntry('game.apk', 'zip', 'archive')];
  const archives = [{
    path: 'game.apk',
    format: 'apk',
    entries: ['AndroidManifest.xml', 'classes.dex', 'lib/arm64-v8a/libgame.so'],
    warnings: [],
  }];
  const metadata = await collectMetadata('/unused', files, archives);
  assert.ok(
    metadata.platformHints.some((h) => h.name === 'Android'),
    'APK members must yield Android platform evidence',
  );
  const candidates = detectEngines({ files, archives, metadata });
  assert.ok(
    !candidates.some((c) => /android/.test(c.id)),
    'the container itself must not be an engine candidate',
  );
});

test('generic PE/ELF binaries alone never produce an engine candidate', () => {
  const files = [
    fileEntry('game.exe', 'pe', 'executable'),
    fileEntry('libgame.so', 'elf', 'executable'),
  ];
  const candidates = detectEngines({
    files,
    archives: [],
    metadata: { engineHints: [], versionHints: [], runtimeHints: [], platformHints: [] },
  });
  assert.deepEqual(candidates, []);
});

test('archive member rules work against real zip-index string entries (libGDX namespace)', () => {
  const files = [fileEntry('game.jar', 'zip', 'archive')];
  const archives = [{
    path: 'game.jar',
    format: 'jar',
    entries: ['com/badlogic/gdx/Scenario.class', 'META-INF/MANIFEST.MF'],
    warnings: [],
  }];
  const candidates = detectEngines({
    files,
    archives,
    metadata: { engineHints: [], versionHints: [], runtimeHints: [], platformHints: [] },
  });
  assert.ok(candidates.some((c) => c.id === 'libgdx'), 'libGDX package namespace must be detected');
});

test('output validation resolves junction aliases before rejecting (no privilege needed)', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'grs-junction-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const input = path.join(base, 'game');
  fs.mkdirSync(input);
  fs.writeFileSync(path.join(input, 'a.txt'), 'x');
  const alias = path.join(base, 'alias-into-input');
  let made = false;
  try {
    fs.symlinkSync(input, alias, 'junction');
    made = true;
  } catch {
    // junction creation not available on this host
  }
  if (!made) {
    t.skip('junction creation not available on this platform');
    return;
  }
  assert.throws(
    () => ensureSafeOutputPath(input, path.join(alias, 'out')),
    (e) => e.code === 'UNSAFE_OUTPUT',
    'a junction aliasing the input root must be rejected as unsafe output placement',
  );
});

test('candidates without explicit metadata keep an unfabricated version', () => {
  const files = [
    fileEntry('UnityPlayer.dll', 'pe', 'executable'),
    fileEntry('MyGame_Data/globalgamemanagers', null, 'other'),
  ];
  const candidates = detectEngines({
    files,
    archives: [],
    metadata: { engineHints: [], versionHints: [], runtimeHints: [], platformHints: [] },
  });
  const unity = candidates.find((c) => c.id === 'unity');
  assert.ok(unity, 'unity marker should produce a candidate');
  assert.ok(
    ['unknown', '', null, undefined].includes(unity.version),
    `version must stay unknown without explicit metadata, got ${unity.version}`,
  );
});
