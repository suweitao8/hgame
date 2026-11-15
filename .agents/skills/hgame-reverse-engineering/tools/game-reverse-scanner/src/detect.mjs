const ENGINE_NAMES = {
  unity: 'Unity',
  unreal: 'Unreal Engine',
  godot: 'Godot',
  'rpg-maker-mv': 'RPG Maker MV',
  'rpg-maker-mz': 'RPG Maker MZ',
  'rpg-maker-rgss': 'RPG Maker RGSS',
  gamemaker: 'GameMaker',
  'cocos-creator': 'Cocos Creator',
  'cocos2d-x': 'cocos2d-x',
  renpy: 'Ren’Py',
  'web-html5': 'Web / HTML5',
  electron: 'Electron shell',
  source: 'Source Engine',
  source2: 'Source 2',
  'flash-air': 'Flash / Adobe AIR',
  defold: 'Defold',
  love: 'LÖVE',
  libgdx: 'libGDX',
};

const STRENGTH_WEIGHTS = { strong: 3, moderate: 2, weak: 1 };

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/').toLowerCase();
}

function extension(file) {
  if (typeof file.extension === 'string') return file.extension.toLowerCase();
  const path = normalizePath(file.path);
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot);
}

function fileName(file) {
  const path = normalizePath(file.path);
  return path.slice(path.lastIndexOf('/') + 1);
}

function firstFilePath(files, predicate, fallback = '.') {
  return files.find(predicate)?.path || fallback;
}

function createCandidate(map, id) {
  if (!ENGINE_NAMES[id]) return null;
  if (!map.has(id)) {
    map.set(id, {
      id,
      name: ENGINE_NAMES[id],
      score: 0,
      confidence: 'unknown',
      version: 'unknown',
      evidence: [],
      runtimes: [],
      containers: [],
      platforms: [],
    });
  }
  return map.get(id);
}

function addEvidence(map, id, evidence) {
  const candidate = createCandidate(map, id);
  if (!candidate) return;
  const normalized = {
    path: evidence.path || '.',
    rule: evidence.rule,
    strength: evidence.strength,
    detail: evidence.detail,
    group: evidence.group,
  };
  const key = [normalized.path, normalized.rule, normalized.group].join('|');
  if (!candidate.evidence.some(item => [item.path, item.rule, item.group].join('|') === key)) {
    candidate.evidence.push(normalized);
  }
}

function addRuntime(map, id, name, version = 'unknown', path = '.') {
  const candidate = createCandidate(map, id);
  if (!candidate) return;
  if (!candidate.runtimes.some(runtime => runtime.name === name && runtime.version === version)) {
    candidate.runtimes.push({ name, version, evidence: path });
  }
}

function addContainer(map, id, name) {
  const candidate = createCandidate(map, id);
  if (candidate && !candidate.containers.includes(name)) candidate.containers.push(name);
}

function addPlatform(map, id, name) {
  const candidate = createCandidate(map, id);
  if (candidate && !candidate.platforms.includes(name)) candidate.platforms.push(name);
}

function addFileEvidence(map, id, files, predicate, group, strength, rule, detail) {
  for (const file of files) {
    if (!predicate(file)) continue;
    addEvidence(map, id, {
      path: file.path,
      rule,
      strength,
      detail,
      group,
    });
  }
}

function archiveMemberMatches(archives, archivePredicate, memberPredicate) {
  const matches = [];
  for (const archive of archives) {
    if (archivePredicate && !archivePredicate(archive)) continue;
    for (const entry of archive.entries || []) {
      // The zip index produces plain member-name strings; tolerate {name}
      // objects so hand-built fixtures and future index shapes both work.
      const name = typeof entry === 'string' ? entry : entry?.name;
      if (memberPredicate(name)) matches.push({ archive, name });
    }
  }
  return matches;
}

function addArchiveEvidence(map, id, matches, group, strength, rule, detail) {
  for (const match of matches) {
    addEvidence(map, id, {
      path: `${match.archive.path}!/${String(match.name).replaceAll('\\', '/')}`,
      rule,
      strength,
      detail: `${detail} Archive member: ${match.name}`,
      group,
    });
  }
}

function addMetadataEvidence(map, metadata) {
  for (const hint of metadata.engineHints || []) {
    addEvidence(map, hint.engineId, {
      path: hint.path,
      rule: hint.rule,
      strength: hint.strength,
      detail: hint.detail,
      group: 'metadata',
    });
  }
  for (const hint of metadata.versionHints || []) {
    const candidate = createCandidate(map, hint.engineId);
    if (!candidate) continue;
    if (!candidate.versionEvidence) candidate.versionEvidence = [];
    candidate.versionEvidence.push(hint);
  }
  for (const hint of metadata.runtimeHints || []) {
    if (!hint.engineId || !ENGINE_NAMES[hint.engineId]) continue;
    addRuntime(map, hint.engineId, hint.name, hint.version || 'unknown', hint.path || '.');
  }
}

function platformForFile(file) {
  const magic = file.magic?.id;
  if (magic === 'pe' || extension(file) === '.exe') return 'Windows';
  if (magic === 'macho' || magic === 'macho-fat') return 'Apple platform';
  if (magic === 'elf' && !/\/lib\/(?:arm|x86|mips|riscv)/i.test(file.path)) return 'Linux';
  return null;
}

// Directory keys used to associate a platform-bearing file with engine
// evidence: the full path, its parent directory and its top-level segment.
function directoryKeys(value) {
  const normalized = normalizePath(value);
  const slash = normalized.lastIndexOf('/');
  const dir = slash >= 0 ? normalized.slice(0, slash) : '.';
  const top = dir.split('/')[0] || '.';
  return [normalized, dir, top];
}

// Platform hints naming an archive container (APK/IPA/AAB/JAR/...) carry the
// platform of the members inside it; they attach only to candidates whose own
// evidence lives inside that archive, never to unrelated sibling candidates.
const ARCHIVE_CONTAINER_EXTENSIONS = new Set(['.zip', '.jar', '.apk', '.aab', '.ipa', '.love', '.vpk']);

function pathExtension(value) {
  const normalized = normalizePath(value);
  const dot = normalized.lastIndexOf('.');
  return dot < 0 ? '' : normalized.slice(dot);
}

// Platforms attach to a candidate only where its own evidence sits: an
// engine-scoped metadata hint, a binary whose path/directory overlaps the
// candidate's evidence paths, or an archive container the candidate's evidence
// was found in. Unattributable platforms stay scan-global (inventory/report
// level) instead of being copied onto every candidate.
function inferPlatforms(map, files, metadata) {
  const engineScoped = new Map();
  const archiveHints = [];
  for (const hint of metadata.platformHints || []) {
    if (hint.engineId && ENGINE_NAMES[hint.engineId]) {
      if (!engineScoped.has(hint.engineId)) engineScoped.set(hint.engineId, new Set());
      engineScoped.get(hint.engineId).add(hint.name);
    } else if (ARCHIVE_CONTAINER_EXTENSIONS.has(pathExtension(hint.path || ''))) {
      archiveHints.push(hint);
    }
  }
  const filePlatforms = [];
  for (const file of files) {
    const platform = platformForFile(file);
    if (platform) filePlatforms.push({ keys: directoryKeys(file.path), platform });
  }
  for (const candidate of map.values()) {
    const scoped = engineScoped.get(candidate.id);
    if (scoped) for (const platform of scoped) addPlatform(map, candidate.id, platform);
    const evidencePaths = [];
    const evidenceKeys = new Set();
    for (const evidence of candidate.evidence) {
      evidencePaths.push(normalizePath(evidence.path));
      for (const key of directoryKeys(evidence.path)) evidenceKeys.add(key);
    }
    for (const filePlatform of filePlatforms) {
      if (filePlatform.keys.some(key => evidenceKeys.has(key))) {
        addPlatform(map, candidate.id, filePlatform.platform);
      }
    }
    for (const hint of archiveHints) {
      const archivePath = normalizePath(hint.path);
      if (evidencePaths.some(path => path === archivePath || path.startsWith(`${archivePath}!/`))) {
        addPlatform(map, candidate.id, hint.name);
      }
    }
  }
}

function finalizeCandidates(map) {
  const candidates = [];
  for (const candidate of map.values()) {
    const groupEvidence = new Map();
    for (const evidence of candidate.evidence) {
      const weight = STRENGTH_WEIGHTS[evidence.strength] || 0;
      const group = groupEvidence.get(evidence.group) || { weight: 0, paths: new Set() };
      group.weight = Math.max(group.weight, weight);
      group.paths.add(evidence.path);
      groupEvidence.set(evidence.group, group);
    }
    const rankedGroups = [...groupEvidence.values()].sort((left, right) => right.weight - left.weight);
    const countedPaths = new Set();
    const independentGroups = [];
    candidate.score = 0;
    for (const group of rankedGroups) {
      const hasNewSourcePath = [...group.paths].some(sourcePath => !countedPaths.has(sourcePath));
      if (!hasNewSourcePath) continue;
      independentGroups.push(group);
      candidate.score += group.weight;
      for (const sourcePath of group.paths) countedPaths.add(sourcePath);
    }
    const strongGroups = independentGroups.filter(group => group.weight === STRENGTH_WEIGHTS.strong);
    const hasIndependentStrongPair = strongGroups.some((left, index) => strongGroups
      .slice(index + 1)
      .some(right => [...left.paths].some(sourcePath => !right.paths.has(sourcePath))
        && [...right.paths].some(sourcePath => !left.paths.has(sourcePath))));
    const versionCorroborated = (candidate.versionEvidence || []).some(versionHint => candidate.evidence
      .some(evidence => evidence.path !== versionHint.path && evidence.strength !== 'weak'));
    if (hasIndependentStrongPair || versionCorroborated) candidate.confidence = 'high';
    else if (strongGroups.length > 0 || independentGroups.length >= 2) candidate.confidence = 'medium';
    else if (independentGroups.length > 0) candidate.confidence = 'low';

    const versionHints = candidate.versionEvidence || [];
    const versions = [...new Set(versionHints.map(hint => hint.version).filter(Boolean))];
    if (versions.length === 1) {
      candidate.version = versions[0];
    } else {
      // Never guess between conflicting explicit versions; keep the conflict
      // visible so a human can resolve which metadata source is authoritative.
      candidate.version = 'unknown';
      if (versions.length > 1) {
        candidate.versionConflict = versionHints
          .filter(hint => hint.version)
          .map(hint => ({ version: hint.version, path: hint.path, rule: hint.rule }))
          .sort((left, right) => (left.version < right.version ? -1 : left.version > right.version ? 1 : 0));
      }
    }
    delete candidate.versionEvidence;
    candidate.evidence.sort((left, right) => {
      const pathOrder = left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
      if (pathOrder !== 0) return pathOrder;
      return left.rule < right.rule ? -1 : left.rule > right.rule ? 1 : 0;
    });
    candidate.runtimes.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    candidate.containers.sort();
    candidate.platforms.sort();
    candidates.push(candidate);
  }
  return candidates.sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** Rank engine candidates from file signatures, paths, archive member names and bounded metadata. */
export function detectEngines({ files = [], archives = [], metadata = {} } = {}) {
  const candidates = new Map();
  const all = { engineHints: [], versionHints: [], runtimeHints: [], platformHints: [], ...metadata };

  addMetadataEvidence(candidates, all);

  // Unity: player/runtime binaries, Mono assemblies, IL2CPP metadata and data layout.
  addFileEvidence(candidates, 'unity', files,
    file => ['unityplayer.dll', 'unityframework'].includes(fileName(file)),
    'player-runtime', 'strong', 'unity-player-runtime', 'A Unity player runtime binary was found.');
  const gameAssembly = files.filter(file => ['gameassembly.dll', 'libil2cpp.so', 'libil2cpp.dylib'].includes(fileName(file)));
  for (const file of gameAssembly) {
    addEvidence(candidates, 'unity', { path: file.path, rule: 'unity-il2cpp-native-runtime', strength: 'strong', detail: 'An IL2CPP native runtime binary was found.', group: 'native-runtime' });
    addRuntime(candidates, 'unity', 'IL2CPP', 'unknown', file.path);
  }
  addFileEvidence(candidates, 'unity', files,
    file => fileName(file) === 'global-metadata.dat',
    'il2cpp-metadata', 'strong', 'unity-il2cpp-metadata', 'Unity IL2CPP global metadata was found.');
  const managedAssemblies = files.filter(file => /\/managed\/assembly-csharp\.dll$/i.test(`/${normalizePath(file.path)}`));
  for (const file of managedAssemblies) {
    addEvidence(candidates, 'unity', { path: file.path, rule: 'unity-managed-assembly', strength: 'strong', detail: 'Assembly-CSharp.dll was found under a Managed directory.', group: 'managed-assemblies' });
    addRuntime(candidates, 'unity', 'Mono', 'unknown', file.path);
  }
  addFileEvidence(candidates, 'unity', files,
    file => /(?:^|\/)[^/]+_data(?:\/|$)/i.test(normalizePath(file.path)),
    'player-data-layout', 'moderate', 'unity-data-directory', 'A Unity-style <Game>_Data directory was found.');
  addFileEvidence(candidates, 'unity', files,
    file => file.magic?.id === 'unityfs' || ['.assets', '.bundle'].includes(extension(file)),
    'unity-content', 'moderate', 'unity-content-container', 'A Unity asset bundle or serialized asset file was found.');
  for (const file of files) {
    if (file.magic?.id === 'unityfs' || ['.assets', '.bundle'].includes(extension(file))) addContainer(candidates, 'unity', 'AssetBundle/SerializedFile');
  }

  // Unreal: Pak/IoStore containers, engine build metadata and cooked project markers.
  const utocFiles = files.filter(file => extension(file) === '.utoc');
  const ucasFiles = files.filter(file => extension(file) === '.ucas');
  if (utocFiles.length && ucasFiles.length) {
    for (const file of [...utocFiles, ...ucasFiles]) {
      addEvidence(candidates, 'unreal', { path: file.path, rule: 'unreal-iostore-pair', strength: 'strong', detail: 'A matching IoStore .utoc/.ucas container pair was found.', group: 'iostore-container' });
    }
    addContainer(candidates, 'unreal', 'IoStore');
  } else {
    for (const file of [...utocFiles, ...ucasFiles]) {
      addEvidence(candidates, 'unreal', { path: file.path, rule: 'unreal-iostore-partial', strength: 'moderate', detail: 'An IoStore container member was found without its matching pair.', group: 'iostore-partial' });
    }
  }
  addFileEvidence(candidates, 'unreal', files,
    file => extension(file) === '.pak' || file.magic?.id === 'unreal-pak',
    'pak-container', 'moderate', 'unreal-pak-container', 'An Unreal-style .pak container candidate was found.');
  if (files.some(file => extension(file) === '.pak' || file.magic?.id === 'unreal-pak')) addContainer(candidates, 'unreal', 'Pak');
  addFileEvidence(candidates, 'unreal', files,
    file => /(?:^|\/)defaultgame\.ini$/i.test(normalizePath(file.path)),
    'project-config', 'moderate', 'unreal-default-game-config', 'DefaultGame.ini project configuration was found.');
  addFileEvidence(candidates, 'unreal', files,
    file => /(?:^|\/)engine\/binaries\//i.test(normalizePath(file.path))
      || /(?:ue4|ue5|unreal).*shipping\.exe$/i.test(fileName(file)),
    'engine-binary', 'strong', 'unreal-engine-binary', 'An Unreal Engine binary layout or Shipping executable was found.');

  // Godot: project file, PCK header, scripts and managed runtime.
  addFileEvidence(candidates, 'godot', files,
    file => fileName(file) === 'project.godot',
    'project-config', 'strong', 'godot-project-file', 'project.godot was found.');
  addFileEvidence(candidates, 'godot', files,
    file => file.magic?.id === 'godot-pck',
    'pck-container', 'strong', 'godot-pck-signature', 'A Godot PCK signature was found.');
  addFileEvidence(candidates, 'godot', files,
    file => fileName(file) === 'godotsharp' || /\/godotsharp\//i.test(`/${normalizePath(file.path)}`),
    'dotnet-runtime', 'strong', 'godot-csharp-runtime', 'GodotSharp managed runtime files were found.');
  addFileEvidence(candidates, 'godot', files,
    file => extension(file) === '.gdc',
    'gdscript-bytecode', 'moderate', 'godot-gdscript-bytecode', 'A compiled GDScript file was found.');
  addFileEvidence(candidates, 'godot', files,
    file => /^godot(?:\.|$)/i.test(fileName(file)) && ['.exe', '.x86_64', '.arm64'].includes(extension(file)),
    'engine-binary', 'strong', 'godot-runtime-binary', 'A Godot runtime executable was found.');
  for (const file of files) if (file.magic?.id === 'godot-pck') addContainer(candidates, 'godot', 'PCK');

  // RPG Maker: distinguish JavaScript generations from RGSS archives.
  addFileEvidence(candidates, 'rpg-maker-mv', files,
    file => fileName(file) === 'rpg_core.js' && /(?:^|\/)www\/js\//i.test(normalizePath(file.path)),
    'runtime-script', 'strong', 'rpg-maker-mv-core', 'RPG Maker MV rpg_core.js was found under www/js.');
  addFileEvidence(candidates, 'rpg-maker-mz', files,
    file => fileName(file) === 'rmmz_core.js',
    'runtime-script', 'strong', 'rpg-maker-mz-core', 'RPG Maker MZ rmmz_core.js was found.');
  addFileEvidence(candidates, 'rpg-maker-mv', files,
    file => /(?:^|\/)www\/data\/system\.json$/i.test(normalizePath(file.path)),
    'database-layout', 'moderate', 'rpg-maker-mv-database', 'RPG Maker MV data/System.json was found.');
  addFileEvidence(candidates, 'rpg-maker-mz', files,
    file => /(?:^|\/)data\/system\.json$/i.test(normalizePath(file.path)),
    'database-layout', 'moderate', 'rpg-maker-mz-database', 'RPG Maker MZ data/System.json was found.');
  addFileEvidence(candidates, 'rpg-maker-rgss', files,
    file => ['.rgssad', '.rgss2a', '.rgss3a', '.rgss1a'].includes(extension(file)) || file.magic?.id === 'rgss-archive',
    'rgss-archive', 'strong', 'rpg-maker-rgss-archive', 'An RGSS encrypted archive extension was found.');
  addFileEvidence(candidates, 'rpg-maker-rgss', files,
    file => /^scripts\.(?:rvdata2?|rxdata)$/i.test(fileName(file)),
    'rgss-database', 'moderate', 'rpg-maker-rgss-scripts', 'An RGSS Scripts database file was found.');
  addFileEvidence(candidates, 'rpg-maker-rgss', files,
    file => fileName(file) === 'game.ini',
    'rgss-project-config', 'weak', 'rpg-maker-rgss-game-ini', 'A Game.ini launcher configuration was found.');

  // GameMaker: compiled data files and source-project resource trees.
  addFileEvidence(candidates, 'gamemaker', files,
    file => ['data.win', 'game.unx'].includes(fileName(file)),
    'compiled-game-data', 'strong', 'gamemaker-compiled-data', 'A GameMaker data.win or game.unx file was found.');
  addFileEvidence(candidates, 'gamemaker', files,
    file => extension(file) === '.yy' && /\/(?:objects|rooms|scripts|sprites)\//i.test(`/${normalizePath(file.path)}`),
    'source-project', 'moderate', 'gamemaker-yy-project', 'A GameMaker .yy resource project file was found.');
  addFileEvidence(candidates, 'gamemaker', files,
    file => fileName(file) === 'options.ini',
    'project-options', 'weak', 'gamemaker-options-ini', 'A GameMaker-style options.ini file was found.');

  // Cocos Creator and cocos2d-x have different native/script fingerprints.
  addFileEvidence(candidates, 'cocos-creator', files,
    file => ['settings.js', 'settings.json'].includes(fileName(file)) && /(?:^|\/)src\//i.test(normalizePath(file.path)),
    'creator-settings', 'strong', 'cocos-creator-settings', 'Cocos Creator src/settings configuration was found.');
  addFileEvidence(candidates, 'cocos-creator', files,
    file => ['cocos2d-js.js', 'cc.js'].includes(fileName(file)),
    'creator-runtime', 'strong', 'cocos-creator-runtime', 'A Cocos Creator JavaScript runtime bundle was found.');
  addFileEvidence(candidates, 'cocos-creator', files,
    file => /(?:^|\/)assets\/(?:main|resources)\//i.test(normalizePath(file.path)),
    'creator-assets', 'moderate', 'cocos-creator-assets', 'A Cocos Creator exported asset bundle layout was found.');
  addFileEvidence(candidates, 'cocos2d-x', files,
    file => /cocos2d/i.test(fileName(file)) && ['.dll', '.so', '.dylib'].includes(extension(file)),
    'native-engine-library', 'strong', 'cocos2d-x-native-library', 'A cocos2d-x native engine library was found.');
  addFileEvidence(candidates, 'cocos2d-x', files,
    file => /(?:^|\/)classes\/appdelegate\.(?:cpp|h)$/i.test(normalizePath(file.path)),
    'native-project-source', 'moderate', 'cocos2d-x-appdelegate', 'A cocos2d-x AppDelegate source file was found.');

  // Ren’Py compiled script/runtime and RPA archive markers.
  addFileEvidence(candidates, 'renpy', files,
    file => /(?:^|\/)renpy\//i.test(`/${normalizePath(file.path)}`),
    'renpy-runtime', 'strong', 'renpy-runtime-directory', 'The Ren’Py runtime directory was found.');
  addFileEvidence(candidates, 'renpy', files,
    file => /(?:^|\/)game\/[^/]+\.rpyc$/i.test(normalizePath(file.path)),
    'renpy-script', 'strong', 'renpy-compiled-script', 'A compiled Ren’Py game script was found.');
  addFileEvidence(candidates, 'renpy', files,
    file => extension(file) === '.rpa' || file.magic?.id === 'rpa',
    'renpy-archive', 'moderate', 'renpy-rpa-archive', 'A Ren’Py RPA archive was found.');

  // Electron is a desktop wrapper; HTML/JS remains the underlying app/game layer.
  addFileEvidence(candidates, 'electron', files,
    file => fileName(file) === 'electron.exe' || fileName(file) === 'electron',
    'electron-runtime', 'strong', 'electron-runtime-binary', 'An Electron runtime executable was found.');
  addFileEvidence(candidates, 'electron', files,
    file => /(?:^|\/)resources\/(?:app|electron)\.asar$/i.test(normalizePath(file.path)),
    'electron-asar', 'moderate', 'electron-asar-container', 'An Electron ASAR application/runtime container was found.');
  if (files.some(file => /(?:^|\/)resources\/(?:app|electron)\.asar$/i.test(normalizePath(file.path)))) {
    addContainer(candidates, 'electron', 'ASAR');
  }
  addFileEvidence(candidates, 'web-html5', files,
    file => fileName(file) === 'index.html',
    'html-entry', 'moderate', 'web-html-entry', 'An HTML application entry point was found.');
  addFileEvidence(candidates, 'web-html5', files,
    file => ['.js', '.mjs'].includes(extension(file)) && /(?:^|\/)(?:assets|js|build|dist|renderer|chunks|resources\/app)\//i.test(normalizePath(file.path)),
    'script-bundle', 'moderate', 'web-script-bundle', 'A JavaScript application bundle was found.');
  const hasWebApplicationFiles = files.some(file => fileName(file) === 'index.html'
    || (['.js', '.mjs'].includes(extension(file)) && /(?:^|\/)(?:assets|js|build|dist|renderer|chunks|resources\/app)\//i.test(normalizePath(file.path))));
  if (hasWebApplicationFiles) {
    addFileEvidence(candidates, 'web-html5', files,
      file => file.magic?.id === 'wasm',
      'wasm-module', 'strong', 'webassembly-module', 'A WebAssembly module was found alongside a web application.');
  }
  if (files.some(file => file.magic?.id === 'wasm') && hasWebApplicationFiles) addContainer(candidates, 'web-html5', 'WebAssembly');

  // Source 1/2 resource families.
  for (const [resourceExtension, group] of [
    ['.vmap_c', 'source2-map-resource'],
    ['.vmdl_c', 'source2-model-resource'],
    ['.vtex_c', 'source2-texture-resource'],
    ['.vpcf_c', 'source2-particle-resource'],
    ['.vmat_c', 'source2-material-resource'],
  ]) {
    addFileEvidence(candidates, 'source2', files,
      file => extension(file) === resourceExtension,
      group, 'moderate', 'source2-compiled-resource', 'A Source 2 compiled resource was found.');
  }
  addFileEvidence(candidates, 'source', files,
    file => extension(file) === '.vpk' || file.magic?.id === 'vpk',
    'vpk-container', 'moderate', 'source-vpk-container', 'A Valve VPK archive candidate was found.');
  addFileEvidence(candidates, 'source', files,
    file => fileName(file) === 'gameinfo.txt',
    'source-gameinfo', 'moderate', 'source-gameinfo', 'A Source engine gameinfo.txt file was found.');
  addFileEvidence(candidates, 'source', files,
    file => extension(file) === '.bsp',
    'source-bsp-map', 'moderate', 'source-bsp-map', 'A Source-family BSP map file was found.');
  if (files.some(file => extension(file) === '.vpk' || file.magic?.id === 'vpk')) addContainer(candidates, 'source', 'VPK');
  if (files.some(file => ['.vmap_c', '.vmdl_c', '.vtex_c', '.vpcf_c', '.vmat_c'].includes(extension(file)))) addContainer(candidates, 'source2', 'CompiledResource');

  // Flash/AIR and Defold.
  addFileEvidence(candidates, 'flash-air', files,
    file => file.magic?.id === 'swf' || extension(file) === '.swf',
    'swf-movie', 'strong', 'flash-swf-movie', 'A Shockwave Flash SWF movie was found.');
  if (files.some(file => file.magic?.id === 'swf' || extension(file) === '.swf')) addContainer(candidates, 'flash-air', 'SWF');
  addArchiveEvidence(candidates, 'flash-air', archiveMemberMatches(
    archives,
    null,
    name => normalizePath(name).endsWith('meta-inf/air/application.xml'),
  ), 'air-application-descriptor', 'moderate', 'air-application-xml', 'An Adobe AIR application descriptor was found.');
  addFileEvidence(candidates, 'defold', files,
    file => fileName(file) === 'game.project',
    'defold-project', 'strong', 'defold-game-project', 'A Defold game.project file was found.');
  addFileEvidence(candidates, 'defold', files,
    file => ['.arcd', '.dmanifest'].includes(extension(file)),
    'defold-archive', 'moderate', 'defold-resource-container', 'A Defold resource archive or manifest was found.');
  if (files.some(file => ['.arcd', '.dmanifest'].includes(extension(file)))) addContainer(candidates, 'defold', 'Defold archive/manifest');
  addFileEvidence(candidates, 'defold', files,
    file => /^dmengine(?:\.|$)/i.test(fileName(file)),
    'defold-runtime', 'moderate', 'defold-engine-binary', 'A Defold runtime executable was found.');

  // LÖVE and libGDX/JVM can be identified from archive member names without extraction.
  addFileEvidence(candidates, 'love', files,
    file => extension(file) === '.love',
    'love-archive', 'moderate', 'love-archive-extension', 'A .love archive candidate was found.');
  const loveMain = archiveMemberMatches(archives,
    archive => normalizePath(archive.path).endsWith('.love'),
    name => normalizePath(name) === 'main.lua');
  const loveConfig = archiveMemberMatches(archives,
    archive => normalizePath(archive.path).endsWith('.love'),
    name => normalizePath(name) === 'conf.lua');
  addArchiveEvidence(candidates, 'love', loveMain, 'love-main-script', 'strong', 'love-main-script', 'A LÖVE main.lua entry was found.');
  addArchiveEvidence(candidates, 'love', loveConfig, 'love-config-script', 'strong', 'love-conf-script', 'A LÖVE conf.lua entry was found.');
  if (candidates.has('love') && (loveMain.length || files.some(file => extension(file) === '.love'))) {
    addContainer(candidates, 'love', '.love');
  }
  addFileEvidence(candidates, 'love', files,
    file => fileName(file) === 'love.exe' || fileName(file) === 'love.dll',
    'love-runtime', 'strong', 'love-runtime-binary', 'A LÖVE runtime binary was found.');
  // A bare main.lua/conf.lua pair only counts as LÖVE evidence when both live
  // in the same directory; unrelated Lua files elsewhere must not pair up.
  const lovePairedDirs = [];
  {
    const luaByDir = new Map();
    for (const file of files) {
      const name = fileName(file);
      if (name !== 'main.lua' && name !== 'conf.lua') continue;
      const normalized = normalizePath(file.path);
      const slash = normalized.lastIndexOf('/');
      const dir = slash >= 0 ? normalized.slice(0, slash) : '.';
      if (!luaByDir.has(dir)) luaByDir.set(dir, { main: null, conf: null });
      luaByDir.get(dir)[name === 'main.lua' ? 'main' : 'conf'] = file;
    }
    for (const [dir, pair] of luaByDir) {
      if (pair.main && pair.conf) lovePairedDirs.push({ dir, ...pair });
    }
  }
  lovePairedDirs.sort((left, right) => (left.dir < right.dir ? -1 : left.dir > right.dir ? 1 : 0));
  for (const pair of lovePairedDirs) {
    addEvidence(candidates, 'love', {
      path: pair.main.path,
      rule: 'love-main-script',
      strength: 'moderate',
      detail: 'A LÖVE main.lua project entry was found alongside conf.lua in the same directory.',
      group: 'love-project-pair',
    });
    addEvidence(candidates, 'love', {
      path: pair.conf.path,
      rule: 'love-conf-script',
      strength: 'moderate',
      detail: 'A LÖVE conf.lua configuration was found alongside main.lua in the same directory.',
      group: 'love-project-pair',
    });
  }

  const libgdxMembers = archiveMemberMatches(archives,
    archive => ['.jar', '.apk'].includes(normalizePath(archive.path).slice(-4)),
    name => normalizePath(name).startsWith('com/badlogic/gdx/'));
  addArchiveEvidence(candidates, 'libgdx', libgdxMembers, 'libgdx-package', 'strong', 'libgdx-package-namespace', 'The libGDX Java package namespace was found.');
  if (libgdxMembers.length) {
    for (const match of libgdxMembers) addRuntime(candidates, 'libgdx', 'Java/JVM', 'unknown', match.archive.path);
    addContainer(candidates, 'libgdx', 'JAR');
  }

  // Attach only runtimes supported by the candidate's concrete file evidence.
  if (candidates.has('godot')) {
    for (const file of files) {
      if (/\.gd$/i.test(file.path) || extension(file) === '.gdc') addRuntime(candidates, 'godot', 'GDScript', 'unknown', file.path);
      if (/\/godotsharp\//i.test(`/${normalizePath(file.path)}`)) addRuntime(candidates, 'godot', 'C#', 'unknown', file.path);
    }
    if (files.some(file => file.magic?.id === 'godot-pck')) addContainer(candidates, 'godot', 'PCK');
  }
  if (candidates.has('rpg-maker-mv')) addRuntime(candidates, 'rpg-maker-mv', 'JavaScript', 'unknown', firstFilePath(files, file => fileName(file) === 'rpg_core.js'));
  if (candidates.has('rpg-maker-mz')) addRuntime(candidates, 'rpg-maker-mz', 'JavaScript', 'unknown', firstFilePath(files, file => fileName(file) === 'rmmz_core.js'));
  if (candidates.has('rpg-maker-rgss')) {
    addRuntime(candidates, 'rpg-maker-rgss', 'Ruby / RGSS', 'unknown', firstFilePath(files, file => /^scripts\.(?:rvdata2?|rxdata)$/i.test(fileName(file))));
    if (files.some(file => ['.rgssad', '.rgss2a', '.rgss3a', '.rgss1a'].includes(extension(file)) || file.magic?.id === 'rgss-archive')) addContainer(candidates, 'rpg-maker-rgss', 'RGSS archive');
  }
  if (candidates.has('gamemaker')) {
    addRuntime(candidates, 'gamemaker', 'GML (VM/YYC backend unknown)', 'unknown', firstFilePath(files, file => ['data.win', 'game.unx'].includes(fileName(file))));
    if (files.some(file => ['data.win', 'game.unx'].includes(fileName(file)))) addContainer(candidates, 'gamemaker', 'Compiled game data');
  }
  if (candidates.has('cocos-creator')) addRuntime(candidates, 'cocos-creator', 'JavaScript / TypeScript', 'unknown', firstFilePath(files, file => ['settings.js', 'settings.json', 'cocos2d-js.js', 'cc.js'].includes(fileName(file))));
  if (candidates.has('cocos2d-x')) addRuntime(candidates, 'cocos2d-x', 'C++', 'unknown', firstFilePath(files, file => /cocos2d/i.test(fileName(file)) && ['.dll', '.so', '.dylib'].includes(extension(file)) || /(?:^|\/)classes\/appdelegate\.(?:cpp|h)$/i.test(normalizePath(file.path))));
  if (candidates.has('renpy')) {
    addRuntime(candidates, 'renpy', 'Python / Ren’Py script runtime', 'unknown', firstFilePath(files, file => /(?:^|\/)renpy\//i.test(`/${normalizePath(file.path)}`)
      || /(?:^|\/)game\/[^/]+\.rpyc$/i.test(normalizePath(file.path)) || extension(file) === '.rpa'));
    if (files.some(file => extension(file) === '.rpa' || file.magic?.id === 'rpa')) addContainer(candidates, 'renpy', 'RPA');
  }
  if (candidates.has('web-html5')) addRuntime(candidates, 'web-html5', 'JavaScript', 'unknown', firstFilePath(files, file => fileName(file) === 'index.html' || ['.js', '.mjs'].includes(extension(file))));
  if (candidates.has('electron')) addRuntime(candidates, 'electron', 'Node.js / Electron', 'unknown', firstFilePath(files, file => fileName(file) === 'electron.exe' || fileName(file) === 'electron'));
  if (candidates.has('flash-air')) addRuntime(candidates, 'flash-air', 'ActionScript (version unknown)', 'unknown', firstFilePath(files, file => file.magic?.id === 'swf' || extension(file) === '.swf'));
  if (candidates.has('defold') && files.some(file => ['.script', '.lua'].includes(extension(file)))) addRuntime(candidates, 'defold', 'Lua', 'unknown', firstFilePath(files, file => ['.script', '.lua'].includes(extension(file))));
  if (candidates.has('love')) addRuntime(candidates, 'love', 'Lua', 'unknown', loveMain[0]?.archive?.path
    ? `${loveMain[0].archive.path}!/${loveMain[0].name}`
    : firstFilePath(files, file => ['main.lua', 'conf.lua'].includes(fileName(file))));

  // Generic native/Java/WASM signatures are runtime/platform evidence only.
  for (const hint of all.runtimeHints || []) {
    if (hint.engineId && ENGINE_NAMES[hint.engineId]) addRuntime(candidates, hint.engineId, hint.name, hint.version || 'unknown', hint.path || '.');
  }
  inferPlatforms(candidates, files, all);

  return finalizeCandidates(candidates);
}
