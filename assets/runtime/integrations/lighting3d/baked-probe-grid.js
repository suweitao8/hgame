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
