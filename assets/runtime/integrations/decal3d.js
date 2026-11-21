/**
 * Pooled OBB-projected 3D Decal system with surface normal alignment,
 * polygonOffset anti-Z-fighting, lifetime fade-out, and zero-allocation ring reuse.
 * Never imports 'three' directly; callers inject { THREE }.
 */

/**
 * Create a fixed-capacity pooled 3D decal manager.
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 * @param {number} [options.maxDecals=128] Maximum active decals before oldest ring-buffer recycling.
 * @param {number} [options.fadeSeconds=1.5] Default fade-out duration at the end of a decal lifetime.
 * @param {number} [options.polygonOffsetFactor=-4]
 * @param {number} [options.polygonOffsetUnits=-4]
 * @param {object | null} [options.group=null] Parent Three.js Group/Scene receiving decal meshes.
 */
export function createDecalSystem3D(THREE, {
  maxDecals = 128,
  fadeSeconds = 1.5,
  polygonOffsetFactor = -4,
  polygonOffsetUnits = -4,
  group = null,
} = {}) {
  if (!THREE?.Mesh || !THREE?.BoxGeometry || !THREE?.MeshStandardMaterial || !THREE?.Vector3) {
    throw new TypeError('createDecalSystem3D requires THREE.Mesh, BoxGeometry, MeshStandardMaterial, and Vector3');
  }
  const capacity = Math.max(1, Math.floor(maxDecals) || 128);
  const defaultFade = Math.max(0.05, Number(fadeSeconds) || 1.5);
  const ownedGroup = group ?? (THREE.Group ? new THREE.Group() : null);
  if (ownedGroup && !ownedGroup.name) ownedGroup.name = 'hgame_decal_group';

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
    pool.push({
      id: 0,
      slotIndex: i,
      mesh,
      material,
      active: false,
      age: 0,
      lifetime: 0,
      fadeDuration: defaultFade,
      baseOpacity: 1,
    });
  }

  function deactivateSlot(slot) {
    slot.active = false;
    slot.id = 0;
    slot.mesh.visible = false;
    slot.material.opacity = 0;
    slot.material.map = null;
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
  } = {}) {
    if (disposed) return null;
    // Prefer an inactive slot first; otherwise overwrite oldest ring entry cleanly.
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

    scratchPos.set(px + scratchNorm.x * 0.003, py + scratchNorm.y * 0.003, pz + scratchNorm.z * 0.003);
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

    slot.material.color?.set?.(color);
    slot.material.map = map ?? null;
    slot.material.needsUpdate = true;
    slot.baseOpacity = Math.max(0, Math.min(1, Number(opacity) ?? 1));
    slot.material.opacity = slot.baseOpacity;
    slot.lifetime = Math.max(0.05, Number(lifetime) || 15);
    slot.fadeDuration = Math.max(0.01, Math.min(slot.lifetime, Number(slotFade) || defaultFade));
    slot.age = 0;
    slot.active = true;
    slot.id = nextId++;
    slot.mesh.visible = true;
    totalSpawned++;

    const handleId = slot.id;
    return {
      id: handleId,
      mesh: slot.mesh,
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
        slot.material.opacity = slot.baseOpacity * (remaining / slot.fadeDuration);
      }
    }
    return activeCount;
  }

  function clear() {
    for (const slot of pool) deactivateSlot(slot);
    cursor = 0;
  }

  function getStats() {
    let active = 0;
    for (const slot of pool) if (slot.active) active++;
    return { active, capacity, recycled, totalSpawned };
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    for (const slot of pool) {
      slot.mesh.removeFromParent?.();
      slot.material.dispose?.();
    }
    unitBox.dispose?.();
    pool.length = 0;
    return true;
  }

  return {
    get group() { return ownedGroup; },
    get capacity() { return capacity; },
    spawn,
    update,
    clear,
    getStats,
    dispose,
  };
}
