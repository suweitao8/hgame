// profile.mjs — engine-profile.json builder for the Game Reverse Scanner.
//
// buildEngineProfile(scanResult) maps a completed scan onto schema version 1
// of docs/reverse-engineering/templates/engine-profile.template.json. The
// scanner never invents versions, platforms, or offline scope: unavailable
// values stay "unknown"/empty, and only opted-in hashes are filled in.

const PROFILE_SCHEMA_VERSION = 1;
const MAX_SOURCE_ENTRIES = 200;

// walk/magic kinds mapped onto the template's source.kind enum:
// executable | archive | package | save | resource-container | other.
// Files with kind "other" are not key artifacts and never become sources.
const SOURCE_KINDS = new Map([
  ['executable', 'executable'],
  ['archive', 'archive'],
  ['container', 'resource-container'],
  ['database', 'other'],
  ['bytecode', 'other'],
  ['asset', 'other'],
]);

// Candidates that describe the game's own engine layer versus wrapper layers.
const GAMEPLAY_ENGINE_IDS = new Set([
  'unity', 'unreal', 'godot', 'rpg-maker-mv', 'rpg-maker-mz', 'rpg-maker-rgss',
  'gamemaker', 'cocos-creator', 'cocos2d-x', 'renpy', 'web-html5', 'source',
  'source2', 'flash-air', 'defold', 'love', 'libgdx',
]);

function componentRole(candidate) {
  if (GAMEPLAY_ENGINE_IDS.has(candidate.id)) return 'gameplay-engine';
  if (candidate.id === 'electron') return 'scripting-runtime';
  return 'other';
}

function profileEngine(candidate) {
  if (!candidate) {
    return { name: 'unknown', version: 'unknown', confidence: 'unknown', evidence: [], platforms: [] };
  }
  return {
    name: candidate.name,
    version: candidate.version || 'unknown',
    confidence: candidate.confidence || 'unknown',
    evidence: candidate.evidence.map(item => ({ ...item })),
    platforms: [...candidate.platforms],
    ...(candidate.versionConflict ? { versionConflict: candidate.versionConflict.map(item => ({ ...item })) } : {}),
  };
}

function profileRuntimes(candidates) {
  const runtimes = [];
  const seen = new Set();
  for (const candidate of candidates) {
    for (const runtime of candidate.runtimes || []) {
      const key = `${runtime.name}|${runtime.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      runtimes.push({
        name: runtime.name,
        version: runtime.version || 'unknown',
        backend: runtime.name === 'IL2CPP' ? 'il2cpp'
          : runtime.name === 'Mono' ? 'mono'
            : 'unknown',
        role: 'scripting',
        // Template schema declares evidence as an array; wrap the detector's
        // single source path so the profile stays aligned with schema version 1.
        evidence: runtime.evidence && runtime.evidence !== '.' ? [runtime.evidence] : [],
      });
    }
  }
  return runtimes;
}

function profileSources(inventory, keyFileHashes) {
  const sourceKindById = new Map();
  for (const entry of inventory.files || []) {
    if (!SOURCE_KINDS.has(entry.kind)) continue;
    sourceKindById.set(entry.path, {
      path: entry.path,
      kind: SOURCE_KINDS.get(entry.kind),
      sha256: (keyFileHashes && keyFileHashes[entry.path]) || '',
      size_bytes: entry.sizeBytes,
      read_only: true,
    });
  }
  return [...sourceKindById.values()]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .slice(0, MAX_SOURCE_ENTRIES);
}

function profileContainers(archives) {
  return (archives || []).map(archive => ({
    path: archive.path,
    format: archive.format,
    entry_count: Array.isArray(archive.entries) ? archive.entries.length : 0,
    indexed: Array.isArray(archive.entries) && archive.entries.length > 0,
    warnings: (archive.warnings || []).map(warning => ({ ...warning })),
  }));
}

function profileNotes(scanResult) {
  const notes = [
    'Scanner output is a first-pass fingerprint. Engine candidates require manual evidence review before engine-specific extraction work begins.',
    'The scanner does not prove gameplay rules, content coverage, or offline scope; offline_scope stays empty by design.',
    'Tool availability is not checked by the scanner; see tool-recommendations.json.',
  ];
  const { inventory, options } = scanResult;
  if (inventory?.stats?.truncated) {
    notes.push(`Traversal was truncated (max-files=${options?.maxFiles ?? 'default'}, max-depth=${options?.maxDepth ?? 'default'}); skipped and listed files are not the complete tree.`);
  }
  const warningCodes = [...new Set([
    ...(inventory?.warnings || []),
    ...(scanResult.metadata?.warnings || []),
    ...(scanResult.warnings || []),
  ].map(warning => warning.code))];
  if (warningCodes.length) notes.push(`Warnings recorded: ${warningCodes.join(', ')}.`);
  return notes;
}

/** Build a schema-version-1 engine profile from a completed scan result. */
export function buildEngineProfile(scanResult) {
  const candidates = scanResult.candidates || [];
  const [leading, ...rest] = candidates;
  return {
    schema_version: PROFILE_SCHEMA_VERSION,
    game: {
      id: '',
      name: scanResult.input?.label || '',
      version: '',
      build: '',
      platform: (scanResult.metadata?.platformHints || []).map(hint => hint.name).join(', ') || 'unknown',
      language: '',
    },
    source: profileSources(scanResult.inventory, scanResult.keyFileHashes),
    engine: profileEngine(leading),
    engine_components: rest.map(candidate => ({
      role: componentRole(candidate),
      name: candidate.name,
      version: candidate.version || 'unknown',
      confidence: candidate.confidence || 'unknown',
      evidence: candidate.evidence.map(item => ({ ...item })),
      platforms: [...candidate.platforms],
      ...(candidate.versionConflict ? { versionConflict: candidate.versionConflict.map(item => ({ ...item })) } : {}),
    })),
    runtimes: profileRuntimes(candidates),
    containers: profileContainers(scanResult.archives),
    data_driven_systems: [],
    toolchain: [],
    offline_scope: { required: [], adapter: [], excluded_online: [], unknown: [] },
    notes: profileNotes(scanResult),
  };
}
