import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEngineProfile } from '../src/profile.mjs';
import { buildRecommendations } from '../src/recommendations.mjs';
import { renderMarkdownReport } from '../src/report.mjs';

const emptyMetadata = { engineHints: [], versionHints: [], runtimeHints: [], platformHints: [], warnings: [] };

function fileEntry(path, options = {}) {
  return {
    path,
    sizeBytes: options.sizeBytes ?? 1024,
    extension: options.extension ?? path.slice(path.lastIndexOf('.')).toLowerCase(),
    magic: options.magic ?? null,
    kind: options.kind ?? 'other',
  };
}

function unityCandidate(overrides = {}) {
  return {
    id: 'unity',
    name: 'Unity',
    score: 6,
    confidence: 'high',
    version: 'unknown',
    evidence: [
      { path: 'UnityPlayer.dll', rule: 'unity-player-runtime', strength: 'strong', detail: 'A Unity player runtime binary was found.', group: 'player-runtime' },
    ],
    runtimes: [{ name: 'Mono', version: 'unknown', evidence: 'Game_Data/Managed/Assembly-CSharp.dll' }],
    containers: ['AssetBundle/SerializedFile'],
    platforms: ['Windows'],
    ...overrides,
  };
}

function godotCandidate(overrides = {}) {
  return {
    id: 'godot',
    name: 'Godot',
    score: 5,
    confidence: 'high',
    version: '4.2',
    evidence: [
      { path: 'project.godot', rule: 'godot-project-file', strength: 'strong', detail: 'project.godot was found.', group: 'project-config' },
    ],
    runtimes: [],
    containers: ['PCK'],
    platforms: [],
    ...overrides,
  };
}

function scanResult(overrides = {}) {
  return {
    input: { root: 'C:/fixtures/SomeGame', label: 'SomeGame', isFile: false },
    scannedAt: '2026-11-07T05:00:00.000Z',
    options: { maxFiles: 50000, maxDepth: 40, includeCache: false, hashKeyFiles: false },
    inventory: {
      files: [
        fileEntry('UnityPlayer.dll', { magic: { id: 'pe', label: 'Windows PE executable', kind: 'executable' }, kind: 'executable', sizeBytes: 654321 }),
        fileEntry('game.pck', { magic: { id: 'godot-pck', label: 'Godot engine pack (PCK)', kind: 'container' }, kind: 'container', sizeBytes: 2048 }),
        fileEntry('readme.txt'),
      ],
      skipped: [{ path: 'node_modules', reason: 'cache-excluded' }],
      warnings: [{ code: 'dir-unreadable', path: 'locked' }],
      stats: { fileCount: 3, dirCount: 2, skippedCount: 1, truncated: false },
    },
    archives: [{
      path: 'game.pck',
      format: 'zip-family',
      entries: [{ name: 'a.txt', isDirectory: false }],
      warnings: [],
    }],
    metadata: emptyMetadata,
    candidates: [unityCandidate(), godotCandidate()],
    keyFileHashes: {},
    warnings: [],
    ...overrides,
  };
}

test('profile follows schema version 1 with relative source paths and empty hashes', () => {
  const profile = buildEngineProfile(scanResult());
  assert.equal(profile.schema_version, 1);
  assert.equal(profile.game.name, 'SomeGame');
  assert.equal(profile.engine.name, 'Unity');
  assert.equal(profile.engine.confidence, 'high');
  assert.ok(Array.isArray(profile.engine.evidence) && profile.engine.evidence.length > 0);
  const source = profile.source.find(item => item.path === 'UnityPlayer.dll');
  assert.ok(source, 'key artifacts become source entries');
  assert.equal(source.kind, 'executable');
  assert.equal(source.sha256, '', 'hash stays empty unless hashing was requested');
  assert.equal(source.size_bytes, 654321);
  assert.equal(source.read_only, true);
  for (const entry of profile.source) {
    assert.ok(!entry.path.includes('/') || !entry.path.startsWith('C:'), 'source paths stay relative');
  }
  assert.deepEqual(profile.offline_scope, { required: [], adapter: [], excluded_online: [], unknown: [] });
  assert.deepEqual(profile.toolchain, []);
});

test('profile keeps hybrid engine components and uses the template roles', () => {
  const profile = buildEngineProfile(scanResult());
  const component = profile.engine_components.find(item => item.name === 'Godot');
  assert.ok(component, 'second candidate stays visible as an engine component');
  assert.equal(component.version, '4.2');
  assert.equal(component.confidence, 'high');
  const electronProfile = buildEngineProfile(scanResult({
    candidates: [
      unityCandidate(),
      godotCandidate({ id: 'electron', name: 'Electron shell' }),
    ],
  }));
  const electron = electronProfile.engine_components.find(item => item.name === 'Electron shell');
  assert.ok(electron, 'Electron shell is retained as a component');
});

test('profile reports unknown engine without inventing versions for unrecognized inputs', () => {
  const profile = buildEngineProfile(scanResult({
    candidates: [],
    inventory: scanResult().inventory && {
      files: [fileEntry('readme.txt')],
      skipped: [],
      warnings: [],
      stats: { fileCount: 1, dirCount: 1, skippedCount: 0, truncated: false },
    },
  }));
  assert.equal(profile.engine.name, 'unknown');
  assert.equal(profile.engine.version, 'unknown');
  assert.equal(profile.engine.confidence, 'unknown');
  assert.deepEqual(profile.engine.evidence, []);
  assert.deepEqual(profile.engine_components, []);
  assert.ok(profile.notes.length > 0, 'limitations stay visible in notes');
});

test('profile copies opted-in key file hashes without inventing others', () => {
  const profile = buildEngineProfile(scanResult({
    keyFileHashes: { 'UnityPlayer.dll': 'abc123' },
  }));
  const hashed = profile.source.find(item => item.path === 'UnityPlayer.dll');
  assert.equal(hashed.sha256, 'abc123');
  const unhashed = profile.source.find(item => item.path === 'game.pck');
  assert.equal(unhashed.sha256, '');
});

test('profile lists container archives with member counts and warnings', () => {
  const profile = buildEngineProfile(scanResult({
    archives: [{
      path: 'game.pck',
      format: 'zip-family',
      entries: [{ name: 'a.txt' }, { name: 'b.txt' }],
      warnings: [{ code: 'zip64-unsupported', path: 'game.pck' }],
    }],
  }));
  const container = profile.containers.find(item => item.path === 'game.pck');
  assert.ok(container, 'indexed archives appear as containers');
  assert.equal(container.entry_count, 2);
  assert.ok(Array.isArray(container.warnings) && container.warnings.length === 1);
});

test('recommendations mark every tool availability as not_checked', () => {
  const result = buildRecommendations([unityCandidate(), godotCandidate()]);
  assert.equal(result.schema_version, 1);
  assert.ok(result.recommendations.length >= 2);
  for (const group of result.recommendations) {
    assert.ok(group.candidate && group.tools.length > 0);
    for (const tool of group.tools) {
      assert.equal(tool.availability, 'not_checked');
      assert.ok(tool.purpose, 'every tool states its purpose');
    }
  }
  const unityTools = result.recommendations.find(group => group.candidate === 'unity');
  assert.ok(unityTools.tools.some(tool => /il2cpp|ilspy|unitypy|assetripper/i.test(tool.name)));
});

test('recommendations cover unknown candidates with generic tools', () => {
  const result = buildRecommendations([]);
  assert.ok(result.recommendations.length >= 1);
  const generic = result.recommendations.find(group => group.candidate === 'generic');
  assert.ok(generic, 'generic recommendations exist without engine candidates');
  for (const group of result.recommendations) {
    for (const tool of group.tools) assert.equal(tool.availability, 'not_checked');
  }
});

test('markdown report renders ranked candidates, evidence, warnings and next steps', () => {
  const report = renderMarkdownReport(scanResult({
    warnings: [{ code: 'file-limit-reached', path: 'x', detail: 'stopped at 50000 files' }],
  }));
  assert.match(report, /# Game Reverse Scanner report/);
  assert.match(report, /SomeGame/);
  assert.match(report, /Unity/);
  assert.match(report, /Godot/);
  assert.match(report, /UnityPlayer\.dll/, 'evidence paths appear in the report');
  assert.match(report, /high/);
  assert.match(report, /file-limit-reached/);
  assert.match(report, /node_modules/, 'skipped paths are disclosed');
  assert.match(report, /manual/i, 'manual confirmation step is present');
  assert.match(report, /not prove|does not|first-pass|initial/i, 'scope caveat is present');
});

test('markdown report handles unknown engines and conflicting versions explicitly', () => {
  const unknown = renderMarkdownReport(scanResult({ candidates: [] }));
  assert.match(unknown, /unknown/i);
  const conflict = renderMarkdownReport(scanResult({
    candidates: [godotCandidate({ version: 'unknown', versionConflict: [
      { version: '4.2.1', path: 'project.godot', rule: 'godot-project-features' },
      { version: '3.5.2', path: 'backup/project.godot', rule: 'godot-project-features' },
    ] })],
  }));
  assert.match(conflict, /4\.2\.1/);
  assert.match(conflict, /3\.5\.2/);
  assert.match(conflict, /conflict/i);
});

test('all generated JSON artifacts parse with JSON.parse', () => {
  const profile = buildEngineProfile(scanResult());
  const recommendations = buildRecommendations(scanResult().candidates);
  assert.equal(JSON.parse(JSON.stringify(profile)).schema_version, 1);
  assert.equal(JSON.parse(JSON.stringify(recommendations)).schema_version, 1);
});
