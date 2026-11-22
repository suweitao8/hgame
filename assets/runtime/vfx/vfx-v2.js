import { VFX_RENDER_ORDERS, createVisualPrng, markAttributeRangeDirty } from './vfx-core.js';
import {
  VFX_V2_BENCHMARK_PRESETS,
  compileVfxPresetV2,
  sampleCurveLut16,
  validateVfxPresetV2,
} from './vfx-v2-presets.js';
import {
  createVfxGradientLutTexture,
  createVfxMasterMaterial,
  createVfxV2DefaultTextures,
  createVfxV2MeshGeometries,
  getVfxMasterDefines,
} from './vfx-v2-shader.js';

export const VFX_QUALITY_TIERS = Object.freeze({
  high: Object.freeze({ scale: 1.0, softParticles: true, allowSecondary: true }),
  med: Object.freeze({ scale: 0.75, softParticles: false, allowSecondary: true }),
  low: Object.freeze({ scale: 0.5, softParticles: false, allowSecondary: false }),
});

const MAX_ACTIVE_V2_INSTANCES = 64;
const MAX_POOLED_POINT_LIGHTS = 8;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function packColorInt(rgb) {
  const r = Math.max(0, Math.min(255, Math.round((rgb[0] ?? 1) * 255)));
  const g = Math.max(0, Math.min(255, Math.round((rgb[1] ?? 1) * 255)));
  const b = Math.max(0, Math.min(255, Math.round((rgb[2] ?? 1) * 255)));
  return (r << 16) | (g << 8) | b;
}

function writeBillboardMatrix(mat, base, px, py, pz, cx, cy, cz, scale, rotZ, alignVel, vx, vy, vz, stretchFactor) {
  let lx = cx - px;
  let ly = cy - py;
  let lz = cz - pz;
  let lLen = Math.hypot(lx, ly, lz);
  if (lLen < 1e-4) {
    lx = 0; ly = 0; lz = 1;
  } else {
    lx /= lLen; ly /= lLen; lz /= lLen;
  }

  let rx = 0;
  let ry = 0;
  let rz = 0;
  let ux = 0;
  let uy = 0;
  let uz = 0;

  if (alignVel) {
    const spd = Math.hypot(vx, vy, vz);
    if (spd > 1e-4) {
      ux = vx / spd;
      uy = vy / spd;
      uz = vz / spd;
      rx = uy * lz - uz * ly;
      ry = uz * lx - ux * lz;
      rz = ux * ly - uy * lx;
      let rLen = Math.hypot(rx, ry, rz);
      if (rLen < 1e-4) {
        rx = 1; ry = 0; rz = 0;
      } else {
        rx /= rLen; ry /= rLen; rz /= rLen;
      }
      const fx = ry * uz - rz * uy;
      const fy = rz * ux - rx * uz;
      const fz = rx * uy - ry * ux;
      const stretchLen = scale * (1.0 + spd * stretchFactor);
      mat[base] = rx * scale;
      mat[base + 1] = ry * scale;
      mat[base + 2] = rz * scale;
      mat[base + 3] = 0;
      mat[base + 4] = ux * stretchLen;
      mat[base + 5] = uy * stretchLen;
      mat[base + 6] = uz * stretchLen;
      mat[base + 7] = 0;
      mat[base + 8] = fx * scale;
      mat[base + 9] = fy * scale;
      mat[base + 10] = fz * scale;
      mat[base + 11] = 0;
      mat[base + 12] = px;
      mat[base + 13] = py;
      mat[base + 14] = pz;
      mat[base + 15] = 1;
      return;
    }
  }

  // Standard camera-facing billboard with world-up fallback
  rx = lz;
  ry = 0;
  rz = -lx;
  let rLen = Math.hypot(rx, ry, rz);
  if (rLen < 1e-4) {
    rx = 1; ry = 0; rz = 0;
  } else {
    rx /= rLen; ry /= rLen; rz /= rLen;
  }
  ux = ly * rz - lz * ry;
  uy = lz * rx - lx * rz;
  uz = lx * ry - ly * rx;

  const cr = Math.cos(rotZ) * scale;
  const sr = Math.sin(rotZ) * scale;
  mat[base] = rx * cr + ux * sr;
  mat[base + 1] = ry * cr + uy * sr;
  mat[base + 2] = rz * cr + uz * sr;
  mat[base + 3] = 0;
  mat[base + 4] = -rx * sr + ux * cr;
  mat[base + 5] = -ry * sr + uy * cr;
  mat[base + 6] = -rz * sr + uz * cr;
  mat[base + 7] = 0;
  mat[base + 8] = lx * scale;
  mat[base + 9] = ly * scale;
  mat[base + 10] = lz * scale;
  mat[base + 11] = 0;
  mat[base + 12] = px;
  mat[base + 13] = py;
  mat[base + 14] = pz;
  mat[base + 15] = 1;
}

function writeEulerScaleMatrix(mat, base, px, py, pz, rx, ry, rz, sx, sy, sz) {
  const cx = Math.cos(rx);
  const sxi = Math.sin(rx);
  const cy = Math.cos(ry);
  const syi = Math.sin(ry);
  const cz = Math.cos(rz);
  const szi = Math.sin(rz);

  const ae = cx * cz;
  const af = cx * szi;
  const be = sxi * cz;
  const bf = sxi * szi;

  mat[base] = (cy * cz) * sx;
  mat[base + 1] = (af + be * syi) * sx;
  mat[base + 2] = (bf - ae * syi) * sx;
  mat[base + 3] = 0;

  mat[base + 4] = (-cy * szi) * sy;
  mat[base + 5] = (ae - bf * syi) * sy;
  mat[base + 6] = (be + af * syi) * sy;
  mat[base + 7] = 0;

  mat[base + 8] = syi * sz;
  mat[base + 9] = (-sxi * cy) * sz;
  mat[base + 10] = (cx * cy) * sz;
  mat[base + 11] = 0;

  mat[base + 12] = px;
  mat[base + 13] = py;
  mat[base + 14] = pz;
  mat[base + 15] = 1;
}

/**
 * Zero-GC VFX v2 runtime supporting VfxPresetV2 composite effects, SoA RingBuffers,
 * 4 renderers (sprite/mesh/ribbon/event), 4 motion modules, and high/med/low quality guardrails.
 */
export function createVfxV2Runtime({
  mode = 'headless',
  THREE = null,
  scene = null,
  trails = null,
  shake = null,
  prng = createVisualPrng(0x52f29a13),
  maxInstances = MAX_ACTIVE_V2_INSTANCES,
} = {}) {
  const is3D = mode === '3d' && Boolean(THREE && scene);
  const registry = new Map();
  const emitterPools = new Map(); // key `${presetId}::${emitterId}` -> SoA pool
  const activeInstances = [];
  const freeInstances = [];
  for (let i = 0; i < maxInstances; i++) {
    freeInstances.push({
      uid: 0,
      preset: null,
      x: 0,
      y: 0,
      z: 0,
      elapsed: 0,
      lutOverride: null,
      active: false,
      emitterState: [],
    });
  }

  let qualityTier = 'high';
  let groundCollisionEnabled = true;
  let groundYOverride = null;
  let lutRowOverride = null;
  let depthTexture = null;
  let depthNear = 0.05;
  let depthFar = 500;
  let invViewportW = 1 / 960;
  let invViewportH = 1 / 540;
  let simTime = 0;
  let nextUid = 1;
  let totalSpawned = 0;
  let totalRecycled = 0;
  let nanCount = 0;
  let disposed = false;
  let eventHandler = null;

  let v2Group = null;
  let gradientLutTex = null;
  let defaultTextures = null;
  let defaultMeshes = null;
  const registeredTextures = new Map();
  const registeredMeshes = new Map();
  const pooledPointLights = [];

  if (is3D) {
    v2Group = new THREE.Group();
    v2Group.name = 'hgame_vfx_v2';
    scene.add(v2Group);
    gradientLutTex = createVfxGradientLutTexture(THREE);
    defaultTextures = createVfxV2DefaultTextures(THREE);
    defaultMeshes = createVfxV2MeshGeometries(THREE);

    if (THREE.PointLight) {
      for (let i = 0; i < MAX_POOLED_POINT_LIGHTS; i++) {
        const light = new THREE.PointLight(0xffffff, 0, 8, 2);
        light.visible = false;
        v2Group.add(light);
        pooledPointLights.push({ light, age: 0, dur: 0, peakIntensity: 0, active: false });
      }
    }
  }

  function resolveTexture(ref) {
    if (!ref) return null;
    if (typeof ref === 'object' && ref.isTexture) return ref;
    if (typeof ref === 'string' && registeredTextures.has(ref)) {
      return registeredTextures.get(ref);
    }
    return defaultTextures?.resolve(ref) ?? null;
  }

  function ensureEmitterPool(preset, em) {
    const key = `${preset.id}::${em.id}`;
    const existing = emitterPools.get(key);
    if (existing) return existing;

    const capacity = Math.max(1, em.maxParticles);
    const pool = {
      key,
      presetId: preset.id,
      emitter: em,
      capacity,
      cursor: 0,
      aliveCount: 0,
      // SoA RingBuffer typed arrays (zero-GC)
      posX: new Float32Array(capacity),
      posY: new Float32Array(capacity),
      posZ: new Float32Array(capacity),
      velX: new Float32Array(capacity),
      velY: new Float32Array(capacity),
      velZ: new Float32Array(capacity),
      rotX: new Float32Array(capacity),
      rotY: new Float32Array(capacity),
      rotZ: new Float32Array(capacity),
      angVelX: new Float32Array(capacity),
      angVelY: new Float32Array(capacity),
      angVelZ: new Float32Array(capacity),
      originX: new Float32Array(capacity),
      originY: new Float32Array(capacity),
      originZ: new Float32Array(capacity),
      age: new Float32Array(capacity),
      invLife: new Float32Array(capacity),
      seed: new Float32Array(capacity),
      baseSize: new Float32Array(capacity),
      lutRowSlot: new Float32Array(capacity),
      alive: new Uint8Array(capacity),
      bounced: new Uint8Array(capacity),
      // GPU resources for 3D sprite/mesh renderers
      instancedMesh: null,
      material: null,
      customAttr: null,
      customArray: null,
      variantKey: 'NONE',
    };

    if (is3D && (em.renderer === 'sprite' || em.renderer === 'mesh')) {
      const baseGeo = em.renderer === 'sprite'
        ? defaultMeshes.get('quad')
        : (registeredMeshes.get(em.material.meshKind) || defaultMeshes.get(em.material.meshKind));
      const geo = baseGeo.clone();
      const customArray = new Float32Array(capacity * 4);
      const customAttr = new THREE.InstancedBufferAttribute(customArray, 4);
      if (THREE.DynamicDrawUsage !== undefined) customAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aCustom', customAttr);

      const avgLife = (em.lifetime[0] + em.lifetime[1]) * 0.5;
      const matRes = createVfxMasterMaterial(THREE, em.material, {
        qualityTier,
        mainTex: resolveTexture(em.material.mainTex),
        noiseTex: resolveTexture(em.material.noiseTex),
        gradientLut: gradientLutTex,
        depthTex: depthTexture,
        avgLifetime: avgLife,
      });

      const instancedMesh = new THREE.InstancedMesh(geo, matRes.material, capacity);
      if (THREE.DynamicDrawUsage !== undefined) instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instancedMesh.count = 0;
      instancedMesh.frustumCulled = false;
      instancedMesh.renderOrder = VFX_RENDER_ORDERS.PARTICLES;
      v2Group.add(instancedMesh);

      pool.instancedMesh = instancedMesh;
      pool.material = matRes.material;
      pool.customAttr = customAttr;
      pool.customArray = customArray;
      pool.variantKey = matRes.variantKey;
    }

    emitterPools.set(key, pool);
    return pool;
  }

  function rebuildEmitterMaterial(pool) {
    if (!is3D || !pool.instancedMesh) return;
    const em = pool.emitter;
    const avgLife = (em.lifetime[0] + em.lifetime[1]) * 0.5;
    const oldMat = pool.material;
    const matRes = createVfxMasterMaterial(THREE, em.material, {
      qualityTier,
      mainTex: resolveTexture(em.material.mainTex),
      noiseTex: resolveTexture(em.material.noiseTex),
      gradientLut: gradientLutTex,
      depthTex: depthTexture,
      avgLifetime: avgLife,
    });
    pool.material = matRes.material;
    pool.variantKey = matRes.variantKey;
    pool.instancedMesh.material = matRes.material;
    oldMat?.dispose?.();
  }

  function registerPresetV2(preset) {
    const compiled = compileVfxPresetV2(preset);
    registry.set(compiled.id, compiled);
    return compiled;
  }

  for (const bench of VFX_V2_BENCHMARK_PRESETS) {
    registerPresetV2(bench);
  }

  function sampleSpawnOffsetAndDir(shape, velCfg, outPos, outDir) {
    const r = shape.radius;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let dx = 0;
    let dy = 1;
    let dz = 0;

    if (shape.type === 'sphere' || shape.type === 'hemisphere') {
      const zMin = shape.type === 'hemisphere' ? 0 : -1;
      const z = zMin + prng.nextFloat() * (1 - zMin);
      const phi = prng.nextFloat() * Math.PI * 2;
      const rXY = Math.sqrt(Math.max(0, 1 - z * z));
      dx = rXY * Math.cos(phi);
      dy = z;
      dz = rXY * Math.sin(phi);
      const rad = r * Math.cbrt(prng.nextFloat());
      ox = dx * rad;
      oy = dy * rad;
      oz = dz * rad;
    } else if (shape.type === 'cone') {
      const halfAng = (shape.angle * Math.PI) / 180;
      const phi = prng.nextFloat() * Math.PI * 2;
      const baseR = r * Math.sqrt(prng.nextFloat());
      ox = baseR * Math.cos(phi);
      oz = baseR * Math.sin(phi);
      const tilt = halfAng * Math.sqrt(prng.nextFloat());
      dx = Math.sin(tilt) * Math.cos(phi);
      dy = Math.cos(tilt);
      dz = Math.sin(tilt) * Math.sin(phi);
    } else if (shape.type === 'ring') {
      const phi = prng.nextFloat() * Math.PI * 2;
      dx = Math.cos(phi);
      dy = 0.08 + prng.nextFloat() * 0.25;
      dz = Math.sin(phi);
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      ox = Math.cos(phi) * r;
      oz = Math.sin(phi) * r;
    } else if (shape.type === 'box') {
      ox = (prng.nextFloat() - 0.5) * (shape.size[0] ?? 1);
      oy = (prng.nextFloat() - 0.5) * (shape.size[1] ?? 1);
      oz = (prng.nextFloat() - 0.5) * (shape.size[2] ?? 1);
      dx = 0; dy = 1; dz = 0;
    }

    if (velCfg.dir) {
      const len = Math.hypot(velCfg.dir[0] || 0, velCfg.dir[1] || 0, velCfg.dir[2] || 0);
      if (len > 1e-4) {
        dx = velCfg.dir[0] / len;
        dy = velCfg.dir[1] / len;
        dz = velCfg.dir[2] / len;
      } else {
        dx = 0; dy = 0; dz = 0;
      }
    }

    outPos[0] = ox; outPos[1] = oy; outPos[2] = oz;
    outDir[0] = dx; outDir[1] = dy; outDir[2] = dz;
  }

  const scratchSpawnPos = new Float32Array(3);
  const scratchSpawnDir = new Float32Array(3);

  function spawnInPool(pool, inst, emState) {
    const em = pool.emitter;
    if (em.renderer === 'ribbon') {
      if (!trails) return;
      if (em.material.lightningJitter > 0) {
        const phi = prng.nextFloat() * Math.PI * 2;
        const rad = Math.max(0.5, em.shape.radius || 1.4);
        trails.lightningBolt({
          x0: inst.x + Math.cos(phi) * rad * 0.35,
          y0: inst.y + 0.3 + prng.nextFloat() * 0.8,
          z0: inst.z + Math.sin(phi) * rad * 0.35,
          x1: inst.x - Math.cos(phi) * rad,
          y1: inst.y + 0.2 + prng.nextFloat() * 1.1,
          z1: inst.z - Math.sin(phi) * rad,
          color: packColorInt(em.material.tint),
          duration: prng.range(em.lifetime[0], em.lifetime[1]),
          thickness: prng.range(em.sizeStart[0], em.sizeStart[1]),
          jitter: em.material.lightningJitter,
        });
        totalSpawned += 1;
      } else if (emState.ribbonTrackId === -1) {
        emState.ribbonTrackId = trails.allocTrail({
          color: packColorInt(em.material.tint),
          width: em.sizeStart[0] || 0.25,
          lifetime: em.lifetime[0] || 0.35,
          hdr: em.material.emissiveBoost || 1.5,
        });
        totalSpawned += 1;
      }
      return;
    }

    const idx = pool.cursor;
    pool.cursor = (idx + 1) % pool.capacity;
    if (pool.alive[idx]) {
      totalRecycled += 1;
    } else {
      pool.alive[idx] = 1;
      pool.aliveCount += 1;
    }
    totalSpawned += 1;

    sampleSpawnOffsetAndDir(em.shape, em.velocity, scratchSpawnPos, scratchSpawnDir);
    const spd = prng.range(em.velocity.speed[0], em.velocity.speed[1]);
    const life = Math.max(0.04, prng.range(em.lifetime[0], em.lifetime[1]));
    const sz = prng.range(em.sizeStart[0], em.sizeStart[1]);

    pool.originX[idx] = inst.x;
    pool.originY[idx] = inst.y;
    pool.originZ[idx] = inst.z;
    pool.posX[idx] = inst.x + scratchSpawnPos[0];
    pool.posY[idx] = inst.y + scratchSpawnPos[1];
    pool.posZ[idx] = inst.z + scratchSpawnPos[2];
    pool.velX[idx] = scratchSpawnDir[0] * spd;
    pool.velY[idx] = scratchSpawnDir[1] * spd;
    pool.velZ[idx] = scratchSpawnDir[2] * spd;

    if (em.renderer === 'mesh' && em.material.meshKind === 'shard') {
      pool.rotX[idx] = prng.nextFloat() * Math.PI * 2;
      pool.rotY[idx] = prng.nextFloat() * Math.PI * 2;
      pool.rotZ[idx] = prng.nextFloat() * Math.PI * 2;
    } else {
      pool.rotX[idx] = 0;
      pool.rotY[idx] = em.renderer === 'mesh' ? prng.nextFloat() * 0.4 - 0.2 : 0;
      pool.rotZ[idx] = em.renderer === 'sprite' ? prng.nextFloat() * Math.PI * 2 : 0;
    }
    pool.angVelX[idx] = em.motion.angularVel[0] * (prng.nextFloat() * 1.4 - 0.7);
    pool.angVelY[idx] = em.motion.angularVel[1] * (em.renderer === 'mesh' && em.material.meshKind === 'arc' ? 1 : (prng.nextFloat() * 1.4 - 0.7));
    pool.angVelZ[idx] = em.motion.angularVel[2] * (prng.nextFloat() * 1.4 - 0.7);

    pool.age[idx] = 0;
    pool.invLife[idx] = 1 / life;
    pool.seed[idx] = prng.nextFloat();
    pool.baseSize[idx] = sz;
    pool.lutRowSlot[idx] = inst.lutOverride !== null ? inst.lutOverride : em.material.lutRow;
    pool.bounced[idx] = 0;
  }

  function triggerEventEmitter(em, inst) {
    const ev = em.events || {};
    if (ev.pointLightFlash && is3D) {
      const plCfg = ev.pointLightFlash;
      const slot = pooledPointLights.find((p) => !p.active) || pooledPointLights[0];
      if (slot) {
        const col = plCfg.color || [1, 0.7, 0.3];
        slot.light.color.setRGB(col[0] ?? 1, col[1] ?? 0.7, col[2] ?? 0.3);
        slot.light.position.set(inst.x, inst.y + 0.6, inst.z);
        slot.light.distance = Number(plCfg.radius) || 8.0;
        slot.peakIntensity = Number(plCfg.intensity) || 6.0;
        slot.light.intensity = slot.peakIntensity;
        slot.dur = Math.max(0.04, Number(plCfg.duration) || 0.2);
        slot.age = 0;
        slot.active = true;
        slot.light.visible = true;
      }
    }
    if (ev.cameraShake && shake) {
      shake.impulse(Number(ev.cameraShake.intensity) || 0.25);
    }
    if (ev.spawnDecal && eventHandler) {
      eventHandler('spawnDecal', {
        ...ev.spawnDecal,
        x: inst.x,
        y: groundYOverride !== null ? groundYOverride : 0,
        z: inst.z,
      });
    }
    if (ev.playCue && eventHandler) {
      eventHandler('playCue', {
        cue: ev.playCue,
        x: inst.x,
        y: inst.y,
        z: inst.z,
      });
    }
  }

  function playV2(presetOrId, { x = 0, y = 0, z = 0, lutOverride = null } = {}) {
    if (disposed) return 0;
    const preset = typeof presetOrId === 'string'
      ? registry.get(presetOrId)
      : (presetOrId?.schemaVersion === 2 ? compileVfxPresetV2(presetOrId) : null);
    if (!preset) return 0;
    if (typeof presetOrId === 'object' && !registry.has(preset.id)) {
      registry.set(preset.id, preset);
    }

    let inst = freeInstances.pop();
    if (!inst) {
      inst = activeInstances.shift();
      if (!inst) return 0;
    }
    const uid = nextUid++;
    inst.uid = uid;
    inst.preset = preset;
    inst.x = Number(x) || 0;
    inst.y = Number(y) || 0;
    inst.z = Number(z) || 0;
    inst.elapsed = 0;
    inst.lutOverride = lutOverride;
    inst.active = true;
    inst.emitterState.length = 0;

    for (let i = 0; i < preset.emitters.length; i++) {
      const em = preset.emitters[i];
      if (em.renderer !== 'event') ensureEmitterPool(preset, em);
      inst.emitterState.push({
        burstIdx: 0,
        rateAcc: 0,
        eventFired: false,
        ribbonTrackId: -1,
      });
    }
    activeInstances.push(inst);
    return uid;
  }

  function stopV2(uid) {
    for (let i = activeInstances.length - 1; i >= 0; i--) {
      if (activeInstances[i].uid === uid) {
        const inst = activeInstances[i];
        for (const st of inst.emitterState) {
          if (st.ribbonTrackId >= 0 && trails) trails.freeTrail(st.ribbonTrackId);
        }
        inst.active = false;
        activeInstances.splice(i, 1);
        freeInstances.push(inst);
        return true;
      }
    }
    return false;
  }

  function isEmitterAllowed(em) {
    const tier = VFX_QUALITY_TIERS[qualityTier] || VFX_QUALITY_TIERS.high;
    if (!tier.allowSecondary && em.minQuality !== 'low') return false;
    return true;
  }

  function update(dt = 0.016, cameraPos = null) {
    if (disposed) return;
    const stepDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    simTime += stepDt;
    const tier = VFX_QUALITY_TIERS[qualityTier] || VFX_QUALITY_TIERS.high;
    const cx = cameraPos?.x ?? 0;
    const cy = cameraPos?.y ?? 2.5;
    const cz = cameraPos?.z ?? 4.5;

    // 1. Decay pooled point lights
    for (let i = 0; i < pooledPointLights.length; i++) {
      const pl = pooledPointLights[i];
      if (!pl.active) continue;
      pl.age += stepDt;
      if (pl.age >= pl.dur) {
        pl.active = false;
        pl.light.intensity = 0;
        pl.light.visible = false;
      } else {
        const u = 1 - pl.age / pl.dur;
        pl.light.intensity = pl.peakIntensity * u * u;
      }
    }

    // 2. Step active effect instances (spawning + events)
    for (let i = activeInstances.length - 1; i >= 0; i--) {
      const inst = activeInstances[i];
      const preset = inst.preset;
      inst.elapsed += stepDt;
      const t = preset.loop ? (inst.elapsed % preset.duration) : inst.elapsed;

      for (let eIdx = 0; eIdx < preset.emitters.length; eIdx++) {
        const em = preset.emitters[eIdx];
        if (!isEmitterAllowed(em)) continue;
        const st = inst.emitterState[eIdx];
        if (t < em.delay) continue;
        const localT = t - em.delay;

        if (em.renderer === 'event') {
          if (!st.eventFired) {
            st.eventFired = true;
            triggerEventEmitter(em, inst);
          }
          continue;
        }

        const pool = emitterPools.get(`${preset.id}::${em.id}`);
        if (!pool) continue;

        if (em.renderer === 'ribbon' && st.ribbonTrackId >= 0 && trails) {
          const ang = localT * 7.5;
          const r = em.shape.radius || 1.4;
          trails.pushTrailPoint(st.ribbonTrackId, inst.x + Math.cos(ang) * r, inst.y + 0.8, inst.z + Math.sin(ang) * r);
        }

        const bursts = em.spawn.burst;
        while (st.burstIdx < bursts.length && localT >= bursts[st.burstIdx].time - 1e-5) {
          const rawCount = bursts[st.burstIdx].count;
          const scaledCount = rawCount >= 1 ? Math.max(1, Math.round(rawCount * tier.scale)) : 0;
          for (let k = 0; k < scaledCount; k++) spawnInPool(pool, inst, st);
          st.burstIdx += 1;
        }

        if (em.spawn.rate > 0 && localT <= preset.duration) {
          st.rateAcc += em.spawn.rate * tier.scale * stepDt;
          while (st.rateAcc >= 1) {
            st.rateAcc -= 1;
            spawnInPool(pool, inst, st);
          }
        }
      }

      if (!preset.loop && inst.elapsed >= preset.duration + 0.05) {
        for (const st of inst.emitterState) {
          if (st.ribbonTrackId >= 0 && trails) trails.freeTrail(st.ribbonTrackId);
        }
        inst.active = false;
        activeInstances.splice(i, 1);
        freeInstances.push(inst);
      } else if (preset.loop && inst.elapsed >= preset.duration) {
        inst.elapsed -= preset.duration;
        for (const st of inst.emitterState) {
          st.burstIdx = 0;
          st.eventFired = false;
        }
      }
    }

    // 3. Step SoA particle pools & upload dirty GPU instance buffers
    for (const pool of emitterPools.values()) {
      const em = pool.emitter;
      if (em.renderer === 'event' || em.renderer === 'ribbon') continue;

      const cap = pool.capacity;
      const mot = em.motion;
      const dragFactor = mot.drag > 0 ? Math.exp(-mot.drag * stepDt) : 1.0;
      const hasCurl = mot.curlNoise.strength > 0.001;
      const hasVortex = Math.abs(mot.vortex.strength) > 0.001 || Math.abs(mot.vortex.pull) > 0.001;
      const hasAttractor = Math.abs(mot.attractor.strength) > 0.001;
      const useBounce = mot.groundBounce.enabled && groundCollisionEnabled;
      const groundY = groundYOverride !== null ? groundYOverride : mot.groundBounce.groundY;

      const gpuMat = pool.instancedMesh?.instanceMatrix?.array ?? null;
      const gpuCustom = pool.customArray;
      let gpuCount = 0;
      let aliveTotal = 0;
      let sampleLutRow = em.material.lutRow;

      for (let i = 0; i < cap; i++) {
        if (!pool.alive[i]) continue;
        pool.age[i] += stepDt;
        const u = pool.age[i] * pool.invLife[i];
        if (u >= 1.0) {
          pool.alive[i] = 0;
          continue;
        }
        aliveTotal += 1;

        let vx = pool.velX[i];
        let vy = pool.velY[i];
        let vz = pool.velZ[i];

        vy -= mot.gravity * stepDt;

        if (hasCurl) {
          const f = mot.curlNoise.frequency;
          const sp = simTime * mot.curlNoise.speed;
          const str = mot.curlNoise.strength;
          const px = pool.posX[i] * f;
          const py = pool.posY[i] * f;
          const pz = pool.posZ[i] * f;
          vx += Math.sin(py * 1.7 + sp + pool.seed[i] * 6.28) * str * stepDt;
          vy += Math.cos(pz * 1.9 + sp * 0.8) * str * 0.65 * stepDt;
          vz += Math.sin(px * 1.5 - sp + pool.seed[i] * 3.14) * str * stepDt;
        }

        if (hasVortex) {
          const dx = pool.posX[i] - pool.originX[i];
          const dz = pool.posZ[i] - pool.originZ[i];
          const dist = Math.max(0.05, Math.hypot(dx, dz));
          vx += (-dz / dist) * mot.vortex.strength * stepDt - (dx / dist) * mot.vortex.pull * stepDt;
          vz += (dx / dist) * mot.vortex.strength * stepDt - (dz / dist) * mot.vortex.pull * stepDt;
        }

        if (hasAttractor) {
          const tx = pool.originX[i] + mot.attractor.offset[0] - pool.posX[i];
          const ty = pool.originY[i] + mot.attractor.offset[1] - pool.posY[i];
          const tz = pool.originZ[i] + mot.attractor.offset[2] - pool.posZ[i];
          const dist = Math.max(0.05, Math.hypot(tx, ty, tz));
          vx += (tx / dist) * mot.attractor.strength * stepDt;
          vy += (ty / dist) * mot.attractor.strength * stepDt;
          vz += (tz / dist) * mot.attractor.strength * stepDt;
        }

        vx *= dragFactor;
        vy *= dragFactor;
        vz *= dragFactor;

        let px = pool.posX[i] + vx * stepDt;
        let py = pool.posY[i] + vy * stepDt;
        let pz = pool.posZ[i] + vz * stepDt;

        if (useBounce && py <= groundY && vy < 0) {
          py = groundY;
          vy = -vy * mot.groundBounce.restitution;
          vx *= mot.groundBounce.friction;
          vz *= mot.groundBounce.friction;
          if (!pool.bounced[i]) {
            pool.bounced[i] = 1;
            if (em.subEmitters.onCollision && eventHandler) {
              eventHandler('subEmitter', {
                kind: em.subEmitters.onCollision,
                x: px,
                y: groundY,
                z: pz,
              });
            }
          }
        }

        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
          nanCount += 1;
          pool.alive[i] = 0;
          continue;
        }

        pool.posX[i] = px;
        pool.posY[i] = py;
        pool.posZ[i] = pz;
        pool.velX[i] = vx;
        pool.velY[i] = vy;
        pool.velZ[i] = vz;
        pool.rotX[i] += pool.angVelX[i] * stepDt;
        pool.rotY[i] += pool.angVelY[i] * stepDt;
        pool.rotZ[i] += pool.angVelZ[i] * stepDt;

        if (gpuMat && gpuCustom) {
          const szScale = sampleCurveLut16(em.curves.size, u);
          const alpha = clamp01(sampleCurveLut16(em.curves.alpha, u));
          const dissolve = clamp01(sampleCurveLut16(em.curves.dissolve, u));
          const additive = clamp01(sampleCurveLut16(em.curves.additive, u));
          const s = Math.max(0.0001, pool.baseSize[i] * szScale * (alpha > 0.001 ? 1.0 : 0.0));

          if (em.renderer === 'sprite') {
            writeBillboardMatrix(
              gpuMat,
              gpuCount * 16,
              px, py, pz,
              cx, cy, cz,
              s, pool.rotZ[i],
              em.velocity.alignVelocity, vx, vy, vz,
              em.velocity.stretchFactor,
            );
          } else {
            writeEulerScaleMatrix(gpuMat, gpuCount * 16, px, py, pz, pool.rotX[i], pool.rotY[i], pool.rotZ[i], s, s, s);
          }

          const cBase = gpuCount * 4;
          gpuCustom[cBase] = clamp01(u);
          gpuCustom[cBase + 1] = pool.seed[i];
          gpuCustom[cBase + 2] = dissolve;
          gpuCustom[cBase + 3] = additive;
          sampleLutRow = pool.lutRowSlot[i];
          gpuCount += 1;
        }
      }

      pool.aliveCount = aliveTotal;
      if (pool.instancedMesh && pool.material) {
        pool.instancedMesh.count = gpuCount;
        pool.material.uniforms.uTime.value = simTime;
        const resolvedLut = resolveEffectiveLutRow(em.material.lutRow, sampleLutRow);
        pool.material.uniforms.uLutRow.value = resolvedLut;
        if (gpuCount > 0) {
          markAttributeRangeDirty(pool.instancedMesh.instanceMatrix, 0, gpuCount * 16);
          markAttributeRangeDirty(pool.customAttr, 0, gpuCount * 4);
        }
      }
    }
  }

  function resolveEffectiveLutRow(baseLutRow, slotLutRow) {
    if (lutRowOverride !== null) {
      if (baseLutRow === 3 || baseLutRow === 4 || baseLutRow === 5) return lutRowOverride;
    }
    return Number.isFinite(slotLutRow) ? slotLutRow : baseLutRow;
  }

  function setQualityTier(nextTier) {
    if (!VFX_QUALITY_TIERS[nextTier] || nextTier === qualityTier) return;
    qualityTier = nextTier;
    for (const pool of emitterPools.values()) {
      rebuildEmitterMaterial(pool);
    }
  }

  function setDepthTexture(tex, opts = {}) {
    depthTexture = tex || null;
    if (Number.isFinite(opts.near)) depthNear = opts.near;
    if (Number.isFinite(opts.far)) depthFar = opts.far;
    if (Number.isFinite(opts.width) && opts.width > 0) invViewportW = 1 / opts.width;
    if (Number.isFinite(opts.height) && opts.height > 0) invViewportH = 1 / opts.height;
    for (const pool of emitterPools.values()) {
      if (!pool.material) continue;
      pool.material.uniforms.uDepthTex.value = depthTexture;
      pool.material.uniforms.uHasDepthTex.value = depthTexture ? 1.0 : 0.0;
      pool.material.uniforms.uCameraProj.value.set(depthNear, depthFar);
      pool.material.uniforms.uInvViewport.value.set(invViewportW, invViewportH);
    }
  }

  function setGroundConfig({ enabled = true, groundY = null } = {}) {
    groundCollisionEnabled = Boolean(enabled);
    groundYOverride = Number.isFinite(groundY) ? groundY : null;
  }

  function setLutRowOverride(rowOrNull) {
    lutRowOverride = Number.isFinite(rowOrNull) && rowOrNull >= 0 ? Number(rowOrNull) : null;
    for (const pool of emitterPools.values()) {
      const baseRow = pool.emitter.material.lutRow;
      if (pool.material && (baseRow === 3 || baseRow === 4 || baseRow === 5)) {
        pool.material.uniforms.uLutRow.value = lutRowOverride !== null ? lutRowOverride : baseRow;
      }
    }
  }

  function registerTexture(key, texture) {
    if (typeof key !== 'string' || !key || !texture) return;
    registeredTextures.set(key, texture);
    for (const pool of emitterPools.values()) {
      const matCfg = pool.emitter.material;
      if (pool.material && (matCfg.mainTex === key || matCfg.noiseTex === key)) {
        if (matCfg.mainTex === key && pool.material.uniforms?.uMainTex) {
          pool.material.uniforms.uMainTex.value = texture;
        }
        if (matCfg.noiseTex === key && pool.material.uniforms?.uNoiseTex) {
          pool.material.uniforms.uNoiseTex.value = texture;
        }
      }
    }
  }

  function registerMesh(kind, geometry) {
    if (typeof kind === 'string' && geometry) {
      registeredMeshes.set(kind, geometry);
      if (is3D) {
        for (const pool of emitterPools.values()) {
          if (pool.instancedMesh && pool.emitter.renderer === 'mesh' && pool.emitter.material.meshKind === kind) {
            const oldGeo = pool.instancedMesh.geometry;
            const nextGeo = geometry.clone();
            if (pool.customAttr) nextGeo.setAttribute('aCustom', pool.customAttr);
            pool.instancedMesh.geometry = nextGeo;
            oldGeo?.dispose?.();
          }
        }
      }
    }
  }

  function reset() {
    while (activeInstances.length > 0) {
      const inst = activeInstances.pop();
      for (const st of inst.emitterState) {
        if (st.ribbonTrackId >= 0 && trails) trails.freeTrail(st.ribbonTrackId);
      }
      inst.active = false;
      freeInstances.push(inst);
    }
    for (const pool of emitterPools.values()) {
      pool.alive.fill(0);
      pool.aliveCount = 0;
      pool.cursor = 0;
      if (pool.instancedMesh) pool.instancedMesh.count = 0;
    }
    for (const pl of pooledPointLights) {
      pl.active = false;
      pl.light.intensity = 0;
      pl.light.visible = false;
    }
    simTime = 0;
  }

  function dispose() {
    if (disposed) return;
    reset();
    disposed = true;
    for (const pool of emitterPools.values()) {
      if (pool.instancedMesh) {
        v2Group?.remove(pool.instancedMesh);
        pool.instancedMesh.geometry?.dispose?.();
        pool.material?.dispose?.();
      }
    }
    emitterPools.clear();
    if (v2Group) scene?.remove?.(v2Group);
    gradientLutTex?.dispose?.();
    defaultTextures?.dispose?.();
    defaultMeshes?.dispose?.();
  }

  function getStats() {
    let activeParticles = 0;
    let activeDrawCalls = 0;
    const shaderVariants = new Set();
    for (const pool of emitterPools.values()) {
      activeParticles += pool.aliveCount;
      if (pool.instancedMesh && pool.instancedMesh.count > 0) activeDrawCalls += 1;
      if (pool.variantKey && pool.variantKey !== 'NONE') shaderVariants.add(pool.variantKey);
    }
    return {
      qualityTier,
      registeredPresets: registry.size,
      activeInstances: activeInstances.length,
      activeEmitters: emitterPools.size,
      activeParticles,
      activeDrawCalls,
      shaderVariants: Array.from(shaderVariants),
      totalSpawned,
      totalRecycled,
      nanCount,
    };
  }

  return {
    registerPresetV2,
    getPresetV2: (id) => registry.get(id) || null,
    listPresetsV2: () => Array.from(registry.values()),
    validatePresetV2: validateVfxPresetV2,
    playV2,
    stopV2,
    setQualityTier,
    getQualityTier: () => qualityTier,
    setDepthTexture,
    setGroundConfig,
    setLutRowOverride,
    setEventHandler: (fn) => { eventHandler = typeof fn === 'function' ? fn : null; },
    registerTexture,
    registerMesh,
    getVfxMasterDefines: (matCfg) => getVfxMasterDefines(matCfg, qualityTier),
    update,
    reset,
    dispose,
    getStats,
  };
}
