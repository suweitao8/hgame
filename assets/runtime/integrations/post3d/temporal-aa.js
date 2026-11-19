import { FULLSCREEN_PASSES } from './pass-contracts.js';

function halton(index, base) {
  let fraction = 1;
  let result = 0;
  while (index > 0) {
    fraction /= base;
    result += fraction * (index % base);
    index = Math.floor(index / base);
  }
  return result - 0.5;
}

const JITTER = Array.from({ length: 8 }, (_, i) => [halton(i + 1, 2), halton(i + 1, 3)]);

/** Owns one view's color and depth history. */
export function createTemporalAA(THREE, createTarget, createMaterial, createMotion = null) {
  const targets = [];
  const originalProjection = new THREE.Matrix4();
  const originalInverse = new THREE.Matrix4();
  const jitteredProjection = new THREE.Matrix4();
  const currentToWorld = new THREE.Matrix4();
  const previousView = new THREE.Matrix4();
  const uniforms = {
    tCurrentColor: { value: null },
    tCurrentDepth: { value: null },
    tPreviousColor: { value: null },
    tPreviousDepth: { value: null },
    tMotionVectors: { value: null },
    uHasMotionVectors: { value: false },
    uInvProj: { value: new THREE.Matrix4() },
    uPreviousInvProj: { value: new THREE.Matrix4() },
    uPreviousProjection: { value: new THREE.Matrix4() },
    uPreviousFromCurrentView: { value: new THREE.Matrix4() },
    uSceneDepthMode: { value: 0 },
    uJitterUv: { value: new THREE.Vector2() },
    uHistoryWeight: { value: 0 },
  };
  const material = createMaterial(uniforms);
  let index = 0;
  let sampleIndex = 0;
  let lastWorld = null;
  let lastCamera = null;
  let lastDepthMode = -1;
  let motion = null;

  function reset() {
    lastWorld = null;
    lastCamera = null;
    lastDepthMode = -1;
    sampleIndex = 0;
    uniforms.tPreviousColor.value = null;
    uniforms.tPreviousDepth.value = null;
    uniforms.tMotionVectors.value = null;
    uniforms.uHasMotionVectors.value = false;
    uniforms.uHistoryWeight.value = 0;
    motion?.reset();
  }

  function release() {
    for (const target of targets) {
      target.depthTexture?.dispose?.();
      target.dispose?.();
    }
    targets.length = 0;
    index = 0;
    uniforms.tCurrentColor.value = null;
    uniforms.tCurrentDepth.value = null;
    reset();
    motion?.release();
  }

  function jitter(camera, width, height) {
    if (targets.length !== 2 || targets[0].width !== width || targets[0].height !== height) {
      release();
      targets.push(createTarget(width, height));
      targets.push(createTarget(width, height));
    }

    originalProjection.copy(camera.projectionMatrix);
    originalInverse.copy(camera.projectionMatrixInverse);
    const [x, y] = JITTER[sampleIndex];
    sampleIndex = (sampleIndex + 1) % JITTER.length;
    const ux = x / width;
    const uy = y / height;
    uniforms.uJitterUv.value.set(ux, uy);
    // Apply a clip-space translation, preserving off-axis and orthographic cameras.
    const entries = camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i += 4) {
      entries[i] += ux * 2 * entries[i + 3];
      entries[i + 1] += uy * 2 * entries[i + 3];
    }
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    jitteredProjection.copy(camera.projectionMatrix);
    uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
  }

  function restore(camera) {
    // Rendering callbacks may intentionally change the projection. Preserve those edits.
    if (!jitteredProjection.equals(camera.projectionMatrix) || !uniforms.uInvProj.value.equals(camera.projectionMatrixInverse)) {
      reset();
      return false;
    }
    camera.projectionMatrix.copy(originalProjection);
    camera.projectionMatrixInverse.copy(originalInverse);
    return true;
  }

  function resolve(world, camera, color, depth, depthMode, dt, runPass, trackMotion, multisampled) {
    let historyWeight = 0;
    if (lastWorld === world && lastCamera === camera && lastDepthMode === depthMode && dt <= 0.125 &&
        uniforms.uPreviousProjection.value.equals(originalProjection)) {
      currentToWorld.copy(camera.matrixWorldInverse).invert();
      const motion = uniforms.uPreviousFromCurrentView.value.multiplyMatrices(previousView, currentToWorld).elements;
      if (motion[0] + motion[5] + motion[10] > 2.7 && motion[12] ** 2 + motion[13] ** 2 + motion[14] ** 2 < 16) {
        historyWeight = Math.pow(0.88, Math.max(1, dt * 60));
      }
    }

    const history = targets[index];
    const output = targets[index ^ 1];
    let vectors = null;
    if (trackMotion && createMotion) {
      motion ??= createMotion();
      vectors = motion.render(world, camera, depth, depthMode, jitteredProjection, uniforms.uJitterUv.value,
        uniforms.uPreviousProjection.value, previousView, historyWeight, multisampled);
    } else {
      motion?.release();
    }
    uniforms.tMotionVectors.value = vectors;
    uniforms.uHasMotionVectors.value = Boolean(vectors);
    uniforms.tCurrentColor.value = color;
    uniforms.tCurrentDepth.value = depth;
    uniforms.tPreviousColor.value = historyWeight ? history.texture : null;
    uniforms.tPreviousDepth.value = historyWeight ? history.depthTexture : null;
    uniforms.uSceneDepthMode.value = depthMode;
    uniforms.uHistoryWeight.value = historyWeight;
    runPass(FULLSCREEN_PASSES.temporalAA, material, output);

    previousView.copy(camera.matrixWorldInverse);
    uniforms.uPreviousInvProj.value.copy(uniforms.uInvProj.value);
    uniforms.uPreviousProjection.value.copy(originalProjection);
    index ^= 1;
    lastWorld = world;
    lastCamera = camera;
    lastDepthMode = depthMode;
    return output.texture;
  }

  return { targets, jitter, restore, resolve, reset, release, get motionTarget() { return motion?.target ?? null; }, dispose() {
    release();
    motion?.dispose();
    material.dispose?.();
  } };
}
