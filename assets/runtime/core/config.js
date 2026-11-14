/**
 * HGame project recipes.
 *
 * A Unity-inspired module *selection* contract, not a Unity file format.
 * No renderer or physics engine is imported by this module.
 */
/**
 * @typedef {'2d' | '3d' | 'ui'} ProjectProfile
 * @typedef {'canvas2d' | 'webgl2d' | 'threejs' | 'dom'} ProjectRenderer
 * @typedef {'none' | 'rapier2d' | 'rapier3d'} PhysicsBackend
 * @typedef {'scene' | 'input' | 'assets' | 'audio' | 'save' | 'diagnostics' | 'physics2d' | 'animation2d' | 'tilemap2d' | 'pathfinding2d' | 'physics3d' | 'model3d' | 'adaptiveQuality3d'} FeatureName
 */

/**
 * @typedef {object} ProjectOptions Project recipe accepted by {@link defineProject}.
 * @property {1} [configVersion=1] Only version 1 exists.
 * @property {ProjectProfile} [profile='2d']
 * @property {ProjectRenderer} [renderer] Default depends on profile (`canvas2d` / `threejs` / `dom`).
 * @property {PhysicsBackend} [physics='none'] Deterministic backend; must match the physics feature.
 * @property {number} [tickHz] Fixed ticks per second, integer 1..240 (`0` only for the `ui` profile, default 60 / 0).
 * @property {readonly FeatureName[]} [features] Optional modules to load (default `['scene','input']`, `['scene']` for ui).
 */

/**
 * @typedef {object} ProjectConfig Normalized, frozen project configuration.
 * @property {1} configVersion
 * @property {ProjectProfile} profile
 * @property {ProjectRenderer} renderer
 * @property {PhysicsBackend} physics
 * @property {number} tickHz Fixed ticks per second (0 = no fixed loop).
 * @property {readonly FeatureName[]} features De-duplicated feature list.
 */

/**
 * @typedef {Readonly<Record<string, { depends?: readonly string[] }>>} FeatureCatalog
 *   Feature name -> dependency declaration used by {@link resolveFeatureGraph}.
 */
const BASE = {
  '2d': { renderer: 'canvas2d', physics: 'none', tickHz: 60, features: ['scene', 'input'] },
  '3d': { renderer: 'threejs', physics: 'none', tickHz: 60, features: ['scene', 'input'] },
  'ui': { renderer: 'dom', physics: 'none', tickHz: 0, features: ['scene'] },
};

/** Suggest the closest valid name for typos so an agent can self-correct from the message alone. */
/** @param {unknown} input @param {Iterable<string>} candidates @returns {string} */
function closestHint(input, candidates) {
  const word = String(input).toLowerCase();
  let best = null, bestScore = Infinity;
  for (const c of candidates) {
    const a = word, b = String(c).toLowerCase();
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    if (row[b.length] < bestScore) { bestScore = row[b.length]; best = c; }
  }
  return best !== null && bestScore <= Math.max(2, Math.floor(word.length / 3)) ? ` Did you mean "${best}"?` : '';
}
/** @type {readonly ProjectProfile[]} */
export const PROJECT_PROFILES = Object.freeze(Object.keys(BASE));
/** @type {readonly ('rapier2d' | 'rapier3d')[]} */
export const DETERMINISTIC_PHYSICS_BACKENDS = Object.freeze(['rapier2d', 'rapier3d']);
/** @type {readonly FeatureName[]} */
export const OPTIONAL_FEATURES = Object.freeze([
  'scene', 'input', 'assets', 'audio', 'save', 'diagnostics', 'physics2d',
  'animation2d', 'tilemap2d', 'pathfinding2d', 'physics3d', 'model3d',
  'adaptiveQuality3d',
]);

/**
 * Validate a project recipe and return the normalized, frozen config.
 * Throws on unknown fields, incompatible renderer/physics/feature combinations.
 * @param {ProjectOptions} [options]
 * @returns {Readonly<ProjectConfig>}
 */
export function defineProject(options = {}) {
  if (!options || Array.isArray(options) || typeof options !== 'object') throw new TypeError('Project must be an object');
  const validFields = new Set(['configVersion', 'profile', 'renderer', 'physics', 'tickHz', 'features']);
  for (const key of Object.keys(options)) {
    if (!validFields.has(key)) throw new Error('Unknown engine config field: ' + key + '. Valid fields: ' + [...validFields].join(', ') + closestHint(key, validFields));
  }
  if (options.configVersion !== undefined && options.configVersion !== 1) {
    throw new Error('Unsupported engine configuration version: ' + options.configVersion);
  }
  const profile = options.profile ?? '2d';
  const defaults = BASE[profile];
  if (!defaults) throw new Error('Unknown game profile: ' + profile + '. Use one of: ' + PROJECT_PROFILES.join(', '));
  const renderer = options.renderer ?? defaults.renderer;
  const allowedRenderers = { '2d': ['canvas2d', 'webgl2d'], '3d': ['threejs'], ui: ['dom'] }[profile];
  if (!allowedRenderers.includes(renderer)) {
    throw new Error('Renderer ' + renderer + ' is incompatible with ' + profile + ' profile');
  }
  const physics = options.physics ?? defaults.physics;
  const allowedPhysics = { '2d': ['none', 'rapier2d'], '3d': ['none', 'rapier3d'], ui: ['none'] }[profile];
  if (!allowedPhysics.includes(physics)) throw new Error('Physics ' + physics + ' is incompatible with ' + profile + ' profile. Allowed: ' + allowedPhysics.join(', '));
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
    if (!OPTIONAL_FEATURES.includes(feature)) throw new Error('Unknown feature: ' + feature + '. Valid features: ' + OPTIONAL_FEATURES.join(', ') + closestHint(feature, OPTIONAL_FEATURES));
    if ((profile !== '2d' && ['physics2d', 'animation2d', 'tilemap2d', 'pathfinding2d'].includes(feature)) ||
        (profile !== '3d' && ['physics3d', 'model3d', 'adaptiveQuality3d'].includes(feature))) {
      throw new Error('Feature ' + feature + ' cannot run in profile ' + profile + '. Remove it from eatures or choose a profile that supports it.');
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
/**
 * @param {readonly string[]} requested Feature names.
 * @param {FeatureCatalog} catalog
 * @returns {string[]} Dependencies-first order.
 */
export function resolveFeatureGraph(requested, catalog) {
  if (!Array.isArray(requested) || !catalog || typeof catalog !== 'object') {
    throw new TypeError('Feature graph needs requested array and catalog');
  }
  /** @type {string[]} */
  const result = [], state = new Map();
  function visit(name) {
    if (!Object.hasOwn(catalog, name)) throw new Error('Unknown feature: ' + name + (Object.keys(catalog).length ? '. Known: ' + Object.keys(catalog).join(', ') : ''));
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
