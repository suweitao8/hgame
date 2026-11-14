/**
 * HGame project recipes.
 *
 * A Unity-inspired module *selection* contract, not a Unity file format.
 * No renderer or physics engine is imported by this module.
 */
const BASE = {
  '2d': { renderer: 'canvas2d', physics: 'none', tickHz: 60, features: ['scene', 'input'] },
  '3d': { renderer: 'threejs', physics: 'none', tickHz: 60, features: ['scene', 'input'] },
  'ui': { renderer: 'dom', physics: 'none', tickHz: 0, features: ['scene'] },
};

export const PROJECT_PROFILES = Object.freeze(Object.keys(BASE));
export const DETERMINISTIC_PHYSICS_BACKENDS = Object.freeze(['rapier2d', 'rapier3d']);
export const OPTIONAL_FEATURES = Object.freeze([
  'scene', 'input', 'assets', 'audio', 'save', 'diagnostics', 'physics2d',
  'animation2d', 'tilemap2d', 'pathfinding2d', 'physics3d', 'model3d',
  'adaptiveQuality3d',
]);

export function defineProject(options = {}) {
  if (!options || Array.isArray(options) || typeof options !== 'object') throw new TypeError('Project must be an object');
  const validFields = new Set(['configVersion', 'profile', 'renderer', 'physics', 'tickHz', 'features']);
  for (const key of Object.keys(options)) {
    if (!validFields.has(key)) throw new Error('Unknown engine config field: ' + key);
  }
  if (options.configVersion !== undefined && options.configVersion !== 1) {
    throw new Error('Unsupported engine configuration version: ' + options.configVersion);
  }
  const profile = options.profile ?? '2d';
  const defaults = BASE[profile];
  if (!defaults) throw new Error('Unknown game profile: ' + profile);
  const renderer = options.renderer ?? defaults.renderer;
  const allowedRenderers = { '2d': ['canvas2d', 'webgl2d'], '3d': ['threejs'], ui: ['dom'] }[profile];
  if (!allowedRenderers.includes(renderer)) {
    throw new Error('Renderer ' + renderer + ' is incompatible with ' + profile + ' profile');
  }
  const physics = options.physics ?? defaults.physics;
  const allowedPhysics = { '2d': ['none', 'rapier2d'], '3d': ['none', 'rapier3d'], ui: ['none'] }[profile];
  if (!allowedPhysics.includes(physics)) throw new Error('Physics ' + physics + ' is incompatible with ' + profile + ' profile');
  const tickHz = options.tickHz ?? defaults.tickHz;
  if (!Number.isInteger(tickHz) || tickHz < 0 || tickHz > 240 ||
      (profile === 'ui' && tickHz !== 0) ||
      (profile !== 'ui' && tickHz < 1)) {
    throw new RangeError('Invalid tickHz for ' + profile + ' profile');
  }
  const features = options.features ?? defaults.features;
  if (!Array.isArray(features)) throw new TypeError('features must be an array');
  const unique = [...new Set(features)];
  for (const feature of unique) {
    if (!OPTIONAL_FEATURES.includes(feature)) throw new Error('Unknown feature: ' + feature);
    if ((profile !== '2d' && ['physics2d', 'animation2d', 'tilemap2d', 'pathfinding2d'].includes(feature)) ||
        (profile !== '3d' && ['physics3d', 'model3d', 'adaptiveQuality3d'].includes(feature))) {
      throw new Error('Feature ' + feature + ' cannot run in profile ' + profile);
    }
  }
  if (physics === 'rapier2d' && !unique.includes('physics2d')) throw new Error('rapier2d requires the physics2d feature');
  if (physics === 'rapier3d' && !unique.includes('physics3d')) throw new Error('rapier3d requires the physics3d feature');
  if (unique.includes('physics2d') && physics !== 'rapier2d') throw new Error('physics2d feature requires the rapier2d backend');
  if (unique.includes('physics3d') && physics !== 'rapier3d') throw new Error('physics3d feature requires the rapier3d backend');
  return Object.freeze({
    configVersion: 1, profile, renderer, physics, tickHz,
    features: Object.freeze(unique),
  });
}

/** Topological ordering of only the explicitly requested features + dependencies. */
export function resolveFeatureGraph(requested, catalog) {
  if (!Array.isArray(requested) || !catalog || typeof catalog !== 'object') {
    throw new TypeError('Feature graph needs requested array and catalog');
  }
  const result = [], state = new Map();
  function visit(name) {
    if (!Object.hasOwn(catalog, name)) throw new Error('Unknown feature: ' + name);
    if (state.get(name) === 1) throw new Error('Feature dependency cycle at ' + name);
    if (state.get(name) === 2) return;
    state.set(name, 1);
    for (const dep of catalog[name].depends ?? []) visit(dep);
    state.set(name, 2);
    result.push(name);
  }
  for (const name of requested) visit(name);
  return result;
}
