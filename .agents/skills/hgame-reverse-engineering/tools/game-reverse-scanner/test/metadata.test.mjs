import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectMetadata } from '../src/metadata.mjs';
import { walkInput } from '../src/walk.mjs';

async function withTempDirectory(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-reverse-metadata-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('extracts engine versions only from explicit allowlisted metadata', async () => {
  await withTempDirectory(async root => {
    await mkdir(path.join(root, 'ProjectSettings'), { recursive: true });
    await mkdir(path.join(root, 'Engine', 'Build'), { recursive: true });
    await writeFile(path.join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.21f1\nm_EditorVersionWithRevision: ignored\n');
    await writeFile(path.join(root, 'Engine', 'Build', 'Build.version'), JSON.stringify({
      MajorVersion: 5,
      MinorVersion: 3,
      PatchVersion: 2,
      Changelist: 123456,
    }));
    await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="Fixture"\nconfig/features=PackedStringArray("4.2", "GL Compatibility")\n');
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'fixture',
      version: '99.99.99',
      creator: '3.8.2',
      devDependencies: { electron: '^31.2.0' },
    }));
    await writeFile(path.join(root, 'conf.lua'), 'function love.conf(t)\n  t.version = "11.4"\nend\n');
    await writeFile(path.join(root, 'notes.txt'), 'Unity 999.0 Unreal 999.0 Godot 999.0');

    const scan = await walkInput(root);
    const metadata = await collectMetadata(root, scan.files, []);
    const versions = Object.fromEntries(metadata.versionHints.map(hint => [hint.engineId, hint.version]));

    assert.equal(versions.unity, '2022.3.21f1');
    assert.equal(versions.unreal, '5.3.2');
    assert.equal(versions.godot, '4.2');
    assert.equal(versions['cocos-creator'], '3.8.2');
    assert.equal(versions.love, '11.4');
    assert.equal(Object.hasOwn(versions, 'web-html5'), false);
    assert.ok(metadata.runtimeHints.some(hint => hint.name === 'Electron' && hint.version === '^31.2.0'));
    assert.ok(metadata.engineHints.some(hint => hint.engineId === 'electron'));
    assert.ok(!metadata.versionHints.some(hint => hint.version === '99.99.99'));
  });
});

test('malformed or missing metadata leaves engine versions unknown', async () => {
  await withTempDirectory(async root => {
    await writeFile(path.join(root, 'Build.version'), '{not valid json');
    await writeFile(path.join(root, 'project.godot'), '[application]\nconfig/name="No version"\n');
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '7.8.9' }));
    const scan = await walkInput(root);
    const metadata = await collectMetadata(root, scan.files, []);

    assert.deepEqual(metadata.versionHints, []);
    assert.ok(metadata.engineHints.some(hint => hint.engineId === 'godot'));
    assert.ok(metadata.warnings.some(warning => warning.code === 'metadata-invalid-json'));
  });
});

test('does not read metadata files above the configured size bound', async () => {
  await withTempDirectory(async root => {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { electron: '99.0.0' } }).padEnd(1024, ' '));
    const scan = await walkInput(root);
    const metadata = await collectMetadata(root, scan.files, [], { maxBytesPerFile: 128 });
    assert.deepEqual(metadata.engineHints, []);
    assert.deepEqual(metadata.runtimeHints, []);
    assert.ok(metadata.warnings.some(warning => warning.code === 'metadata-too-large'));
  });
});

test('detects Android and iOS package containers from archive member names without extraction', async () => {
  const metadata = await collectMetadata('unused-root', [], [
    {
      path: 'build/game.apk',
      entries: [{ name: 'AndroidManifest.xml' }, { name: 'classes.dex' }, { name: 'lib/arm64-v8a/libgame.so' }],
    },
    {
      path: 'build/game.ipa',
      entries: [{ name: 'Payload/Game.app/Info.plist' }, { name: 'Payload/Game.app/Game' }],
    },
  ]);

  assert.ok(metadata.platformHints.some(hint => hint.name === 'Android'));
  assert.ok(metadata.platformHints.some(hint => hint.name === 'iOS'));
});

test('reports generic Java bytecode as a runtime hint, not an engine claim', async () => {
  const metadata = await collectMetadata('unused-root', [
    { path: 'classes/com/example/Game.class', magic: { id: 'java-class' } },
  ], []);
  assert.ok(metadata.runtimeHints.some(hint => hint.name === 'Java/JVM'));
  assert.deepEqual(metadata.engineHints, []);
});

test('Mach-O binaries contribute Apple platform hints through the real magic id', async () => {
  await withTempDirectory(async root => {
    await writeFile(
      path.join(root, 'Game'),
      Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(16)]),
    );
    const scan = await walkInput(root);
    const collected = await collectMetadata(root, scan.files, []);
    assert.ok(
      collected.platformHints.some(hint => hint.name === 'Apple platform' && hint.path === 'Game'),
      'Mach-O magic must map to an Apple platform hint',
    );
  });
});
