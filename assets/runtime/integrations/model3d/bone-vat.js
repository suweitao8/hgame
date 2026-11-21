/**
 * 3D Half-Float Bone-VAT Baker, 16-Byte Compressed Instancing, and 3-Level Distance LOD
 * (LOD0 4-bone linear skin, LOD1 simplified 1-bone skin, LOD2 8-direction Y-locked impostor).
 *
 * Compatible with HGame's WebGL2 Three.js pipeline (MegaLights, Irradiance Probes, UE Filmic post3d),
 * with normal-space bone/yaw rotation and view-azimuth billboard selection.
 */

import { createInstanceUpdateRanges } from '../../internal/instance-buffer-updates.js';
import { cloneObject3DWithSkins, computeRootBounds } from './helpers.js';

const HVAT_MAGIC = 0x54415648; // "HVAT" LE
const HVAT_VERSION = 1;
const HVAT_HEADER_BYTES = 32;
const IDENTITY_TRANSFORM = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const CROWD_STATUS_COLOR_GLSL = [
  '#include <color_fragment>',
  'if (vCrowdFlash > 0.5) {',
  '  if (vCrowdFlash < 4.5) {',
  '    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(vCrowdFlash * 0.23, 0.0, 0.92));',
  '  } else if (vCrowdFlash < 5.5) {',
  '    diffuseColor.rgb *= vec3(0.45, 0.85, 1.35);',
  '  } else if (vCrowdFlash < 6.5) {',
  '    diffuseColor.rgb *= vec3(0.45, 1.25, 0.45);',
  '  } else if (vCrowdFlash < 7.5) {',
  '    diffuseColor.rgb *= vec3(1.35, 0.55, 0.30);',
  '  }',
  '}',
].join('\n');

const _f32Scratch = new Float32Array(1);
const _u32Scratch = new Uint32Array(_f32Scratch.buffer);

/**
 * Encodes a finite JS number to IEEE-754 binary16 (uint16), clamping large finite values
 * to `+/-65504` (`0x7bff` / `0xfbff`) to avoid overflowing to Infinity in Bone-VAT texels.
 * @param {number} value
 * @returns {number} 16-bit half-float bits (`0..65535`).
 */
export function float32ToFloat16(value) {
  if (Number.isNaN(value)) return 0x7e00;
  const sign = (value < 0 || Object.is(value, -0)) ? 0x8000 : 0;
  if (!Number.isFinite(value)) return sign | 0x7c00;
  if (value >= 65504) return 0x7bff;
  if (value <= -65504) return 0xfbff;

  _f32Scratch[0] = value;
  const x = _u32Scratch[0];
  const e = (x >>> 23) & 0xff;
  const m = x & 0x7fffff;

  if (e === 0) return sign;

  let halfExp = e - 112;
  if (halfExp <= 0) {
    if (halfExp < -10) return sign;
    const shift = 14 - halfExp;
    const mant = m | 0x800000;
    let halfM = mant >> shift;
    const roundBit = (mant >> (shift - 1)) & 1;
    const stickyMask = (1 << (shift - 1)) - 1;
    if (roundBit !== 0 && ((halfM & 1) !== 0 || (mant & stickyMask) !== 0)) {
      halfM++;
    }
    return sign | halfM;
  }

  if (halfExp >= 31) return sign | 0x7bff;

  let halfM = m >> 13;
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (halfM & 1) !== 0)) {
    halfM++;
    if (halfM >= 0x400) {
      halfM = 0;
      halfExp++;
      if (halfExp >= 31) return sign | 0x7bff;
    }
  }
  return sign | (halfExp << 10) | halfM;
}

/**
 * Decodes an IEEE-754 binary16 uint16 back to a JavaScript float.
 * @param {number} bits 16-bit half-float bits (`0..65535`).
 * @returns {number}
 */
export function float16ToFloat32(bits) {
  const b = bits & 0xffff;
  const s = (b & 0x8000) << 16;
  const e = (b >>> 10) & 0x1f;
  const m = b & 0x03ff;

  if (e === 0) {
    if (m === 0) {
      _u32Scratch[0] = s;
      return _f32Scratch[0];
    }
    const mag = (m / 1024) * Math.pow(2, -14);
    return (b & 0x8000) ? -mag : mag;
  }
  if (e === 31) {
    _u32Scratch[0] = s | 0x7f800000 | (m << 13);
    return _f32Scratch[0];
  }
  _u32Scratch[0] = s | ((e + 112) << 23) | (m << 13);
  return _f32Scratch[0];
}

/**
 * @typedef {object} BoneVatClipMeta
 * @property {string} name
 * @property {number} startFrame
 * @property {number} frames
 * @property {number} duration
 */

/**
 * @typedef {object} BoneVatBakedData
 * @property {Uint16Array} data Half-float RGBA pixel array (`width * height * 4`), 2 texels per bone (`[tx,ty,tz,scale]`, `[qx,qy,qz,qw]`).
 * @property {Float32Array} floatData Float32 RGBA mirror (`width * height * 4`) for fallback WebGL backends without HalfFloat textures.
 * @property {number} width Texture width in texels (`boneCount * 2`).
 * @property {number} height Total baked frame rows across all clips.
 * @property {number} boneCount Number of bones encoded per frame.
 * @property {number} sampleFps Sampling FPS used during bake.
 * @property {number} totalFrames Identical to `height`.
 * @property {BoneVatClipMeta[]} clips Baked clip frame slices.
 * @property {import('./helpers.js').Model3DBounds} bounds Base mesh world bounds.
 */

/**
 * @typedef {object} BakeBoneVatOptions
 * @property {import('./helpers.js').Model3DAsset | null} [asset=null] Loaded GLTF asset (`scene` + `animations`).
 * @property {import('./helpers.js').Model3DObject | null} [root=null] Alternative root Object3D.
 * @property {import('./helpers.js').Model3DClip[] | null} [animations=null] Clips overriding `asset.animations`.
 * @property {number} [sampleFps=30] Bake sample rate in FPS (clamped `4..60`).
 */

function decomposeColMajorMat4(arr, offset) {
  const m00 = arr[offset], m01 = arr[offset + 1], m02 = arr[offset + 2];
  const m10 = arr[offset + 4], m11 = arr[offset + 5], m12 = arr[offset + 6];
  const m20 = arr[offset + 8], m21 = arr[offset + 9], m22 = arr[offset + 10];
  const tx = arr[offset + 12], ty = arr[offset + 13], tz = arr[offset + 14];

  let sx = Math.hypot(m00, m01, m02);
  let sy = Math.hypot(m10, m11, m12);
  let sz = Math.hypot(m20, m21, m22);

  const det =
    m00 * (m11 * m22 - m12 * m21) -
    m10 * (m01 * m22 - m02 * m21) +
    m20 * (m01 * m12 - m02 * m11);
  if (det < 0) sx = -sx;

  const invSx = Math.abs(sx) > 1e-8 ? 1 / sx : 0;
  const invSy = Math.abs(sy) > 1e-8 ? 1 / sy : 0;
  const invSz = Math.abs(sz) > 1e-8 ? 1 / sz : 0;

  const r00 = m00 * invSx, r10 = m01 * invSx, r20 = m02 * invSx;
  const r01 = m10 * invSy, r11 = m11 * invSy, r21 = m12 * invSy;
  const r02 = m20 * invSz, r12 = m21 * invSz, r22 = m22 * invSz;

  const trace = r00 + r11 + r22;
  let qx = 0, qy = 0, qz = 0, qw = 1;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    qw = 0.25 / s;
    qx = (r21 - r12) * s;
    qy = (r02 - r20) * s;
    qz = (r10 - r01) * s;
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(Math.max(1e-12, 1 + r00 - r11 - r22));
    qw = (r21 - r12) / s;
    qx = 0.25 * s;
    qy = (r01 + r10) / s;
    qz = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(Math.max(1e-12, 1 + r11 - r00 - r22));
    qw = (r02 - r20) / s;
    qx = (r01 + r10) / s;
    qy = 0.25 * s;
    qz = (r12 + r21) / s;
  } else {
    const s = 2 * Math.sqrt(Math.max(1e-12, 1 + r22 - r00 - r11));
    qw = (r10 - r01) / s;
    qx = (r02 + r20) / s;
    qy = (r12 + r21) / s;
    qz = 0.25 * s;
  }

  const qLen = Math.hypot(qx, qy, qz, qw);
  if (qLen > 1e-8) {
    qx /= qLen; qy /= qLen; qz /= qLen; qw /= qLen;
  }
  const uniScale = (Math.abs(sx) + Math.abs(sy) + Math.abs(sz)) / 3;
  return [tx, ty, tz, uniScale || 1, qx, qy, qz, qw];
}

function createIdentityBoneVat(bounds) {
  const data = new Uint16Array(8);
  const floatData = new Float32Array(8);
  const vals = [0, 0, 0, 1, 0, 0, 0, 1];
  for (let i = 0; i < 8; i++) {
    floatData[i] = vals[i];
    data[i] = float32ToFloat16(vals[i]);
  }
  return {
    data,
    floatData,
    width: 2,
    height: 1,
    boneCount: 1,
    sampleFps: 30,
    totalFrames: 1,
    clips: [{ name: 'idle', startFrame: 0, frames: 1, duration: 1 / 30 }],
    bounds,
  };
}

/**
 * Bakes skeletal AnimationClips into a compact Half-Float Bone-VAT texture (`2 * boneCount` texels wide)
 * with hemisphere-continuous quaternions so frame lerp never flips along the long arc.
 * @param {import('./helpers.js').Model3DThree} THREE
 * @param {BakeBoneVatOptions} [options]
 * @returns {BoneVatBakedData}
 */
export function bakeBoneVatData(THREE, {
  asset = null,
  root = null,
  animations = null,
  sampleFps = 30,
} = {}) {
  if (!THREE) throw new TypeError('bakeBoneVatData requires THREE');
  const sourceRoot = root ?? asset?.scene;
  if (!sourceRoot || typeof sourceRoot.traverse !== 'function') {
    throw new TypeError('bakeBoneVatData requires asset or root Object3D');
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
    throw new Error('bakeBoneVatData could not find a Mesh with position attribute');
  }

  const bounds = computeRootBounds(THREE, clonedRoot);
  const skeleton = srcMesh.isSkinnedMesh ? srcMesh.skeleton : null;
  const boneCount = skeleton?.bones?.length || 0;
  const fps = Math.max(4, Math.min(60, Number(sampleFps) || 30));

  if (!skeleton || boneCount < 1 || clipList.length === 0 || !THREE.AnimationMixer) {
    return createIdentityBoneVat(bounds);
  }

  let totalFrames = 0;
  const clipInfos = [];
  for (let i = 0; i < clipList.length; i++) {
    const clip = clipList[i];
    const duration = Math.max(1 / fps, Number(clip?.duration) || 1);
    const frames = Math.max(2, Math.ceil(duration * fps) + 1);
    const name = clip?.name || `clip_${i}`;
    clipInfos.push({ clip, name, startFrame: totalFrames, frames, duration });
    totalFrames += frames;
  }

  const width = boneCount * 2;
  const height = Math.max(1, totalFrames);
  const data = new Uint16Array(width * height * 4);
  const floatData = new Float32Array(width * height * 4);

  const mixer = new THREE.AnimationMixer(clonedRoot);
  const hasMatTools = Boolean(THREE.Matrix4 && THREE.Vector3 && THREE.Quaternion);
  const matLocal = hasMatTools ? new THREE.Matrix4() : null;
  const posVec = hasMatTools ? new THREE.Vector3() : null;
  const quatVec = hasMatTools ? new THREE.Quaternion() : null;
  const scaleVec = hasMatTools ? new THREE.Vector3() : null;
  const hasBindMatrices = Boolean(hasMatTools && srcMesh.bindMatrix && srcMesh.bindMatrixInverse);

  const prevQuats = new Float32Array(boneCount * 4);

  for (const info of clipInfos) {
    const action = mixer.clipAction(info.clip);
    action.reset();
    action.play();

    for (let f = 0; f < info.frames; f++) {
      const t = info.frames > 1 ? (f / (info.frames - 1)) * info.duration : 0;
      mixer.setTime(t);
      clonedRoot.updateMatrixWorld?.(true);
      skeleton.update?.();

      const bm = skeleton.boneMatrices;
      const rowOffset = (info.startFrame + f) * width * 4;

      for (let b = 0; b < boneCount; b++) {
        let tx = 0, ty = 0, tz = 0, uniScale = 1;
        let qx = 0, qy = 0, qz = 0, qw = 1;

        if (bm && bm.length >= (b + 1) * 16) {
          if (hasMatTools && matLocal.fromArray) {
            matLocal.fromArray(bm, b * 16);
            if (hasBindMatrices) {
              matLocal.multiply(srcMesh.bindMatrix);
              matLocal.premultiply(srcMesh.bindMatrixInverse);
            }
            matLocal.decompose(posVec, quatVec, scaleVec);
            tx = posVec.x; ty = posVec.y; tz = posVec.z;
            uniScale = (Math.abs(scaleVec.x) + Math.abs(scaleVec.y) + Math.abs(scaleVec.z)) / 3 || 1;
            qx = quatVec.x; qy = quatVec.y; qz = quatVec.z; qw = quatVec.w;
          } else {
            const parts = decomposeColMajorMat4(bm, b * 16);
            [tx, ty, tz, uniScale, qx, qy, qz, qw] = parts;
          }
        }

        const pqBase = b * 4;
        if (f > 0) {
          const dot =
            prevQuats[pqBase] * qx +
            prevQuats[pqBase + 1] * qy +
            prevQuats[pqBase + 2] * qz +
            prevQuats[pqBase + 3] * qw;
          if (dot < 0) {
            qx = -qx; qy = -qy; qz = -qz; qw = -qw;
          }
        }
        prevQuats[pqBase] = qx;
        prevQuats[pqBase + 1] = qy;
        prevQuats[pqBase + 2] = qz;
        prevQuats[pqBase + 3] = qw;

        const base = rowOffset + b * 8;
        floatData[base] = tx;
        floatData[base + 1] = ty;
        floatData[base + 2] = tz;
        floatData[base + 3] = uniScale;
        floatData[base + 4] = qx;
        floatData[base + 5] = qy;
        floatData[base + 6] = qz;
        floatData[base + 7] = qw;

        data[base] = float32ToFloat16(tx);
        data[base + 1] = float32ToFloat16(ty);
        data[base + 2] = float32ToFloat16(tz);
        data[base + 3] = float32ToFloat16(uniScale);
        data[base + 4] = float32ToFloat16(qx);
        data[base + 5] = float32ToFloat16(qy);
        data[base + 6] = float32ToFloat16(qz);
        data[base + 7] = float32ToFloat16(qw);
      }
    }
    action.stop();
  }

  mixer.stopAllAction?.();
  mixer.uncacheRoot?.(clonedRoot);

  return {
    data,
    floatData,
    width,
    height,
    boneCount,
    sampleFps: fps,
    totalFrames,
    clips: clipInfos.map(c => ({ name: c.name, startFrame: c.startFrame, frames: c.frames, duration: c.duration })),
    bounds,
  };
}

/**
 * Serializes a {@link BoneVatBakedData} struct into a compact `.vat.bin` ArrayBuffer (`"HVAT"` header + JSON metadata + Uint16 half-float texels).
 * @param {BoneVatBakedData} baked
 * @returns {ArrayBuffer}
 */
export function encodeBoneVatBinary(baked) {
  if (!baked?.data || !Number.isInteger(baked.width) || !Number.isInteger(baked.height)) {
    throw new TypeError('encodeBoneVatBinary requires baked Bone-VAT data');
  }
  const metaJson = JSON.stringify({
    clips: baked.clips ?? [],
    bounds: baked.bounds ?? null,
  });
  const metaBytes = new TextEncoder().encode(metaJson);
  const paddedMetaLen = (metaBytes.byteLength + 3) & ~3;
  const payloadBytes = baked.data.byteLength;
  const totalBytes = HVAT_HEADER_BYTES + paddedMetaLen + payloadBytes;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  view.setUint32(0, HVAT_MAGIC, true);
  view.setUint32(4, HVAT_VERSION, true);
  view.setUint32(8, baked.boneCount | 0, true);
  view.setUint32(12, baked.width | 0, true);
  view.setUint32(16, baked.height | 0, true);
  view.setFloat32(20, Number(baked.sampleFps) || 30, true);
  view.setUint32(24, metaBytes.byteLength, true);
  view.setUint32(28, payloadBytes, true);

  const outBytes = new Uint8Array(buffer);
  outBytes.set(metaBytes, HVAT_HEADER_BYTES);
  const srcBytes = new Uint8Array(baked.data.buffer, baked.data.byteOffset, baked.data.byteLength);
  outBytes.set(srcBytes, HVAT_HEADER_BYTES + paddedMetaLen);
  return buffer;
}

/**
 * Decodes an `"HVAT"` binary ArrayBuffer produced by {@link encodeBoneVatBinary}.
 * @param {ArrayBuffer | Uint8Array} input
 * @returns {BoneVatBakedData}
 */
export function decodeBoneVatBinary(input) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : (ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null);
  if (!bytes || bytes.byteLength < HVAT_HEADER_BYTES) {
    throw new RangeError('Invalid HVAT binary: buffer too short');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== HVAT_MAGIC) throw new Error('Invalid HVAT binary: bad magic');
  const version = view.getUint32(4, true);
  if (version !== HVAT_VERSION) throw new Error(`Unsupported HVAT version: ${version}`);

  const boneCount = view.getUint32(8, true);
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  const sampleFps = view.getFloat32(20, true);
  const metaLen = view.getUint32(24, true);
  const payloadBytes = view.getUint32(28, true);

  const paddedMetaLen = (metaLen + 3) & ~3;
  const payloadOffset = HVAT_HEADER_BYTES + paddedMetaLen;
  if (payloadOffset + payloadBytes > bytes.byteLength) {
    throw new RangeError('Invalid HVAT binary: truncated payload');
  }

  const metaText = new TextDecoder().decode(bytes.subarray(HVAT_HEADER_BYTES, HVAT_HEADER_BYTES + metaLen));
  const meta = JSON.parse(metaText);
  const expectedLength = width * height * 4;
  if (payloadBytes !== expectedLength * 2) {
    throw new RangeError('Invalid HVAT binary: texel byte size mismatch');
  }

  const data = new Uint16Array(expectedLength);
  new Uint8Array(data.buffer).set(bytes.subarray(payloadOffset, payloadOffset + payloadBytes));

  const floatData = new Float32Array(expectedLength);
  for (let i = 0; i < expectedLength; i++) {
    floatData[i] = float16ToFloat32(data[i]);
  }

  return {
    data,
    floatData,
    width,
    height,
    boneCount,
    sampleFps,
    totalFrames: height,
    clips: Array.isArray(meta.clips) ? meta.clips : [],
    bounds: meta.bounds ?? null,
  };
}

/**
 * @typedef {object} SimplifyLodOptions
 * @property {number} [gridResolution=12] Voxel clustering resolution per axis for LOD1 reduction (integer >= 2).
 */

function dominantBoneIndexForVertex(skinIdxArr, skinWtArr, v) {
  if (!skinIdxArr || !skinWtArr) return 0;
  let bestBone = skinIdxArr[v * 4] | 0;
  let bestW = -1;
  for (let k = 0; k < 4; k++) {
    const w = skinWtArr[v * 4 + k];
    if (w > bestW) {
      bestW = w;
      bestBone = skinIdxArr[v * 4 + k] | 0;
    }
  }
  return bestBone;
}

function collapseToSingleBoneGeometry(THREE, srcGeom) {
  const geom = srcGeom.clone();
  const posAttr = geom.attributes.position;
  const vertCount = posAttr.count;
  const skinIdxArr = geom.attributes.skinIndex?.array ?? null;
  const skinWtArr = geom.attributes.skinWeight?.array ?? null;

  const outIdx = new Float32Array(vertCount * 4);
  const outWt = new Float32Array(vertCount * 4);
  for (let v = 0; v < vertCount; v++) {
    outIdx[v * 4] = dominantBoneIndexForVertex(skinIdxArr, skinWtArr, v);
    outWt[v * 4] = 1;
  }
  geom.setAttribute('skinIndex', new THREE.BufferAttribute(outIdx, 4));
  geom.setAttribute('skinWeight', new THREE.BufferAttribute(outWt, 4));
  return geom;
}

/**
 * Zero-dependency spatial vertex-clustering geometry simplifier for `LOD1`, preserving UVs, normals,
 * and collapsing `skinIndex`/`skinWeight` down to a single dominant bone per vertex (75% fewer VAT fetches).
 * @param {import('./helpers.js').Model3DThree} THREE
 * @param {object} geometry Source `THREE.BufferGeometry`.
 * @param {SimplifyLodOptions} [options]
 * @returns {object} Simplified geometry (or dominant-bone clone when triangle count is already tiny).
 */
export function buildSimplifiedLodGeometry(THREE, geometry, { gridResolution = 12 } = {}) {
  if (!THREE?.BufferGeometry || !geometry?.attributes?.position) {
    throw new TypeError('buildSimplifiedLodGeometry requires THREE and a BufferGeometry with position');
  }
  const posAttr = geometry.attributes.position;
  const vertCount = posAttr.count;
  const indexAttr = geometry.index ?? null;
  const triCount = Math.floor((indexAttr ? indexAttr.count : vertCount) / 3);
  if (triCount <= 24 || vertCount <= 16) {
    return collapseToSingleBoneGeometry(THREE, geometry);
  }

  const res = Math.max(2, Math.min(64, Math.round(gridResolution)));
  const normAttr = geometry.attributes.normal ?? null;
  const uvAttr = geometry.attributes.uv ?? null;
  const skinIdxAttr = geometry.attributes.skinIndex ?? null;
  const skinWtAttr = geometry.attributes.skinWeight ?? null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < vertCount; v++) {
    const x = posAttr.array[v * 3];
    const y = posAttr.array[v * 3 + 1];
    const z = posAttr.array[v * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const invX = res / Math.max(1e-5, maxX - minX);
  const invY = res / Math.max(1e-5, maxY - minY);
  const invZ = res / Math.max(1e-5, maxZ - minZ);

  const cellToCluster = new Map();
  const vertToCluster = new Int32Array(vertCount);
  const sumX = [];
  const sumY = [];
  const sumZ = [];
  const sumNx = [];
  const sumNy = [];
  const sumNz = [];
  const sumU = [];
  const sumV = [];
  const counts = [];
  const boneMaps = [];

  for (let v = 0; v < vertCount; v++) {
    const x = posAttr.array[v * 3];
    const y = posAttr.array[v * 3 + 1];
    const z = posAttr.array[v * 3 + 2];
    const gx = Math.min(res - 1, Math.max(0, Math.floor((x - minX) * invX)));
    const gy = Math.min(res - 1, Math.max(0, Math.floor((y - minY) * invY)));
    const gz = Math.min(res - 1, Math.max(0, Math.floor((z - minZ) * invZ)));
    const key = (gx * 65536) + (gy * 256) + gz;

    let cid = cellToCluster.get(key);
    if (cid === undefined) {
      cid = counts.length;
      cellToCluster.set(key, cid);
      sumX.push(0); sumY.push(0); sumZ.push(0);
      sumNx.push(0); sumNy.push(0); sumNz.push(0);
      sumU.push(0); sumV.push(0);
      counts.push(0);
      boneMaps.push(new Map());
    }
    vertToCluster[v] = cid;
    counts[cid]++;
    sumX[cid] += x;
    sumY[cid] += y;
    sumZ[cid] += z;
    if (normAttr) {
      sumNx[cid] += normAttr.array[v * 3];
      sumNy[cid] += normAttr.array[v * 3 + 1];
      sumNz[cid] += normAttr.array[v * 3 + 2];
    }
    if (uvAttr) {
      sumU[cid] += uvAttr.array[v * 2];
      sumV[cid] += uvAttr.array[v * 2 + 1];
    }
    if (skinIdxAttr && skinWtAttr) {
      const bm = boneMaps[cid];
      for (let k = 0; k < 4; k++) {
        const w = skinWtAttr.array[v * 4 + k];
        if (w > 0) {
          const bi = skinIdxAttr.array[v * 4 + k] | 0;
          bm.set(bi, (bm.get(bi) || 0) + w);
        }
      }
    }
  }

  const outIndices = [];
  const srcIdx = indexAttr ? indexAttr.array : null;
  for (let t = 0; t < triCount; t++) {
    const a = srcIdx ? srcIdx[t * 3] : t * 3;
    const b = srcIdx ? srcIdx[t * 3 + 1] : t * 3 + 1;
    const c = srcIdx ? srcIdx[t * 3 + 2] : t * 3 + 2;
    const c0 = vertToCluster[a];
    const c1 = vertToCluster[b];
    const c2 = vertToCluster[c];
    if (c0 !== c1 && c1 !== c2 && c2 !== c0) {
      outIndices.push(c0, c1, c2);
    }
  }

  if (outIndices.length === 0) {
    return collapseToSingleBoneGeometry(THREE, geometry);
  }

  const clusterCount = counts.length;
  const outPos = new Float32Array(clusterCount * 3);
  const outNorm = new Float32Array(clusterCount * 3);
  const outUv = uvAttr ? new Float32Array(clusterCount * 2) : null;
  const outSkinIdx = new Float32Array(clusterCount * 4);
  const outSkinWt = new Float32Array(clusterCount * 4);

  for (let cid = 0; cid < clusterCount; cid++) {
    const invN = 1 / counts[cid];
    outPos[cid * 3] = sumX[cid] * invN;
    outPos[cid * 3 + 1] = sumY[cid] * invN;
    outPos[cid * 3 + 2] = sumZ[cid] * invN;

    if (normAttr) {
      const nx = sumNx[cid];
      const ny = sumNy[cid];
      const nz = sumNz[cid];
      const len = Math.hypot(nx, ny, nz) || 1;
      outNorm[cid * 3] = nx / len;
      outNorm[cid * 3 + 1] = ny / len;
      outNorm[cid * 3 + 2] = nz / len;
    } else {
      outNorm[cid * 3 + 1] = 1;
    }

    if (outUv) {
      outUv[cid * 2] = sumU[cid] * invN;
      outUv[cid * 2 + 1] = sumV[cid] * invN;
    }

    let bestBone = 0;
    let bestW = -1;
    for (const [bi, w] of boneMaps[cid]) {
      if (w > bestW) {
        bestW = w;
        bestBone = bi;
      }
    }
    outSkinIdx[cid * 4] = bestBone;
    outSkinWt[cid * 4] = 1;
  }

  const outGeom = new THREE.BufferGeometry();
  outGeom.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  outGeom.setAttribute('normal', new THREE.BufferAttribute(outNorm, 3));
  if (outUv) outGeom.setAttribute('uv', new THREE.BufferAttribute(outUv, 2));
  outGeom.setAttribute('skinIndex', new THREE.BufferAttribute(outSkinIdx, 4));
  outGeom.setAttribute('skinWeight', new THREE.BufferAttribute(outSkinWt, 4));
  outGeom.setIndex(outIndices);
  if (!normAttr) outGeom.computeVertexNormals?.();
  return outGeom;
}

function makeInstancedStaticGeometry(THREE, srcGeom, singleBoneOnly, packedAttr, yAttr = null) {
  const instGeo = new THREE.InstancedBufferGeometry();
  if (srcGeom.index) {
    instGeo.index = srcGeom.index;
  }
  const posAttr = srcGeom.attributes.position;
  const vertCount = posAttr.count;
  instGeo.setAttribute('position', posAttr);

  if (srcGeom.attributes.normal) {
    instGeo.setAttribute('normal', srcGeom.attributes.normal);
  } else {
    const nArr = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) nArr[i * 3 + 1] = 1;
    instGeo.setAttribute('normal', new THREE.BufferAttribute(nArr, 3));
  }
  if (srcGeom.attributes.uv) {
    instGeo.setAttribute('uv', srcGeom.attributes.uv);
  }

  const sIdx = srcGeom.attributes.skinIndex?.array ?? null;
  const sWt = srcGeom.attributes.skinWeight?.array ?? null;
  const boneIndices = new Float32Array(vertCount * 4);
  const boneWeights = new Float32Array(vertCount * 4);

  for (let v = 0; v < vertCount; v++) {
    const b4 = v * 4;
    if (!sIdx || !sWt) {
      boneIndices[b4] = 0;
      boneWeights[b4] = 1;
      continue;
    }
    if (singleBoneOnly) {
      boneIndices[b4] = dominantBoneIndexForVertex(sIdx, sWt, v);
      boneWeights[b4] = 1;
    } else {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        boneIndices[b4 + k] = sIdx[b4 + k];
        const w = Math.max(0, sWt[b4 + k]);
        boneWeights[b4 + k] = w;
        sum += w;
      }
      if (sum > 1e-5) {
        const inv = 1 / sum;
        for (let k = 0; k < 4; k++) boneWeights[b4 + k] *= inv;
      } else {
        boneWeights[b4] = 1;
      }
    }
  }

  instGeo.setAttribute('aBoneIndex', new THREE.BufferAttribute(boneIndices, 4));
  instGeo.setAttribute('aBoneWeight', new THREE.BufferAttribute(boneWeights, 4));
  instGeo.setAttribute('aCrowdPacked', packedAttr);
  if (yAttr) instGeo.setAttribute('aCrowdY', yAttr);
  instGeo.instanceCount = 0;
  return instGeo;
}

function createProceduralImpostorTexture(THREE, cols, rows, colorHex = 0x7fd4b8) {
  const cellPx = 16;
  const w = cols * cellPx;
  const h = rows * cellPx;
  const pixels = new Uint8Array(w * h * 4);
  const baseR = (colorHex >> 16) & 0xff;
  const baseG = (colorHex >> 8) & 0xff;
  const baseB = colorHex & 0xff;

  for (let r = 0; r < rows; r++) {
    const strideShift = Math.sin((r / Math.max(1, rows)) * Math.PI * 2) * 0.14;
    for (let c = 0; c < cols; c++) {
      const ang = (c / cols) * Math.PI * 2;
      const profileWidth = 0.22 + 0.14 * Math.abs(Math.cos(ang));
      for (let py = 0; py < cellPx; py++) {
        const vNorm = 1 - (py + 0.5) / cellPx; // 0 bottom -> 1 top
        for (let px = 0; px < cellPx; px++) {
          const uNorm = (px + 0.5) / cellPx - 0.5;
          const inHead = ((uNorm * uNorm) / (0.14 * 0.14) + ((vNorm - 0.78) * (vNorm - 0.78)) / (0.14 * 0.14)) <= 1.0;
          const inTorso = Math.abs(uNorm) <= profileWidth && vNorm >= 0.30 && vNorm <= 0.68;
          const legGap = Math.abs(uNorm) <= 0.04 && vNorm < 0.30;
          const legSpan = Math.abs(uNorm - strideShift * (uNorm < 0 ? 1 : -1)) <= profileWidth * 0.8 && vNorm >= 0.04 && vNorm < 0.34 && !legGap;

          if (inHead || inTorso || legSpan) {
            const shade = 0.65 + 0.35 * vNorm - 0.15 * Math.sin(ang) * (uNorm / Math.max(0.1, profileWidth));
            const gx = c * cellPx + px;
            const gy = r * cellPx + py;
            const idx = (gy * w + gx) * 4;
            pixels[idx] = Math.max(0, Math.min(255, Math.round(baseR * shade)));
            pixels[idx + 1] = Math.max(0, Math.min(255, Math.round(baseG * shade)));
            pixels[idx + 2] = Math.max(0, Math.min(255, Math.round(baseB * shade)));
            pixels[idx + 3] = 255;
          }
        }
      }
    }
  }

  if (typeof THREE.DataTexture !== 'function') return null;
  const tex = new THREE.DataTexture(pixels, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function patchBoneVatMaterial(material, {
  vatTexture,
  vatHeight,
  singleBoneOnly,
  scaleUniform,
  baseYUniform,
  useGpuSwarmUniform = { value: 0 },
  gpuSwarmTexUniform = { value: vatTexture },
  gpuSwarmWidthUniform = { value: 1 },
  gpuInstanceOffsetUniform = { value: 0 },
}) {
  const modeTag = singleBoneOnly ? 'lod1' : 'lod0';
  material.customProgramCacheKey = () => `hgame-bone-vat-v2:${modeTag}:${vatHeight}`;
  const prevCompile = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(material, shader, renderer);
    shader.uniforms.uBoneVat = { value: vatTexture };
    shader.uniforms.uVatHeight = { value: vatHeight };
    shader.uniforms.uCrowdScale = scaleUniform;
    shader.uniforms.uCrowdBaseY = baseYUniform;
    shader.uniforms.uUseGpuSwarm = useGpuSwarmUniform;
    shader.uniforms.uGpuSwarmTex = gpuSwarmTexUniform;
    shader.uniforms.uGpuSwarmWidth = gpuSwarmWidthUniform;
    shader.uniforms.uGpuInstanceOffset = gpuInstanceOffsetUniform;

    const vertexHeader = [
      'attribute vec4 aBoneIndex;',
      'attribute vec4 aBoneWeight;',
      'attribute vec4 aCrowdPacked;',
      'attribute float aCrowdY;',
      'uniform highp sampler2D uBoneVat;',
      'uniform int uVatHeight;',
      'uniform float uCrowdScale;',
      'uniform float uCrowdBaseY;',
      'uniform int uUseGpuSwarm;',
      'uniform highp sampler2D uGpuSwarmTex;',
      'uniform int uGpuSwarmWidth;',
      'uniform int uGpuInstanceOffset;',
      'varying float vCrowdFlash;',
      'vec4 hgameReadCrowdPacked() {',
      '  if (uUseGpuSwarm == 1) {',
      '    int _gid = gl_InstanceID + uGpuInstanceOffset;',
      '    int _w = max(1, uGpuSwarmWidth);',
      '    int _row = _gid / _w;',
      '    int _col = _gid - _row * _w;',
      '    return texelFetch(uGpuSwarmTex, ivec2(_col, _row), 0);',
      '  }',
      '  return aCrowdPacked;',
      '}',
      'vec3 hgameQuatRotate(vec4 q, vec3 v) {',
      '  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);',
      '}',
      'void hgameEvalBoneSample(int bi, float w, int f0, int f1, float t, vec3 localPos, vec3 localNorm, inout vec3 spos, inout vec3 snorm) {',
      '  if (w <= 0.0001) return;',
      '  int tx = bi * 2;',
      '  vec4 p0 = texelFetch(uBoneVat, ivec2(tx, f0), 0);',
      '  vec4 q0 = texelFetch(uBoneVat, ivec2(tx + 1, f0), 0);',
      '  vec4 p1 = texelFetch(uBoneVat, ivec2(tx, f1), 0);',
      '  vec4 q1 = texelFetch(uBoneVat, ivec2(tx + 1, f1), 0);',
      '  vec4 p = mix(p0, p1, t);',
      '  if (dot(q0, q1) < 0.0) q1 = -q1;',
      '  vec4 q = normalize(mix(q0, q1, t));',
      '  spos += (hgameQuatRotate(q, localPos * p.w) + p.xyz) * w;',
      '  snorm += hgameQuatRotate(q, localNorm) * w;',
      '}',
      'void hgameEvalBoneVat(vec4 packedInst, vec3 localPos, vec3 localNorm, out vec3 outPos, out vec3 outNorm) {',
      '  float rawW = packedInst.w;',
      '  float absW = abs(rawW);',
      '  float statusCode = floor(absW / 16384.0);',
      '  float framePos = max(0.0, (absW - statusCode * 16384.0) - 1.0);',
      '  int f0 = min(int(floor(framePos)), max(0, uVatHeight - 1));',
      '  int f1 = min(f0 + 1, max(0, uVatHeight - 1));',
      '  float t = fract(framePos);',
      singleBoneOnly ? [
        '  vec3 spos = vec3(0.0);',
        '  vec3 snorm = vec3(0.0);',
        '  hgameEvalBoneSample(int(aBoneIndex.x + 0.5), 1.0, f0, f1, t, localPos, localNorm, spos, snorm);',
      ].join('\n') : [
        '  vec3 spos = vec3(0.0);',
        '  vec3 snorm = vec3(0.0);',
        '  float wSum = aBoneWeight.x + aBoneWeight.y + aBoneWeight.z + aBoneWeight.w;',
        '  if (wSum <= 0.0001) {',
        '    spos = localPos; snorm = localNorm;',
        '  } else {',
        '    hgameEvalBoneSample(int(aBoneIndex.x + 0.5), aBoneWeight.x, f0, f1, t, localPos, localNorm, spos, snorm);',
        '    hgameEvalBoneSample(int(aBoneIndex.y + 0.5), aBoneWeight.y, f0, f1, t, localPos, localNorm, spos, snorm);',
        '    hgameEvalBoneSample(int(aBoneIndex.z + 0.5), aBoneWeight.z, f0, f1, t, localPos, localNorm, spos, snorm);',
        '    hgameEvalBoneSample(int(aBoneIndex.w + 0.5), aBoneWeight.w, f0, f1, t, localPos, localNorm, spos, snorm);',
        '    snorm = normalize(snorm);',
        '  }',
      ].join('\n'),
      '  float rotY = packedInst.z;',
      '  float c = cos(rotY);',
      '  float s = sin(rotY);',
      '  vec3 scaled = spos * uCrowdScale;',
      '  outPos = vec3(scaled.x * c + scaled.z * s + packedInst.x, scaled.y + uCrowdBaseY + aCrowdY, scaled.z * c - scaled.x * s + packedInst.y);',
      '  outNorm = normalize(vec3(snorm.x * c + snorm.z * s, snorm.y, snorm.z * c - snorm.x * s));',
      '}',
    ].join('\n');

    shader.vertexShader = vertexHeader + '\n' + shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        [
          '#include <beginnormal_vertex>',
          'vec4 _hgamePackedInst = hgameReadCrowdPacked();',
          'vec3 _hgameVatPos = vec3(0.0);',
          'vec3 _hgameVatNorm = objectNormal;',
          'hgameEvalBoneVat(_hgamePackedInst, position, objectNormal, _hgameVatPos, _hgameVatNorm);',
          'objectNormal = _hgameVatNorm;',
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#if defined( STANDARD ) || defined( PHONG ) || defined( LAMBERT ) || defined( TOON )',
          'transformed = _hgameVatPos;',
          'float _scMain = floor(abs(_hgamePackedInst.w) / 16384.0);',
          'vCrowdFlash = (_hgamePackedInst.w < 0.0 && _scMain < 0.5) ? 4.0 : _scMain;',
          '#else',
          '{',
          '  vec4 _depthPackedInst = hgameReadCrowdPacked();',
          '  vec3 _unusedN;',
          '  vec3 _finalPos;',
          '  hgameEvalBoneVat(_depthPackedInst, position, vec3(0.0, 1.0, 0.0), _finalPos, _unusedN);',
          '  transformed = _finalPos;',
          '  float _scDepth = floor(abs(_depthPackedInst.w) / 16384.0);',
          '  vCrowdFlash = (_depthPackedInst.w < 0.0 && _scDepth < 0.5) ? 4.0 : _scDepth;',
          '}',
          '#endif',
        ].join('\n'),
      );

    if (shader.fragmentShader.includes('#include <color_fragment>')) {
      shader.fragmentShader = 'varying float vCrowdFlash;\n' + shader.fragmentShader.replace(
        '#include <color_fragment>',
        CROWD_STATUS_COLOR_GLSL,
      );
    }
  };
  material.needsUpdate = true;
  return material;
}

function patchImpostorMaterial(material, {
  impostorCols,
  impostorRows,
  vatHeight,
  scaleUniform,
  baseYUniform,
  useGpuSwarmUniform = { value: 0 },
  gpuSwarmTexUniform = { value: null },
  gpuSwarmWidthUniform = { value: 1 },
  gpuInstanceOffsetUniform = { value: 0 },
}) {
  material.customProgramCacheKey = () => `hgame-bone-impostor-v4:${impostorCols}x${impostorRows}:${vatHeight}`;
  const prevCompile = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(material, shader, renderer);
    shader.uniforms.uImpostorCols = { value: impostorCols };
    shader.uniforms.uImpostorRows = { value: impostorRows };
    shader.uniforms.uVatHeight = { value: vatHeight };
    shader.uniforms.uCrowdScale = scaleUniform;
    shader.uniforms.uCrowdBaseY = baseYUniform;
    shader.uniforms.uUseGpuSwarm = useGpuSwarmUniform;
    shader.uniforms.uGpuSwarmTex = gpuSwarmTexUniform;
    shader.uniforms.uGpuSwarmWidth = gpuSwarmWidthUniform;
    shader.uniforms.uGpuInstanceOffset = gpuInstanceOffsetUniform;

    const header = [
      'attribute vec4 aCrowdPacked;',
      'attribute float aCrowdY;',
      'uniform int uImpostorCols;',
      'uniform int uImpostorRows;',
      'uniform int uVatHeight;',
      'uniform float uCrowdScale;',
      'uniform float uCrowdBaseY;',
      'uniform int uUseGpuSwarm;',
      'uniform highp sampler2D uGpuSwarmTex;',
      'uniform int uGpuSwarmWidth;',
      'uniform int uGpuInstanceOffset;',
      'varying float vCrowdFlash;',
      'vec4 hgameReadCrowdPacked() {',
      '  if (uUseGpuSwarm == 1) {',
      '    int _gid = gl_InstanceID + uGpuInstanceOffset;',
      '    int _w = max(1, uGpuSwarmWidth);',
      '    int _row = _gid / _w;',
      '    int _col = _gid - _row * _w;',
      '    return texelFetch(uGpuSwarmTex, ivec2(_col, _row), 0);',
      '  }',
      '  return aCrowdPacked;',
      '}',
    ].join('\n');

    shader.vertexShader = header + '\n' + shader.vertexShader
      .replace(
        '#include <uv_vertex>',
        [
          '#include <uv_vertex>',
          'vec4 _impostorPacked = hgameReadCrowdPacked();',
          'vec3 _axisX = modelMatrix[0].xyz;',
          'vec3 _axisY = modelMatrix[1].xyz;',
          'vec3 _axisZ = modelMatrix[2].xyz;',
          'vec2 _toCamUv;',
          'vec2 _impostorFacing;',
          'vec3 _impostorNormal;',
          'if (all(equal(_axisX, vec3(1.0, 0.0, 0.0))) && all(equal(_axisY, vec3(0.0, 1.0, 0.0))) && all(equal(_axisZ, vec3(0.0, 0.0, 1.0)))) {',
          '  _toCamUv = (cameraPosition - modelMatrix[3].xyz).xz - _impostorPacked.xy;',
          '  _impostorFacing = _toCamUv;',
          '  _impostorNormal = vec3(_toCamUv.x, max(0.001, length(_toCamUv)) * 0.25, _toCamUv.y);',
          '} else {',
          '  vec3 _localOffset = _axisX * _impostorPacked.x + _axisY * (uCrowdBaseY + aCrowdY) + _axisZ * _impostorPacked.y;',
          '  vec3 _toEye = (cameraPosition - modelMatrix[3].xyz) - _localOffset;',
          '  float _upLength = length(_axisY);',
          '  vec3 _up = _upLength > 0.0 ? _axisY / _upLength : vec3(0.0, 1.0, 0.0);',
          '  vec3 _forward = _toEye - _up * dot(_toEye, _up);',
          // The cofactors recover local atlas azimuth without a per-vertex matrix inverse.
          '  vec3 _dualX = cross(_axisY, _axisZ);',
          '  vec3 _dualZ = cross(_axisX, _axisY);',
          '  float _handedness = dot(_axisX, _dualX) < 0.0 ? -1.0 : 1.0;',
          '  _toCamUv = vec2(dot(_dualX, _toEye), dot(_dualZ, _toEye)) * _handedness;',
          // The local right vector is perpendicular to the projected world view in both bases.
          '  _impostorFacing = vec2(dot(_axisX, _forward), dot(_axisZ, _forward));',
          '  vec3 _normalWorld = _forward + _up * (max(0.001, length(_forward)) * 0.25);',
          '  _impostorNormal = transpose(mat3(modelMatrix)) * _normalWorld;',
          '}',
          'float _impostorAbsW = abs(_impostorPacked.w);',
          'float _impostorStatus = floor(_impostorAbsW / 16384.0);',
          '#ifdef USE_MAP',
          '{',
          '  float _camAzimuth = dot(_toCamUv, _toCamUv) > 0.0 ? atan(_toCamUv.x, _toCamUv.y) : 0.0;',
          '  float _relAngle = fract((_camAzimuth - _impostorPacked.z) * 0.15915494309 + 1.0);',
          '  float _col = floor(_relAngle * float(uImpostorCols));',
          '  float _framePos = max(0.0, _impostorAbsW - _impostorStatus * 16384.0 - 1.0);',
          '  float _rowNorm = clamp(_framePos / max(1.0, float(uVatHeight)), 0.0, 0.9999);',
          '  float _row = floor(_rowNorm * float(uImpostorRows));',
          '  vMapUv = vec2((_col + uv.x) / float(uImpostorCols), (float(uImpostorRows - 1) - _row + uv.y) / float(uImpostorRows));',
          '}',
          '#endif',
        ].join('\n'),
      )
      .replace(
        '#include <beginnormal_vertex>',
        [
          '#include <beginnormal_vertex>',
          'objectNormal = dot(_impostorNormal, _impostorNormal) > 0.0 ? normalize(_impostorNormal) : vec3(0.0, 1.0, 0.0);',
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '{',
          '  vec2 _fwd = dot(_impostorFacing, _impostorFacing) > 0.0 ? normalize(_impostorFacing) : vec2(0.0, 1.0);',
          '  vec2 _right = vec2(_fwd.y, -_fwd.x);',
          '  float _sx = position.x * uCrowdScale;',
          '  float _sy = position.y * uCrowdScale;',
          '  transformed = vec3(_right.x * _sx + _impostorPacked.x, _sy + uCrowdBaseY + aCrowdY, _right.y * _sx + _impostorPacked.y);',
          '  vCrowdFlash = (_impostorPacked.w < 0.0 && _impostorStatus < 0.5) ? 4.0 : _impostorStatus;',
          '}',
        ].join('\n'),
      );

    shader.fragmentShader = 'varying float vCrowdFlash;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>',
      CROWD_STATUS_COLOR_GLSL,
    );
  };
  material.needsUpdate = true;
  return material;
}

/**
 * @typedef {object} BoneVatCrowd3DOptions
 * @property {import('./helpers.js').Model3DAsset | null} [asset=null] Loaded asset (`scene` + `animations`).
 * @property {import('./helpers.js').Model3DObject | null} [root=null] Alternative Object3D root.
 * @property {import('./helpers.js').Model3DClip[] | null} [animations=null] Clips overriding `asset.animations`.
 * @property {BoneVatBakedData | null} [vatData=null] Pre-baked Half-Float Bone-VAT (e.g. from `decodeBoneVatBinary`).
 * @property {object | null} [lod0Geometry=null] Custom LOD0 BufferGeometry override.
 * @property {object | null} [lod1Geometry=null] Custom LOD1 BufferGeometry override.
 * @property {object | null} [material=null] Base material cloned across LOD0/LOD1.
 * @property {object | null} [impostorTexture=null] Optional 8-direction billboard atlas (`impostorCols x impostorRows`).
 * @property {number} [impostorCols=8] Columns (azimuth sectors) in impostor atlas.
 * @property {number} [impostorRows=8] Rows (animation frames) in impostor atlas.
 * @property {number} [capacity=20000] Maximum instances (integer `1..262144`).
 * @property {number} [sampleFps=30] Bake sample FPS when `vatData` is not supplied.
 * @property {number} [lod1Distance=25] World distance threshold switching LOD0 -> LOD1.
 * @property {number} [lod2Distance=80] World distance threshold switching LOD1 -> LOD2 impostor.
 * @property {number} [lodHysteresis=0.1] Fractional CPU LOD margin on either side of a threshold (`0..0.5`).
 * @property {number} [maxDistance=240] Far draw cutoff (`<= 0` disables).
 * @property {number} [cullRadius=1.2] Culling radius before applying crowd scale and the group's world transform.
 * @property {number} [baseY=0] Ground Y offset in crowd-local units.
 * @property {number} [scale=1] Global uniform crowd scale.
 * @property {boolean} [castShadow=false] Whether LOD0/LOD1 meshes cast shadows.
 * @property {boolean} [receiveShadow=true] Whether LOD meshes receive shadows.
 */

/**
 * @typedef {object} BoneVatSpawnOptions
 * @property {number} [x=0] Crowd-local horizontal position.
 * @property {number} [y=0] Ignored per-instance (uses shared `baseY`); retained for API symmetry.
 * @property {number} [z=0] Crowd-local depth position.
 * @property {number} [rotationY=0]
 * @property {string | null} [clip=null]
 * @property {number} [time=0]
 * @property {number} [speed=1]
 */

/**
 * @typedef {object} BoneVatUpdateOptions
 * @property {object | null} [camera=null] Three.js camera for LOD distances + azimuth.
 * @property {{ testSphere?: (x: number, y: number, z: number, r?: number) => boolean, classifySphere?: (x: number, y: number, z: number, r?: number) => number, frustum?: { cameraPosition?: { x: number, y: number, z: number } } } | null} [culler=null] Optional SceneCuller3D.
 */

/**
 * @typedef {object} BoneVatSyncSwarmOptions
 * @property {object | null} [camera=null]
 * @property {{ testSphere?: (x: number, y: number, z: number, r?: number) => boolean, classifySphere?: (x: number, y: number, z: number, r?: number) => number, frustum?: { cameraPosition?: { x: number, y: number, z: number } } } | null} [culler=null]
 * @property {string[] | null} [clipNames=null] Optional mapping from numeric `swarm.animClip[id]` to clip names.
 */

/**
 * @typedef {object} BoneVatSyncGpuSwarmOptions
 * @property {number} [lod0Count=2000] Number of leading GPU instances rendered as full 4-bone LOD0.
 * @property {number} [lod1Count=12000] Number of subsequent GPU instances rendered as 1-bone LOD1.
 */

/**
 * @typedef {object} BoneVatCrowdStats
 * @property {number} activeCount
 * @property {number} visibleCount
 * @property {number} culledCount
 * @property {[number, number, number]} lodCounts Visible `[lod0, lod1, lod2]` counts.
 * @property {number} drawCalls Total active LOD draw calls (`0..3`).
 * @property {number} uploadedBytes Packed instance bytes scheduled by this call, excluding buffer creation.
 */

/**
 * @typedef {object} BoneVatCrowd3D
 * @property {object} group `THREE.Group` holding `[lod0Mesh, lod1Mesh, lod2Mesh]`.
 * @property {object} mesh Alias getter returning `group` (for drop-in compatibility with `world.add(crowd.mesh)`).
 * @property {[object, object, object]} lodMeshes Individual Three.js Meshes `[lod0, lod1, lod2]`.
 * @property {number} capacity
 * @property {object | null} vatTexture
 * @property {{ width: number, height: number, boneCount: number, sampleFps: number, totalFrames: number, byteLength: number }} vatInfo
 * @property {number} count Getter; live spawned count.
 * @property {() => string[]} getClipNames
 * @property {(options?: BoneVatSpawnOptions) => number} spawn
 * @property {(index: number) => { x: number, y: number, z: number, rotationY: number } | null} getTransform
 * @property {(index: number, x: number, y: number, z: number, rotY?: number) => boolean} setTransform
 * @property {(index: number, clipName: string, options?: { speed?: number, randomizePhase?: boolean, phase?: number }) => boolean} play
 * @property {(index: number, clipName: string, time: number, speed?: number) => boolean} setPlayback Sample a named clip at an explicit time in seconds. Speed defaults to zero for an external clock.
 * @property {(index: number, enabled: boolean) => boolean} setDistanceFallback Allow a standalone slot to draw past maxDistance while a replacement is unavailable. Frustum and occlusion culling still apply.
 * @property {(index: number, duration?: number) => boolean} hitFlash
 * @property {(index: number) => boolean} kill
 * @property {() => void} clear
 * @property {(fn: (material: object, lodIndex: number) => void) => void} applyToMaterials
 * @property {(dt?: number, options?: BoneVatUpdateOptions) => BoneVatCrowdStats} update
 * @property {(swarm: import('../../world/swarm-ecs.js').SwarmSimulation, options?: BoneVatSyncSwarmOptions) => BoneVatCrowdStats} syncFromSwarm
 * @property {(gpuSwarm: import('../../world/gpu-swarm-webgl2.js').GpuSwarmWebGL2, options?: BoneVatSyncGpuSwarmOptions) => BoneVatCrowdStats} syncFromGpuSwarm
 * @property {() => void} dispose
 */

/**
 * High-density 3D GPU Crowd powered by Half-Float Bone-VAT, 16-Byte packed instances,
 * and automatic 3-level distance LOD (`LOD0` 4-bone / `LOD1` simplified 1-bone / `LOD2` 8-direction billboard).
 * @param {import('./helpers.js').Model3DThree} THREE
 * @param {BoneVatCrowd3DOptions} [options]
 * @returns {BoneVatCrowd3D}
 */
export function createBoneVatCrowd3D(THREE, {
  asset = null,
  root = null,
  animations = null,
  vatData = null,
  lod0Geometry = null,
  lod1Geometry = null,
  material = null,
  impostorTexture = null,
  impostorCols = 8,
  impostorRows = 8,
  capacity = 20000,
  sampleFps = 30,
  lod1Distance = 25,
  lod2Distance = 80,
  lodHysteresis = 0.1,
  maxDistance = 240,
  cullRadius = 1.2,
  baseY = 0,
  scale = 1,
  castShadow = false,
  receiveShadow = true,
} = {}) {
  if (!THREE?.Mesh || !THREE?.BufferGeometry || !THREE?.InstancedBufferGeometry || !THREE?.InstancedBufferAttribute || !THREE?.Group) {
    throw new TypeError('createBoneVatCrowd3D requires THREE.Mesh, Group, BufferGeometry, InstancedBufferGeometry, InstancedBufferAttribute');
  }
  const sourceRoot = root ?? asset?.scene;
  if (!sourceRoot && !lod0Geometry) {
    throw new TypeError('createBoneVatCrowd3D requires asset/root Object3D or lod0Geometry');
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 262144) {
    throw new RangeError('createBoneVatCrowd3D capacity must be an integer in 1..262144');
  }
  if (!Number.isFinite(lodHysteresis) || lodHysteresis < 0 || lodHysteresis > 0.5) {
    throw new RangeError('lodHysteresis must be between 0 and 0.5');
  }

  let baseMesh = null;
  if (sourceRoot?.traverse) {
    sourceRoot.traverse((node) => {
      if (!baseMesh && (node.isSkinnedMesh || node.isMesh)) baseMesh = node;
    });
  }
  const rawLod0Geom = lod0Geometry ?? baseMesh?.geometry;
  if (!rawLod0Geom?.attributes?.position) {
    throw new Error('createBoneVatCrowd3D requires a Mesh with position attribute');
  }

  const baked = vatData ?? bakeBoneVatData(THREE, {
    asset,
    root: sourceRoot,
    animations,
    sampleFps,
  });

  const clipList = Array.isArray(baked.clips) && baked.clips.length > 0
    ? baked.clips
    : [{ name: 'idle', startFrame: 0, frames: 1, duration: 1 / 30 }];
  const clipByName = new Map();
  for (const c of clipList) clipByName.set(c.name, c);
  const clipCount = clipList.length;
  const clipStarts = new Float32Array(clipCount);
  const clipSpans = new Float32Array(clipCount);
  const clipDurs = new Float32Array(clipCount);
  const clipInvDurs = new Float32Array(clipCount);
  for (let i = 0; i < clipCount; i++) {
    const c = clipList[i];
    clipStarts[i] = c.startFrame || 0;
    const valid = c.frames > 1 && c.duration > 0;
    clipSpans[i] = valid ? (c.frames - 1) : 0;
    clipDurs[i] = valid ? c.duration : 1;
    clipInvDurs[i] = valid ? (1 / c.duration) : 0;
  }

  let vatTexture = null;
  if (typeof THREE.DataTexture === 'function' && THREE.RGBAFormat !== undefined) {
    if (THREE.HalfFloatType !== undefined && baked.data instanceof Uint16Array) {
      vatTexture = new THREE.DataTexture(baked.data, baked.width, baked.height, THREE.RGBAFormat, THREE.HalfFloatType);
    } else if (THREE.FloatType !== undefined) {
      vatTexture = new THREE.DataTexture(baked.floatData, baked.width, baked.height, THREE.RGBAFormat, THREE.FloatType);
    }
    if (vatTexture) {
      vatTexture.minFilter = THREE.NearestFilter;
      vatTexture.magFilter = THREE.NearestFilter;
      vatTexture.generateMipmaps = false;
      if (THREE.NoColorSpace !== undefined) vatTexture.colorSpace = THREE.NoColorSpace;
      vatTexture.needsUpdate = true;
    }
  }

  const rawLod1Geom = lod1Geometry ?? buildSimplifiedLodGeometry(THREE, rawLod0Geom);

  const scaleUniform = { value: Number.isFinite(scale) ? scale : 1 };
  const baseYUniform = { value: Number.isFinite(baseY) ? baseY : 0 };
  const useGpuSwarmUniform = { value: 0 };
  const gpuSwarmTexUniform = { value: vatTexture };
  const gpuSwarmWidthUniform = { value: 1 };
  const gpuOffsetUniforms = [{ value: 0 }, { value: 0 }, { value: 0 }];

  const srcMat = material ?? (Array.isArray(baseMesh?.material) ? baseMesh.material[0] : baseMesh?.material);
  const makeBaseMat = () => (srcMat?.clone ? srcMat.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.05 }));

  const lod0Mat = patchBoneVatMaterial(makeBaseMat(), {
    vatTexture,
    vatHeight: baked.height,
    singleBoneOnly: false,
    scaleUniform,
    baseYUniform,
    useGpuSwarmUniform,
    gpuSwarmTexUniform,
    gpuSwarmWidthUniform,
    gpuInstanceOffsetUniform: gpuOffsetUniforms[0],
  });
  const lod1Mat = patchBoneVatMaterial(makeBaseMat(), {
    vatTexture,
    vatHeight: baked.height,
    singleBoneOnly: true,
    scaleUniform,
    baseYUniform,
    useGpuSwarmUniform,
    gpuSwarmTexUniform,
    gpuSwarmWidthUniform,
    gpuInstanceOffsetUniform: gpuOffsetUniforms[1],
  });

  const ownedImpostorTex = impostorTexture ? null : createProceduralImpostorTexture(
    THREE,
    impostorCols,
    impostorRows,
    srcMat?.color?.getHex?.() ?? 0x7fd4b8,
  );
  const effectiveImpostorTex = impostorTexture ?? ownedImpostorTex;
  const lod2Mat = patchImpostorMaterial(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: effectiveImpostorTex,
    alphaTest: 0.25,
    side: THREE.DoubleSide ?? 2,
    roughness: 0.85,
    metalness: 0.0,
  }), {
    impostorCols,
    impostorRows,
    vatHeight: baked.height,
    scaleUniform,
    baseYUniform,
    useGpuSwarmUniform,
    gpuSwarmTexUniform,
    gpuSwarmWidthUniform,
    gpuInstanceOffsetUniform: gpuOffsetUniforms[2],
  });

  const packedBuffers = [
    new Float32Array(capacity * 4),
    new Float32Array(capacity * 4),
    new Float32Array(capacity * 4),
  ];
  const packedAttrs = packedBuffers.map((buf) => {
    const attr = new THREE.InstancedBufferAttribute(buf, 4);
    if (THREE.DynamicDrawUsage !== undefined) attr.setUsage?.(THREE.DynamicDrawUsage);
    return attr;
  });
  const packedUpdates = packedBuffers.map(() => createInstanceUpdateRanges(4));
  const yBuffers = [
    new Float32Array(capacity),
    new Float32Array(capacity),
    new Float32Array(capacity),
  ];
  const yAttrs = yBuffers.map((buf) => {
    const attr = new THREE.InstancedBufferAttribute(buf, 1);
    if (THREE.DynamicDrawUsage !== undefined) attr.setUsage?.(THREE.DynamicDrawUsage);
    return attr;
  });
  const yUpdates = yBuffers.map(() => createInstanceUpdateRanges(1));
  const initializedRows = new Uint32Array(3);
  const initializedYRows = new Uint32Array(3);
  const yEverUsed = new Uint8Array(3);
  let packingIncomplete = false;

  const instGeo0 = makeInstancedStaticGeometry(THREE, rawLod0Geom, false, packedAttrs[0], yAttrs[0]);
  const instGeo1 = makeInstancedStaticGeometry(THREE, rawLod1Geom, true, packedAttrs[1], yAttrs[1]);

  const charH = Math.max(0.5, baked.bounds?.size?.y || 1.8);
  const charW = Math.max(0.4, Math.max(baked.bounds?.size?.x || 1.0, baked.bounds?.size?.z || 1.0));
  const instGeo2 = new THREE.InstancedBufferGeometry();
  const quadPos = new Float32Array([
    -charW * 0.5, 0, 0,
    charW * 0.5, 0, 0,
    charW * 0.5, charH, 0,
    -charW * 0.5, charH, 0,
  ]);
  const quadNorm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const quadUv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  instGeo2.setAttribute('position', new THREE.BufferAttribute(quadPos, 3));
  instGeo2.setAttribute('normal', new THREE.BufferAttribute(quadNorm, 3));
  instGeo2.setAttribute('uv', new THREE.BufferAttribute(quadUv, 2));
  instGeo2.setIndex([0, 1, 2, 0, 2, 3]);
  instGeo2.setAttribute('aCrowdPacked', packedAttrs[2]);
  instGeo2.setAttribute('aCrowdY', yAttrs[2]);
  instGeo2.instanceCount = 0;

  const mesh0 = new THREE.Mesh(instGeo0, lod0Mat);
  const mesh1 = new THREE.Mesh(instGeo1, lod1Mat);
  const mesh2 = new THREE.Mesh(instGeo2, lod2Mat);
  const lodGeometries = [instGeo0, instGeo1, instGeo2];
  const lodMeshes = [mesh0, mesh1, mesh2];

  let depthMat0 = null;
  let depthMat1 = null;
  if (castShadow && typeof THREE.MeshDepthMaterial === 'function') {
    const depthOpts = THREE.RGBADepthPacking !== undefined ? { depthPacking: THREE.RGBADepthPacking } : {};
    depthMat0 = patchBoneVatMaterial(new THREE.MeshDepthMaterial(depthOpts), {
      vatTexture,
      vatHeight: baked.height,
      singleBoneOnly: false,
      scaleUniform,
      baseYUniform,
      useGpuSwarmUniform,
      gpuSwarmTexUniform,
      gpuSwarmWidthUniform,
      gpuInstanceOffsetUniform: gpuOffsetUniforms[0],
    });
    depthMat1 = patchBoneVatMaterial(new THREE.MeshDepthMaterial(depthOpts), {
      vatTexture,
      vatHeight: baked.height,
      singleBoneOnly: true,
      scaleUniform,
      baseYUniform,
      useGpuSwarmUniform,
      gpuSwarmTexUniform,
      gpuSwarmWidthUniform,
      gpuInstanceOffsetUniform: gpuOffsetUniforms[1],
    });
    mesh0.customDepthMaterial = depthMat0;
    mesh1.customDepthMaterial = depthMat1;
  }

  for (const [m, idx] of [[mesh0, 0], [mesh1, 1], [mesh2, 2]]) {
    m.name = `hgame_bone_vat_lod${idx}`;
    m.frustumCulled = false;
    m.castShadow = idx < 2 ? Boolean(castShadow) : false;
    m.receiveShadow = Boolean(receiveShadow);
    m.visible = false;
    m.userData = { ...(m.userData || {}), hgameTemporalMotion: 'bone-vat' };
  }

  const group = new THREE.Group();
  group.name = 'hgame_bone_vat_crowd';
  group.add(mesh0, mesh1, mesh2);

  // Local standalone SoA slots (used when driving createBoneVatCrowd3D directly without SwarmSimulation).
  // 0 is free, 1 uses maxDistance, and 2 is a retained LOD fallback.
  const activeFlags = new Uint8Array(capacity);
  const posX = new Float32Array(capacity);
  const posY = new Float32Array(capacity);
  const posZ = new Float32Array(capacity);
  const rotY = new Float32Array(capacity);
  const clipIdx = new Uint16Array(capacity);
  const clipTime = new Float32Array(capacity);
  const clipSpeed = new Float32Array(capacity).fill(1);
  const flashTimer = new Float32Array(capacity);
  const standaloneLod = lodHysteresis > 0 ? new Uint8Array(capacity) : null;
  let swarmGenerations = null;
  let swarmLod = null;
  let swarmLodGenerations = null;

  const freeStack = new Int32Array(capacity);
  let freeTop = capacity;
  for (let i = 0; i < capacity; i++) freeStack[i] = capacity - 1 - i;
  const activeIndices = new Int32Array(capacity);
  const indexInActive = new Int32Array(capacity).fill(-1);
  let activeCount = 0;

  const lod1Radius = Math.abs(lod1Distance);
  const lod2Radius = Math.max(lod1Radius, lod2Distance);
  const lod1Sq = lod1Radius ** 2;
  const lod2Sq = lod2Radius ** 2;
  const nearLod1 = lod1Radius * (1 - lodHysteresis);
  const farLod1 = lod1Radius * (1 + lodHysteresis);
  const nearLod2 = lod2Radius * (1 - lodHysteresis);
  const farLod2 = lod2Radius * (1 + lodHysteresis);
  const nearLod1Sq = nearLod1 ** 2;
  const farLod1Sq = farLod1 ** 2;
  const nearLod2Sq = nearLod2 ** 2;
  const farLod2Sq = farLod2 ** 2;
  const maxDistSq = maxDistance > 0 && Number.isFinite(maxDistance) ? maxDistance * maxDistance : Infinity;
  const localCullRadius = Math.abs(cullRadius * scaleUniform.value);
  let worldMatrix = IDENTITY_TRANSFORM;
  let simpleGroundPlane = true;
  let worldCullRadius = localCullRadius;
  let originToEyeX = 0, originToEyeY = 0, originToEyeZ = 0;
  let cullOriginX = 0, cullOriginY = 0, cullOriginZ = 0;
  let axisXSquared = 1, axisZSquared = 1, axisXZAbsDot = 0;

  function selectLod(distanceSquared, previous) {
    // Track bucket + 1 so a recycled or freshly spawned slot starts at nominal thresholds.
    const first = previous === 0 ? lod1Sq : (previous === 1 ? farLod1Sq : nearLod1Sq);
    if (distanceSquared < first) return 0;
    const second = previous === 0 ? lod2Sq : (previous === 3 ? nearLod2Sq : farLod2Sq);
    return distanceSquared < second ? 1 : 2;
  }

  function prepareSwarmLod(swarm) {
    const generations = lodHysteresis > 0 ? (swarm.slotGeneration ?? null) : null;
    if (generations === swarmGenerations) return;
    swarmGenerations = generations;
    swarmLod = generations ? new Uint8Array(generations.length) : null;
    swarmLodGenerations = generations ? new Uint32Array(generations.length) : null;
  }

  function selectSwarmLod(id, distanceSquared) {
    const previous = swarmLod && swarmLodGenerations[id] === swarmGenerations[id] ? (swarmLod[id] ?? 0) : 0;
    return selectLod(distanceSquared, previous);
  }

  function rememberSwarmLod(id, lod) {
    if (!swarmLod) return;
    swarmLod[id] = lod + 1;
    swarmLodGenerations[id] = swarmGenerations[id];
  }

  function resolveCameraPos(camera, culler) {
    const mw = camera?.matrixWorld?.elements;
    if (mw && mw.length >= 16) return [mw[12], mw[13], mw[14]];
    if (camera?.position) return [camera.position.x ?? 0, camera.position.y ?? 0, camera.position.z ?? 0];
    const cp = culler?.frustum?.cameraPosition;
    if (cp) return [cp.x ?? 0, cp.y ?? 0, cp.z ?? 0];
    return [0, 0, 0];
  }

  function prepareVisibility(camera, culler) {
    group.updateWorldMatrix?.(true, false);
    camera?.updateWorldMatrix?.(true, false);
    const m = group.matrixWorld?.elements;
    worldMatrix = m?.length >= 16 ? m : IDENTITY_TRANSFORM;
    const [xx, xy, xz, , yx, yy, yz, , zx, zy, zz, , tx, ty, tz] = worldMatrix;
    simpleGroundPlane = xx === 1 && xy === 0 && xz === 0 && zx === 0 && zy === 0 && zz === 1;
    const [eyeX, eyeY, eyeZ] = resolveCameraPos(camera, culler);
    const y = baseYUniform.value;
    const centerY = y + charH * scaleUniform.value * 0.5;
    originToEyeX = tx + yx * y - eyeX;
    originToEyeY = ty + yy * y - eyeY;
    originToEyeZ = tz + yz * y - eyeZ;
    cullOriginX = tx + yx * centerY;
    cullOriginY = ty + yy * centerY;
    cullOriginZ = tz + yz * centerY;

    axisXSquared = xx * xx + xy * xy + xz * xz;
    axisZSquared = zx * zx + zy * zy + zz * zz;
    axisXZAbsDot = Math.abs(xx * zx + xy * zy + xz * zz);
    const axisYSquared = yx * yx + yy * yy + yz * yz;
    const axisXYAbsDot = Math.abs(xx * yx + xy * yy + xz * yz);
    const axisYZAbsDot = Math.abs(yx * zx + yy * zy + yz * zz);
    // Bound the maximum stretch using the row sums of the basis Gram matrix.
    // Using only column lengths would underestimate spheres under parent shear.
    const maxStretch = Math.sqrt(Math.max(
      axisXSquared + axisXYAbsDot + axisXZAbsDot,
      axisYSquared + axisXYAbsDot + axisYZAbsDot,
      axisZSquared + axisXZAbsDot + axisYZAbsDot,
    ));
    worldCullRadius = localCullRadius * maxStretch;
  }

  function worldDistanceSquared(x, z) {
    let dx, dy, dz;
    if (simpleGroundPlane) {
      dx = x + originToEyeX;
      dy = originToEyeY;
      dz = z + originToEyeZ;
    } else {
      const m = worldMatrix;
      dx = m[0] * x + m[8] * z + originToEyeX;
      dy = m[1] * x + m[9] * z + originToEyeY;
      dz = m[2] * x + m[10] * z + originToEyeZ;
    }
    return dx * dx + dy * dy + dz * dz;
  }

  function classifyWorldSphere(culler, x, z, radius, preferClassify = false) {
    const m = worldMatrix;
    const wx = cullOriginX + (simpleGroundPlane ? x : m[0] * x + m[8] * z);
    const wy = cullOriginY + (simpleGroundPlane ? 0 : m[1] * x + m[9] * z);
    const wz = cullOriginZ + (simpleGroundPlane ? z : m[2] * x + m[10] * z);
    if ((preferClassify || typeof culler.testSphere !== 'function') && typeof culler.classifySphere === 'function') {
      return culler.classifySphere(wx, wy, wz, radius);
    }
    return culler.testSphere(wx, wy, wz, radius) ? 1 : 0;
  }

  function computeFramePos(meta, t) {
    if (!meta || meta.frames <= 1 || meta.duration <= 0) return meta?.startFrame ?? 0;
    const norm = ((t % meta.duration) + meta.duration) % meta.duration;
    const maxOffset = Math.max(0, meta.frames - 1 - 1e-4);
    return meta.startFrame + Math.min(maxOffset, (norm / meta.duration) * (meta.frames - 1));
  }

  function spawn({
    x = 0,
    y = 0,
    z = 0,
    rotationY = 0,
    clip = null,
    time = 0,
    speed = 1,
  } = {}) {
    if (freeTop <= 0) return -1;
    const id = freeStack[--freeTop];
    const slot = activeCount++;
    activeIndices[slot] = id;
    indexInActive[id] = slot;

    activeFlags[id] = 1;
    posX[id] = x;
    posY[id] = Number.isFinite(y) ? y : 0;
    posZ[id] = z;
    rotY[id] = rotationY;
    let cIndex = 0;
    if (clip && clipByName.has(clip)) {
      cIndex = clipList.indexOf(clipByName.get(clip));
      if (cIndex < 0) cIndex = 0;
    }
    clipIdx[id] = cIndex;
    clipTime[id] = time;
    clipSpeed[id] = speed;
    flashTimer[id] = 0;
    if (standaloneLod) standaloneLod[id] = 0;
    return id;
  }

  function setTransform(index, x, y, z, rY = 0) {
    if (index < 0 || index >= capacity || !activeFlags[index]) return false;
    posX[index] = x;
    posY[index] = Number.isFinite(y) ? y : 0;
    posZ[index] = z;
    rotY[index] = rY;
    return true;
  }

  function getTransform(index) {
    if (index < 0 || index >= capacity || !activeFlags[index]) return null;
    return { x: posX[index], y: posY[index], z: posZ[index], rotationY: rotY[index] };
  }

  function play(index, clipName, { speed = 1, randomizePhase = false, phase = 0 } = {}) {
    if (index < 0 || index >= capacity || !activeFlags[index]) return false;
    const meta = clipByName.get(clipName);
    if (!meta) return false;
    const ci = clipList.indexOf(meta);
    clipIdx[index] = ci >= 0 ? ci : 0;
    clipSpeed[index] = speed;
    clipTime[index] = randomizePhase ? phase * meta.duration : 0;
    return true;
  }

  function setPlayback(index, clipName, time, speed = 0) {
    const packedSpeed = Math.fround(speed);
    if (!activeFlags[index] || !Number.isFinite(time) || !Number.isFinite(packedSpeed)) return false;
    let meta = clipList[clipIdx[index]];
    if (meta?.name !== clipName) {
      meta = clipByName.get(clipName);
      if (!meta) return false;
      clipIdx[index] = clipList.indexOf(meta);
    }
    const wrappedTime = meta.duration > 0 ? time % meta.duration : 0;
    clipTime[index] = wrappedTime < 0 ? wrappedTime + meta.duration : wrappedTime;
    clipSpeed[index] = packedSpeed;
    return true;
  }

  function setDistanceFallback(index, enabled) {
    if (!activeFlags[index]) return false;
    activeFlags[index] = enabled ? 2 : 1;
    return true;
  }

  function hitFlash(index, duration = 0.08) {
    if (index < 0 || index >= capacity || !activeFlags[index]) return false;
    flashTimer[index] = duration > 0 ? duration : 0;
    return true;
  }

  function kill(index) {
    if (index < 0 || index >= capacity || !activeFlags[index]) return false;
    activeFlags[index] = 0;
    flashTimer[index] = 0;
    const slot = indexInActive[index];
    const last = --activeCount;
    if (slot !== last) {
      const moved = activeIndices[last];
      activeIndices[slot] = moved;
      indexInActive[moved] = slot;
    }
    indexInActive[index] = -1;
    freeStack[freeTop++] = index;
    return true;
  }

  function clear() {
    for (let i = 0; i < activeCount; i++) {
      const id = activeIndices[i];
      activeFlags[id] = 0;
      flashTimer[id] = 0;
      indexInActive[id] = -1;
      freeStack[freeTop++] = id;
    }
    activeCount = 0;
    swarmGenerations = null;
    swarmLod = null;
    swarmLodGenerations = null;
  }

  function beginCpuPacking() {
    // A throwing culler can leave the CPU buffers partially rewritten and unsubmitted.
    if (packingIncomplete) {
      initializedRows.fill(0);
      initializedYRows.fill(0);
    }
    packingIncomplete = true;
    for (const updates of packedUpdates) updates.reset();
    for (const updates of yUpdates) updates.reset();
  }

  function writePackedRow(bucket, row, x, z, yaw, framePos, flash, status = 0, y = 0) {
    const yVal = Number.isFinite(y) ? y : 0;
    const yBuf = yBuffers[bucket];
    if (yVal !== 0) yEverUsed[bucket] = 1;
    if (yEverUsed[bucket] && (row >= initializedYRows[bucket] || yBuf[row] !== yVal)) {
      yBuf[row] = yVal;
      yUpdates[bucket].add(row);
    }
    const frame = framePos + 1;
    const packedW = Math.fround(status > 0 ? status * 16384 + frame : (flash > 0 ? -frame : frame));
    const buf = packedBuffers[bucket];
    const offset = row * 4;
    if (row < initializedRows[bucket] && buf[offset] === x && buf[offset + 1] === z &&
        buf[offset + 2] === yaw && buf[offset + 3] === packedW) return;
    buf[offset] = x;
    buf[offset + 1] = z;
    buf[offset + 2] = yaw;
    buf[offset + 3] = packedW;
    packedUpdates[bucket].add(row);
  }

  function commitLodBuffers(counts, totalActive) {
    let drawCalls = 0;
    let visibleCount = 0;
    let uploadedComponents = 0;
    for (let k = 0; k < 3; k++) {
      const n = counts[k];
      lodGeometries[k].instanceCount = n;
      lodMeshes[k].visible = n > 0;
      if (n > 0) {
        drawCalls++;
        visibleCount += n;
        uploadedComponents += packedUpdates[k].submit(packedAttrs[k]);
        initializedRows[k] = Math.max(initializedRows[k], n);
        if (yEverUsed[k]) {
          uploadedComponents += yUpdates[k].submit(yAttrs[k]);
          initializedYRows[k] = Math.max(initializedYRows[k], n);
        }
      }
    }
    packingIncomplete = false;
    return {
      activeCount: totalActive,
      visibleCount,
      culledCount: Math.max(0, totalActive - visibleCount),
      lodCounts: [counts[0], counts[1], counts[2]],
      drawCalls,
      uploadedBytes: uploadedComponents * Float32Array.BYTES_PER_ELEMENT,
    };
  }

  function update(dt = 0, { camera = null, culler = null } = {}) {
    useGpuSwarmUniform.value = 0;
    gpuOffsetUniforms[0].value = 0;
    gpuOffsetUniforms[1].value = 0;
    gpuOffsetUniforms[2].value = 0;

    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    prepareVisibility(camera, culler);
    const hasCuller = typeof culler?.testSphere === 'function' || typeof culler?.classifySphere === 'function';
    const lodCounts = [0, 0, 0];
    beginCpuPacking();

    for (let a = 0; a < activeCount; a++) {
      const id = activeIndices[a];
      if (step > 0) {
        clipTime[id] += step * clipSpeed[id];
        if (flashTimer[id] > 0) {
          flashTimer[id] = Math.max(0, flashTimer[id] - step);
        }
      }

      const px = posX[id];
      const pz = posZ[id];
      const distSq = worldDistanceSquared(px, pz);
      if (distSq > maxDistSq && activeFlags[id] === 1) continue;
      if (hasCuller && classifyWorldSphere(culler, px, pz, worldCullRadius) === 0) continue;

      const bucket = selectLod(distSq, standaloneLod?.[id] ?? 0);
      const dstSlot = lodCounts[bucket];
      if (dstSlot >= capacity) continue;
      lodCounts[bucket]++;
      if (standaloneLod) standaloneLod[id] = bucket + 1;

      const meta = clipList[clipIdx[id]] ?? clipList[0];
      const framePos = computeFramePos(meta, clipTime[id]);
      writePackedRow(bucket, dstSlot, px, pz, rotY[id], framePos, flashTimer[id], 0, posY[id]);
    }

    return commitLodBuffers(lodCounts, activeCount);
  }

  function syncFromSwarm(swarm, { camera = null, culler = null, clipNames = null } = {}) {
    if (!swarm || !swarm.activeIds || !swarm.posX || !swarm.posY) {
      throw new TypeError('syncFromSwarm requires a SwarmSimulation');
    }
    useGpuSwarmUniform.value = 0;
    gpuOffsetUniforms[0].value = 0;
    gpuOffsetUniforms[1].value = 0;
    gpuOffsetUniforms[2].value = 0;

    prepareVisibility(camera, culler);
    const hasCuller = typeof culler?.testSphere === 'function' || typeof culler?.classifySphere === 'function';
    prepareSwarmLod(swarm);
    const total = swarm.count;
    const sPosX = swarm.posX;
    const sPosZ = swarm.posY;
    const sElev = swarm.elevation ?? swarm.posElevation ?? swarm.posHeight ?? null;
    const sRot = swarm.rot;
    const sClip = swarm.animClip;
    const sTime = swarm.animTime;
    const sFlash = swarm.flash;
    const sStatus = swarm.statusCode;
    const lodCounts = [0, 0, 0];
    beginCpuPacking();

    let cidMap = null;
    if (clipNames && clipNames.length > 0) {
      cidMap = new Uint16Array(clipNames.length);
      for (let j = 0; j < clipNames.length; j++) {
        const mapped = clipByName.get(clipNames[j]);
        cidMap[j] = mapped ? Math.max(0, clipList.indexOf(mapped)) : (j % clipCount);
      }
    }
    const singleClip = clipCount === 1 && cidMap === null;
    const sStart0 = clipStarts[0];
    const sSpan0 = clipSpans[0];
    const sDur0 = clipDurs[0];
    const sInvDur0 = clipInvDurs[0];

    if (typeof swarm.ensureChunks === 'function' && swarm.chunkHead) {
      swarm.ensureChunks();
      const cCount = swarm.chunkCount;
      const cHead = swarm.chunkHead;
      const cNext = swarm.chunkNext;
      const cMinX = swarm.chunkMinX;
      const cMaxX = swarm.chunkMaxX;
      const cMinZ = swarm.chunkMinY;
      const cMaxZ = swarm.chunkMaxY;
      const occupiedCount = swarm.occupiedChunkCount;
      const occupiedIds = occupiedCount === undefined ? null : swarm.occupiedChunkIds;
      const chunkLimit = occupiedIds ? occupiedCount : cHead.length;
      const minimumLod1 = swarmLod ? nearLod1 : lod1Radius;
      const maximumLod1 = swarmLod ? farLod1 : lod1Radius;
      const minimumLod2 = swarmLod ? nearLod2 : lod2Radius;
      const maximumLod2 = swarmLod ? farLod2 : lod2Radius;
      const maxDistRad = maxDistance > 0 && Number.isFinite(maxDistance) ? maxDistance : Infinity;

      for (let i = 0; i < chunkLimit; i++) {
        const ck = occupiedIds ? occupiedIds[i] : i;
        if (!occupiedIds && cCount[ck] === 0) continue;
        const minX = cMinX[ck];
        const maxX = cMaxX[ck];
        const minZ = cMinZ[ck];
        const maxZ = cMaxZ[ck];
        const cx = (minX + maxX) * 0.5;
        const cz = (minZ + maxZ) * 0.5;
        const halfW = (maxX - minX) * 0.5;
        const halfD = (maxZ - minZ) * 0.5;
        const halfDiag = Math.sqrt(halfW * halfW * axisXSquared + halfD * halfD * axisZSquared + 2 * halfW * halfD * axisXZAbsDot);
        const chunkRadius = halfDiag + worldCullRadius;
        const centerDist = Math.sqrt(worldDistanceSquared(cx, cz));
        if (maxDistRad < Infinity && centerDist - chunkRadius > maxDistRad) continue;

        const cullState = hasCuller ? classifyWorldSphere(culler, cx, cz, chunkRadius, true) : 2;
        if (cullState === 0) continue;

        let singleBucket = -1;
        if (cullState === 2 && (maxDistRad === Infinity || centerDist + chunkRadius <= maxDistRad)) {
          // Use the fast path only when every possible prior LOD yields the same result.
          const nearDistance = centerDist - halfDiag;
          const farDistance = centerDist + halfDiag;
          if (farDistance < minimumLod1) singleBucket = 0;
          else if (nearDistance >= maximumLod1 && farDistance < minimumLod2) singleBucket = 1;
          else if (nearDistance >= maximumLod2) singleBucket = 2;
        }

        if (singleBucket !== -1) {
          let dst = lodCounts[singleBucket];
          let id = cHead[ck];
          while (id !== -1 && dst < capacity) {
            let framePos = sStart0;
            let span = sSpan0;
            let dur = sDur0;
            let invDur = sInvDur0;
            if (!singleClip) {
              const cid = sClip[id];
              const mIdx = cidMap !== null && cid < cidMap.length ? cidMap[cid] : (cid % clipCount);
              framePos = clipStarts[mIdx];
              span = clipSpans[mIdx];
              dur = clipDurs[mIdx];
              invDur = clipInvDurs[mIdx];
            }
            if (span > 0) {
              const t = sTime[id];
              let norm = t < dur && t >= 0 ? t : (t % dur);
              if (norm < 0) norm += dur;
              let fOff = norm * invDur * span;
              const maxOff = span - 1e-4;
              if (fOff > maxOff) fOff = maxOff;
              framePos += fOff;
            }
            writePackedRow(singleBucket, dst, sPosX[id], sPosZ[id], sRot[id], framePos, sFlash[id], sStatus?.[id], sElev ? sElev[id] : 0);
            rememberSwarmLod(id, singleBucket);
            dst++;
            id = cNext[id];
          }
          lodCounts[singleBucket] = dst;
        } else {
          const needPerUnitCull = cullState === 1 && hasCuller;
          let id = cHead[ck];
          while (id !== -1) {
            const px = sPosX[id];
            const pz = sPosZ[id];
            const distSq = worldDistanceSquared(px, pz);
            if (distSq <= maxDistSq && (!needPerUnitCull || classifyWorldSphere(culler, px, pz, worldCullRadius) !== 0)) {
              const bucket = selectSwarmLod(id, distSq);
              const dstSlot = lodCounts[bucket];
              if (dstSlot < capacity) {
                lodCounts[bucket]++;
                rememberSwarmLod(id, bucket);
                let framePos = sStart0;
                let span = sSpan0;
                let dur = sDur0;
                let invDur = sInvDur0;
                if (!singleClip) {
                  const cid = sClip[id];
                  const mIdx = cidMap !== null && cid < cidMap.length ? cidMap[cid] : (cid % clipCount);
                  framePos = clipStarts[mIdx];
                  span = clipSpans[mIdx];
                  dur = clipDurs[mIdx];
                  invDur = clipInvDurs[mIdx];
                }
                if (span > 0) {
                  const t = sTime[id];
                  let norm = t < dur && t >= 0 ? t : (t % dur);
                  if (norm < 0) norm += dur;
                  let fOff = norm * invDur * span;
                  const maxOff = span - 1e-4;
                  if (fOff > maxOff) fOff = maxOff;
                  framePos += fOff;
                }
                writePackedRow(bucket, dstSlot, px, pz, sRot[id], framePos, sFlash[id], sStatus?.[id], sElev ? sElev[id] : 0);
              }
            }
            id = cNext[id];
          }
        }
      }
      return commitLodBuffers(lodCounts, total);
    }

    const ids = swarm.activeIds;
    for (let i = 0; i < total; i++) {
      const id = ids[i];
      const px = sPosX[id];
      const pz = sPosZ[id];
      const distSq = worldDistanceSquared(px, pz);
      if (distSq > maxDistSq) continue;
      if (hasCuller && classifyWorldSphere(culler, px, pz, worldCullRadius) === 0) continue;

      const bucket = selectSwarmLod(id, distSq);
      const dstSlot = lodCounts[bucket];
      if (dstSlot >= capacity) continue;
      lodCounts[bucket]++;
      rememberSwarmLod(id, bucket);

      const cid = sClip[id];
      const mappedName = clipNames?.[cid];
      const meta = (mappedName && clipByName.get(mappedName)) || clipList[cid % clipList.length] || clipList[0];
      const framePos = computeFramePos(meta, sTime[id]);
      writePackedRow(bucket, dstSlot, px, pz, sRot[id], framePos, sFlash[id], sStatus?.[id], sElev ? sElev[id] : 0);
    }

    return commitLodBuffers(lodCounts, total);
  }

  function syncFromGpuSwarm(gpuSwarm, { lod0Count = 2000, lod1Count = 12000 } = {}) {
    if (!gpuSwarm || !Number.isFinite(gpuSwarm.texWidth)) {
      throw new TypeError('syncFromGpuSwarm requires a GpuSwarmWebGL2 instance');
    }
    const total = Math.min(capacity, Math.max(0, gpuSwarm.count | 0));
    const n0 = Math.min(total, Math.max(0, lod0Count | 0));
    const n1 = Math.min(total - n0, Math.max(0, lod1Count | 0));
    const n2 = Math.max(0, total - n0 - n1);
    const counts = [n0, n1, n2];

    useGpuSwarmUniform.value = 1;
    gpuSwarmTexUniform.value = gpuSwarm.texture ?? vatTexture;
    gpuSwarmWidthUniform.value = Math.max(1, gpuSwarm.texWidth | 0);
    gpuOffsetUniforms[0].value = 0;
    gpuOffsetUniforms[1].value = n0;
    gpuOffsetUniforms[2].value = n0 + n1;

    let drawCalls = 0;
    for (let k = 0; k < 3; k++) {
      const n = counts[k];
      lodGeometries[k].instanceCount = n;
      lodMeshes[k].visible = n > 0;
      if (n > 0) drawCalls++;
    }
    return {
      activeCount: total,
      visibleCount: total,
      culledCount: 0,
      lodCounts: [n0, n1, n2],
      drawCalls,
      uploadedBytes: 0,
    };
  }

  function applyToMaterials(fn) {
    if (typeof fn !== 'function') return;
    fn(lod0Mat, 0);
    fn(lod1Mat, 1);
    fn(lod2Mat, 2);
  }

  function dispose() {
    clear();
    instGeo0.dispose?.();
    instGeo1.dispose?.();
    instGeo2.dispose?.();
    lod0Mat.dispose?.();
    lod1Mat.dispose?.();
    lod2Mat.dispose?.();
    depthMat0?.dispose?.();
    depthMat1?.dispose?.();
    vatTexture?.dispose?.();
    ownedImpostorTex?.dispose?.();
    vatTexture = null;
  }

  return {
    group,
    get mesh() { return group; },
    lodMeshes: [mesh0, mesh1, mesh2],
    capacity,
    get vatTexture() { return vatTexture; },
    vatInfo: {
      width: baked.width,
      height: baked.height,
      boneCount: baked.boneCount,
      sampleFps: baked.sampleFps,
      totalFrames: baked.totalFrames,
      byteLength: baked.data.byteLength,
    },
    get count() { return activeCount; },
    getClipNames: () => clipList.map(c => c.name),
    spawn,
    getTransform,
    setTransform,
    play,
    setPlayback,
    setDistanceFallback,
    hitFlash,
    kill,
    clear,
    applyToMaterials,
    update,
    syncFromSwarm,
    syncFromGpuSwarm,
    dispose,
  };
}
