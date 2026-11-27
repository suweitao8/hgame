/**
 * Pure Shuriken Particle Simulation Kernel + Instanced Shader Profile Batch Renderer.
 * Zero-GC SoA Float32Array RingBuffer architecture supporting:
 *  - MinMaxCurve (Constant, TwoConstants, Curve, TwoCurves) with 16-pt Float32Array LUTs
 *  - MinMaxGradient in Linear RGBA space
 *  - CustomDataModule (Custom1.xyzw & Custom2.xyzw) + VertexStreams (0x21 AgePercent, 0x22 Custom1, 0x23 Custom2, 0x26 StableRandom)
 *  - ClampVelocityModule (limit + dampen)
 *  - SizeModule.separateAxes (3D XYZ curves)
 *  - RotationBySpeedModule & InheritVelocityModule
 *  - SimulationSpace ('world' | 'local')
 *  - RenderMode ('billboard' | 'horizontal' | 'stretched' | 'vertical' | 'mesh' | 'none')
 *  - TrailModule (mode=0 Particles & mode=1 Ribbon)
 *  - 3-tier quality guardrails ('high' | 'med' | 'low')
 */

import { createVisualPrng, markAttributeRangeDirty, packRgb24 } from './vfx-core.js';
import {
  compileCustomDataCurves,
  compileMinMaxCurve,
  compileMinMaxGradient,
  evaluateCustomDataChannel,
  evaluateMinMaxCurve,
  evaluateMinMaxGradient,
} from './vfx-shader-chunks.js';
import { createProfileMaterial } from './vfx-shader-profiles.js';

export const SHURIKEN_QUALITY_TIERS = Object.freeze({
  high: Object.freeze({ emissionScale: 1.0, softParticles: true, warpScale: 1.0, skipSubEmitters: false }),
  med: Object.freeze({ emissionScale: 0.75, softParticles: false, warpScale: 0.5, skipSubEmitters: false }),
  low: Object.freeze({ emissionScale: 0.5, softParticles: false, warpScale: 0.0, skipSubEmitters: true }),
});

const RENDER_MODE_IDS = Object.freeze({
  billboard: 0,
  horizontal: 1,
  stretched: 2,
  mesh: 3,
  vertical: 4,
  none: 5,
});

function readRangeFromCompiled(compiled, prng) {
  return evaluateMinMaxCurve(compiled, 0, prng.nextFloat());
}

function ensureQuadGeometry(THREE) {
  const base = new THREE.PlaneGeometry(1, 1);
  if (!base.getAttribute('uv1') && base.getAttribute('uv')) {
    base.setAttribute('uv1', base.getAttribute('uv').clone());
  }
  return base;
}

function cloneGeometryWithBusAttributes(THREE, srcGeo, maxInstances) {
  const geo = new THREE.InstancedBufferGeometry();
  if (srcGeo.index) geo.index = srcGeo.index;
  for (const key of Object.keys(srcGeo.attributes)) {
    geo.setAttribute(key, srcGeo.attributes[key]);
  }
  if (!geo.getAttribute('normal') && geo.getAttribute('position')) {
    const cnt = geo.getAttribute('position').count;
    const norm = new Float32Array(cnt * 3);
    for (let i = 2; i < norm.length; i += 3) norm[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  }
  if (!geo.getAttribute('uv') && geo.getAttribute('position')) {
    const cnt = geo.getAttribute('position').count;
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cnt * 2), 2));
  }
  if (!geo.getAttribute('uv1')) {
    const uvAttr = geo.getAttribute('uv');
    geo.setAttribute('uv1', uvAttr ? uvAttr.clone() : new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
  }
  geo.instanceCount = 0;

  const makeAttr = (arr) => {
    const attr = new THREE.InstancedBufferAttribute(arr, 4);
    if (THREE.DynamicDrawUsage) attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
  };

  const instPos = new Float32Array(maxInstances * 4);
  const instRot = new Float32Array(maxInstances * 4);
  const instScale = new Float32Array(maxInstances * 4);
  const instVel = new Float32Array(maxInstances * 4);
  const color = new Float32Array(maxInstances * 4);
  const custom1 = new Float32Array(maxInstances * 4);
  const custom2 = new Float32Array(maxInstances * 4);
  const meta = new Float32Array(maxInstances * 4);

  const attrs = {
    aInstPos: makeAttr(instPos),
    aInstRot: makeAttr(instRot),
    aInstScale: makeAttr(instScale),
    aInstVel: makeAttr(instVel),
    aColor: makeAttr(color),
    aCustom1: makeAttr(custom1),
    aCustom2: makeAttr(custom2),
    aMeta: makeAttr(meta),
  };
  for (const [name, attr] of Object.entries(attrs)) {
    geo.setAttribute(name, attr);
  }
  return {
    geo,
    arrays: { instPos, instRot, instScale, instVel, color, custom1, custom2, meta },
    attrs,
  };
}

/**
 * Compiles a Shuriken layer into zero-GC LUT curves + Shader Profile GPU batch.
 */
export function compileShurikenLayer(layer, {
  THREE = null,
  scene = null,
  textures = {},
  meshGeometry = null,
  sharedUniforms = null,
  mainAtlasRect = null,
  mainSrgb = false,
} = {}) {
  const renderMode = layer.renderMode || (layer.kind === 'mesh' ? 'mesh' : 'billboard');
  const renderModeId = RENDER_MODE_IDS[renderMode] ?? 0;
  const isNone = renderMode === 'none';

  const life = compileMinMaxCurve(layer.life ?? 1.0, 1.0);
  const speed = compileMinMaxCurve(layer.speed ?? 0.0, 0.0);
  const sizeX = compileMinMaxCurve(layer.sizeX ?? layer.size ?? 1.0, 1.0);
  const sizeY = compileMinMaxCurve(layer.sizeY ?? layer.size ?? 1.0, 1.0);
  const sizeZ = compileMinMaxCurve(layer.sizeZ ?? layer.size ?? 1.0, 1.0);
  const sizeCurveX = (layer.size3D?.x ?? layer.sizeCurve) ? compileMinMaxCurve(layer.size3D?.x ?? layer.sizeCurve, 1.0) : null;
  const sizeCurveY = (layer.size3D?.y ?? layer.sizeYCurve) ? compileMinMaxCurve(layer.size3D?.y ?? layer.sizeYCurve, 1.0) : null;
  const sizeCurveZ = (layer.size3D?.z ?? layer.sizeZCurve) ? compileMinMaxCurve(layer.size3D?.z ?? layer.sizeZCurve, 1.0) : null;

  const rot0X = compileMinMaxCurve(layer.rotX ?? 0, 0);
  const rot0Y = compileMinMaxCurve(layer.rotY ?? 0, 0);
  const rot0Z = compileMinMaxCurve(layer.rotation ?? layer.rotZ ?? 0, 0);

  const spinX = compileMinMaxCurve(layer.spin?.[0] ?? 0, 0);
  const spinY = compileMinMaxCurve(layer.spin?.[1] ?? 0, 0);
  const spinZ = compileMinMaxCurve(layer.spin?.[2] ?? layer.angularVel ?? 0, 0);
  const rotCurveX = layer.rotationOverLifetime?.x ? compileMinMaxCurve(layer.rotationOverLifetime.x, 0) : null;
  const rotCurveY = layer.rotationOverLifetime?.y ? compileMinMaxCurve(layer.rotationOverLifetime.y, 0) : null;
  const rotCurveZ = layer.rotationOverLifetime?.z ? compileMinMaxCurve(layer.rotationOverLifetime.z, 0) : null;

  const velX = layer.velocity?.linear?.[0] !== undefined ? compileMinMaxCurve(layer.velocity.linear[0], 0) : null;
  const velY = layer.velocity?.linear?.[1] !== undefined ? compileMinMaxCurve(layer.velocity.linear[1], 0) : null;
  const velZ = layer.velocity?.linear?.[2] !== undefined ? compileMinMaxCurve(layer.velocity.linear[2], 0) : null;
  const velCurve = layer.velCurve ? compileMinMaxCurve(layer.velCurve, 1.0) : null;
  const orbitalX = compileMinMaxCurve(layer.velocity?.orbitalX ?? 0, 0);
  const orbitalY = compileMinMaxCurve(layer.velocity?.orbitalY ?? 0, 0);
  const orbitalZ = compileMinMaxCurve(layer.velocity?.orbitalZ ?? 0, 0);
  const radialVel = compileMinMaxCurve(layer.velocity?.radial ?? 0, 0);

  const forceX = Array.isArray(layer.force) ? compileMinMaxCurve(layer.force[0], 0) : null;
  const forceY = Array.isArray(layer.force) ? compileMinMaxCurve(layer.force[1], 0) : null;
  const forceZ = Array.isArray(layer.force) ? compileMinMaxCurve(layer.force[2], 0) : null;

  const clampVel = layer.clampVelocity ? {
    separateAxis: Boolean(layer.clampVelocity.separateAxis),
    dampen: Math.max(0, Math.min(1, Number(layer.clampVelocity.dampen ?? 1.0))),
    limitMag: compileMinMaxCurve(layer.clampVelocity.magnitude ?? layer.clampVelocity.limit ?? 1000, 1000),
    limitX: compileMinMaxCurve(layer.clampVelocity.x ?? 1000, 1000),
    limitY: compileMinMaxCurve(layer.clampVelocity.y ?? 1000, 1000),
    limitZ: compileMinMaxCurve(layer.clampVelocity.z ?? 1000, 1000),
    drag: layer.clampVelocity.drag !== undefined ? compileMinMaxCurve(layer.clampVelocity.drag, 0) : null,
  } : null;

  const rotBySpeed = layer.rotationBySpeed ? {
    separateAxes: Boolean(layer.rotationBySpeed.separateAxes),
    rangeMin: Number(layer.rotationBySpeed.range?.[0] ?? 0),
    rangeMax: Number(layer.rotationBySpeed.range?.[1] ?? 1),
    curveX: layer.rotationBySpeed.x ? compileMinMaxCurve(layer.rotationBySpeed.x, 0) : null,
    curveY: layer.rotationBySpeed.y ? compileMinMaxCurve(layer.rotationBySpeed.y, 0) : null,
    curveZ: compileMinMaxCurve(layer.rotationBySpeed.z ?? layer.rotationBySpeed.curve ?? 0, 0),
  } : null;

  const inheritVelocity = layer.inheritVelocity ? {
    mode: layer.inheritVelocity.mode || 'initial',
    multiplier: compileMinMaxCurve(layer.inheritVelocity.multiplier ?? layer.inheritVelocity.curve ?? 0, 0),
  } : null;

  const startColor = compileMinMaxGradient(layer.startColor, true);
  const colorOverLifetime = compileMinMaxGradient(layer.colorCurve, true);
  const customData = compileCustomDataCurves(layer.customData);
  const streams = layer.vertexStreams || {};

  const maxInstances = Math.max(4, Math.min(2048, Number(layer.maxParticles ?? 256) | 0));
  const capacity = maxInstances;

  const matSpec = layer.material ? { ...layer.material } : {
    shaderProfile: layer.shaderProfile || 'unity_standard',
    blend: layer.blend || 'alpha',
    opaque: layer.opaque,
    cullMode: layer.cullMode,
    depthTest: layer.depthTest,
    depthWrite: layer.depthWrite,
    softParticles: layer.softParticles,
    cutoff: layer.alphaCutoff,
    alphaClip: layer.alphaCutoff !== undefined,
    hdr: layer.hdr ?? 1.0,
    emission: layer.emission,
    mainTexST: [layer.uvScale?.[0] ?? 1, layer.uvScale?.[1] ?? 1, layer.uvOffset?.[0] ?? 0, layer.uvOffset?.[1] ?? 0],
    mainTexPanning: layer.uvScroll || [0, 0],
  };

  let mesh = null;
  let material = null;
  let renderState = null;
  let gpuBuffers = null;

  if (!isNone && THREE && scene) {
    const baseGeo = (renderMode === 'mesh' && meshGeometry) ? meshGeometry : ensureQuadGeometry(THREE);
    gpuBuffers = cloneGeometryWithBusAttributes(THREE, baseGeo, capacity);
    const fb = layer.flipbook;
    const matRes = createProfileMaterial(THREE, matSpec, textures, {
      ...sharedUniforms,
      renderModeId,
      cols: fb?.cols ?? 1,
      rows: fb?.rows ?? 1,
      flipbookBlend: fb ? fb.blend !== false : false,
      pivot: layer.pivot || [0, 0],
      hasUv2: Boolean(baseGeo.getAttribute?.('uv1') || streams.uv2),
      mainAtlasRect,
      mainSrgb,
    });
    material = matRes.material;
    renderState = matRes.renderState;
    mesh = new THREE.Mesh(gpuBuffers.geo, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = renderState.renderOrder;
    mesh.userData.vfxWarp = Boolean(renderState.isWarp);
    mesh.name = `ShurikenLayer_${layer.name || 'layer'}`;
    scene.add(mesh);
  }

  return {
    layer,
    renderMode,
    renderModeId,
    isNone,
    isWarp: matSpec.shaderProfile === 'piloto_warp' || matSpec.blend === 'distortion',
    space: layer.space === 'local' ? 'local' : 'world',
    simSpeed: Math.max(0.05, Number(layer.simulationSpeed ?? 1.0)),
    meshGlobalScale: Number(layer.meshGlobalScale ?? 1.0),
    velocityScale: Number(layer.velocityScale ?? 0),
    lengthScale: Number(layer.lengthScale ?? 1),
    alignToVelocity: Boolean(layer.alignToVelocity || layer.shape?.alignToDirection),
    aspectY: Number(layer.aspectY ?? 1),
    capacity,
    life,
    speed,
    sizeX,
    sizeY,
    sizeZ,
    sizeCurveX,
    sizeCurveY,
    sizeCurveZ,
    rot0X,
    rot0Y,
    rot0Z,
    spinX,
    spinY,
    spinZ,
    rotCurveX,
    rotCurveY,
    rotCurveZ,
    velX,
    velY,
    velZ,
    velCurve,
    orbitalX,
    orbitalY,
    orbitalZ,
    radialVel,
    forceX,
    forceY,
    forceZ,
    clampVel,
    rotBySpeed,
    inheritVelocity,
    startColor,
    colorOverLifetime,
    customData,
    streams: {
      custom1: Boolean(streams.custom1 || customData?.custom1),
      custom2: Boolean(streams.custom2 || customData?.custom2),
      agePercent: Boolean(streams.agePercent),
      stableRandom: Boolean(streams.stableRandom),
      uv2: Boolean(streams.uv2),
    },
    needsCustom1: Boolean(customData?.custom1 || streams.custom1 || streams.agePercent),
    needsCustom2: Boolean(customData?.custom2 || streams.custom2),
    flipbook: layer.flipbook || null,
    trail: layer.trail || null,
    subEmitters: Array.isArray(layer.subEmitters) ? layer.subEmitters : null,
    mesh,
    material,
    renderState,
    gpuBuffers,
    // Pre-allocated SoA ring buffer per compiled layer (zero GC!)
    soa: {
      cursor: 0,
      activeCount: 0,
      active: new Uint8Array(capacity),
      activeIndices: new Int32Array(capacity),
      slotToActivePos: new Int32Array(capacity).fill(-1),
      effectSlotId: new Int32Array(capacity),
      px: new Float32Array(capacity),
      py: new Float32Array(capacity),
      pz: new Float32Array(capacity),
      vx: new Float32Array(capacity),
      vy: new Float32Array(capacity),
      vz: new Float32Array(capacity),
      age: new Float32Array(capacity),
      life: new Float32Array(capacity),
      baseSx: new Float32Array(capacity),
      baseSy: new Float32Array(capacity),
      baseSz: new Float32Array(capacity),
      rotX: new Float32Array(capacity),
      rotY: new Float32Array(capacity),
      rotZ: new Float32Array(capacity),
      spinX: new Float32Array(capacity),
      spinY: new Float32Array(capacity),
      spinZ: new Float32Array(capacity),
      gravity: new Float32Array(capacity),
      drag: new Float32Array(capacity),
      fx: new Float32Array(capacity),
      fy: new Float32Array(capacity),
      fz: new Float32Array(capacity),
      orbitalX: new Float32Array(capacity),
      orbitalY: new Float32Array(capacity),
      orbitalZ: new Float32Array(capacity),
      centerX: new Float32Array(capacity),
      centerY: new Float32Array(capacity),
      centerZ: new Float32Array(capacity),
      noiseStr: new Float32Array(capacity),
      noiseFreq: new Float32Array(capacity),
      noisePhase: new Float32Array(capacity),
      randSize: new Float32Array(capacity),
      randColor: new Float32Array(capacity),
      randRot: new Float32Array(capacity),
      randCustom: new Float32Array(capacity),
      stableRand: new Float32Array(capacity),
      startR: new Float32Array(capacity),
      startG: new Float32Array(capacity),
      startB: new Float32Array(capacity),
      startA: new Float32Array(capacity),
      fbRow: new Uint16Array(capacity),
      trailId: new Int32Array(capacity).fill(-1),
      birthSeq: new Float64Array(capacity),
      ribbonTrailId: -1,
      ribbonOrder: new Int32Array(capacity),
    },
  };
}

/**
 * Pure Shuriken runtime controller managing SoA particle simulation, instanced shader profile batches,
 * single-pass Warp detection, SoftParticles depth binding, and 3-tier quality guardrails.
 */
export function createShurikenKernel({
  THREE = null,
  scene = null,
  trails = null,
  prng = createVisualPrng(0x51a2b3c4),
} = {}) {
  let qualityTier = 'high';
  let simTime = 0;
  let birthCounter = 1;
  let disposed = false;

  const uTime = { value: 0 };
  const uSoftDepthTex = { value: null };
  const uHasSoftDepth = { value: 0.0 };
  const uSceneColor = { value: null };
  const uHasSceneColor = { value: 0.0 };
  const uInvViewport = { value: THREE?.Vector2 ? new THREE.Vector2(1 / 1280, 1 / 720) : { set() {} } };
  const uCamNearFar = { value: THREE?.Vector2 ? new THREE.Vector2(0.1, 200) : { set() {} } };

  const sharedUniforms = {
    uTime,
    uSoftDepthTex,
    uHasSoftDepth,
    uSceneColor,
    uHasSceneColor,
    uInvViewport,
    uCamNearFar,
  };

  const compiledLayers = new Set();
  const texturesMap = new Map();
  const meshGeometriesMap = new Map();
  const effectTransforms = new Map(); // effectId -> { x, y, z, yaw, vx, vy, vz }
  let atlasTex = null;
  let atlasRegions = null;
  let atlasFlipV = true;

  function resolveAtlasRect(key) {
    const r = key && atlasRegions?.[key];
    if (!Array.isArray(r) || r.length < 4) return [0, 0, 1, 1];
    const [u0, v0, u1, v1] = r;
    const useFlipV = atlasTex?.flipY !== false && atlasFlipV;
    if (useFlipV) {
      return [u0, 1 - v1, u1 - u0, v1 - v0];
    }
    return [u0, v1, u1 - u0, v0 - v1];
  }

  function isAtlasSrgb() {
    if (!atlasTex) return false;
    return !atlasTex.colorSpace || atlasTex.colorSpace === THREE?.NoColorSpace;
  }

  function setAtlas(tex, regions = null, opts = {}) {
    atlasTex = tex || null;
    atlasRegions = regions ? { ...regions } : null;
    atlasFlipV = typeof opts?.flipV === 'boolean' ? opts.flipV : true;
    const srgbVal = isAtlasSrgb() ? 1.0 : 0.0;
    for (const cl of compiledLayers) {
      if (!cl._usesAtlas || !cl.material?.uniforms) continue;
      const u = cl.material.uniforms;
      const key = cl._mainTexKey;
      const hasRegion = Boolean(key && atlasTex && atlasRegions?.[key]);
      if (u.uMainTex) u.uMainTex.value = hasRegion ? atlasTex : null;
      if (u.uHasMainTex) u.uHasMainTex.value = hasRegion ? 1.0 : 0.0;
      if (u.uMainSrgb) u.uMainSrgb.value = hasRegion ? srgbVal : 0.0;
      if (u.uMainAtlasRect?.value) {
        const rect = hasRegion ? resolveAtlasRect(key) : [0, 0, 1, 1];
        u.uMainAtlasRect.value.set(rect[0], rect[1], rect[2], rect[3]);
      }
    }
  }

  const scratchColorStart = [1, 1, 1, 1];
  const scratchColorLife = [1, 1, 1, 1];
  const scratchC1 = new Float32Array(4);
  const scratchC2 = new Float32Array(4);

  function setQualityTier(tier = 'high') {
    qualityTier = SHURIKEN_QUALITY_TIERS[tier] ? tier : 'high';
    const q = SHURIKEN_QUALITY_TIERS[qualityTier];
    uHasSoftDepth.value = (q.softParticles && uSoftDepthTex.value) ? 1.0 : 0.0;
    for (const cl of compiledLayers) {
      if (cl.isWarp && cl.mesh) {
        cl.mesh.visible = q.warpScale > 0 && cl.soa.activeCount > 0 && Boolean(uSceneColor.value);
      }
    }
  }

  function getQualityTier() {
    return qualityTier;
  }

  function registerTexture(key, tex) {
    if (key && tex) texturesMap.set(key, tex);
  }

  function registerMeshGeometry(key, geoOrObj) {
    if (!key || !geoOrObj) return;
    let geo = geoOrObj.isBufferGeometry ? geoOrObj : geoOrObj.geometry;
    if (!geo && typeof geoOrObj.traverse === 'function') {
      geoOrObj.traverse((ch) => {
        if (!geo && ch.geometry?.isBufferGeometry) geo = ch.geometry;
      });
    }
    if (geo) meshGeometriesMap.set(String(key), geo);
  }

  function registerLayer(layer, customTextures = null) {
    const texBundle = { ...(customTextures || {}) };
    const mat = layer.material;
    const mainKey = mat?.mainTexKey || layer.flipbook?.region || layer.sprite || null;
    if (mat) {
      if (!texBundle.main && mat.mainTexKey) texBundle.main = texturesMap.get(mat.mainTexKey) || null;
      if (!texBundle.detail && (mat.detailNoiseKey || mat.detailMapKey)) texBundle.detail = texturesMap.get(mat.detailNoiseKey || mat.detailMapKey) || null;
      if (!texBundle.alphaOverride && mat.alphaOverrideKey) texBundle.alphaOverride = texturesMap.get(mat.alphaOverrideKey) || null;
      if (!texBundle.baseColor && mat.baseColorMapKey) texBundle.baseColor = texturesMap.get(mat.baseColorMapKey) || null;
      if (!texBundle.normal && mat.normalMapKey) texBundle.normal = texturesMap.get(mat.normalMapKey) || null;
      if (!texBundle.orm && mat.ormMapKey) texBundle.orm = texturesMap.get(mat.ormMapKey) || null;
      if (!texBundle.emission && mat.emissionMapKey) texBundle.emission = texturesMap.get(mat.emissionMapKey) || null;
      if (!texBundle.dissolve && mat.dissolveMapKey) texBundle.dissolve = texturesMap.get(mat.dissolveMapKey) || null;
      if (!texBundle.distortion && mat.distortionTextureKey) texBundle.distortion = texturesMap.get(mat.distortionTextureKey) || null;
      if (!texBundle.alpha && mat.alphaTextureKey) texBundle.alpha = texturesMap.get(mat.alphaTextureKey) || null;
    } else if (mainKey) {
      texBundle.main = texturesMap.get(mainKey) || null;
    }

    let usesAtlas = false;
    let mainAtlasRect = [0, 0, 1, 1];
    let mainSrgb = false;
    if (!texBundle.main && mainKey) {
      usesAtlas = true;
      if (atlasTex && atlasRegions?.[mainKey]) {
        texBundle.main = atlasTex;
        mainAtlasRect = resolveAtlasRect(mainKey);
        mainSrgb = isAtlasSrgb();
      }
    }

    const meshGeo = layer.mesh ? (meshGeometriesMap.get(String(layer.mesh)) || null) : null;
    const cl = compileShurikenLayer(layer, {
      THREE,
      scene,
      textures: texBundle,
      meshGeometry: meshGeo,
      sharedUniforms,
      mainAtlasRect,
      mainSrgb,
    });
    cl._usesAtlas = usesAtlas;
    cl._mainTexKey = mainKey;
    compiledLayers.add(cl);
    return cl;
  }

  function setDepthTexture(depthTex, { near = 0.1, far = 200, width = 1280, height = 720 } = {}) {
    uSoftDepthTex.value = depthTex || null;
    const q = SHURIKEN_QUALITY_TIERS[qualityTier];
    uHasSoftDepth.value = (q.softParticles && depthTex) ? 1.0 : 0.0;
    uInvViewport.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    uCamNearFar.value.set(near, far);
  }

  /**
   * @param {object | null} sceneTex
   * @param {{ width?: number, height?: number }} [opts]
   */
  function setSceneTexture(sceneTex, { width, height } = {}) {
    uSceneColor.value = sceneTex || null;
    uHasSceneColor.value = sceneTex ? 1.0 : 0.0;
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      uInvViewport.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    }
  }

  function setEffectTransform(
    effectId,
    x,
    y,
    z,
    yaw = 0,
    vx = 0,
    vy = 0,
    vz = 0,
    qx = 0,
    qy = -Math.sin(yaw * 0.5),
    qz = 0,
    qw = Math.cos(yaw * 0.5),
  ) {
    let tr = effectTransforms.get(effectId);
    if (!tr) {
      tr = { x: 0, y: 0, z: 0, yaw: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0 };
      effectTransforms.set(effectId, tr);
    }
    const qLen = Math.hypot(qx, qy, qz, qw);
    if (qLen > 1e-6) {
      const inv = 1 / qLen;
      tr.qx = qx * inv; tr.qy = qy * inv; tr.qz = qz * inv; tr.qw = qw * inv;
    } else {
      tr.qx = 0; tr.qy = 0; tr.qz = 0; tr.qw = 1;
    }
    tr.x = x; tr.y = y; tr.z = z; tr.yaw = yaw;
    tr.vx = vx; tr.vy = vy; tr.vz = vz;
  }

  function emitParticle(cl, opts = {}) {
    if (disposed || !cl) return -1;
    const q = SHURIKEN_QUALITY_TIERS[qualityTier];
    if (cl.isWarp && q.warpScale <= 0) return -1;

    const soa = cl.soa;
    const idx = soa.cursor;
    soa.cursor = (idx + 1) % cl.capacity;

    if (soa.active[idx] && soa.trailId[idx] >= 0 && trails) {
      trails.freeTrail(soa.trailId[idx]);
      soa.trailId[idx] = -1;
    }

    const dur = Math.max(0.01, (opts.duration ?? readRangeFromCompiled(cl.life, prng)) / cl.simSpeed);
    const sx = (opts.sizeX ?? readRangeFromCompiled(cl.sizeX, prng)) * (opts.scale ?? 1) * cl.meshGlobalScale;
    const sy = (opts.sizeY ?? readRangeFromCompiled(cl.sizeY, prng)) * (opts.scale ?? 1) * cl.meshGlobalScale * cl.aspectY;
    const sz = (opts.sizeZ ?? readRangeFromCompiled(cl.sizeZ, prng)) * (opts.scale ?? 1) * cl.meshGlobalScale;

    soa.active[idx] = 1;
    if (soa.slotToActivePos[idx] < 0) {
      const pos = soa.activeCount++;
      soa.activeIndices[pos] = idx;
      soa.slotToActivePos[idx] = pos;
    }
    soa.effectSlotId[idx] = opts.effectId | 0;
    soa.px[idx] = opts.x ?? 0;
    soa.py[idx] = opts.y ?? 0;
    soa.pz[idx] = opts.z ?? 0;

    let vx = opts.vx ?? 0;
    let vy = opts.vy ?? 0;
    let vz = opts.vz ?? 0;
    if (cl.inheritVelocity && cl.inheritVelocity.mode === 'initial') {
      const mul = evaluateMinMaxCurve(cl.inheritVelocity.multiplier, 0, prng.nextFloat());
      const tr = effectTransforms.get(opts.effectId | 0);
      if (tr) {
        vx += tr.vx * mul;
        vy += tr.vy * mul;
        vz += tr.vz * mul;
      }
    }
    soa.vx[idx] = vx;
    soa.vy[idx] = vy;
    soa.vz[idx] = vz;

    soa.age[idx] = Math.min(dur - 0.001, Math.max(0, opts.initialAge ?? 0));
    soa.life[idx] = dur;
    soa.baseSx[idx] = sx;
    soa.baseSy[idx] = sy;
    soa.baseSz[idx] = sz;
    soa.rotX[idx] = opts.rotX ?? readRangeFromCompiled(cl.rot0X, prng);
    soa.rotY[idx] = opts.rotY ?? readRangeFromCompiled(cl.rot0Y, prng);
    soa.rotZ[idx] = opts.rotZ ?? readRangeFromCompiled(cl.rot0Z, prng);
    soa.spinX[idx] = readRangeFromCompiled(cl.spinX, prng) * cl.simSpeed;
    soa.spinY[idx] = readRangeFromCompiled(cl.spinY, prng) * cl.simSpeed;
    soa.spinZ[idx] = readRangeFromCompiled(cl.spinZ, prng) * cl.simSpeed;
    soa.gravity[idx] = (opts.gravity ?? 0) * cl.simSpeed * cl.simSpeed;
    soa.drag[idx] = (opts.drag ?? 0) * cl.simSpeed;
    soa.fx[idx] = (cl.forceX ? readRangeFromCompiled(cl.forceX, prng) : 0) * cl.simSpeed * cl.simSpeed;
    soa.fy[idx] = (cl.forceY ? readRangeFromCompiled(cl.forceY, prng) : 0) * cl.simSpeed * cl.simSpeed;
    soa.fz[idx] = (cl.forceZ ? readRangeFromCompiled(cl.forceZ, prng) : 0) * cl.simSpeed * cl.simSpeed;
    soa.orbitalX[idx] = readRangeFromCompiled(cl.orbitalX, prng) * cl.simSpeed;
    soa.orbitalY[idx] = readRangeFromCompiled(cl.orbitalY, prng) * cl.simSpeed;
    soa.orbitalZ[idx] = readRangeFromCompiled(cl.orbitalZ, prng) * cl.simSpeed;
    soa.centerX[idx] = opts.centerX ?? opts.x ?? 0;
    soa.centerY[idx] = opts.centerY ?? opts.y ?? 0;
    soa.centerZ[idx] = opts.centerZ ?? opts.z ?? 0;
    soa.noiseStr[idx] = opts.noiseStrength ?? 0;
    soa.noiseFreq[idx] = opts.noiseFreq ?? 0.5;
    soa.noisePhase[idx] = prng.nextFloat();

    soa.randSize[idx] = prng.nextFloat();
    soa.randColor[idx] = prng.nextFloat();
    soa.randRot[idx] = prng.nextFloat();
    soa.randCustom[idx] = prng.nextFloat();
    soa.stableRand[idx] = prng.nextFloat();

    evaluateMinMaxGradient(cl.startColor, 0, soa.randColor[idx], scratchColorStart);
    soa.startR[idx] = scratchColorStart[0] * (opts.inheritTintR ?? 1);
    soa.startG[idx] = scratchColorStart[1] * (opts.inheritTintG ?? 1);
    soa.startB[idx] = scratchColorStart[2] * (opts.inheritTintB ?? 1);
    soa.startA[idx] = scratchColorStart[3];

    if (cl.flipbook && (cl.flipbook.rows || 1) > 1) {
      const rows = Math.max(1, cl.flipbook.rows | 0);
      soa.fbRow[idx] = cl.flipbook.rowMode === 'random'
        ? Math.floor(prng.nextFloat() * rows)
        : Math.max(0, Math.min(rows - 1, (cl.flipbook.rowIndex ?? 0) | 0));
    } else {
      soa.fbRow[idx] = 0;
    }

    soa.birthSeq[idx] = birthCounter++;

    if (cl.trail && cl.trail.mode !== 'ribbon' && trails?.allocTrail) {
      const tid = trails.allocTrail({
        color: packRgb24(soa.startR[idx] * 255, soa.startG[idx] * 255, soa.startB[idx] * 255),
        endColor: cl.trail.endColor,
        width: Math.max(0.005, (cl.trail.width ?? 0.1) * (cl.trail.sizeAffectsWidth !== false ? sx : 1)),
        endWidth: cl.trail.endWidth ?? 0,
        widthCurve: cl.trail.widthCurve || null,
        alpha: cl.trail.alpha ?? 1,
        hdr: cl.trail.hdr ?? 1,
        lifetime: cl.trail.lifetimeMode === 'fraction' ? dur * (cl.trail.lifetime ?? 0.2) : (cl.trail.lifetime ?? 0.2),
        blend: cl.trail.blend || 'alpha',
      });
      soa.trailId[idx] = tid;
      if (tid >= 0) trails.pushTrailPoint(tid, soa.px[idx], soa.py[idx], soa.pz[idx]);
    }
    return idx;
  }

  function stepLayer(cl, dt) {
    const soa = cl.soa;
    if (soa.activeCount === 0) {
      if (soa.ribbonTrailId >= 0 && trails) {
        trails.freeTrail(soa.ribbonTrailId);
        soa.ribbonTrailId = -1;
      }
      if (cl.gpuBuffers && cl.mesh) {
        cl.gpuBuffers.geo.instanceCount = 0;
        cl.mesh.visible = false;
      }
      return 0;
    }
    const gpu = cl.gpuBuffers;
    const isLocal = cl.space === 'local';
    let alive = 0;
    let maxWritten = 0;

    for (let k = soa.activeCount - 1; k >= 0; k--) {
      const i = soa.activeIndices[k];
      soa.age[i] += dt;
      if (soa.age[i] >= soa.life[i]) {
        soa.active[i] = 0;
        if (soa.trailId[i] >= 0 && trails) {
          trails.freeTrail(soa.trailId[i]);
          soa.trailId[i] = -1;
        }
        const lastIdx = soa.activeIndices[--soa.activeCount];
        if (k < soa.activeCount) {
          soa.activeIndices[k] = lastIdx;
          soa.slotToActivePos[lastIdx] = k;
        }
        soa.slotToActivePos[i] = -1;
        continue;
      }

      const t = Math.max(0, Math.min(1, soa.age[i] / soa.life[i]));

      const vScale = cl.velCurve ? evaluateMinMaxCurve(cl.velCurve, t, soa.randSize[i]) : 1.0;
      const addVx = cl.velX ? evaluateMinMaxCurve(cl.velX, t, soa.randSize[i]) : 0;
      const addVy = cl.velY ? evaluateMinMaxCurve(cl.velY, t, soa.randSize[i]) : 0;
      const addVz = cl.velZ ? evaluateMinMaxCurve(cl.velZ, t, soa.randSize[i]) : 0;
      let effVx = soa.vx[i] * vScale + addVx;
      let effVy = soa.vy[i] * vScale + addVy;
      let effVz = soa.vz[i] * vScale + addVz;

      if (dt > 0) {
        const drag = soa.drag[i];
        if (drag > 0.001) {
          const d = Math.exp(-drag * dt);
          soa.vx[i] *= d;
          soa.vy[i] *= d;
          soa.vz[i] *= d;
        }

        soa.vx[i] += soa.fx[i] * dt;
        soa.vy[i] += (soa.fy[i] - soa.gravity[i]) * dt;
        soa.vz[i] += soa.fz[i] * dt;

        if (cl.clampVel) {
          const cv = cl.clampVel;
          const damp = cv.dampen >= 0.999 ? 1.0 : (1.0 - Math.pow(1.0 - cv.dampen, dt * 60.0));
          if (cv.drag) {
            const cDrag = Math.max(0, evaluateMinMaxCurve(cv.drag, t, soa.randSize[i]));
            if (cDrag > 0.001) {
              const cd = Math.exp(-cDrag * dt);
              soa.vx[i] *= cd; soa.vy[i] *= cd; soa.vz[i] *= cd;
            }
          }
          if (cv.separateAxis) {
            const lx = Math.max(0, evaluateMinMaxCurve(cv.limitX, t, soa.randSize[i]));
            const ly = Math.max(0, evaluateMinMaxCurve(cv.limitY, t, soa.randSize[i]));
            const lz = Math.max(0, evaluateMinMaxCurve(cv.limitZ, t, soa.randSize[i]));
            if (Math.abs(soa.vx[i]) > lx) soa.vx[i] += (Math.sign(soa.vx[i]) * lx - soa.vx[i]) * damp;
            if (Math.abs(soa.vy[i]) > ly) soa.vy[i] += (Math.sign(soa.vy[i]) * ly - soa.vy[i]) * damp;
            if (Math.abs(soa.vz[i]) > lz) soa.vz[i] += (Math.sign(soa.vz[i]) * lz - soa.vz[i]) * damp;
          } else {
            const lim = Math.max(0, evaluateMinMaxCurve(cv.limitMag, t, soa.randSize[i]));
            const spd = Math.hypot(soa.vx[i], soa.vy[i], soa.vz[i]);
            if (spd > lim && spd > 1e-6) {
              const targetSpd = spd + (lim - spd) * damp;
              const ratio = targetSpd / spd;
              soa.vx[i] *= ratio;
              soa.vy[i] *= ratio;
              soa.vz[i] *= ratio;
            }
          }
        }

        effVx = soa.vx[i] * vScale + addVx;
        effVy = soa.vy[i] * vScale + addVy;
        effVz = soa.vz[i] * vScale + addVz;

        soa.px[i] += effVx * dt;
        soa.py[i] += effVy * dt;
        soa.pz[i] += effVz * dt;

        const nStr = soa.noiseStr[i];
        if (nStr > 0.001) {
          const nf = Math.max(0.08, soa.noiseFreq[i]);
          const ph = soa.noisePhase[i] * 6.2831853 + soa.age[i] * nf * 2.5;
          soa.px[i] += Math.sin(ph) * nStr * dt;
          soa.py[i] += Math.cos(ph * 1.13 + 1.2) * nStr * dt;
          soa.pz[i] += Math.sin(ph * 0.87 + 2.4) * nStr * dt;
        }

        const ox = soa.orbitalX[i];
        const oy = soa.orbitalY[i];
        const oz = soa.orbitalZ[i];
        if (Math.abs(ox) > 0.0001 || Math.abs(oy) > 0.0001 || Math.abs(oz) > 0.0001) {
          let rx = soa.px[i] - soa.centerX[i];
          let ry = soa.py[i] - soa.centerY[i];
          let rz = soa.pz[i] - soa.centerZ[i];
          if (Math.abs(ox) > 0.0001) {
            const ax = ox * dt;
            const c = Math.cos(ax), s = Math.sin(ax);
            const ny = ry * c - rz * s;
            const nz = ry * s + rz * c;
            ry = ny; rz = nz;
          }
          if (Math.abs(oy) > 0.0001) {
            const ay = oy * dt;
            const c = Math.cos(ay), s = Math.sin(ay);
            const nx = rx * c - rz * s;
            const nz = rx * s + rz * c;
            rx = nx; rz = nz;
          }
          if (Math.abs(oz) > 0.0001) {
            const az = oz * dt;
            const c = Math.cos(az), s = Math.sin(az);
            const nx = rx * c - ry * s;
            const ny = rx * s + ry * c;
            rx = nx; ry = ny;
          }
          soa.px[i] = soa.centerX[i] + rx;
          soa.py[i] = soa.centerY[i] + ry;
          soa.pz[i] = soa.centerZ[i] + rz;
        }

        const rvx = cl.rotCurveX ? evaluateMinMaxCurve(cl.rotCurveX, t, soa.randRot[i]) : soa.spinX[i];
        const rvy = cl.rotCurveY ? evaluateMinMaxCurve(cl.rotCurveY, t, soa.randRot[i]) : soa.spinY[i];
        const rvz = cl.rotCurveZ ? evaluateMinMaxCurve(cl.rotCurveZ, t, soa.randRot[i]) : soa.spinZ[i];
        soa.rotX[i] += rvx * dt;
        soa.rotY[i] += rvy * dt;
        soa.rotZ[i] += rvz * dt;

        if (cl.rotBySpeed) {
          const spd = Math.hypot(effVx, effVy, effVz);
          const rbs = cl.rotBySpeed;
          const uSpd = Math.max(0, Math.min(1, (spd - rbs.rangeMin) / Math.max(1e-5, rbs.rangeMax - rbs.rangeMin)));
          if (rbs.separateAxes) {
            if (rbs.curveX) soa.rotX[i] += evaluateMinMaxCurve(rbs.curveX, uSpd, soa.randRot[i]) * dt;
            if (rbs.curveY) soa.rotY[i] += evaluateMinMaxCurve(rbs.curveY, uSpd, soa.randRot[i]) * dt;
            soa.rotZ[i] += evaluateMinMaxCurve(rbs.curveZ, uSpd, soa.randRot[i]) * dt;
          } else {
            soa.rotZ[i] += evaluateMinMaxCurve(rbs.curveZ, uSpd, soa.randRot[i]) * dt;
          }
        }
      }

      let wx = soa.px[i], wy = soa.py[i], wz = soa.pz[i];
      if (isLocal) {
        const tr = effectTransforms.get(soa.effectSlotId[i]);
        if (tr) {
          const qx = tr.qx, qy = tr.qy, qz = tr.qz, qw = tr.qw;
          const ix = qw * wx + qy * wz - qz * wy;
          const iy = qw * wy + qz * wx - qx * wz;
          const iz = qw * wz + qx * wy - qy * wx;
          const iw = -qx * wx - qy * wy - qz * wz;
          wx = tr.x + (ix * qw + iw * -qx + iy * -qz - iz * -qy);
          wy = tr.y + (iy * qw + iw * -qy + iz * -qx - ix * -qz);
          wz = tr.z + (iz * qw + iw * -qz + ix * -qy - iy * -qx);
        }
      }

      if (soa.trailId[i] >= 0 && trails) {
        trails.pushTrailPoint(soa.trailId[i], wx, wy, wz);
      }

      if (cl.trail?.mode === 'ribbon') {
        soa.ribbonOrder[alive] = i;
      }

      if (!cl.isNone && gpu) {
        const dst = alive * 4;
        const arr = gpu.arrays;
        arr.instPos[dst] = wx;
        arr.instPos[dst + 1] = wy;
        arr.instPos[dst + 2] = wz;
        arr.instPos[dst + 3] = 1.0;

        arr.instRot[dst] = soa.rotX[i];
        arr.instRot[dst + 1] = soa.rotY[i];
        arr.instRot[dst + 2] = soa.rotZ[i];
        arr.instRot[dst + 3] = cl.lengthScale;

        const cxVal = cl.sizeCurveX ? evaluateMinMaxCurve(cl.sizeCurveX, t, soa.randSize[i]) : 1.0;
        const scX = soa.baseSx[i] * cxVal;
        const scY = soa.baseSy[i] * (cl.sizeCurveY
          ? evaluateMinMaxCurve(cl.sizeCurveY, t, soa.randSize[i])
          : cxVal);
        const scZ = soa.baseSz[i] * (cl.sizeCurveZ
          ? evaluateMinMaxCurve(cl.sizeCurveZ, t, soa.randSize[i])
          : cxVal);

        arr.instScale[dst] = scX;
        arr.instScale[dst + 1] = scY;
        arr.instScale[dst + 2] = scZ;
        arr.instScale[dst + 3] = cl.renderMode === 'mesh' ? (cl.alignToVelocity ? 1 : 0) : cl.velocityScale;

        arr.instVel[dst] = effVx;
        arr.instVel[dst + 1] = effVy;
        arr.instVel[dst + 2] = effVz;
        arr.instVel[dst + 3] = 0;

        evaluateMinMaxGradient(cl.colorOverLifetime, t, soa.randColor[i], scratchColorLife);
        arr.color[dst] = soa.startR[i] * scratchColorLife[0];
        arr.color[dst + 1] = soa.startG[i] * scratchColorLife[1];
        arr.color[dst + 2] = soa.startB[i] * scratchColorLife[2];
        arr.color[dst + 3] = soa.startA[i] * scratchColorLife[3];

        if (cl.needsCustom1) {
          if (cl.customData?.custom1) {
            evaluateCustomDataChannel(cl.customData.custom1, t, soa.randCustom[i], scratchC1, 0);
            arr.custom1[dst] = scratchC1[0];
            arr.custom1[dst + 1] = scratchC1[1];
            arr.custom1[dst + 2] = scratchC1[2];
            arr.custom1[dst + 3] = scratchC1[3];
          } else if (cl.streams.agePercent) {
            arr.custom1[dst] = t;
            arr.custom1[dst + 1] = 0;
            arr.custom1[dst + 2] = 0;
            arr.custom1[dst + 3] = 0;
          }
        }

        if (cl.needsCustom2 && cl.customData?.custom2) {
          evaluateCustomDataChannel(cl.customData.custom2, t, soa.randCustom[i], scratchC2, 0);
          arr.custom2[dst] = scratchC2[0];
          arr.custom2[dst + 1] = scratchC2[1];
          arr.custom2[dst + 2] = scratchC2[2];
          arr.custom2[dst + 3] = scratchC2[3];
        }

        let fbFrame = 0;
        let fbBlend = 0;
        if (cl.flipbook && ((cl.flipbook.cols || 1) > 1 || (cl.flipbook.rows || 1) > 1)) {
          const cols = Math.max(1, cl.flipbook.cols | 0);
          const rows = Math.max(1, cl.flipbook.rows | 0);
          const rawCycles = Number(cl.flipbook.cycles ?? 1);
          const sf = Array.isArray(cl.flipbook.startFrame)
            ? cl.flipbook.startFrame[0] + (cl.flipbook.startFrame[1] - cl.flipbook.startFrame[0]) * soa.stableRand[i]
            : Number(cl.flipbook.startFrame ?? 0);
          if (rawCycles <= 0.001) {
            if (cl.flipbook.rowMode === 'random' || cl.flipbook.rowMode === 'custom') {
              const colIdx = Math.min(cols - 1, Math.max(0, Math.floor((sf % 1) * cols + 0.01)));
              fbFrame = soa.fbRow[i] * cols + colIdx;
            } else {
              const total = cols * rows;
              fbFrame = Math.min(total - 1, Math.max(0, Math.floor(sf * total + 0.01)));
            }
            fbBlend = 0;
          } else {
            const phase = (sf + t * rawCycles) % 1;
            if (cl.flipbook.rowMode === 'random' || cl.flipbook.rowMode === 'custom') {
              const f = Math.min(cols - 0.001, phase * cols);
              fbFrame = soa.fbRow[i] * cols + Math.floor(f);
              fbBlend = f - Math.floor(f);
            } else {
              const total = cols * rows;
              const f = Math.min(total - 0.001, phase * total);
              fbFrame = Math.floor(f);
              fbBlend = f - fbFrame;
            }
          }
        }
        arr.meta[dst] = t;
        arr.meta[dst + 1] = soa.stableRand[i];
        arr.meta[dst + 2] = fbFrame;
        arr.meta[dst + 3] = fbBlend;
        maxWritten = alive + 1;
      }

      alive += 1;
    }

    if (cl.trail?.mode === 'ribbon' && trails?.allocTrail) {
      if (alive >= 2) {
        if (soa.ribbonTrailId < 0) {
          soa.ribbonTrailId = trails.allocTrail({
            color: cl.trail.color || 0xffffff,
            endColor: cl.trail.endColor,
            width: cl.trail.width ?? 0.15,
            endWidth: cl.trail.endWidth ?? 0,
            widthCurve: cl.trail.widthCurve || null,
            alpha: cl.trail.alpha ?? 1,
            hdr: cl.trail.hdr ?? 1,
            lifetime: 0,
            blend: cl.trail.blend || 'alpha',
          });
        }
        if (soa.ribbonTrailId >= 0) {
          // Sort alive indices in-place by birthSeq (insertion sort, zero GC)
          for (let a = 1; a < alive; a++) {
            const key = soa.ribbonOrder[a];
            const keySeq = soa.birthSeq[key];
            let b = a - 1;
            while (b >= 0 && soa.birthSeq[soa.ribbonOrder[b]] > keySeq) {
              soa.ribbonOrder[b + 1] = soa.ribbonOrder[b];
              b -= 1;
            }
            soa.ribbonOrder[b + 1] = key;
          }
          const maxNodes = trails.getStats?.().trailNodes ?? 8;
          const start = Math.max(0, alive - maxNodes);
          if (typeof trails.setTrailPoints === 'function') {
            trails.setTrailPoints(soa.ribbonTrailId, soa.px, soa.py, soa.pz, soa.ribbonOrder, start, alive);
          } else {
            for (let k = start; k < alive; k++) {
              const idx = soa.ribbonOrder[k];
              trails.pushTrailPoint(soa.ribbonTrailId, soa.px[idx], soa.py[idx], soa.pz[idx]);
            }
          }
        }
      } else if (soa.ribbonTrailId >= 0) {
        trails.freeTrail(soa.ribbonTrailId);
        soa.ribbonTrailId = -1;
      }
    }

    soa.activeCount = alive;
    if (gpu && cl.mesh) {
      const q = SHURIKEN_QUALITY_TIERS[qualityTier];
      gpu.geo.instanceCount = maxWritten;
      cl.mesh.visible = maxWritten > 0 && (!cl.isWarp || (q.warpScale > 0 && Boolean(uSceneColor.value)));
      if (maxWritten > 0) {
        const dirtyFloats = maxWritten * 4;
        const ga = gpu.attrs;
        markAttributeRangeDirty(ga.aInstPos, 0, dirtyFloats);
        markAttributeRangeDirty(ga.aInstRot, 0, dirtyFloats);
        markAttributeRangeDirty(ga.aInstScale, 0, dirtyFloats);
        markAttributeRangeDirty(ga.aInstVel, 0, dirtyFloats);
        markAttributeRangeDirty(ga.aColor, 0, dirtyFloats);
        markAttributeRangeDirty(ga.aMeta, 0, dirtyFloats);
        if (cl.needsCustom1) markAttributeRangeDirty(ga.aCustom1, 0, dirtyFloats);
        if (cl.needsCustom2) markAttributeRangeDirty(ga.aCustom2, 0, dirtyFloats);
      }
    }
    return alive;
  }

  function update(dt = 0.016) {
    if (disposed) return;
    const clampedDt = Math.max(0, dt);
    simTime += clampedDt;
    uTime.value = simTime;
    for (const cl of compiledLayers) {
      stepLayer(cl, clampedDt);
    }
  }

  function hasActiveWarp() {
    if (SHURIKEN_QUALITY_TIERS[qualityTier].warpScale <= 0) return false;
    for (const cl of compiledLayers) {
      if (cl.isWarp && cl.soa.activeCount > 0) return true;
    }
    return false;
  }

  function setWarpMeshesVisible(visible) {
    const q = SHURIKEN_QUALITY_TIERS[qualityTier];
    for (const cl of compiledLayers) {
      if (cl.isWarp && cl.mesh) {
        cl.mesh.visible = Boolean(visible && q.warpScale > 0 && cl.soa.activeCount > 0);
      }
    }
  }

  function getStats() {
    let activeParticles = 0;
    let activeDrawCalls = 0;
    let warpActive = 0;
    for (const cl of compiledLayers) {
      activeParticles += cl.soa.activeCount;
      if (!cl.isNone && cl.mesh?.visible && cl.soa.activeCount > 0) {
        activeDrawCalls += 1;
        if (cl.isWarp) warpActive += cl.soa.activeCount;
      }
    }
    return {
      qualityTier,
      compiledLayers: compiledLayers.size,
      activeParticles,
      activeDrawCalls,
      warpActive,
    };
  }

  function reset() {
    simTime = 0;
    uTime.value = 0;
    effectTransforms.clear();
    for (const cl of compiledLayers) {
      cl.soa.active.fill(0);
      cl.soa.activeCount = 0;
      cl.soa.slotToActivePos.fill(-1);
      cl.soa.cursor = 0;
      for (let i = 0; i < cl.soa.trailId.length; i++) {
        if (cl.soa.trailId[i] >= 0 && trails) trails.freeTrail(cl.soa.trailId[i]);
        cl.soa.trailId[i] = -1;
      }
      if (cl.soa.ribbonTrailId >= 0 && trails) {
        trails.freeTrail(cl.soa.ribbonTrailId);
        cl.soa.ribbonTrailId = -1;
      }
      if (cl.gpuBuffers) cl.gpuBuffers.geo.instanceCount = 0;
      if (cl.mesh) cl.mesh.visible = false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    reset();
    for (const cl of compiledLayers) {
      if (cl.mesh && scene) scene.remove(cl.mesh);
      cl.gpuBuffers?.geo?.dispose?.();
      cl.material?.dispose?.();
    }
    compiledLayers.clear();
  }

  return {
    registerTexture,
    setAtlas,
    registerMeshGeometry,
    registerLayer,
    emitParticle,
    setEffectTransform,
    setQualityTier,
    getQualityTier,
    setDepthTexture,
    setSceneTexture,
    hasActiveWarp,
    setWarpMeshesVisible,
    update,
    reset,
    dispose,
    getStats,
  };
}
