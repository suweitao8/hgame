// Shared by project creation, API recipes and the standalone release packager.
export const RENDERERS = Object.freeze({
  canvas2d: { module: 'integrations/canvas2d.js', catalog: 'canvas2d' },
  webgl2d: { module: 'integrations/webgl2d.js', catalog: 'webgl-custom' },
  threejs: { module: 'integrations/three.js', catalog: 'threejs' },
  dom: { module: 'integrations/dom.js', catalog: 'dom' },
});

export const PROJECT_PRESETS = Object.freeze({
  '2d': { profile: '2d', renderer: 'canvas2d', title: '2D Action', features: ['audio', 'save'], exampleBare: true },
  horde: { profile: '2d', renderer: 'webgl2d', title: 'Horde', features: ['audio', 'save'], starter: 'horde', exampleBare: true },
  '3d': { profile: '3d', renderer: 'threejs', title: '3D Action', features: ['assets', 'audio', 'save'],
    physics: 'rapier3d', quality: 'auto', exampleBare: true },
  ui: { profile: 'ui', renderer: 'dom', title: 'Card / UI', features: ['audio', 'save'] },
});

export const PROFILE_FILES = Object.freeze({
  '2d': { html: null, demoData: [] },
  '3d': { html: '3d/index.html', demoData: ['level.json', 'materials.json', 'model-slots.json'] },
  ui: { html: 'ui/index.html', demoData: [] },
  horde: { html: null, demoData: ['swarm.json'] },
});

export const THREE_FILES = Object.freeze([
  'three.module.js', 'three.core.js', 'LICENSE', 'jsm/loaders/GLTFLoader.js',
  'jsm/utils/BufferGeometryUtils.js', 'jsm/utils/SkeletonUtils.js',
]);

const FEATURE_MODULES = {
  animation2d: ['animation/player.js', 'animation/spritesheet.js'],
  tilemap2d: ['world/tilemap.js'],
  pathfinding2d: ['world/tilemap.js'],
  physics2d: ['physics/rapier2d.js'],
  physics3d: ['physics/rapier3d.js'],
};

export function getProjectPreset(name) {
  if (!Object.hasOwn(PROJECT_PRESETS, name)) throw new Error('Unknown project preset: ' + name + '. Use ' + Object.keys(PROJECT_PRESETS).join(', '));
  return PROJECT_PRESETS[name];
}

export function recipeCreateCommand(name) {
  const preset = getProjectPreset(name);
  return `node scripts/create-game.mjs "<dir>" --preset ${name}${preset.exampleBare ? ' --bare' : ''} --name ${JSON.stringify(preset.title)}`;
}

/** Runtime modules that can load through configured or evaluated paths. */
export function runtimeSeeds(project) {
  const renderer = RENDERERS[project.renderer];
  return [...new Set([renderer?.module, ...project.features.flatMap(feature => FEATURE_MODULES[feature] ?? [])].filter(Boolean))];
}

/** Read packaging metadata independently of runtime engine and WebAsset configurations. */
export function normalizeReleaseProfile(input) {
  if (input === undefined) return { runtime: 'compat', includeRuntime: [], includeSource: [], assetMode: 'all' };
  if (!input || input.schemaVersion !== 1 || !['entry-graph', 'compat'].includes(input.runtime)) {
    throw new Error('hgame.project.json requires schemaVersion 1 and runtime entry-graph or compat');
  }
  if (input.preset !== undefined) getProjectPreset(input.preset);
  const assetMode = input.assetMode ?? 'all';
  if (assetMode !== 'all' && assetMode !== 'catalog') throw new Error('assetMode must be all or catalog');
  function explicitModules(field, base) {
    const entries = input[field] ?? [];
    if (!Array.isArray(entries)) throw new TypeError(field + ' must be an array of module paths');
    for (const entry of entries) {
      if (typeof entry !== 'string' || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.m?js$/.test(entry)) {
        throw new TypeError(field + ' expects paths relative to ' + base + ': ' + entry);
      }
    }
    return [...new Set(entries)];
  }
  return { runtime: input.runtime, includeRuntime: explicitModules('includeRuntime', 'vendor/hgame'), includeSource: explicitModules('includeSource', 'src'), assetMode };
}
