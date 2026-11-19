const MOTION_VERTEX = `
uniform mat4 uCurrentProjection;
uniform mat4 uPreviousModelView;
uniform mat4 uPreviousProjection;
uniform sampler2D tPreviousInstances;
uniform bool uReadPreviousInstances;
uniform int uPreviousInstanceCount;
uniform bool uHasPrevious;
out vec4 vPreviousClip;
out float vPreviousViewZ;
flat out int vHasPrevious;

void main() {
  vec4 current = vec4(position, 1.0);
  vec4 previous = current;
  bool hasPrevious = uHasPrevious;
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

function isSupportedMesh(THREE, object) {
  const material = object.material;
  return object.isMesh && object.geometry?.isBufferGeometry && !object.isSkinnedMesh && !object.isBatchedMesh &&
    !object.geometry.isInstancedBufferGeometry && !object.geometry.morphAttributes.position?.length &&
    material && !Array.isArray(material) && material.visible && material.colorWrite &&
    !material.isShaderMaterial && material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile &&
    !material.transparent && material.opacity === 1 && material.depthWrite && material.depthTest &&
    material.depthFunc === THREE.LessEqualDepth && !material.isNodeMaterial && !material.transmission &&
    !material.alphaTest && !material.alphaHash && !material.alphaToCoverage && !material.displacementMap && !material.clippingPlanes?.length &&
    !material.wireframe && !material.polygonOffset;
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
  };
  let target = null;
  let frame = 0;

  function releaseEntry(entry) {
    entry.texture?.dispose();
    if (entry.proxy?.isInstancedMesh) {
      // Three also frees instance attributes on dispose. The source mesh still owns its matrix buffer.
      entry.proxy.instanceMatrix = entry.proxyMatrix;
      entry.proxy.dispose();
    }
  }

  function materialFor(side) {
    if (!materials.has(side)) {
      materials.set(side, new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: MOTION_VERTEX,
        fragmentShader: MOTION_FRAGMENT, uniforms, side, depthTest: false, depthWrite: false, toneMapped: false }));
    }
    return materials.get(side);
  }

  function snapshotInstances(entry, instance) {
    if (!instance) return;
    const width = Math.min(matricesPerRow, entry.count) * 4;
    const height = Math.ceil(entry.count / matricesPerRow);
    if (entry.texture?.image.width !== width || entry.texture.image.height !== height) {
      entry.texture?.dispose();
      entry.texture = new THREE.DataTexture(new Float32Array(width * height * 4), width, height, THREE.RGBAFormat, THREE.FloatType);
    }
    entry.texture.image.data.set(instance.array.subarray(0, entry.count * 16));
    entry.texture.needsUpdate = true;
    entry.version = instance.version;
  }

  function addMotionMesh(object, entry, previousView, instanceMoved) {
    const material = materialFor(object.material.side);
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
    proxy.onBeforeRender = () => {
      uniforms.uPreviousModelView.value.multiplyMatrices(previousView, entry.matrix);
      uniforms.uHasPrevious.value = entry.hasPrevious;
      uniforms.uPreviousInstanceCount.value = entry.count;
      uniforms.uReadPreviousInstances.value = instanceMoved && Boolean(entry.texture);
      uniforms.tPreviousInstances.value = instanceMoved ? entry.texture : null;
      material.uniformsNeedUpdate = true;
    };
    scene.add(proxy);
  }

  function render(world, camera, depth, depthMode, currentProjection, currentJitter, previousProjection, previousView, historyWeight, multisampled) {
    frame++;
    if (!world.overrideMaterial) world.traverseVisible?.(object => {
      if (!isSupportedMesh(THREE, object) || !object.layers.test(camera.layers)) return;
      const instance = object.isInstancedMesh ? object.instanceMatrix : null;
      const count = instance ? object.count : 0;
      if (instance && (!(count > 0) || count > matricesPerRow * maxTextureSize)) return;
      let entry = entries.get(object);
      if (!entry) {
        entry = { matrix: new THREE.Matrix4(), count: 0, version: -1, frame: 0, texture: null, proxy: null };
        entries.set(object, entry);
      }
      const position = object.geometry.attributes.position;
      const positionVersion = position?.isInterleavedBufferAttribute ? position.data.version : position?.version;
      const instanceMoved = instance && (entry.instance !== instance || entry.version !== instance.version || entry.count !== count);
      entry.hasPrevious = entry.frame === frame - 1 && entry.frame > 0 && entry.geometry === object.geometry &&
        entry.material === object.material && entry.position === position && entry.positionVersion === positionVersion &&
        (!instance || (entry.instance === instance && count >= entry.count));
      entry.position = position;
      entry.positionVersion = positionVersion;
      entry.modelMoved = !entry.matrix.equals(object.matrixWorld);
      if (historyWeight > 0 && (!entry.hasPrevious || instanceMoved || entry.modelMoved)) {
        addMotionMesh(object, entry, previousView, Boolean(instanceMoved));
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
    }
    return draws ? target.texture : null;
  }

  function reset() {
    scene.clear();
    for (const entry of entries.values()) releaseEntry(entry);
    entries.clear();
    frame = 0;
    uniforms.tPreviousInstances.value = null;
  }

  function release() {
    reset();
    target?.dispose();
    target = null;
    uniforms.tWorldDepth.value = null;
  }

  return { render, reset, release, get target() { return target; }, dispose() {
    release();
    for (const material of materials.values()) material.dispose();
    materials.clear();
  } };
}
