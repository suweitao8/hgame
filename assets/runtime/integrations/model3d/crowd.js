/** VAT instanced crowd. */

/**
 * Minimal structural view of a Three.js object/geometry/material/texture used by the crowd.
 * @typedef {{ [member: string]: unknown }} Model3DCrowdObject
 */

/**
 * Options for {@link createInstancedCrowd3D}.
 * @typedef {object} InstancedCrowd3DOptions
 * @property {import('./helpers.js').Model3DAsset | null} [asset=null] Loaded asset (`scene` + `animations`).
 * @property {import('./helpers.js').Model3DObject | null} [root=null] Root object (alternative to `asset`).
 * @property {import('./helpers.js').Model3DClip[] | null} [animations=null] Clips to bake (defaults to `asset.animations`).
 * @property {number} [capacity=1024] Maximum instances (integer 1..100000).
 * @property {number} [sampleFps=15] VAT bake sample rate in frames per second (clamped 4..60).
 * @property {boolean} [castShadow=false] Instanced mesh casts shadows.
 * @property {boolean} [receiveShadow=true] Instanced mesh receives shadows.
 * @property {boolean} [perInstanceColor=false] Enable per-instance color.
 * @property {number} [cullRadius=1.2] Per-instance bounding radius in world units (before scale).
 * @property {number} [scale=1] Default per-instance uniform scale.
 */

/**
 * Options for {@link InstancedCrowd3D.spawn}.
 * @typedef {object} CrowdSpawnOptions
 * @property {number} [x=0] World X.
 * @property {number} [y=0] World Y.
 * @property {number} [z=0] World Z.
 * @property {number} [rotationY=0] Yaw in radians.
 * @property {number} [scale] Uniform scale (defaults to the crowd `scale`).
 * @property {string | null} [clip] Clip name (defaults to the first baked clip).
 * @property {number} [time=0] Start time in seconds.
 * @property {number} [speed=1] Playback speed multiplier.
 * @property {{r: number, g: number, b: number} | number | string | null} [color=null] Per-instance color (when `perInstanceColor`).
 */

/**
 * Options for {@link InstancedCrowd3D.play}.
 * @typedef {object} CrowdPlayOptions
 * @property {number} [speed=1] Playback speed multiplier.
 * @property {boolean} [randomizePhase=false] Start at `phase` of the clip instead of 0.
 * @property {number} [phase=0] Normalized start phase 0..1 (used with `randomizePhase`).
 */

/**
 * Options for {@link InstancedCrowd3D.update}.
 * @typedef {object} CrowdUpdateOptions
 * @property {{ [member: string]: unknown } | null} [culler=null] Scene culler (see `createSceneCuller3D`) used to cull instances.
 */

/**
 * Statistics returned by {@link InstancedCrowd3D.update}.
 * @typedef {object} CrowdUpdateStats
 * @property {number} activeCount Allocated instances.
 * @property {number} visibleCount Instances that passed culling.
 * @property {number} culledCount Instances culled.
 * @property {number} drawCalls 1 when any instance is visible, else 0.
 */

/**
 * VAT bake metadata.
 * @typedef {object} CrowdVatInfo
 * @property {number} width Texture width in texels.
 * @property {number} height Texture height in texels.
 * @property {number} stride Vertices per texture row.
 * @property {number} rowsPerFrame Texture rows per baked frame.
 * @property {number} totalFrames Total baked frame slices.
 */

/**
 * Crowd API returned by {@link createInstancedCrowd3D}.
 * @typedef {object} InstancedCrowd3D
 * @property {Model3DCrowdObject} mesh The InstancedMesh (single draw call).
 * @property {number} capacity Maximum instances.
 * @property {Model3DCrowdObject | null} vatTexture Baked VAT DataTexture, or null when baking was not possible (getter).
 * @property {CrowdVatInfo | null} vatInfo Copy of the VAT metadata (getter).
 * @property {number} count Allocated instance count (getter).
 * @property {() => string[]} getClipNames Baked clip names.
 * @property {(options?: CrowdSpawnOptions) => number} spawn Allocates an instance; returns its index or -1 when full.
 * @property {(index: number, x: number, y: number, z: number, rotY?: number, scale?: number) => boolean} setTransform Sets position (world units), yaw (radians), and scale.
 * @property {(index: number, rotX: number, rotY: number, rotZ: number) => boolean} setRotation Sets Euler rotation in radians.
 * @property {(index: number, r: number, g: number, b: number) => boolean} setColor Sets per-instance color (0..1 channels).
 * @property {(index: number, clipName: string, options?: CrowdPlayOptions) => boolean} play Switches an instance's clip.
 * @property {(index: number, duration?: number) => boolean} hitFlash Flashes an instance white for `duration` seconds (default 0.08).
 * @property {(index: number) => boolean} kill Frees an instance.
 * @property {() => void} clear Frees all instances.
 * @property {(dt?: number, options?: CrowdUpdateOptions) => CrowdUpdateStats} update Advances animation (`dt` seconds) and flushes instance data.
 * @property {() => void} dispose Releases geometry, material, and texture.
 */
import { cloneObject3DWithSkins } from './helpers.js';
import { createInstancedBatch3D } from '../culling3d.js';
import { createInstanceUpdateRanges } from '../../internal/instance-buffer-updates.js';

/**
 * Bakes Skeletal AnimationClips into a Vertex Animation Texture (VAT) RGBA Float DataTexture
 * and wraps geometry+material into a single-draw-call GPU InstancedMesh crowd.
 * @param {import('./helpers.js').Model3DThree} THREE Three.js namespace (needs `InstancedMesh`, `BufferGeometry`; VAT baking also needs `AnimationMixer`, `DataTexture`, `InstancedBufferAttribute`).
 * @param {InstancedCrowd3DOptions} [options] Crowd options.
 * @returns {InstancedCrowd3D} Crowd API.
 */
export function createInstancedCrowd3D(THREE, {
  asset = null,
  root = null,
  animations = null,
  capacity = 1024,
  sampleFps = 15,
  castShadow = false,
  receiveShadow = true,
  perInstanceColor = false,
  cullRadius = 1.2,
  scale = 1,
} = {}) {
  if (!THREE?.InstancedMesh || !THREE?.BufferGeometry) {
    throw new TypeError('createInstancedCrowd3D requires THREE.InstancedMesh and BufferGeometry');
  }
  const sourceRoot = root ?? asset?.scene;
  if (!sourceRoot || typeof sourceRoot.traverse !== 'function') {
    throw new TypeError('createInstancedCrowd3D requires asset or root Object3D');
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
    throw new RangeError('createInstancedCrowd3D capacity must be an integer in 1..100000');
  }

  const clipList = Array.isArray(animations)
    ? animations
    : (Array.isArray(asset?.animations) ? asset.animations : []);

  const clonedRoot = cloneObject3DWithSkins(THREE, sourceRoot);
  clonedRoot.position?.set?.(0, 0, 0);
  clonedRoot.updateMatrixWorld?.(true);

  let srcMesh = null;
  clonedRoot.traverse((node) => {
    if (!srcMesh && (node.isSkinnedMesh || node.isMesh)) srcMesh = node;
  });
  if (!srcMesh?.geometry?.attributes?.position) {
    throw new Error('createInstancedCrowd3D could not find a Mesh with position attribute');
  }

  const bakedGeometry = srcMesh.geometry.clone();
  bakedGeometry.deleteAttribute?.('skinIndex');
  bakedGeometry.deleteAttribute?.('skinWeight');

  const srcMat = Array.isArray(srcMesh.material) ? srcMesh.material[0] : srcMesh.material;
  const crowdMaterial = srcMat?.clone ? srcMat.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff });

  const clipMeta = new Map();
  let vatTexture = null;
  let vatMeta = null;

  const canBakeVat = Boolean(
    srcMesh.isSkinnedMesh &&
    typeof srcMesh.applyBoneTransform === 'function' &&
    THREE.AnimationMixer &&
    THREE.DataTexture &&
    THREE.RGBAFormat &&
    THREE.FloatType &&
    THREE.InstancedBufferAttribute &&
    clipList.length > 0
  );

  if (canBakeVat) {
    const posAttr = srcMesh.geometry.attributes.position;
    const vertCount = posAttr.count;
    const stride = Math.min(2048, Math.max(1, vertCount));
    const rowsPerFrame = Math.ceil(vertCount / stride);
    const fps = Math.max(4, Math.min(60, sampleFps));

    let totalFrameSlices = 0;
    const ranges = [];
    for (const clip of clipList) {
      const duration = Math.max(1 / fps, Number(clip?.duration) || 1);
      const frames = Math.max(2, Math.ceil(duration * fps) + 1);
      ranges.push({ clip, name: clip.name || `clip_${ranges.length}`, duration, frames, startFrame: totalFrameSlices });
      clipMeta.set(clip.name || `clip_${ranges.length - 1}`, {
        startFrame: totalFrameSlices,
        frames,
        duration,
      });
      totalFrameSlices += frames;
    }

    const texWidth = stride;
    const texHeight = Math.max(1, totalFrameSlices * rowsPerFrame);
    const pixels = new Float32Array(texWidth * texHeight * 4);
    const mixer = new THREE.AnimationMixer(clonedRoot);
    const v = new THREE.Vector3();

    for (const r of ranges) {
      const action = mixer.clipAction(r.clip);
      action.reset();
      action.play();
      for (let f = 0; f < r.frames; f++) {
        const t = r.frames > 1 ? (f / (r.frames - 1)) * r.duration : 0;
        mixer.setTime(t);
        clonedRoot.updateMatrixWorld(true);
        srcMesh.skeleton?.update?.();
        const globalFrame = r.startFrame + f;
        for (let vi = 0; vi < vertCount; vi++) {
          v.fromBufferAttribute(posAttr, vi);
          srcMesh.applyBoneTransform(vi, v);
          const tx = vi % stride;
          const ty = globalFrame * rowsPerFrame + Math.floor(vi / stride);
          const pIdx = (ty * texWidth + tx) * 4;
          pixels[pIdx] = v.x;
          pixels[pIdx + 1] = v.y;
          pixels[pIdx + 2] = v.z;
          pixels[pIdx + 3] = 1;
        }
      }
      action.stop();
    }
    mixer.stopAllAction?.();
    mixer.uncacheRoot?.(clonedRoot);

    vatTexture = new THREE.DataTexture(pixels, texWidth, texHeight, THREE.RGBAFormat, THREE.FloatType);
    vatTexture.minFilter = THREE.NearestFilter;
    vatTexture.magFilter = THREE.NearestFilter;
    if (THREE.NoColorSpace !== undefined) vatTexture.colorSpace = THREE.NoColorSpace;
    vatTexture.needsUpdate = true;

    vatMeta = { width: texWidth, height: texHeight, stride, rowsPerFrame, totalFrames: totalFrameSlices };

    crowdMaterial.customProgramCacheKey = () => `hgame-vat-crowd-v1:${stride}:${rowsPerFrame}`;
    const prevOnBeforeCompile = crowdMaterial.onBeforeCompile;
    crowdMaterial.onBeforeCompile = (shader, renderer) => {
      prevOnBeforeCompile?.(shader, renderer);
      shader.uniforms.uCrowdVat = { value: vatTexture };
      shader.uniforms.uCrowdVatStride = { value: stride };
      shader.uniforms.uCrowdRowsPerFrame = { value: rowsPerFrame };

      shader.vertexShader = [
        'attribute vec4 aCrowdAnim;',
        'uniform sampler2D uCrowdVat;',
        'uniform int uCrowdVatStride;',
        'uniform int uCrowdRowsPerFrame;',
        'varying float vCrowdFlash;',
        'vec3 hgameFetchVatPos(int frameIdx) {',
        '  int vid = gl_VertexID;',
        '  int tx = vid % uCrowdVatStride;',
        '  int ty = frameIdx * uCrowdRowsPerFrame + (vid / uCrowdVatStride);',
        '  return texelFetch(uCrowdVat, ivec2(tx, ty), 0).xyz;',
        '}',
      ].join('\n') + '\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '{',
          '  vec3 vatA = hgameFetchVatPos(int(aCrowdAnim.x));',
          '  vec3 vatB = hgameFetchVatPos(int(aCrowdAnim.y));',
          '  transformed = mix(vatA, vatB, aCrowdAnim.z);',
          '  vCrowdFlash = aCrowdAnim.w;',
          '}',
        ].join('\n'),
      );

      shader.fragmentShader = 'varying float vCrowdFlash;\n' + shader.fragmentShader.replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(vCrowdFlash, 0.0, 1.0));',
        ].join('\n'),
      );
    };
  }

  let animAttr = null;
  if (THREE.InstancedBufferAttribute) {
    animAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    if (THREE.DynamicDrawUsage !== undefined) animAttr.setUsage?.(THREE.DynamicDrawUsage);
    bakedGeometry.setAttribute('aCrowdAnim', animAttr);
  }
  const animationUpdates = createInstanceUpdateRanges(4);
  let animationArray = null;
  let bufferedAnimationRows = 0;

  const batch = createInstancedBatch3D(THREE, {
    geometry: bakedGeometry,
    material: crowdMaterial,
    capacity,
    castShadow,
    receiveShadow,
    perInstanceColor,
    cullRadius,
  });

  const agentClip = new Array(capacity).fill(null);
  const agentTime = new Float32Array(capacity);
  const agentSpeed = new Float32Array(capacity).fill(1);
  const agentFlash = new Float32Array(capacity);
  const agentFlashRate = new Float32Array(capacity);
  const defaultClipName = clipMeta.size > 0 ? clipMeta.keys().next().value : null;
  const activeSet = new Set();

  function spawn({
    x = 0, y = 0, z = 0,
    rotationY = 0, scale: agentScale = scale,
    clip = defaultClipName, time = 0, speed = 1,
    color = null,
  } = {}) {
    const idx = batch.alloc({ x, y, z, rotationY, scale: agentScale, radius: cullRadius * agentScale, color });
    if (idx < 0) return -1;
    agentClip[idx] = clip && clipMeta.has(clip) ? clipMeta.get(clip) : (defaultClipName ? clipMeta.get(defaultClipName) : null);
    agentTime[idx] = time;
    agentSpeed[idx] = speed;
    agentFlash[idx] = 0;
    agentFlashRate[idx] = 0;
    activeSet.add(idx);
    return idx;
  }

  function play(idx, clipName, { speed = 1, randomizePhase = false, phase = 0 } = {}) {
    const meta = clipMeta.get(clipName);
    if (!meta || idx < 0 || idx >= capacity) return false;
    agentClip[idx] = meta;
    agentSpeed[idx] = speed;
    agentTime[idx] = randomizePhase ? (phase * meta.duration) : 0;
    return true;
  }

  function hitFlash(idx, duration = 0.08) {
    if (idx < 0 || idx >= capacity || !activeSet.has(idx)) return false;
    if (!(duration > 0)) {
      agentFlash[idx] = 0;
      agentFlashRate[idx] = 0;
      return true;
    }
    agentFlash[idx] = 1;
    agentFlashRate[idx] = 1 / duration;
    return true;
  }

  function kill(idx) {
    const ok = batch.free(idx);
    if (ok) {
      agentClip[idx] = null;
      activeSet.delete(idx);
    }
    return ok;
  }

  function writeVisibleAnimation(outSlot, idx) {
    const animArr = animationArray;
    const meta = agentClip[idx];
    let firstFrame = meta?.startFrame ?? 0;
    let nextFrame = firstFrame;
    let blend = 0;
    if (meta && meta.frames > 0 && meta.duration > 0) {
      const norm = ((agentTime[idx] % meta.duration) + meta.duration) % meta.duration;
      const maxFrame = meta.frames - 1;
      const framePosition = maxFrame > 0 ? (norm / meta.duration) * maxFrame : 0;
      const current = Math.min(maxFrame, Math.floor(framePosition));
      firstFrame = meta.startFrame + current;
      nextFrame = meta.startFrame + (current + 1 < meta.frames ? current + 1 : current);
      blend = Math.fround(framePosition - current);
    }
    const flash = agentFlash[idx] ?? 0;
    const base = outSlot * 4;
    if (outSlot < bufferedAnimationRows && animArr[base] === firstFrame && animArr[base + 1] === nextFrame &&
        animArr[base + 2] === blend && animArr[base + 3] === flash) return;
    animArr[base] = firstFrame;
    animArr[base + 1] = nextFrame;
    animArr[base + 2] = blend;
    animArr[base + 3] = flash;
    animationUpdates.add(outSlot);
  }

  function update(dt = 0, { culler = null } = {}) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (step > 0) {
      for (const idx of activeSet) {
        agentTime[idx] += step * agentSpeed[idx];
        if (agentFlashRate[idx] > 0) {
          const next = agentFlash[idx] - agentFlashRate[idx] * step;
          if (next <= 0) {
            agentFlash[idx] = 0;
            agentFlashRate[idx] = 0;
          } else {
            agentFlash[idx] = next;
          }
        }
      }
    }

    const nextAnimationArray = animAttr?.array ?? null;
    if (nextAnimationArray !== animationArray) {
      animationArray = nextAnimationArray;
      bufferedAnimationRows = 0;
    }
    animationUpdates.reset();
    let flushStats;
    try {
      flushStats = batch.flush({ culler, onVisible: animationArray ? writeVisibleAnimation : null });
    } finally {
      animationUpdates.submit(animAttr);
    }
    bufferedAnimationRows = Math.max(bufferedAnimationRows, flushStats.visible);
    return {
      activeCount: flushStats.totalActive,
      visibleCount: flushStats.visible,
      culledCount: flushStats.culled,
      drawCalls: flushStats.visible > 0 ? 1 : 0,
    };
  }

  function dispose() {
    activeSet.clear();
    batch.dispose();
    bakedGeometry.dispose?.();
    crowdMaterial.dispose?.();
    vatTexture?.dispose?.();
    vatTexture = null;
  }

  return {
    mesh: batch.mesh,
    capacity,
    get vatTexture() { return vatTexture; },
    get vatInfo() { return vatMeta ? { ...vatMeta } : null; },
    get count() { return batch.count; },
    getClipNames: () => [...clipMeta.keys()],
    spawn,
    setTransform: batch.setTransform,
    setRotation: batch.setRotation,
    setColor: batch.setColor,
    play,
    hitFlash,
    kill,
    clear: () => {
      batch.clear();
      activeSet.clear();
    },
    update,
    dispose,
  };
}

