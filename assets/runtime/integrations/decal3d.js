/**
 * Pooled OBB-projected 3D Decal system supporting both:
 *  - `'surface'` mode: aligned quad/box overlay with polygonOffset (lightweight fallback)
 *  - `'projected'` mode: true screen-space depth-reconstructed OBB volume projection (wraps cleanly over curved/stepped geometry)
 * Never imports 'three' directly; callers inject { THREE }.
 */

const PROJECTED_DECAL_VERT_GLSL3 = `
out vec3 vDecalWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDecalWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PROJECTED_DECAL_FRAG_GLSL3 = `
precision highp float;
uniform sampler2D tDepth;
uniform sampler2D tMap;
uniform float uHasMap;
uniform mat4 uInvProj;
uniform mat4 uInvView;
uniform mat4 uInvModel;
uniform vec2 uResolution;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uEdgeSoftness;
uniform float uRoughnessTint;
in vec3 vDecalWorldPos;
out vec4 fragColor;

void main() {
  vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  float rawDepth = texture(tDepth, screenUv).r;
  if (rawDepth >= 0.999999) discard;
  vec4 ndc = vec4(screenUv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
  vec4 viewPos = uInvProj * ndc;
  viewPos /= viewPos.w;
  vec4 worldPos = uInvView * viewPos;
  vec3 localPos = (uInvModel * worldPos).xyz;
  if (any(greaterThan(abs(localPos), vec3(0.5)))) discard;
  vec2 decalUv = localPos.xy + 0.5;
  float s = clamp(uEdgeSoftness, 0.01, 0.48);
  float edgeFadeZ = smoothstep(0.5, 0.5 - s, abs(localPos.z));
  float edgeFadeX = smoothstep(0.5, 0.5 - s * 0.75, abs(localPos.x));
  float edgeFadeY = smoothstep(0.5, 0.5 - s * 0.75, abs(localPos.y));
  vec4 tex = uHasMap > 0.5 ? texture(tMap, decalUv) : vec4(1.0);
  float alpha = clamp(uOpacity * tex.a * edgeFadeZ * edgeFadeX * edgeFadeY, 0.0, 1.0);
  if (alpha <= 0.004) discard;
  vec3 litRgb = mix(uColor * tex.rgb, uColor * tex.rgb * 0.85, clamp(uRoughnessTint, 0.0, 1.0));
  fragColor = vec4(litRgb, alpha);
}
`;

/**
 * Create a fixed-capacity pooled 3D decal manager.
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 * @param {number} [options.maxDecals=128] Maximum active decals before oldest ring-buffer recycling.
 * @param {number} [options.fadeSeconds=1.5] Default fade-out duration at the end of a decal lifetime.
 * @param {number} [options.polygonOffsetFactor=-4]
 * @param {number} [options.polygonOffsetUnits=-4]
 * @param {'surface' | 'projected'} [options.mode='surface'] Rendering projection mode (`'projected'` reconstructs world positions from depth).
 * @param {object | null} [options.group=null] Parent Three.js Group/Scene receiving surface decal meshes.
 */
export function createDecalSystem3D(THREE, {
  maxDecals = 128,
  fadeSeconds = 1.5,
  polygonOffsetFactor = -4,
  polygonOffsetUnits = -4,
  mode = 'surface',
  group = null,
} = {}) {
  if (!THREE?.Mesh || !THREE?.BoxGeometry || !THREE?.MeshStandardMaterial || !THREE?.Vector3) {
    throw new TypeError('createDecalSystem3D requires THREE.Mesh, BoxGeometry, MeshStandardMaterial, and Vector3');
  }
  const capacity = Math.max(1, Math.floor(maxDecals) || 128);
  const defaultFade = Math.max(0.05, Number(fadeSeconds) || 1.5);
  let activeMode = mode === 'projected' ? 'projected' : 'surface';
  const ownedGroup = group ?? (THREE.Group ? new THREE.Group() : null);
  if (ownedGroup && !ownedGroup.name) ownedGroup.name = 'hgame_decal_group';
  const projectedScene = THREE.Scene ? new THREE.Scene() : (THREE.Group ? new THREE.Group() : null);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const pool = [];
  let cursor = 0;
  let totalSpawned = 0;
  let recycled = 0;
  let nextId = 1;
  let disposed = false;

  const scratchPos = new THREE.Vector3();
  const scratchNorm = new THREE.Vector3();
  const scratchZ = new THREE.Vector3(0, 0, 1);
  const scratchQuat = THREE.Quaternion ? new THREE.Quaternion() : null;
  const scratchRoll = THREE.Quaternion ? new THREE.Quaternion() : null;
  const sharedInvProj = THREE.Matrix4 ? new THREE.Matrix4() : null;
  const sharedInvView = THREE.Matrix4 ? new THREE.Matrix4() : null;
  const sharedRes = THREE.Vector2 ? new THREE.Vector2(1, 1) : { set() {} };
  const canProjectShader = Boolean(THREE.ShaderMaterial && THREE.GLSL3 && THREE.Matrix4);

  for (let i = 0; i < capacity; i++) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor,
      polygonOffsetUnits,
      roughness: 0.9,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.name = `hgame_decal_${i}`;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    ownedGroup?.add?.(mesh);

    let projMat = null;
    let projMesh = null;
    if (canProjectShader) {
      projMat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: PROJECTED_DECAL_VERT_GLSL3,
        fragmentShader: PROJECTED_DECAL_FRAG_GLSL3,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.BackSide ?? 1,
        uniforms: {
          tDepth: { value: null },
          tMap: { value: null },
          uHasMap: { value: 0 },
          uInvProj: { value: sharedInvProj },
          uInvView: { value: sharedInvView },
          uInvModel: { value: new THREE.Matrix4() },
          uResolution: { value: sharedRes },
          uColor: { value: THREE.Color ? new THREE.Color(0xffffff) : { r: 1, g: 1, b: 1 } },
          uOpacity: { value: 1 },
          uEdgeSoftness: { value: 0.25 },
          uRoughnessTint: { value: 0 },
        },
      });
      projMesh = new THREE.Mesh(unitBox, projMat);
      projMesh.name = `hgame_proj_decal_${i}`;
      projMesh.visible = false;
      projMesh.frustumCulled = false;
      projectedScene?.add?.(projMesh);
    }

    pool.push({
      id: 0,
      slotIndex: i,
      mesh,
      material,
      projMesh,
      projMat,
      active: false,
      age: 0,
      lifetime: 0,
      fadeDuration: defaultFade,
      baseOpacity: 1,
    });
  }

  function syncSlotVisibility(slot) {
    slot.mesh.visible = slot.active && activeMode === 'surface';
    if (slot.projMesh) {
      slot.projMesh.visible = slot.active && activeMode === 'projected';
    }
  }

  function deactivateSlot(slot) {
    slot.active = false;
    slot.id = 0;
    slot.mesh.visible = false;
    if (slot.projMesh) slot.projMesh.visible = false;
    slot.material.opacity = 0;
    slot.material.map = null;
    if (slot.projMat) {
      slot.projMat.uniforms.uOpacity.value = 0;
      slot.projMat.uniforms.tMap.value = null;
      slot.projMat.uniforms.uHasMap.value = 0;
    }
  }

  function setMode(nextMode) {
    activeMode = nextMode === 'projected' ? 'projected' : 'surface';
    for (const slot of pool) syncSlotVisibility(slot);
    return activeMode;
  }

  function spawn({
    position = [0, 0, 0],
    normal = [0, 1, 0],
    size = [1, 1, 0.4],
    rotation = 0,
    color = 0xffffff,
    map = null,
    opacity = 1,
    lifetime = 15,
    fadeSeconds: slotFade = defaultFade,
    edgeSoftness = 0.25,
    roughnessTint = 0,
  } = {}) {
    if (disposed) return null;
    let slot = null;
    for (let k = 0; k < capacity; k++) {
      const idx = (cursor + k) % capacity;
      if (!pool[idx].active) {
        slot = pool[idx];
        cursor = (idx + 1) % capacity;
        break;
      }
    }
    if (!slot) {
      slot = pool[cursor];
      cursor = (cursor + 1) % capacity;
      recycled++;
    }

    const px = Array.isArray(position) ? (Number(position[0]) || 0) : (Number(position?.x) || 0);
    const py = Array.isArray(position) ? (Number(position[1]) || 0) : (Number(position?.y) || 0);
    const pz = Array.isArray(position) ? (Number(position[2]) || 0) : (Number(position?.z) || 0);
    const nx = Array.isArray(normal) ? (Number(normal[0]) || 0) : (Number(normal?.x) || 0);
    const ny = Array.isArray(normal) ? (Number(normal[1]) || 0) : (Number(normal?.y) || 0);
    const nz = Array.isArray(normal) ? (Number(normal[2]) || 0) : (Number(normal?.z) || 0);
    const sx = Array.isArray(size) ? Math.max(0.01, Number(size[0]) || 1) : Math.max(0.01, Number(size?.x) || 1);
    const sy = Array.isArray(size) ? Math.max(0.01, Number(size[1]) || 1) : Math.max(0.01, Number(size?.y) || 1);
    const sz = Array.isArray(size) ? Math.max(0.01, Number(size[2]) || 0.4) : Math.max(0.01, Number(size?.z) || 0.4);

    scratchNorm.set(nx, ny, nz);
    if (scratchNorm.lengthSq() <= 1e-8) scratchNorm.set(0, 1, 0);
    else scratchNorm.normalize();

    const offset = activeMode === 'surface' ? 0.003 : 0;
    scratchPos.set(px + scratchNorm.x * offset, py + scratchNorm.y * offset, pz + scratchNorm.z * offset);
    slot.mesh.position.copy?.(scratchPos);
    if (!slot.mesh.position.copy) slot.mesh.position.set(scratchPos.x, scratchPos.y, scratchPos.z);

    if (scratchQuat && slot.mesh.quaternion?.setFromUnitVectors) {
      scratchQuat.setFromUnitVectors(scratchZ, scratchNorm);
      if (rotation) {
        scratchRoll.setFromAxisAngle(scratchNorm, Number(rotation) || 0);
        scratchQuat.premultiply(scratchRoll);
      }
      slot.mesh.quaternion.copy(scratchQuat);
    }
    slot.mesh.scale.set?.(sx, sy, sz);

    if (slot.projMesh && slot.projMat) {
      slot.projMesh.position.set(px, py, pz);
      if (scratchQuat) slot.projMesh.quaternion.copy(scratchQuat);
      slot.projMesh.scale.set(sx, sy, sz);
      slot.projMesh.updateMatrixWorld?.(true);
      slot.projMat.uniforms.uInvModel.value.copy(slot.projMesh.matrixWorld).invert();
      slot.projMat.uniforms.uColor.value?.set?.(color);
      slot.projMat.uniforms.tMap.value = map ?? null;
      slot.projMat.uniforms.uHasMap.value = map ? 1 : 0;
      slot.projMat.uniforms.uEdgeSoftness.value = Math.max(0.01, Math.min(0.48, Number(edgeSoftness) || 0.25));
      slot.projMat.uniforms.uRoughnessTint.value = Math.max(0, Math.min(1, Number(roughnessTint) || 0));
    }

    slot.material.color?.set?.(color);
    slot.material.map = map ?? null;
    slot.material.needsUpdate = true;
    slot.baseOpacity = Math.max(0, Math.min(1, Number(opacity) ?? 1));
    slot.material.opacity = slot.baseOpacity;
    if (slot.projMat) slot.projMat.uniforms.uOpacity.value = slot.baseOpacity;
    slot.lifetime = Math.max(0.05, Number(lifetime) || 15);
    slot.fadeDuration = Math.max(0.01, Math.min(slot.lifetime, Number(slotFade) || defaultFade));
    slot.age = 0;
    slot.active = true;
    slot.id = nextId++;
    syncSlotVisibility(slot);
    totalSpawned++;

    const handleId = slot.id;
    return {
      id: handleId,
      mesh: activeMode === 'projected' && slot.projMesh ? slot.projMesh : slot.mesh,
      dispose: () => {
        if (slot.active && slot.id === handleId) {
          deactivateSlot(slot);
          return true;
        }
        return false;
      },
    };
  }

  function update(dt = 0) {
    if (disposed || !(dt > 0)) return 0;
    let activeCount = 0;
    for (let i = 0; i < capacity; i++) {
      const slot = pool[i];
      if (!slot.active) continue;
      slot.age += dt;
      const remaining = slot.lifetime - slot.age;
      if (remaining <= 0) {
        deactivateSlot(slot);
        continue;
      }
      activeCount++;
      if (remaining < slot.fadeDuration) {
        const nextAlpha = slot.baseOpacity * (remaining / slot.fadeDuration);
        slot.material.opacity = nextAlpha;
        if (slot.projMat) slot.projMat.uniforms.uOpacity.value = nextAlpha;
      }
    }
    return activeCount;
  }

  /**
   * Render depth-projected OBB decals onto `target` (which must NOT attach `depthTexture` simultaneously).
   */
  function renderProjected(renderer, camera, depthTexture, width, height, target = null) {
    if (disposed || activeMode !== 'projected' || !renderer || !camera || !depthTexture || !projectedScene) {
      return 0;
    }
    camera.updateMatrixWorld?.();
    if (camera.projectionMatrixInverse) sharedInvProj?.copy(camera.projectionMatrixInverse);
    if (camera.matrixWorld) sharedInvView?.copy(camera.matrixWorld);
    sharedRes.set?.(Math.max(1, width || 1), Math.max(1, height || 1));

    let rendered = 0;
    for (let i = 0; i < capacity; i++) {
      const slot = pool[i];
      if (!slot.active || !slot.projMat) continue;
      rendered++;
      slot.projMat.uniforms.tDepth.value = depthTexture;
      slot.projMesh.updateMatrixWorld?.(true);
      slot.projMat.uniforms.uInvModel.value.copy(slot.projMesh.matrixWorld).invert();
    }
    if (rendered === 0) return 0;

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget?.(target);
    renderer.render(projectedScene, camera);
    renderer.autoClear = prevAutoClear;
    return rendered;
  }

  function clear() {
    for (const slot of pool) deactivateSlot(slot);
    cursor = 0;
  }

  function getStats() {
    let active = 0;
    for (const slot of pool) if (slot.active) active++;
    return { active, capacity, recycled, totalSpawned, mode: activeMode };
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    for (const slot of pool) {
      slot.mesh.removeFromParent?.();
      slot.material.dispose?.();
      slot.projMesh?.removeFromParent?.();
      slot.projMat?.dispose?.();
    }
    unitBox.dispose?.();
    pool.length = 0;
    return true;
  }

  return {
    get group() { return ownedGroup; },
    get projectedScene() { return projectedScene; },
    get mode() { return activeMode; },
    get capacity() { return capacity; },
    setMode,
    spawn,
    update,
    renderProjected,
    clear,
    getStats,
    dispose,
  };
}
