import assert from 'node:assert/strict';
import test from 'node:test';
import { detectEngines } from '../src/detect.mjs';

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

test('recognizes Unity Mono and IL2CPP as distinct runtime paths', () => {
  const mono = detectEngines({
    files: [
      file('UnityPlayer.dll', { magic: { id: 'pe' }, kind: 'executable' }),
      file('Game_Data/Managed/Assembly-CSharp.dll', { magic: { id: 'pe' }, kind: 'executable' }),
    ],
    archives: [],
    metadata,
  });
  const monoCandidate = candidate(mono, 'unity');
  assert.equal(monoCandidate.confidence, 'high');
  assert.ok(monoCandidate.runtimes.some(runtime => runtime.name === 'Mono'));

  const il2cpp = detectEngines({
    files: [
      file('UnityPlayer.dll', { magic: { id: 'pe' }, kind: 'executable' }),
      file('GameAssembly.dll', { magic: { id: 'pe' }, kind: 'executable' }),
      file('Game_Data/il2cpp_data/Metadata/global-metadata.dat'),
    ],
    archives: [],
    metadata,
  });
  const il2cppCandidate = candidate(il2cpp, 'unity');
  assert.equal(il2cppCandidate.confidence, 'high');
  assert.ok(il2cppCandidate.runtimes.some(runtime => runtime.name === 'IL2CPP'));
});

test('recognizes Unreal Pak and IoStore builds with an explicit engine version', () => {
  const result = detectEngines({
    files: [
      file('Content/Paks/pakchunk0-Windows.pak', { extension: '.pak', kind: 'archive' }),
      file('Content/Paks/global.utoc', { extension: '.utoc', kind: 'resource-container' }),
      file('Content/Paks/global.ucas', { extension: '.ucas', kind: 'resource-container' }),
      file('Engine/Build/Build.version'),
    ],
    archives: [],
    metadata: {
      ...metadata,
      engineHints: [{ engineId: 'unreal', path: 'Engine/Build/Build.version', rule: 'unreal-build-version', strength: 'strong', detail: 'Unreal Build.version metadata.' }],
      versionHints: [{ engineId: 'unreal', version: '5.3.2', path: 'Engine/Build/Build.version', rule: 'unreal-build-version', strength: 'strong', detail: 'Explicit Unreal build version.' }],
    },
  });
  const unreal = candidate(result, 'unreal');
  assert.equal(unreal.version, '5.3.2');
  assert.equal(unreal.confidence, 'high');
  assert.ok(unreal.containers.includes('Pak'));
  assert.ok(unreal.containers.includes('IoStore'));
});

test('recognizes Godot projects and resource packs', () => {
  const result = detectEngines({
    files: [
      file('project.godot'),
      file('game.pck', { extension: '.pck', magic: { id: 'godot-pck' }, kind: 'resource-container' }),
    ],
    archives: [],
    metadata: {
      ...metadata,
      engineHints: [{ engineId: 'godot', path: 'project.godot', rule: 'godot-project-file', strength: 'strong', detail: 'Godot project file.' }],
      versionHints: [{ engineId: 'godot', version: '4.2', path: 'project.godot', rule: 'godot-project-features', strength: 'strong', detail: 'Explicit Godot feature version.' }],
    },
  });
  assert.equal(candidate(result, 'godot').confidence, 'high');
  assert.equal(candidate(result, 'godot').version, '4.2');
});

test('distinguishes RPG Maker MV, MZ and RGSS generations', () => {
  const mv = detectEngines({ files: [file('www/js/rpg_core.js'), file('www/data/System.json')], archives: [], metadata });
  const mz = detectEngines({ files: [file('js/rmmz_core.js'), file('data/System.json')], archives: [], metadata });
  const rgss = detectEngines({ files: [file('Game.exe'), file('Game.ini'), file('Game.rgss3a'), file('Data/Scripts.rvdata2')], archives: [], metadata });
  assert.ok(candidate(mv, 'rpg-maker-mv'));
  assert.ok(candidate(mz, 'rpg-maker-mz'));
  assert.ok(candidate(rgss, 'rpg-maker-rgss'));
});

test('recognizes GameMaker VM data and source project markers', () => {
  const result = detectEngines({
    files: [file('data.win'), file('objects/o_player/o_player.yy'), file('options.ini')],
    archives: [],
    metadata,
  });
  assert.ok(candidate(result, 'gamemaker'));
});

test('distinguishes Cocos Creator from cocos2d-x native projects', () => {
  const creator = detectEngines({
    files: [file('src/settings.js'), file('assets/main/index.js'), file('cocos2d-js.js')],
    archives: [],
    metadata,
  });
  const native = detectEngines({
    files: [file('libcocos2d.so', { extension: '.so', magic: { id: 'elf' }, kind: 'executable' }), file('Classes/AppDelegate.cpp')],
    archives: [],
    metadata,
  });
  assert.ok(candidate(creator, 'cocos-creator'));
  assert.ok(candidate(native, 'cocos2d-x'));
});

test('recognizes RenPy, Electron/Web, Source and Source 2 signatures', () => {
  const renpy = detectEngines({
    files: [file('renpy/__init__.py'), file('game/script.rpyc'), file('game/archive.rpa')],
    archives: [],
    metadata,
  });
  const electron = detectEngines({
    files: [file('electron.exe', { magic: { id: 'pe' }, kind: 'executable' }), file('resources/app.asar'), file('resources/app/index.html'), file('resources/app/renderer.js')],
    archives: [],
    metadata,
  });
  const source = detectEngines({
    files: [file('gameinfo.txt'), file('pak01_dir.vpk', { extension: '.vpk', magic: { id: 'vpk' }, kind: 'archive' })],
    archives: [],
    metadata,
  });
  const source2 = detectEngines({
    files: [file('maps/map.vmap_c'), file('models/hero.vmdl_c'), file('materials/hero.vtex_c')],
    archives: [],
    metadata,
  });
  assert.ok(candidate(renpy, 'renpy'));
  assert.ok(candidate(electron, 'web-html5'));
  assert.ok(candidate(electron, 'electron'));
  assert.ok(candidate(source, 'source'));
  assert.ok(candidate(source2, 'source2'));
});

test('recognizes Flash/AIR, Defold, LÖVE and libGDX', () => {
  const flash = detectEngines({
    files: [file('game.swf', { extension: '.swf', magic: { id: 'swf' }, kind: 'resource-container' })],
    archives: [],
    metadata,
  });
  const defold = detectEngines({ files: [file('game.project'), file('build/game.arcd')], archives: [], metadata });
  const love = detectEngines({
    files: [file('game.love', { extension: '.love', magic: { id: 'zip' }, kind: 'archive' })],
    archives: [archive('game.love', ['main.lua', 'conf.lua'])],
    metadata,
  });
  const libgdx = detectEngines({
    files: [file('game.jar', { extension: '.jar', magic: { id: 'zip' }, kind: 'archive' })],
    archives: [archive('game.jar', ['META-INF/MANIFEST.MF', 'com/badlogic/gdx/Game.class', 'com/example/MyGame.class'])],
    metadata,
  });
  assert.ok(candidate(flash, 'flash-air'));
  assert.ok(candidate(defold, 'defold'));
  assert.ok(candidate(love, 'love'));
  assert.ok(candidate(libgdx, 'libgdx'));
});

test('does not promote a generic Java class file to a game engine candidate', () => {
  const result = detectEngines({
    files: [file('com/example/Game.class', { extension: '.class', magic: { id: 'java-class' }, kind: 'class-file' })],
    archives: [],
    metadata,
  });
  assert.deepEqual(result, []);
});

test('keeps generic native and WASM signatures as runtime evidence, not invented engines', () => {
  const result = detectEngines({
    files: [
      file('game.exe', { magic: { id: 'pe' }, kind: 'executable' }),
      file('game.wasm', { extension: '.wasm', magic: { id: 'wasm' }, kind: 'resource-container' }),
    ],
    archives: [],
    metadata,
  });
  assert.deepEqual(result, []);
});

test('preserves multiple high-confidence candidates for a hybrid build and sorts deterministically', () => {
  const result = detectEngines({
    files: [
      file('UnityPlayer.dll', { magic: { id: 'pe' }, kind: 'executable' }),
      file('Game_Data/Managed/Assembly-CSharp.dll', { magic: { id: 'pe' }, kind: 'executable' }),
      file('project.godot'),
      file('game.pck', { extension: '.pck', magic: { id: 'godot-pck' }, kind: 'resource-container' }),
    ],
    archives: [],
    metadata,
  });
  assert.ok(candidate(result, 'unity'));
  assert.ok(candidate(result, 'godot'));
  assert.ok(result.every(item => item.confidence === 'high'));
  const expectedOrder = [...result]
    .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map(item => item.id);
  assert.deepEqual(result.map(item => item.id), expectedOrder);
});

test('does not count duplicate markers from the same metadata file as independent confirmation', () => {
  const result = detectEngines({
    files: [file('project.godot')],
    archives: [],
    metadata: {
      ...metadata,
      engineHints: [{ engineId: 'godot', path: 'project.godot', rule: 'godot-project-file', strength: 'strong', detail: 'Godot project file.' }],
      versionHints: [{ engineId: 'godot', version: '4.2', path: 'project.godot', rule: 'godot-project-features', strength: 'strong', detail: 'Explicit Godot feature version.' }],
    },
  });
  assert.equal(candidate(result, 'godot').confidence, 'medium');
});

test('returns no engine candidates for unknown files', () => {
  const result = detectEngines({ files: [file('readme.txt'), file('random.bin')], archives: [], metadata });
  assert.deepEqual(result, []);
});

test('attributes platforms to candidates by evidence proximity instead of spreading them globally', () => {
  const result = detectEngines({
    files: [
      file('UnityPlayer.dll', { magic: { id: 'pe' }, kind: 'executable' }),
      file('Game_Data/Managed/Assembly-CSharp.dll', { magic: { id: 'pe' }, kind: 'executable' }),
      file('godot/project.godot'),
      file('godot/godot.x86_64', { magic: { id: 'elf' }, kind: 'executable' }),
    ],
    archives: [],
    metadata,
  });
  const unity = candidate(result, 'unity');
  const godot = candidate(result, 'godot');
  assert.ok(unity.platforms.includes('Windows'), 'Unity evidence sits next to PE binaries');
  assert.ok(!unity.platforms.includes('Linux'), 'Linux must not spread to Unity from the Godot directory');
  assert.ok(godot.platforms.includes('Linux'), 'Godot evidence sits next to its ELF runtime');
  assert.ok(!godot.platforms.includes('Windows'), 'Windows must not spread to Godot from the Unity files');
});

test('derives platform evidence from Mach-O binaries using the real magic id', () => {
  const result = detectEngines({
    files: [
      file('Game.app/Contents/Frameworks/UnityFramework', { magic: { id: 'macho' }, kind: 'executable' }),
      file('Game.app/Contents/Resources/Data/Managed/Assembly-CSharp.dll', { magic: { id: 'pe' }, kind: 'executable' }),
    ],
    archives: [],
    metadata,
  });
  const unity = candidate(result, 'unity');
  assert.ok(unity, 'a macOS Unity app bundle is recognized');
  assert.ok(unity.platforms.includes('Apple platform'), 'the Mach-O UnityFramework runtime is Apple platform evidence');
  assert.ok(unity.runtimes.some(runtime => runtime.name === 'Mono'), 'the managed assembly keeps Mono runtime evidence');
});

test('does not pair LÖVE main.lua and conf.lua across different directories', () => {
  const crossDirectory = detectEngines({
    files: [file('scripts/main.lua'), file('other/conf.lua')],
    archives: [],
    metadata,
  });
  assert.deepEqual(crossDirectory, [], 'cross-directory Lua files must not form LÖVE evidence');

  const sameDirectory = detectEngines({
    files: [file('game/main.lua'), file('game/conf.lua')],
    archives: [],
    metadata,
  });
  const love = candidate(sameDirectory, 'love');
  assert.ok(love, 'a same-directory main.lua/conf.lua pair is LÖVE evidence');
  assert.equal(love.confidence, 'low', 'a bare Lua pair alone stays low confidence');
});

test('keeps conflicting explicit versions unknown and records the conflict', () => {
  const result = detectEngines({
    files: [
      file('project.godot'),
      file('game.pck', { extension: '.pck', magic: { id: 'godot-pck' }, kind: 'resource-container' }),
    ],
    archives: [],
    metadata: {
      ...metadata,
      versionHints: [
        { engineId: 'godot', version: '4.2.1', path: 'project.godot', rule: 'godot-project-features', strength: 'strong', detail: 'Feature version.' },
        { engineId: 'godot', version: '3.5.2', path: 'backup/project.godot', rule: 'godot-project-features', strength: 'strong', detail: 'Backup project feature version.' },
      ],
    },
  });
  const godot = candidate(result, 'godot');
  assert.equal(godot.version, 'unknown', 'conflicting explicit versions must not be guessed');
  assert.ok(Array.isArray(godot.versionConflict), 'conflicting version evidence must stay visible');
  assert.deepEqual(
    godot.versionConflict.map(item => item.version).sort(),
    ['3.5.2', '4.2.1'],
  );
});

test('detects RGSS, RPA and Unreal Pak archives by magic even with wrong extensions', () => {
  const result = detectEngines({
    files: [
      file('Game.dat', { extension: '.dat', magic: { id: 'rgss-archive' }, kind: 'archive' }),
      file('archive.bin', { extension: '.bin', magic: { id: 'rpa' }, kind: 'archive' }),
      file('pakchunk0.bin', { extension: '.bin', magic: { id: 'unreal-pak' }, kind: 'archive' }),
    ],
    archives: [],
    metadata,
  });
  assert.ok(candidate(result, 'rpg-maker-rgss'), 'RGSS magic identifies the archive');
  assert.ok(candidate(result, 'renpy'), 'RPA magic identifies the archive');
  assert.ok(candidate(result, 'unreal'), 'Unreal Pak magic identifies the container');
});
