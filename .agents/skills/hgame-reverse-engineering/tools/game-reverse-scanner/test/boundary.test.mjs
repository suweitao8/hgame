// Cross-review boundary tests for the engine fingerprinting review checklist
// (handoff docs/GAME_REVERSE_SCANNER_ZCODE_HANDOFF.md section 5): platform
// attribution must not leak between candidates, LÖVE scripts must not pair
// across directories, explicit versions must never be silently resolved, and
// weak extension markers must not manufacture high confidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { detectEngines } from '../src/detect.mjs';
import { collectMetadata } from '../src/metadata.mjs';

const metadata = {
  engineHints: [],
  versionHints: [],
  runtimeHints: [],
  platformHints: [],
  warnings: [],
};

function file(filePath, options = {}) {
  return {
    path: filePath,
    absolutePath: `C:/fixture/${filePath}`,
    extension: options.extension ?? filePath.slice(filePath.lastIndexOf('.')).toLowerCase(),
    magic: options.magic ?? null,
    kind: options.kind ?? 'other',
  };
}

function archive(archivePath, names) {
  return {
    path: archivePath,
    format: 'zip',
    entries: names.map(name => ({ name, isDirectory: name.endsWith('/') })),
    warnings: [],
  };
}

function candidate(result, id) {
  return result.find(item => item.id === id);
}

test('attributes platforms by evidence association instead of copying them to every candidate', () => {
  const result = detectEngines({
    files: [
      file('UnityPlayer.dll', { magic: { id: 'pe' }, kind: 'executable' }),
      file('Game_Data/Managed/Assembly-CSharp.dll', { magic: { id: 'pe' }, kind: 'executable' }),
      file('server/bin/game-server', { extension: '', magic: { id: 'elf' }, kind: 'executable' }),
      file('godot-build/project.godot'),
    ],
    archives: [],
    metadata,
  });
  const unity = candidate(result, 'unity');
  const godot = candidate(result, 'godot');
  assert.ok(unity);
  assert.ok(godot);
  assert.deepEqual(unity.platforms, ['Windows']);
  assert.deepEqual(godot.platforms, []);
  assert.ok(result.every(item => !item.platforms.includes('Linux')));
});

test('associates Mach-O binaries that share a directory tree with engine evidence', () => {
  const result = detectEngines({
    files: [
      file('renpy/__init__.py'),
      file('renpy/lib/game.dylib', { extension: '.dylib', magic: { id: 'macho' }, kind: 'executable' }),
    ],
    archives: [],
    metadata,
  });
  const renpy = candidate(result, 'renpy');
  assert.ok(renpy);
  assert.deepEqual(renpy.platforms, ['Apple platform']);
});

test('attributes archive-level platform hints only to candidates with evidence inside that archive', () => {
  const result = detectEngines({
    files: [file('game.apk', { extension: '.apk', magic: { id: 'zip' }, kind: 'package' }), file('project.godot')],
    archives: [archive('game.apk', ['classes.dex', 'lib/arm64-v8a/libgame.so', 'com/badlogic/gdx/Game.class'])],
    metadata: {
      ...metadata,
      platformHints: [{
        name: 'Android', path: 'game.apk', rule: 'android-package-archive', strength: 'strong',
        detail: 'Android package manifest and DEX member names were found in the archive index.',
      }],
    },
  });
  const libgdx = candidate(result, 'libgdx');
  const godot = candidate(result, 'godot');
  assert.ok(libgdx);
  assert.ok(godot);
  assert.deepEqual(libgdx.platforms, ['Android']);
  assert.deepEqual(godot.platforms, []);
});

test('reports conflicting explicit versions as unknown without silently picking one', () => {
  const result = detectEngines({
    files: [file('Game_Data/Managed/Assembly-CSharp.dll', { magic: { id: 'pe' }, kind: 'executable' })],
    archives: [],
    metadata: {
      ...metadata,
      engineHints: [
        { engineId: 'unity', path: 'ProjectSettings/ProjectVersion.txt', rule: 'unity-project-version-file', strength: 'strong', detail: 'Project version file.' },
        { engineId: 'unity', path: 'build/legacy-version.txt', rule: 'unity-editor-version', strength: 'strong', detail: 'Legacy version note.' },
      ],
      versionHints: [
        { engineId: 'unity', version: '2022.3.21f1', path: 'ProjectSettings/ProjectVersion.txt', rule: 'unity-editor-version', strength: 'strong', detail: 'Editor version.' },
        { engineId: 'unity', version: '2021.3.5f1', path: 'build/legacy-version.txt', rule: 'unity-editor-version', strength: 'strong', detail: 'Legacy editor version.' },
      ],
    },
  });
  const unity = candidate(result, 'unity');
  assert.equal(unity.version, 'unknown');
  assert.ok(Array.isArray(unity.versionConflict) || Array.isArray(unity.versionConflicts));
  const listed = (unity.versionConflict || unity.versionConflicts).map(item => item.version ?? item);
  assert.deepEqual(listed.sort(), ['2021.3.5f1', '2022.3.21f1']);
});

test('never promotes generic engine-like extensions alone to high confidence', () => {
  const pak = detectEngines({ files: [file('Content/Paks/pakchunk0.pak')], archives: [], metadata });
  assert.equal(candidate(pak, 'unreal').confidence, 'low');
  const assets = detectEngines({ files: [file('data/level0.assets')], archives: [], metadata });
  assert.equal(candidate(assets, 'unity').confidence, 'low');
});

test('does not let one metadata file double-weight confidence through separate rules', () => {
  const result = detectEngines({
    files: [file('project.godot')],
    archives: [],
    metadata: {
      ...metadata,
      engineHints: [{ engineId: 'godot', path: 'project.godot', rule: 'godot-project-file', strength: 'strong', detail: 'Godot project file.' }],
      versionHints: [{ engineId: 'godot', version: '4.2', path: 'project.godot', rule: 'godot-project-features', strength: 'strong', detail: 'Explicit Godot feature version.' }],
    },
  });
  const godot = candidate(result, 'godot');
  assert.equal(godot.confidence, 'medium');
  assert.equal(godot.version, '4.2');
});

test('pairs loose LÖVE scripts only within the same directory', () => {
  const sameDir = detectEngines({
    files: [file('game/main.lua'), file('game/conf.lua')],
    archives: [],
    metadata,
  });
  const paired = candidate(sameDir, 'love');
  assert.ok(paired);
  assert.equal(paired.confidence, 'low');

  const crossDir = detectEngines({
    files: [file('game/main.lua'), file('other/conf.lua')],
    archives: [],
    metadata,
  });
  assert.equal(candidate(crossDir, 'love'), undefined);

  const archived = candidate(detectEngines({
    files: [file('game.love', { extension: '.love', magic: { id: 'zip' }, kind: 'archive' })],
    archives: [archive('game.love', ['main.lua', 'conf.lua', 'lib/util.lua'])],
    metadata,
  }), 'love');
  assert.ok(archived);
  assert.ok(archived.containers.includes('.love'));
  assert.ok(archived.evidence.some(item => item.path === 'game.love!/main.lua' && item.strength === 'strong'));
});

test('recognizes a bare .love archive even when its members were not indexed', () => {
  const result = detectEngines({
    files: [file('packs/legacy.love', { extension: '.love', magic: { id: 'zip' }, kind: 'archive' })],
    archives: [],
    metadata,
  });
  const love = candidate(result, 'love');
  assert.ok(love);
  assert.equal(love.confidence, 'low');
});

test('finds libGDX member evidence inside Android APK containers', () => {
  const result = detectEngines({
    files: [file('game.apk', { extension: '.apk', magic: { id: 'zip' }, kind: 'package' })],
    archives: [archive('game.apk', ['classes.dex', 'com/badlogic/gdx/Game.class'])],
    metadata,
  });
  const libgdx = candidate(result, 'libgdx');
  assert.ok(libgdx);
  assert.ok(libgdx.evidence.some(item => item.path.startsWith('game.apk!/')));
});

test('profile artifacts keep template-aligned shapes for runtimes and unknown platforms', async () => {
  const { buildEngineProfile } = await import('../src/profile.mjs');
  const scanResult = {
    input: { root: 'C:/fixtures/SomeGame', label: 'SomeGame', isFile: false },
    scannedAt: '2026-11-07T05:00:00.000Z',
    options: { maxFiles: 50000, maxDepth: 40, includeCache: false, hashKeyFiles: false },
    inventory: { files: [], skipped: [], warnings: [], stats: { fileCount: 0, dirCount: 1, skippedCount: 0, truncated: false } },
    archives: [],
    metadata,
    candidates: [{
      id: 'unity',
      name: 'Unity',
      score: 6,
      confidence: 'high',
      version: 'unknown',
      evidence: [{ path: 'UnityPlayer.dll', rule: 'unity-player-runtime', strength: 'strong', detail: 'A Unity player runtime binary was found.', group: 'player-runtime' }],
      runtimes: [{ name: 'Mono', version: 'unknown', evidence: 'Game_Data/Managed/Assembly-CSharp.dll' }],
      containers: [],
      platforms: [],
    }],
    keyFileHashes: {},
    warnings: [],
  };
  const profile = buildEngineProfile(scanResult);
  assert.equal(profile.game.platform, 'unknown', 'scan-global platforms stay unknown when no hints exist');
  const runtime = profile.runtimes.find(item => item.name === 'Mono');
  assert.ok(runtime, 'candidate runtimes surface in the profile');
  assert.ok(Array.isArray(runtime.evidence), 'template schema declares runtimes evidence as an array');
  assert.deepEqual(runtime.evidence, ['Game_Data/Managed/Assembly-CSharp.dll']);
});

test('walk skips game-engine project cache directories by default', async () => {
  const { walkInput } = await import('../src/walk.mjs');
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-reverse-walkcache-'));
  try {
    await mkdir(path.join(root, 'Library', 'Artifacts'), { recursive: true });
    await mkdir(path.join(root, '.godot'), { recursive: true });
    await mkdir(path.join(root, 'Intermediate', 'Build'), { recursive: true });
    await mkdir(path.join(root, 'Content', 'Paks'), { recursive: true });
    await writeFile(path.join(root, 'Library', 'Artifacts', 'cache.bin'), 'x');
    await writeFile(path.join(root, '.godot', 'editor'), 'x');
    await writeFile(path.join(root, 'Intermediate', 'Build', 'o.obj'), 'x');
    await writeFile(path.join(root, 'Content', 'Paks', 'game.pck'), 'GDPC');
    const skipped = walkInput(root, { headerBytes: 8 });
    assert.deepEqual(skipped.files.map(item => item.path), ['Content/Paks/game.pck']);
    const skippedPaths = skipped.skipped.map(item => item.path).sort();
    assert.deepEqual(skippedPaths, ['.godot', 'Intermediate', 'Library']);
    assert.ok(skipped.skipped.every(item => item.reason === 'cache-excluded'));

    const included = walkInput(root, { headerBytes: 8, includeCache: true });
    assert.ok(included.files.some(item => item.path === 'Library/Artifacts/cache.bin'));
    assert.equal(included.skipped.filter(item => item.reason === 'cache-excluded').length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reads Cocos Creator versions from the creator object form', async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { walkInput } = await import('../src/walk.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-reverse-boundary-'));
  try {
    await mkdir(path.join(root, 'ProjectSettings'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', creator: { version: '3.8.2' } }));
    await writeFile(path.join(root, 'conf.lua'), 'local t = { version = "11.4" }\nreturn t\n');
    const scan = await walkInput(root);
    const collected = await collectMetadata(root, scan.files, []);
    assert.ok(collected.versionHints.some(hint => hint.engineId === 'cocos-creator' && hint.version === '3.8.2'));
    assert.deepEqual(collected.versionHints.filter(hint => hint.engineId === 'love'), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
