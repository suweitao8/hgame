const SH_COEFFICIENTS = 9;
const SH_VALUES = SH_COEFFICIENTS * 3;
const ATLAS_VOLUMES = Math.ceil(SH_VALUES / 4);
const MAX_HALF_FLOAT = 65504;

/**
 * @typedef {object} BakedIrradianceProbeData
 * @property {1} schemaVersion Probe asset format version.
 * @property {readonly number[]} min Minimum world-space corner of the grid.
 * @property {readonly number[]} max Maximum world-space corner of the grid.
 * @property {readonly number[]} resolution Probe counts on X, Y and Z. Probes are at cell centers.
 * @property {ArrayLike<number>} coefficients Linear SH L2, 9 RGB coefficients per probe. X changes fastest, then Y, then Z.
 * @property {number} [intensity=1] Scale baked irradiance and its coverage of screen-space diffuse GI.
 */

function validBoundsAxis(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
  const low = Math.fround(min);
  const high = Math.fround(max);
  const extent = Math.fround(high - low);
  return Number.isFinite(extent) && Math.fround(extent / count) > 0;
}

function validateGrid(data) {
  if (data?.schemaVersion !== 1) throw new TypeError('Irradiance grid schemaVersion must be 1');
  const { min, max, resolution, coefficients, intensity = 1 } = data;
  if (!Array.isArray(resolution) || resolution.length !== 3 ||
      ![0, 1, 2].every(axis => Number.isSafeInteger(resolution[axis]) && resolution[axis] >= 1)) {
    throw new RangeError('Irradiance grid resolution needs three positive integer counts');
  }
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3 ||
      !resolution.every((count, axis) => validBoundsAxis(min[axis], max[axis], count))) {
    throw new RangeError('Irradiance grid bounds must contain three finite increasing axes');
  }
  const count = resolution[0] * resolution[1] * resolution[2] * SH_VALUES;
  if (!Number.isSafeInteger(count) || coefficients?.length !== count) {
    throw new RangeError('Irradiance grid coefficients must have 27 values per probe');
  }
  if (!Number.isFinite(intensity) || intensity < 0) throw new RangeError('Irradiance grid intensity must be finite and non-negative');
}

/** Check the same visibility conditions as the scene-light draw. */
export function getVisibleBakedProbeGrid(grid, world, camera) {
  if (!grid?.texture || !grid.layers.test(camera.layers)) return null;
  for (let object = grid; object && object.visible; object = object.parent) {
    if (object === world) return grid;
  }
  return null;
}

/** Pack a versioned SH L2 asset for the native Three.js WebGL scene-light path. */
export function createBakedProbeGrid(THREE, renderer, /** @type {BakedIrradianceProbeData} */ data) {
  validateGrid(data);
  const { min, max, resolution, coefficients, intensity = 1 } = data;
  const [width, height, slices] = resolution;
  const padded = slices + 2;
  const depth = ATLAS_VOLUMES * padded;
  const context = renderer.getContext?.();
  const limit = context?.MAX_3D_TEXTURE_SIZE ? context.getParameter(context.MAX_3D_TEXTURE_SIZE) : 0;
  const shader = THREE.ShaderChunk?.lightprobes_pars_fragment;
  if (!renderer.capabilities?.isWebGL2 || !THREE.Data3DTexture || !THREE.DataUtils?.toHalfFloat || !THREE.Light ||
      !THREE.Box3 || !THREE.Vector3 || typeof shader !== 'string' || !shader.includes('getLightProbeGridIrradiance') ||
      !shader.includes('paddedSlices') ||
      !(limit >= Math.max(width, height, depth))) return null;

  const texelsPerSlice = width * height;
  const sliceValues = texelsPerSlice * 4;
  const packed = new Uint16Array(sliceValues * depth);
  for (let z = 0; z < slices; z++) {
    for (let cell = 0; cell < texelsPerSlice; cell++) {
      const probeOffset = (z * texelsPerSlice + cell) * SH_VALUES;
      for (let i = 0; i < SH_VALUES; i++) {
        const coefficient = coefficients[probeOffset + i];
        const scaled = coefficient * intensity;
        if (!Number.isFinite(coefficient) || !Number.isFinite(scaled) || Math.abs(scaled) > MAX_HALF_FLOAT) {
          throw new RangeError('Irradiance grid coefficients must be finite and fit in the half-float atlas');
        }
        const targetSlice = (i >> 2) * padded + z + 1;
        packed[targetSlice * sliceValues + cell * 4 + (i & 3)] = THREE.DataUtils.toHalfFloat(scaled);
      }
    }
  }
  // The native shader filters within each subvolume. Copy edge slices so they cannot bleed into adjacent bands.
  for (let band = 0; band < ATLAS_VOLUMES; band++) {
    const first = band * padded * sliceValues;
    const last = first + slices * sliceValues;
    packed.copyWithin(first, first + sliceValues, first + 2 * sliceValues);
    packed.copyWithin(last + sliceValues, last, last + sliceValues);
  }

  const texture = new THREE.Data3DTexture(packed, width, height, depth);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.HalfFloatType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const light = new THREE.Light();
  light.isLightProbeGrid = true;
  light.priority = 0;
  light.texture = texture;
  light.boundingBox = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
  light.resolution = new THREE.Vector3(width, height, slices);
  light.diffuseWeight = Math.min(1, intensity);
  return light;
}

/**
 * @typedef {object} StreamedProbeManagerOptions
 * @property {number} [maxCells=16] Maximum simultaneously resident probe cells.
 * @property {number} [maxBytes=16777216] Maximum SH 3D texture byte budget across resident cells.
 * @property {number} [blendMargin=4] Smooth spatial blend margin outside cell bounds (world units).
 * @property {number} [transitionSeconds=0.5] Temporal fade-in duration when a probe cell attaches.
 * @property {object | null} [scene=null] Optional Three.js scene/world that hosts attached probe lights.
 */

function readPositionTuple(pos) {
  if (Array.isArray(pos) || ArrayBuffer.isView(pos)) {
    return [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0];
  }
  if (pos && typeof pos === 'object') {
    return [Number(pos.x) || 0, Number(pos.y) || 0, Number(pos.z) || 0];
  }
  return [0, 0, 0];
}

function boxExteriorDistance(box, px, py, pz) {
  const minX = box?.min?.x ?? 0, minY = box?.min?.y ?? 0, minZ = box?.min?.z ?? 0;
  const maxX = box?.max?.x ?? 0, maxY = box?.max?.y ?? 0, maxZ = box?.max?.z ?? 0;
  const dx = px < minX ? minX - px : (px > maxX ? px - maxX : 0);
  const dy = py < minY ? minY - py : (py > maxY ? py - maxY : 0);
  const dz = pz < minZ ? minZ - pz : (pz > maxZ ? pz - maxZ : 0);
  return Math.hypot(dx, dy, dz);
}

/**
 * Multi-cell streamed 3D baked irradiance probe volume manager with LRU residency eviction,
 * GPU texture cleanup, and smooth spatial + temporal cross-cell transition blending.
 *
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object | null} [renderer=null] WebGLRenderer-compatible object for capability validation.
 * @param {StreamedProbeManagerOptions} [options]
 */
export function createStreamedProbeVolumeManager3D(THREE, renderer = null, options = {}) {
  if (!THREE || typeof THREE !== 'object') {
    throw new TypeError('createStreamedProbeVolumeManager3D requires a THREE namespace');
  }
  const maxCells = Math.max(1, Math.floor(options.maxCells ?? 16));
  const maxBytes = Math.max(0, Number(options.maxBytes ?? 16 * 1024 * 1024));
  const blendMargin = Math.max(0, Number(options.blendMargin ?? 4));
  const transitionSeconds = Math.max(0, Number(options.transitionSeconds ?? 0.5));
  const hostScene = options.scene ?? null;

  const entries = new Map();
  let totalBytes = 0;
  let tick = 0;
  let disposed = false;
  let lastEvictionReason = null;
  const evictions = [];

  function disposeEntry(entry) {
    entry.light.removeFromParent?.();
    const tex = entry.texture ?? entry.light.texture;
    entry.light.texture = null;
    entry.texture = null;
    tex?.dispose?.();
  }

  function evictOne(excludeKey, reason) {
    let oldest = null;
    for (const candidate of entries.values()) {
      if (candidate.key === excludeKey) continue;
      if (!oldest || candidate.lastUsedTick < oldest.lastUsedTick) oldest = candidate;
    }
    if (!oldest) return null;
    entries.delete(oldest.key);
    totalBytes = Math.max(0, totalBytes - oldest.bytes);
    disposeEntry(oldest);
    const record = { key: oldest.key, bytes: oldest.bytes, reason, tick };
    lastEvictionReason = reason;
    evictions.push(record);
    if (evictions.length > 64) evictions.shift();
    return record;
  }

  function enforceBudget(excludeKey = null) {
    const removed = [];
    while (entries.size > maxCells) {
      const ev = evictOne(excludeKey, 'cell-budget');
      if (!ev) break;
      removed.push(ev);
    }
    while (totalBytes > maxBytes && entries.size > (excludeKey && entries.has(excludeKey) ? 1 : 0)) {
      const ev = evictOne(excludeKey, 'byte-budget');
      if (!ev) break;
      removed.push(ev);
    }
    return removed;
  }

  function detachCell(cellKey) {
    const key = String(cellKey);
    const existing = entries.get(key);
    if (!existing) return false;
    entries.delete(key);
    totalBytes = Math.max(0, totalBytes - existing.bytes);
    disposeEntry(existing);
    return true;
  }

  function attachCell(cellKey, data) {
    if (disposed || data == null) return { key: String(cellKey), active: false, evicted: [] };
    const key = String(cellKey);
    const light = createBakedProbeGrid(THREE, renderer, data);
    if (!light) return { key, active: false, evicted: [] };

    if (entries.has(key)) detachCell(key);

    const bytes = light.texture?.image?.data?.byteLength ?? 0;
    const entry = {
      key,
      light,
      texture: light.texture,
      bytes,
      baseIntensity: Math.max(0, Math.min(1, Number(data.intensity ?? 1))),
      fade: transitionSeconds <= 0 ? 1 : 0,
      spatialWeight: 0,
      weight: 0,
      lastUsedTick: ++tick,
    };
    light.diffuseWeight = entry.fade * entry.baseIntensity;

    try {
      hostScene?.add?.(light);
    } catch (error) {
      disposeEntry(entry);
      throw error;
    }

    entries.set(key, entry);
    totalBytes += bytes;
    const evicted = enforceBudget(key);
    return { key, active: true, bytes, evicted };
  }

  function touchCell(cellKey) {
    const entry = entries.get(String(cellKey));
    if (!entry) return false;
    entry.lastUsedTick = ++tick;
    return true;
  }

  function evaluateAt(position = [0, 0, 0], dt = 0) {
    const [px, py, pz] = readPositionTuple(position);
    const safeDt = Math.max(0, Number(dt) || 0);
    const stepTick = ++tick;
    let sumSpatial = 0;
    const active = [];

    for (const entry of entries.values()) {
      const dOut = boxExteriorDistance(entry.light.boundingBox, px, py, pz);
      let spatial = 0;
      if (dOut <= 0) {
        spatial = 1;
      } else if (blendMargin > 0 && dOut < blendMargin) {
        const t = 1 - dOut / blendMargin;
        spatial = t * t * (3 - 2 * t);
      }
      entry.spatialWeight = spatial;
      sumSpatial += spatial;
      if (transitionSeconds <= 0) {
        entry.fade = 1;
      } else if (spatial > 0 && entry.fade < 1) {
        entry.fade = Math.min(1, entry.fade + safeDt / transitionSeconds);
      } else if (spatial === 0 && safeDt > 0 && entry.fade === 0) {
        entry.fade = 0;
      }
      if (spatial > 0) entry.lastUsedTick = stepTick;
    }

    const norm = sumSpatial > 1 ? 1 / sumSpatial : 1;
    let totalWeight = 0;
    for (const entry of entries.values()) {
      const w = entry.spatialWeight * norm * entry.fade;
      entry.weight = w;
      entry.light.diffuseWeight = Math.min(1, entry.baseIntensity * w);
      totalWeight += w;
      if (entry.spatialWeight > 0) {
        active.push({
          key: entry.key,
          weight: w,
          spatialWeight: entry.spatialWeight,
          fade: entry.fade,
          light: entry.light,
        });
      }
    }
    active.sort((a, b) => b.weight - a.weight);
    return { position: [px, py, pz], active, totalWeight };
  }

  function getCell(cellKey) {
    const entry = entries.get(String(cellKey));
    if (!entry) return null;
    return {
      key: entry.key,
      bytes: entry.bytes,
      weight: entry.weight,
      spatialWeight: entry.spatialWeight,
      fade: entry.fade,
      lastUsedTick: entry.lastUsedTick,
      light: entry.light,
    };
  }

  function getStats() {
    return {
      cellCount: entries.size,
      totalBytes,
      maxCells,
      maxBytes,
      evictedCount: evictions.length,
      lastEvictionReason,
      evictions: evictions.slice(),
    };
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    for (const key of [...entries.keys()]) detachCell(key);
    return true;
  }

  return {
    attachCell,
    detachCell,
    touchCell,
    evaluateAt,
    getCell,
    getStats,
    dispose,
  };
}
