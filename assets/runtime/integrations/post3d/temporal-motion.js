const MOTION_VERTEX = `
uniform mat4 uCurrentProjection;
uniform mat4 uPreviousModelView;
uniform mat4 uPreviousProjection;
uniform sampler2D tPreviousInstances;
uniform bool uReadPreviousInstances;
uniform int uPreviousInstanceCount;
uniform bool uHasPrevious;
#ifdef MOTION_SKINNED
  #ifndef USE_SKINNING
    in vec4 skinIndex;
    in vec4 skinWeight;
  #endif
  uniform sampler2D tCurrentBones;
  uniform sampler2D tPreviousBones;
  uniform bool uReadPreviousBones;
  uniform int uPreviousBoneCount;
  uniform mat4 uBindMatrix;
  uniform mat4 uBindMatrixInverse;
  mat4 readBoneMatrix(sampler2D tex, int boneIndex) {
    int stride = textureSize(tex, 0).x / 4;
    ivec2 cell = ivec2((boneIndex % stride) * 4, boneIndex / stride);
    return mat4(texelFetch(tex, cell, 0), texelFetch(tex, cell + ivec2(1, 0), 0),
      texelFetch(tex, cell + ivec2(2, 0), 0), texelFetch(tex, cell + ivec2(3, 0), 0));
  }
  vec4 applySkinning(vec4 basePos, sampler2D tex) {
    vec4 bindPos = uBindMatrix * basePos;
    vec4 skinned = vec4(0.0);
    skinned += readBoneMatrix(tex, int(skinIndex.x)) * bindPos * skinWeight.x;
    skinned += readBoneMatrix(tex, int(skinIndex.y)) * bindPos * skinWeight.y;
    skinned += readBoneMatrix(tex, int(skinIndex.z)) * bindPos * skinWeight.z;
    skinned += readBoneMatrix(tex, int(skinIndex.w)) * bindPos * skinWeight.w;
    return uBindMatrixInverse * skinned;
  }
#endif
out vec4 vPreviousClip;
out float vPreviousViewZ;
flat out int vHasPrevious;

void main() {
  vec4 current = vec4(position, 1.0);
  vec4 previous = current;
  bool hasPrevious = uHasPrevious;
  #ifdef MOTION_SKINNED
    current = applySkinning(current, tCurrentBones);
    hasPrevious = hasPrevious && (!uReadPreviousBones || (int(skinIndex.x) < uPreviousBoneCount &&
      int(skinIndex.y) < uPreviousBoneCount && int(skinIndex.z) < uPreviousBoneCount && int(skinIndex.w) < uPreviousBoneCount));
    previous = uReadPreviousBones && hasPrevious ? applySkinning(previous, tPreviousBones) : current;
  #endif
  #ifdef USE_INSTANCING
    current = instanceMatrix * current;
    hasPrevious = hasPrevious && gl_InstanceID < uPreviousInstanceCount;
    if (uReadPreviousInstances && hasPrevious) {
      int stride = textureSize(tPreviousInstances, 0).x / 4;
      ivec2 cell = ivec2((gl_InstanceID % stride) * 4, gl_InstanceID / stride);
      mat4 oldMatrix = mat4(texelFetch(tPreviousInstances, cell, 0),
        texelFetch(tPreviousInstances, cell + ivec2(1, 0), 0),
        texelFetch(tPreviousInstances, cell + ivec2(2, 0), 0),
        texelFetch(tPreviousInstances, cell + ivec2(3, 0), 0));
      previous = oldMatrix * previous;
    } else {
      previous = current;
    }
  #endif
  vec4 previousView = uPreviousModelView * previous;
  vPreviousClip = uPreviousProjection * previousView;
  vPreviousViewZ = previousView.z;
  vHasPrevious = int(hasPrevious);
  vec4 currentView = modelViewMatrix * current;
  gl_Position = uCurrentProjection * currentView;
}
`;

const MOTION_FRAGMENT = `
uniform sampler2D tWorldDepth;
uniform vec2 uCurrentJitter;
uniform int uDepthMode;
uniform bool uMultisampledDepth;
in vec4 vPreviousClip;
in float vPreviousViewZ;
flat in int vHasPrevious;
out vec4 fragColor;

void main() {
  ivec2 size = textureSize(tWorldDepth, 0);
  float depth = texelFetch(tWorldDepth, ivec2(gl_FragCoord.xy), 0).r;
  // The resolved MSAA sample can be up to half a pixel away from the center on the same plane.
  float tolerance = 0.0000003 + (uMultisampledDepth ? min(0.0002, fwidth(gl_FragCoord.z) * 0.5) : 0.0);
  if (depth >= 1.0 || abs(gl_FragCoord.z - depth) > tolerance) discard;
  float nearZ = uDepthMode == 0 ? -vPreviousClip.w : 0.0;
  if (vHasPrevious == 0 || vPreviousClip.w <= 0.0 || vPreviousClip.z < nearZ || vPreviousClip.z > vPreviousClip.w) {
    fragColor = vec4(0.0, 0.0, 0.0, 2.0);
    return;
  }
  vec2 previousUv = vPreviousClip.xy / vPreviousClip.w * 0.5 + 0.5;
  vec2 currentUv = gl_FragCoord.xy / vec2(size);
  float encodedZ = sign(vPreviousViewZ) * log2(1.0 + abs(vPreviousViewZ));
  fragColor = vec4(previousUv - currentUv + uCurrentJitter, encodedZ, 1.0);
}
`;

function isGpuMotionMesh(object) {
  return object.userData?.hgameTemporalMotion === 'bone-vat';
}

function isSkinnedMotionMesh(object) {
  return Boolean(object.isSkinnedMesh && object.skeleton?.boneMatrices?.length >= 16 &&
    object.geometry?.attributes?.skinIndex && object.geometry?.attributes?.skinWeight);
}

function classifyMotionMesh(THREE, object) {
  if (!object.isMesh || object.userData?.hgameTemporalMotion === 'exclude') {
    return object.isMesh ? 'excluded' : 'ignore';
  }
  const gpuMotion = isGpuMotionMesh(object);
  const skinned = isSkinnedMotionMesh(object);
  const material = object.material;
  const standardMaterialOk = material && !Array.isArray(material) && material.visible && material.colorWrite &&
    (gpuMotion || (!material.isShaderMaterial && material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile)) &&
    !material.transparent && material.opacity === 1 && material.depthWrite && material.depthTest &&
    material.depthFunc === THREE.LessEqualDepth && !material.isNodeMaterial && !material.transmission &&
    !material.alphaTest && !material.alphaHash && !material.alphaToCoverage && !material.displacementMap &&
    !material.clippingPlanes?.length && !material.wireframe && !material.polygonOffset;
  if (!standardMaterialOk || !object.geometry?.isBufferGeometry || object.isBatchedMesh ||
      (!gpuMotion && object.geometry.isInstancedBufferGeometry) ||
      object.geometry.morphAttributes.position?.length || (object.isSkinnedMesh && !skinned)) {
    return 'excluded';
  }
  if (gpuMotion) return 'gpuAnimated';
  if (skinned) return 'skinned';
  if (object.isInstancedMesh) return 'instanced';
  return 'rigid';
}

/** Tracks the previous transforms of native opaque meshes independently for each temporal view. */
export function createTemporalMotion(THREE, renderer, makeTarget, draw, maxTextureSize) {
  const matricesPerRow = Math.floor(Math.min(maxTextureSize, 1024) / 4);
  const scene = new THREE.Scene();
  const color = new THREE.Color();
  const entries = new Map();
  const materials = new Map();
  const uniforms = {
    tWorldDepth: { value: null },
    uCurrentProjection: { value: null },
    uCurrentJitter: { value: null },
    uDepthMode: { value: 0 },
    uMultisampledDepth: { value: false },
    uPreviousProjection: { value: null },
    uPreviousModelView: { value: new THREE.Matrix4() },
    uHasPrevious: { value: false },
    uPreviousInstanceCount: { value: 0 },
    uReadPreviousInstances: { value: false },
    tPreviousInstances: { value: null },
    tCurrentBones: { value: null },
    tPreviousBones: { value: null },
    uReadPreviousBones: { value: false },
    uPreviousBoneCount: { value: 0 },
    uBindMatrix: { value: new THREE.Matrix4() },
    uBindMatrixInverse: { value: new THREE.Matrix4() },
  };
  let target = null;
  let frame = 0;
  const classificationStats = { rigid: 0, instanced: 0, skinned: 0, gpuAnimated: 0, excluded: 0, total: 0 };

  function resetClassificationStats() {
    classificationStats.rigid = 0;
    classificationStats.instanced = 0;
    classificationStats.skinned = 0;
    classificationStats.gpuAnimated = 0;
    classificationStats.excluded = 0;
    classificationStats.total = 0;
  }

  function releaseEntry(entry) {
    entry.texture?.dispose();
    entry.currentBoneTexture?.dispose();
    entry.previousBoneTexture?.dispose();
    if (entry.proxy?.isInstancedMesh) {
      // Three also frees instance attributes on dispose. The source mesh still owns its matrix buffer.
      entry.proxy.instanceMatrix = entry.proxyMatrix;
      entry.proxy.dispose();
    }
  }

  function materialFor(side, skinned = false) {
    const key = `${side}:${skinned ? 'skin' : 'base'}`;
    if (!materials.has(key)) {
      materials.set(key, new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: MOTION_VERTEX,
        fragmentShader: MOTION_FRAGMENT,
        ...(skinned ? { defines: { MOTION_SKINNED: 1 } } : {}),
        uniforms,
        side,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }));
    }
    return materials.get(key);
  }

  function snapshotMatrixTexture(existingTex, matrixData, matrixCount) {
    const width = Math.min(matricesPerRow, matrixCount) * 4;
    const height = Math.ceil(matrixCount / matricesPerRow);
    let tex = existingTex;
    if (tex?.image.width !== width || tex.image.height !== height) {
      tex?.dispose();
      tex = new THREE.DataTexture(new Float32Array(width * height * 4), width, height, THREE.RGBAFormat, THREE.FloatType);
    }
    tex.image.data.set(matrixData.subarray(0, matrixCount * 16));
    tex.needsUpdate = true;
    return tex;
  }

  function snapshotInstances(entry, instance) {
    if (!instance) return;
    entry.texture = snapshotMatrixTexture(entry.texture, instance.array, entry.count);
    entry.version = instance.version;
  }

  function bonesDiffer(current, snapshot, length) {
    if (!snapshot || snapshot.length !== length) return true;
    for (let i = 0; i < length; i++) {
      if (current[i] !== snapshot[i]) return true;
    }
    return false;
  }

  function addMotionMesh(object, entry, previousView, instanceMoved, boneMoved, skinned) {
    const material = materialFor(object.material.side, skinned);
    if (!entry.proxy) {
      entry.proxy = object.isInstancedMesh ? new THREE.InstancedMesh(object.geometry, material, 0)
        : new THREE.Mesh(object.geometry, material);
      entry.proxyMatrix = entry.proxy.instanceMatrix;
      entry.proxy.frustumCulled = false;
      entry.proxy.matrixAutoUpdate = false;
      entry.proxy.matrixWorldAutoUpdate = false;
    }
    const proxy = entry.proxy;
    proxy.geometry = object.geometry;
    proxy.material = material;
    proxy.matrixWorld.copy(object.matrixWorld);
    proxy.layers.mask = object.layers.mask;
    if (object.isInstancedMesh) {
      proxy.instanceMatrix = object.instanceMatrix;
      proxy.count = object.count;
    }
    if (skinned) {
      const boneMatrices = object.skeleton.boneMatrices;
      const boneCount = Math.floor(boneMatrices.length / 16);
      entry.currentBoneTexture = snapshotMatrixTexture(entry.currentBoneTexture, boneMatrices, boneCount);
      if (boneMoved && entry.boneSnapshot && entry.boneCount > 0) {
        entry.previousBoneTexture = snapshotMatrixTexture(entry.previousBoneTexture, entry.boneSnapshot, entry.boneCount);
      }
      entry.pendingBoneCount = boneCount;
    }
    proxy.onBeforeRender = () => {
      uniforms.uPreviousModelView.value.multiplyMatrices(previousView, entry.matrix);
      uniforms.uHasPrevious.value = entry.hasPrevious;
      uniforms.uPreviousInstanceCount.value = entry.count;
      uniforms.uReadPreviousInstances.value = instanceMoved && Boolean(entry.texture);
      uniforms.tPreviousInstances.value = instanceMoved ? entry.texture : null;
      uniforms.tCurrentBones.value = skinned ? entry.currentBoneTexture : null;
      uniforms.tPreviousBones.value = skinned && boneMoved ? entry.previousBoneTexture : (skinned ? entry.currentBoneTexture : null);
      uniforms.uReadPreviousBones.value = Boolean(skinned && boneMoved && entry.previousBoneTexture);
      uniforms.uPreviousBoneCount.value = skinned ? (entry.boneCount ?? 0) : 0;
      if (skinned && object.bindMatrix && object.bindMatrixInverse) {
        uniforms.uBindMatrix.value.copy(object.bindMatrix);
        uniforms.uBindMatrixInverse.value.copy(object.bindMatrixInverse);
      }
      material.uniformsNeedUpdate = true;
    };
    scene.add(proxy);
  }

  function render(world, camera, depth, depthMode, currentProjection, currentJitter, previousProjection, previousView, historyWeight, multisampled) {
    frame++;
    resetClassificationStats();
    if (!world.overrideMaterial) world.traverseVisible?.(object => {
      if (!object.layers.test(camera.layers)) return;
      const category = classifyMotionMesh(THREE, object);
      if (category === 'ignore') return;
      if (category === 'excluded') {
        classificationStats.excluded++;
        classificationStats.total++;
        return;
      }
      const instance = object.isInstancedMesh ? object.instanceMatrix : null;
      const count = instance ? object.count : 0;
      if (instance && (!(count > 0) || count > matricesPerRow * maxTextureSize)) {
        classificationStats.excluded++;
        classificationStats.total++;
        return;
      }
      const skinned = category === 'skinned';
      const boneMatrices = skinned ? object.skeleton.boneMatrices : null;
      const boneCount = boneMatrices ? Math.floor(boneMatrices.length / 16) : 0;
      if (skinned && (!(boneCount > 0) || boneCount > matricesPerRow * maxTextureSize)) {
        classificationStats.excluded++;
        classificationStats.total++;
        return;
      }
      classificationStats[category]++;
      classificationStats.total++;

      let entry = entries.get(object);
      if (!entry) {
        entry = {
          matrix: new THREE.Matrix4(),
          count: 0,
          version: -1,
          frame: 0,
          texture: null,
          currentBoneTexture: null,
          previousBoneTexture: null,
          boneSnapshot: null,
          boneCount: 0,
          pendingBoneCount: 0,
          proxy: null,
        };
        entries.set(object, entry);
      }
      const position = object.geometry.attributes.position;
      const positionVersion = position?.isInterleavedBufferAttribute ? position.data.version : position?.version;
      const instanceMoved = instance && (entry.instance !== instance || entry.version !== instance.version || entry.count !== count);
      const boneMoved = Boolean(skinned && entry.boneSnapshot &&
        bonesDiffer(boneMatrices, entry.boneSnapshot, boneCount * 16));
      entry.hasPrevious = entry.frame === frame - 1 && entry.frame > 0 && entry.geometry === object.geometry &&
        entry.material === object.material && entry.position === position && entry.positionVersion === positionVersion &&
        (!instance || (entry.instance === instance && count >= entry.count)) &&
        (!skinned || boneCount >= entry.boneCount);
      entry.position = position;
      entry.positionVersion = positionVersion;
      entry.modelMoved = !entry.matrix.equals(object.matrixWorld);
      entry.skinnedActive = skinned;
      if (historyWeight > 0 && (!entry.hasPrevious || instanceMoved || boneMoved || entry.modelMoved)) {
        addMotionMesh(object, entry, previousView, Boolean(instanceMoved), boneMoved, skinned);
      }
      entry.frame = frame;
    });

    const draws = scene.children.length > 0;
    if (draws) {
      const { width, height } = depth.image;
      target ??= makeTarget(width, height);
      uniforms.tWorldDepth.value = depth;
      uniforms.uCurrentProjection.value = currentProjection;
      uniforms.uCurrentJitter.value = currentJitter;
      uniforms.uDepthMode.value = depthMode;
      uniforms.uMultisampledDepth.value = multisampled;
      uniforms.uPreviousProjection.value = previousProjection;
      renderer.getClearColor?.(color);
      const alpha = renderer.getClearAlpha?.();
      renderer.setRenderTarget(target);
      try {
        renderer.setClearColor?.(0, 0);
        renderer.clear(true, false, false);
        draw('temporal-motion', target, scene, camera);
      } finally {
        if (alpha !== undefined) renderer.setClearColor?.(color, alpha);
        scene.clear();
        uniforms.tPreviousInstances.value = null;
        uniforms.tCurrentBones.value = null;
        uniforms.tPreviousBones.value = null;
      }
    }

    for (const [object, entry] of entries) {
      if (entry.frame !== frame) {
        releaseEntry(entry);
        entries.delete(object);
        continue;
      }
      if (entry.modelMoved) entry.matrix.copy(object.matrixWorld);
      entry.geometry = object.geometry;
      entry.material = object.material;
      const instance = object.isInstancedMesh ? object.instanceMatrix : null;
      if (instance && (entry.instance !== instance || entry.version !== instance.version || entry.count !== object.count)) {
        entry.count = object.count;
        entry.instance = instance;
        snapshotInstances(entry, instance);
      }
      if (entry.skinnedActive && object.skeleton?.boneMatrices) {
        const boneMatrices = object.skeleton.boneMatrices;
        const boneLen = Math.floor(boneMatrices.length / 16) * 16;
        if (!entry.boneSnapshot || entry.boneSnapshot.length !== boneLen) {
          entry.boneSnapshot = new Float32Array(boneLen);
        }
        entry.boneSnapshot.set(boneMatrices.subarray(0, boneLen));
        entry.boneCount = Math.floor(boneLen / 16);
      }
    }
    return draws ? target.texture : null;
  }

  function reset() {
    scene.clear();
    resetClassificationStats();
    for (const entry of entries.values()) releaseEntry(entry);
    entries.clear();
    frame = 0;
    uniforms.tPreviousInstances.value = null;
    uniforms.tCurrentBones.value = null;
    uniforms.tPreviousBones.value = null;
  }

  function release() {
    reset();
    target?.dispose();
    target = null;
    uniforms.tWorldDepth.value = null;
  }

  function getClassificationStats() {
    return { ...classificationStats };
  }

  return { render, reset, release, getClassificationStats, get target() { return target; }, dispose() {
    release();
    for (const material of materials.values()) material.dispose();
    materials.clear();
  } };
}
