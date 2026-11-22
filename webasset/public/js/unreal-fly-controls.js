import * as THREE from 'three';

const MIN_FLY_SPEED = 1.0;
const MAX_FLY_SPEED = 60.0;
const DEFAULT_FLY_SPEED = 9.0;
const SPRINT_MULTIPLIER = 3.0;
const PITCH_LIMIT = 1.48;

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Unreal Engine viewport-style camera rig supporting:
 * - 'fly': RMB drag look (or optional PointerLock), WASD view-aligned 3D flight,
 *          E/Space & Q/C world vertical movement, Shift sprint, Wheel speed control,
 *          F focus-on-exhibit, and LMB hover/click raycast selection.
 * - 'orbit': Standard OrbitControls with LMB raycast selection.
 */
export function createUnrealCameraRig({
  camera,
  domElement,
  orbitControls,
  isActive = () => true,
  onModeChange = null,
  onHudUpdate = null,
  onHoverExhibit = null,
  onSelectExhibit = null,
  onHotbarViewpoint = null,
} = {}) {
  const keys = new Set();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  let mode = 'fly'; // 'fly' | 'orbit'
  let flySpeed = DEFAULT_FLY_SPEED;
  let yaw = Math.PI;
  let pitch = -0.25;
  let lookDragging = false;
  let panDragging = false;
  let pointerDownLeft = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let pointerInside = false;

  let exhibits = [];
  let hitTargets = [];
  let hoveredExhibit = null;
  let selectedExhibit = null;
  let defaultFocus = { pos: new THREE.Vector3(0, 12, 24), target: new THREE.Vector3(0, 1, 0) };

  // Smooth tween state for F-focus or viewpoint teleport
  let tween = null;

  const tmpForward = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const tmpUp = new THREE.Vector3(0, 1, 0);
  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const tmpMove = new THREE.Vector3();

  function syncAnglesFromCamera() {
    tmpEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    yaw = tmpEuler.y;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, tmpEuler.x));
  }

  function applyAnglesToCamera() {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    camera.rotation.z = 0;
  }

  function emitHud() {
    onHudUpdate?.({
      mode,
      flySpeed,
      sprinting: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      pointerLocked: document.pointerLockElement === domElement,
      position: camera.position,
      hoveredExhibit,
      selectedExhibit,
    });
  }

  function setMode(nextMode, { preservePose = true } = {}) {
    const resolved = nextMode === 'orbit' ? 'orbit' : 'fly';
    if (resolved === mode) return;
    tween = null;
    if (document.pointerLockElement === domElement && resolved !== 'fly') {
      document.exitPointerLock?.();
    }
    mode = resolved;
    if (mode === 'fly') {
      if (orbitControls) orbitControls.enabled = false;
      if (preservePose) syncAnglesFromCamera();
      applyAnglesToCamera();
    } else {
      if (preservePose && orbitControls) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        orbitControls.target.copy(camera.position).addScaledVector(dir, 10);
      }
      if (orbitControls) {
        orbitControls.enabled = true;
        orbitControls.update();
      }
    }
    onModeChange?.(mode);
    emitHud();
  }

  function setPose(pos, targetOrAngles) {
    tween = null;
    camera.position.set(pos[0], pos[1], pos[2]);
    if (Array.isArray(targetOrAngles)) {
      const lookVec = new THREE.Vector3(...targetOrAngles);
      camera.lookAt(lookVec);
      syncAnglesFromCamera();
      if (orbitControls) {
        orbitControls.target.copy(lookVec);
        orbitControls.update();
      }
    } else if (targetOrAngles && typeof targetOrAngles === 'object') {
      yaw = Number.isFinite(targetOrAngles.yaw) ? targetOrAngles.yaw : Math.PI;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Number(targetOrAngles.pitch) || -0.2));
      applyAnglesToCamera();
      if (orbitControls) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        orbitControls.target.copy(camera.position).addScaledVector(dir, 10);
        orbitControls.update();
      }
    }
    emitHud();
  }

  function flyTo(pos, lookAt, duration = 0.42) {
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const endPos = pos instanceof THREE.Vector3 ? pos.clone() : new THREE.Vector3(...pos);
    const lookTarget = lookAt instanceof THREE.Vector3 ? lookAt.clone() : new THREE.Vector3(...lookAt);
    const probe = camera.clone();
    probe.position.copy(endPos);
    probe.lookAt(lookTarget);
    const endQuat = probe.quaternion.clone();
    tween = {
      elapsed: 0,
      duration: Math.max(0.08, duration),
      startPos,
      endPos,
      startQuat,
      endQuat,
      lookTarget,
    };
  }

  function focusExhibit(exhibit) {
    if (!exhibit) {
      flyTo(defaultFocus.pos, defaultFocus.target);
      return;
    }
    const target = exhibit.focusTarget
      ? new THREE.Vector3(...exhibit.focusTarget)
      : new THREE.Vector3(0, 0.8, 0);
    if (exhibit.focusPos) {
      flyTo(exhibit.focusPos, target);
      return;
    }
    const radius = Math.max(1.4, exhibit.focusRadius || 2.5);
    const dir = new THREE.Vector3().subVectors(camera.position, target);
    if (dir.lengthSq() < 0.01) dir.set(0.3, 0.4, 1);
    dir.normalize();
    const dest = target.clone().addScaledVector(dir, radius * 2.2);
    dest.y = Math.max(dest.y, target.y + radius * 0.45);
    flyTo(dest, target);
  }

  function setDefaultFocus(pos, target) {
    defaultFocus = {
      pos: new THREE.Vector3(...pos),
      target: new THREE.Vector3(...target),
    };
  }

  function setExhibits(list = []) {
    exhibits = list;
    hitTargets = [];
    for (const ex of exhibits) {
      if (Array.isArray(ex.hitMeshes) && ex.hitMeshes.length) {
        for (const m of ex.hitMeshes) {
          m.userData.exhibit = ex;
          hitTargets.push(m);
        }
      } else if (ex.object) {
        ex.object.traverse(child => {
          if (child.isMesh) {
            child.userData.exhibit = ex;
            hitTargets.push(child);
          }
        });
      }
    }
    hoveredExhibit = null;
    selectedExhibit = null;
    emitHud();
  }

  function selectExhibit(exhibit, { focus = false } = {}) {
    selectedExhibit = exhibit || null;
    onSelectExhibit?.(selectedExhibit);
    if (focus && selectedExhibit) focusExhibit(selectedExhibit);
    emitHud();
  }

  function pickAtClientPos(clientX, clientY) {
    if (!hitTargets.length) return null;
    const rect = domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(hitTargets, false);
    for (const hit of hits) {
      const ex = hit.object?.userData?.exhibit;
      if (ex) return ex;
    }
    return null;
  }

  function adjustSpeed(factor) {
    flySpeed = Math.max(MIN_FLY_SPEED, Math.min(MAX_FLY_SPEED, flySpeed * factor));
    emitHud();
  }

  function togglePointerLock() {
    if (mode !== 'fly') return;
    if (document.pointerLockElement === domElement) {
      document.exitPointerLock?.();
    } else {
      domElement.requestPointerLock?.();
    }
  }

  const onContextMenu = (e) => {
    if (mode === 'fly') e.preventDefault();
  };

  const onPointerDown = (e) => {
    if (!isActive()) return;
    domElement.focus?.({ preventScroll: true });
    if (e.button === 2 && mode === 'fly') {
      lookDragging = true;
      tween = null;
      lastX = e.clientX;
      lastY = e.clientY;
      domElement.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    } else if (e.button === 1 && mode === 'fly') {
      panDragging = true;
      tween = null;
      lastX = e.clientX;
      lastY = e.clientY;
      domElement.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    } else if (e.button === 0) {
      pointerDownLeft = true;
      downX = e.clientX;
      downY = e.clientY;
    }
  };

  const onPointerMove = (e) => {
    if (!isActive()) return;
    if (document.pointerLockElement === domElement && mode === 'fly') {
      yaw -= (e.movementX || 0) * 0.0026;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - (e.movementY || 0) * 0.0026));
      applyAnglesToCamera();
      return;
    }

    if (lookDragging && mode === 'fly') {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw -= dx * 0.0036;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - dy * 0.0036));
      applyAnglesToCamera();
      return;
    }

    if (panDragging && mode === 'fly') {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const scale = Math.max(0.008, flySpeed * 0.0025);
      tmpRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(tmpRight, -dx * scale);
      camera.position.addScaledVector(localUp, dy * scale);
      return;
    }

    if (pointerInside && !e.buttons) {
      const hit = pickAtClientPos(e.clientX, e.clientY);
      if (hit !== hoveredExhibit) {
        hoveredExhibit = hit;
        domElement.style.cursor = hit ? 'pointer' : (mode === 'fly' ? 'crosshair' : 'grab');
        onHoverExhibit?.(hoveredExhibit);
      }
    }
  };

  const onPointerUp = (e) => {
    if (e.button === 2) lookDragging = false;
    if (e.button === 1) panDragging = false;
    if (e.button === 0 && pointerDownLeft) {
      pointerDownLeft = false;
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dist <= 6 && isActive()) {
        const hit = document.pointerLockElement === domElement
          ? pickAtCenter()
          : pickAtClientPos(e.clientX, e.clientY);
        if (hit) selectExhibit(hit);
      }
    }
  };

  function pickAtCenter() {
    if (!hitTargets.length) return null;
    pointerNdc.set(0, 0);
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(hitTargets, false);
    for (const hit of hits) {
      const ex = hit.object?.userData?.exhibit;
      if (ex) return ex;
    }
    return null;
  }

  const onPointerEnter = () => { pointerInside = true; };
  const onPointerLeave = () => {
    pointerInside = false;
    if (hoveredExhibit) {
      hoveredExhibit = null;
      onHoverExhibit?.(null);
    }
  };

  const onWheel = (e) => {
    if (!isActive() || mode !== 'fly') return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    adjustSpeed(factor);
  };

  const onKeyDown = (e) => {
    if (!isActive() || isTypingTarget(e.target)) return;
    keys.add(e.code);
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      focusExhibit(hoveredExhibit || selectedExhibit);
    } else if (e.code === 'KeyL' && !e.ctrlKey && !e.metaKey && mode === 'fly') {
      e.preventDefault();
      togglePointerLock();
    } else if (/^Digit[1-9]$/.test(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      onHotbarViewpoint?.(Number(e.code.slice(5)) - 1);
    }
  };

  const onKeyUp = (e) => {
    keys.delete(e.code);
  };

  const onBlur = () => {
    keys.clear();
    lookDragging = false;
    panDragging = false;
    pointerDownLeft = false;
  };

  const onPointerLockChange = () => emitHud();

  domElement.addEventListener('contextmenu', onContextMenu);
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointerenter', onPointerEnter);
  domElement.addEventListener('pointerleave', onPointerLeave);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onPointerLockChange);

  let hudTimer = 0;

  function update(dt) {
    if (tween) {
      tween.elapsed += dt;
      const t = Math.min(1, tween.elapsed / tween.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(tween.startPos, tween.endPos, ease);
      camera.quaternion.slerpQuaternions(tween.startQuat, tween.endQuat, ease);
      syncAnglesFromCamera();
      if (orbitControls) {
        orbitControls.target.copy(tween.lookTarget);
      }
      if (t >= 1) tween = null;
    } else if (mode === 'fly') {
      const sprint = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? SPRINT_MULTIPLIER : 1;
      const spd = flySpeed * sprint * dt;
      tmpQuat.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
      tmpForward.set(0, 0, -1).applyQuaternion(tmpQuat).normalize();
      tmpRight.set(1, 0, 0).applyQuaternion(tmpQuat).normalize();
      tmpMove.set(0, 0, 0);

      if (keys.has('KeyW') || keys.has('ArrowUp')) tmpMove.add(tmpForward);
      if (keys.has('KeyS') || keys.has('ArrowDown')) tmpMove.sub(tmpForward);
      if (keys.has('KeyD') || keys.has('ArrowRight')) tmpMove.add(tmpRight);
      if (keys.has('KeyA') || keys.has('ArrowLeft')) tmpMove.sub(tmpRight);
      if (keys.has('KeyE') || keys.has('Space')) tmpMove.add(tmpUp);
      if (keys.has('KeyQ') || keys.has('KeyC')) tmpMove.sub(tmpUp);

      if (tmpMove.lengthSq() > 0) {
        tmpMove.normalize().multiplyScalar(spd);
        camera.position.add(tmpMove);
      }
      applyAnglesToCamera();
    } else if (orbitControls) {
      orbitControls.update();
    }

    hudTimer += dt;
    if (hudTimer >= 0.12) {
      hudTimer = 0;
      emitHud();
    }
  }

  function dispose() {
    domElement.removeEventListener('contextmenu', onContextMenu);
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('pointerenter', onPointerEnter);
    domElement.removeEventListener('pointerleave', onPointerLeave);
    domElement.removeEventListener('wheel', onWheel);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
  }

  if (orbitControls) orbitControls.enabled = false;
  applyAnglesToCamera();

  return {
    get mode() { return mode; },
    get flySpeed() { return flySpeed; },
    setMode,
    setPose,
    flyTo,
    focusExhibit,
    setDefaultFocus,
    setExhibits,
    selectExhibit,
    adjustSpeed,
    togglePointerLock,
    update,
    dispose,
  };
}
