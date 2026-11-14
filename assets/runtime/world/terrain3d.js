/**
 * Deterministic 3D procedural heightfield terrain with slope/elevation biome vertex colors,
 * Three.js mesh synthesis, Rapier3D heightfield physics attachment, and prop scatter helpers.
 * Renderer- and physics-neutral at import time (no static Three.js or Rapier WASM imports).
 * @module world/terrain3d
 */

import { createSeededRng } from '../sim/rng.js';

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function hash2D(ix, iz, seed) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2D(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);
  const n00 = hash2D(ix, iz, seed);
  const n10 = hash2D(ix + 1, iz, seed);
  const n01 = hash2D(ix, iz + 1, seed);
  const n11 = hash2D(ix + 1, iz + 1, seed);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 2 - 1;
}

function hexToRgb01(color) {
  if (Array.isArray(color) && color.length >= 3) {
    return [Number(color[0]) || 0, Number(color[1]) || 0, Number(color[2]) || 0];
  }
  const n = typeof color === 'number' ? color : Number.parseInt(String(color).replace('#', ''), 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mixRgb(out, offset, a, b, t) {
  const u = clamp(t, 0, 1);
  out[offset] = a[0] + (b[0] - a[0]) * u;
  out[offset + 1] = a[1] + (b[1] - a[1]) * u;
  out[offset + 2] = a[2] + (b[2] - a[2]) * u;
}

/**
 * Compute deterministic 2D fractal Brownian motion (plus optional ridged noise) in [-1, 1].
 * @param {number} x World X coordinate.
 * @param {number} z World Z coordinate.
 * @param {object} [options]
 * @param {number} [options.seed=1337]
 * @param {number} [options.octaves=4]
 * @param {number} [options.frequency=0.025]
 * @param {number} [options.lacunarity=2.05]
 * @param {number} [options.gain=0.5]
 * @param {number} [options.ridgeWeight=0.22]
 * @returns {number}
 */
export function fbmNoise2D(x, z, options = {}) {
  const seed = (options.seed ?? 1337) | 0;
  const octaves = Math.max(1, Math.min(8, Math.floor(options.octaves ?? 4)));
  let freq = Number.isFinite(options.frequency) ? options.frequency : 0.025;
  const lacunarity = Number.isFinite(options.lacunarity) ? options.lacunarity : 2.05;
  const gain = Number.isFinite(options.gain) ? options.gain : 0.5;
  const ridgeWeight = clamp(options.ridgeWeight ?? 0.22, 0, 1);

  let amp = 1;
  let norm = 0;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise2D(x * freq, z * freq, seed + i * 101);
    const ridge = (1 - Math.abs(n)) * 2 - 1;
    sum += lerp(n, ridge, ridgeWeight) * amp;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * @typedef {object} Terrain3DOptions
 * @property {number} [width=120] Terrain extent along X in world units.
 * @property {number} [depth=120] Terrain extent along Z in world units.
 * @property {number} [segmentsX=64] Grid columns along X.
 * @property {number} [segmentsZ=64] Grid rows along Z.
 * @property {number} [minHeight=-2] Lower height bound.
 * @property {number} [maxHeight=18] Upper height bound.
 * @property {number} [seaLevel=0] Sea/sand transition height.
 * @property {number} [centerX=0] World X center.
 * @property {number} [centerZ=0] World Z center.
 * @property {number} [seed=1337] Deterministic noise seed.
 * @property {number} [octaves=4] FBM octaves.
 * @property {number} [frequency=0.024] Base noise frequency.
 * @property {number} [lacunarity=2.05] FBM frequency multiplier.
 * @property {number} [gain=0.5] FBM amplitude multiplier.
 * @property {number} [ridgeWeight=0.22] Ridged blend weight (0..1).
 * @property {'none'|'island'|'bowl'} [edgeFalloff='none'] Optional radial edge shaping.
 * @property {number} [edgeStrength=0.85] Radial shaping intensity when edgeFalloff != 'none'.
 * @property {(x: number, z: number, baseHeight: number) => number} [heightFn] Optional custom height modifier.
 * @property {object} [palette] Biome hex/RGB colors (`sand`, `grass`, `rock`, `peak`).
 */

/**
 * Create a deterministic 3D heightfield terrain with exact mesh/physics height parity.
 * @param {Terrain3DOptions} [options]
 */
export function createHeightfieldTerrain3D(options = {}) {
  const width = Math.max(2, Number(options.width ?? 120));
  const depth = Math.max(2, Number(options.depth ?? 120));
  const segmentsX = Math.max(1, Math.floor(options.segmentsX ?? 64));
  const segmentsZ = Math.max(1, Math.floor(options.segmentsZ ?? 64));
  const minHeight = Number.isFinite(options.minHeight) ? options.minHeight : -2;
  const maxHeight = Number.isFinite(options.maxHeight) ? options.maxHeight : 18;
  const seaLevel = Number.isFinite(options.seaLevel) ? options.seaLevel : 0;
  const centerX = Number.isFinite(options.centerX) ? options.centerX : 0;
  const centerZ = Number.isFinite(options.centerZ) ? options.centerZ : 0;
  const seed = (options.seed ?? 1337) | 0;
  const edgeFalloff = options.edgeFalloff ?? 'none';
  const edgeStrength = clamp(options.edgeStrength ?? 0.85, 0, 2);
  const customHeightFn = typeof options.heightFn === 'function' ? options.heightFn : null;

  const paletteInput = options.palette ?? {};
  const colors = {
    sand: hexToRgb01(paletteInput.sand ?? 0xd8c38a),
    grass: hexToRgb01(paletteInput.grass ?? 0x4c7a3e),
    rock: hexToRgb01(paletteInput.rock ?? 0x6b6f76),
    peak: hexToRgb01(paletteInput.peak ?? 0xe8eef5),
  };

  const cols = segmentsX + 1;
  const rows = segmentsZ + 1;
  const gridHeights = new Float32Array(cols * rows);
  const minX = centerX - width * 0.5;
  const maxX = centerX + width * 0.5;
  const minZ = centerZ - depth * 0.5;
  const maxZ = centerZ + depth * 0.5;
  const dx = width / segmentsX;
  const dz = depth / segmentsZ;

  let actualMinHeight = Infinity;
  let actualMaxHeight = -Infinity;

  for (let iz = 0; iz < rows; iz++) {
    const z = minZ + iz * dz;
    const nz = ((z - centerZ) / (depth * 0.5));
    for (let ix = 0; ix < cols; ix++) {
      const x = minX + ix * dx;
      const nx = ((x - centerX) / (width * 0.5));
      const n01 = clamp(fbmNoise2D(x, z, {
        seed,
        octaves: options.octaves,
        frequency: options.frequency,
        lacunarity: options.lacunarity,
        gain: options.gain,
        ridgeWeight: options.ridgeWeight,
      }) * 0.5 + 0.5, 0, 1);

      let t = n01;
      if (edgeFalloff === 'island') {
        const dist = Math.min(1.25, Math.hypot(nx, nz));
        t = clamp(t - Math.pow(Math.max(0, dist - 0.35), 1.65) * edgeStrength, 0, 1);
      } else if (edgeFalloff === 'bowl') {
        const dist = Math.min(1.25, Math.hypot(nx, nz));
        t = clamp(t + Math.pow(Math.max(0, dist - 0.4), 1.8) * edgeStrength * 0.75, 0, 1);
      }

      let h = minHeight + (maxHeight - minHeight) * t;
      if (customHeightFn) h = Number(customHeightFn(x, z, h)) || 0;
      gridHeights[iz * cols + ix] = h;
      if (h < actualMinHeight) actualMinHeight = h;
      if (h > actualMaxHeight) actualMaxHeight = h;
    }
  }

  function sampleHeight(x, z) {
    const gx = clamp((x - minX) / dx, 0, segmentsX);
    const gz = clamp((z - minZ) / dz, 0, segmentsZ);
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(segmentsX, x0 + 1);
    const z1 = Math.min(segmentsZ, z0 + 1);
    const tx = gx - x0;
    const tz = gz - z0;
    const h00 = gridHeights[z0 * cols + x0];
    const h10 = gridHeights[z0 * cols + x1];
    const h01 = gridHeights[z1 * cols + x0];
    const h11 = gridHeights[z1 * cols + x1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  function sampleNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
    const epsX = dx * 0.5;
    const epsZ = dz * 0.5;
    const hL = sampleHeight(x - epsX, z);
    const hR = sampleHeight(x + epsX, z);
    const hD = sampleHeight(x, z - epsZ);
    const hU = sampleHeight(x, z + epsZ);
    const vx = (hL - hR) / (2 * epsX);
    const vy = 1;
    const vz = (hD - hU) / (2 * epsZ);
    const len = Math.hypot(vx, vy, vz) || 1;
    out.x = vx / len;
    out.y = vy / len;
    out.z = vz / len;
    return out;
  }

  function sampleSlope(x, z) {
    const n = sampleNormal(x, z);
    return clamp(1 - n.y, 0, 1);
  }

  function sampleBiome(x, z) {
    const h = sampleHeight(x, z);
    const slope = sampleSlope(x, z);
    const range = Math.max(0.001, actualMaxHeight - actualMinHeight);
    const normH = (h - actualMinHeight) / range;
    if (slope > 0.28) return 'rock';
    if (h <= seaLevel + range * 0.08) return 'sand';
    if (normH >= 0.78) return 'peak';
    return 'grass';
  }

  function buildGeometry(THREE) {
    if (!THREE?.BufferGeometry || !THREE?.BufferAttribute) {
      throw new TypeError('buildGeometry requires a Three.js namespace with BufferGeometry and BufferAttribute');
    }
    const vertexCount = cols * rows;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const vertColors = new Float32Array(vertexCount * 3);
    const tmpNormal = { x: 0, y: 1, z: 0 };
    const heightSpan = Math.max(0.001, actualMaxHeight - actualMinHeight);

    for (let iz = 0; iz < rows; iz++) {
      const z = minZ + iz * dz;
      const v = iz / segmentsZ;
      for (let ix = 0; ix < cols; ix++) {
        const idx = iz * cols + ix;
        const x = minX + ix * dx;
        const h = gridHeights[idx];
        const p3 = idx * 3;
        positions[p3] = x;
        positions[p3 + 1] = h;
        positions[p3 + 2] = z;

        sampleNormal(x, z, tmpNormal);
        normals[p3] = tmpNormal.x;
        normals[p3 + 1] = tmpNormal.y;
        normals[p3 + 2] = tmpNormal.z;

        const p2 = idx * 2;
        uvs[p2] = ix / segmentsX;
        uvs[p2 + 1] = v;

        const slope = 1 - tmpNormal.y;
        const normH = (h - actualMinHeight) / heightSpan;
        const grassMix = clamp((h - seaLevel) / Math.max(0.5, heightSpan * 0.14), 0, 1);
        mixRgb(vertColors, p3, colors.sand, colors.grass, grassMix);
        if (normH > 0.7) {
          const peakMix = clamp((normH - 0.7) / 0.22, 0, 1);
          vertColors[p3] = lerp(vertColors[p3], colors.peak[0], peakMix);
          vertColors[p3 + 1] = lerp(vertColors[p3 + 1], colors.peak[1], peakMix);
          vertColors[p3 + 2] = lerp(vertColors[p3 + 2], colors.peak[2], peakMix);
        }
        if (slope > 0.12) {
          const rockMix = clamp((slope - 0.12) / 0.2, 0, 1);
          vertColors[p3] = lerp(vertColors[p3], colors.rock[0], rockMix);
          vertColors[p3 + 1] = lerp(vertColors[p3 + 1], colors.rock[1], rockMix);
          vertColors[p3 + 2] = lerp(vertColors[p3 + 2], colors.rock[2], rockMix);
        }
      }
    }

    const triCount = segmentsX * segmentsZ * 2;
    const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(triCount * 3);
    let ptr = 0;
    for (let iz = 0; iz < segmentsZ; iz++) {
      for (let ix = 0; ix < segmentsX; ix++) {
        const a = iz * cols + ix;
        const b = a + 1;
        const c = (iz + 1) * cols + ix;
        const d = c + 1;
        indices[ptr++] = a;
        indices[ptr++] = c;
        indices[ptr++] = b;
        indices[ptr++] = b;
        indices[ptr++] = c;
        indices[ptr++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(vertColors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    if (typeof geometry.computeBoundingBox === 'function') geometry.computeBoundingBox();
    if (typeof geometry.computeBoundingSphere === 'function') geometry.computeBoundingSphere();
    return geometry;
  }

  function createMesh(THREE, meshOptions = {}) {
    const geometry = buildGeometry(THREE);
    const material = meshOptions.material ?? new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: meshOptions.roughness ?? 0.9,
      metalness: meshOptions.metalness ?? 0.04,
      flatShading: Boolean(meshOptions.flatShading),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = meshOptions.name ?? 'terrain-3d';
    mesh.receiveShadow = meshOptions.receiveShadow !== false;
    mesh.castShadow = Boolean(meshOptions.castShadow);
    return {
      mesh,
      geometry,
      material,
      dispose() {
        geometry.dispose?.();
        if (!meshOptions.material) material.dispose?.();
      },
    };
  }

  function toRapierHeightfieldArray() {
    // Rapier ColliderDesc.heightfield(nrows=segmentsZ, ncols=segmentsX, heights, scale)
    // expects column-major order: heights[ix * (segmentsZ + 1) + iz].
    const out = new Float32Array(cols * rows);
    for (let ix = 0; ix < cols; ix++) {
      const colOffset = ix * rows;
      for (let iz = 0; iz < rows; iz++) {
        out[colOffset + iz] = gridHeights[iz * cols + ix];
      }
    }
    return out;
  }

  function attachPhysics(physicsWorld, physicsOptions = {}) {
    const world = physicsWorld?.world ?? physicsWorld;
    const RAPIER = physicsOptions.RAPIER ?? physicsWorld?.RAPIER;
    if (!world || typeof world.createCollider !== 'function' || !RAPIER?.ColliderDesc?.heightfield) {
      throw new TypeError('attachPhysics requires a RapierPhysicsWorld3D (or { world, RAPIER }) with ColliderDesc.heightfield');
    }
    const heights = toRapierHeightfieldArray();
    const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, 0, centerZ);
    const rigidBody = world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.heightfield(
      segmentsZ,
      segmentsX,
      heights,
      { x: width, y: 1, z: depth },
    );
    if (Number.isFinite(physicsOptions.friction)) colDesc.setFriction(physicsOptions.friction);
    if (Number.isFinite(physicsOptions.restitution)) colDesc.setRestitution(physicsOptions.restitution);
    if (Number.isFinite(physicsOptions.collisionGroups)) colDesc.setCollisionGroups(physicsOptions.collisionGroups);
    const collider = world.createCollider(colDesc, rigidBody);
    return {
      rigidBody,
      collider,
      bodyHandle: rigidBody.handle,
      colliderHandle: collider.handle,
      dispose() {
        if (typeof world.removeRigidBody === 'function') {
          world.removeRigidBody(rigidBody);
        }
      },
    };
  }

  function scatterPositions(scatterOptions = {}) {
    const count = Math.max(0, Math.floor(scatterOptions.count ?? 24));
    const minH = scatterOptions.minHeight ?? seaLevel + 0.25;
    const maxH = scatterOptions.maxHeight ?? actualMaxHeight;
    const maxSlope = clamp(scatterOptions.maxSlope ?? 0.22, 0, 1);
    const minSpacing = Math.max(0, scatterOptions.minSpacing ?? 2.5);
    const margin = clamp(scatterOptions.margin ?? 4, 0, Math.min(width, depth) * 0.45);
    const maxAttempts = Math.max(count * 8, scatterOptions.maxAttempts ?? count * 20);
    const rng = scatterOptions.rng ?? createSeededRng((seed ^ 0x9e3779b9) >>> 0);
    const scaleMin = scatterOptions.scaleMin ?? 0.85;
    const scaleMax = scatterOptions.scaleMax ?? 1.35;
    const minSpacingSq = minSpacing * minSpacing;

    const results = [];
    const spanX = Math.max(0.1, width - margin * 2);
    const spanZ = Math.max(0.1, depth - margin * 2);

    for (let attempt = 0; attempt < maxAttempts && results.length < count; attempt++) {
      const x = minX + margin + rng.next() * spanX;
      const z = minZ + margin + rng.next() * spanZ;
      const y = sampleHeight(x, z);
      if (y < minH || y > maxH) continue;
      const normal = sampleNormal(x, z);
      const slope = clamp(1 - normal.y, 0, 1);
      if (slope > maxSlope) continue;

      let tooClose = false;
      if (minSpacingSq > 0) {
        for (let i = 0; i < results.length; i++) {
          const dxp = results[i].x - x;
          const dzp = results[i].z - z;
          if (dxp * dxp + dzp * dzp < minSpacingSq) {
            tooClose = true;
            break;
          }
        }
      }
      if (tooClose) continue;

      results.push({
        x,
        y,
        z,
        normal,
        slope,
        biome: sampleBiome(x, z),
        yaw: rng.next() * Math.PI * 2,
        scale: lerp(scaleMin, scaleMax, rng.next()),
      });
    }
    return results;
  }

  return Object.freeze({
    width,
    depth,
    segmentsX,
    segmentsZ,
    centerX,
    centerZ,
    seaLevel,
    seed,
    minHeight: actualMinHeight,
    maxHeight: actualMaxHeight,
    bounds: Object.freeze({ minX, maxX, minZ, maxZ, minY: actualMinHeight, maxY: actualMaxHeight }),
    heights: gridHeights,
    sampleHeight,
    sampleNormal,
    sampleSlope,
    sampleBiome,
    toRapierHeightfieldArray,
    buildGeometry,
    createMesh,
    attachPhysics,
    scatterPositions,
  });
}
