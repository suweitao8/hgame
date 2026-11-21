/**
 * Clean-room Lightmap UV2 generator (`uv1`) and WebGL2 GPU progressive sun + AO lightmap baker.
 * Never imports 'three' directly; callers pass { THREE } by dependency injection.
 */

function getAttribute(geometry, name) {
  if (!geometry) return null;
  if (typeof geometry.getAttribute === 'function') return geometry.getAttribute(name) ?? null;
  return geometry.attributes?.[name] ?? null;
}

function setAttribute(geometry, name, attr) {
  if (typeof geometry.setAttribute === 'function') {
    geometry.setAttribute(name, attr);
  } else {
    geometry.attributes = geometry.attributes || {};
    geometry.attributes[name] = attr;
  }
}

function getIndex(geometry) {
  if (typeof geometry.getIndex === 'function') return geometry.getIndex() ?? null;
  return geometry.index ?? null;
}

function setIndex(geometry, idx) {
  if (typeof geometry.setIndex === 'function') {
    geometry.setIndex(idx);
  } else {
    geometry.index = idx;
  }
}

function makeAttributeLike(refAttr, array, itemSize) {
  if (refAttr && typeof refAttr.constructor === 'function' && refAttr.constructor !== Object) {
    try {
      return new refAttr.constructor(array, itemSize);
    } catch {}
  }
  return {
    array,
    itemSize,
    count: array.length / itemSize,
    isBufferAttribute: true,
    needsUpdate: true,
  };
}

function expandGeometryNonIndexedInPlace(geometry) {
  const indexAttr = getIndex(geometry);
  if (!indexAttr?.array) return false;
  const idx = indexAttr.array;
  const vertCount = idx.length;
  const attrs = geometry.attributes || {};
  for (const [name, attr] of Object.entries(attrs)) {
    if (!attr?.array || !attr.itemSize) continue;
    const itemSize = attr.itemSize;
    const src = attr.array;
    const TypedArray = src.constructor || Float32Array;
    const dst = new TypedArray(vertCount * itemSize);
    for (let i = 0; i < vertCount; i++) {
      const srcBase = idx[i] * itemSize;
      const dstBase = i * itemSize;
      for (let k = 0; k < itemSize; k++) {
        dst[dstBase + k] = src[srcBase + k];
      }
    }
    const nextAttr = makeAttributeLike(attr, dst, itemSize);
    nextAttr.needsUpdate = true;
    setAttribute(geometry, name, nextAttr);
  }
  setIndex(geometry, null);
  return true;
}

function signedDominantAxis(nx, ny, nz) {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ax >= ay && ax >= az) return nx >= 0 ? 0 : 1; // +X, -X
  if (ay >= ax && ay >= az) return ny >= 0 ? 2 : 3; // +Y, -Y
  return nz >= 0 ? 4 : 5; // +Z, -Z
}

function projectPoint(x, y, z, axis) {
  if (axis === 0 || axis === 1) return [z, y];
  if (axis === 2 || axis === 3) return [x, z];
  return [x, y];
}

function packChartsShelf(charts, padNorm) {
  // Find maximum uniform scale where shelf packing fits in [padNorm, 1 - padNorm]^2
  const sorted = [...charts].sort((a, b) => b.h - a.h || b.w - a.w);
  const maxDim = sorted.reduce((m, c) => Math.max(m, c.w, c.h), 1e-4);
  const totalArea = sorted.reduce((s, c) => s + c.w * c.h, 1e-6);

  const tryPack = (scale) => {
    const placements = [];
    let cursorX = padNorm;
    let cursorY = padNorm;
    let rowHeight = 0;
    const limit = 1 - padNorm;
    for (const c of sorted) {
      const pw = c.w * scale;
      const ph = c.h * scale;
      if (pw > limit - padNorm + 1e-7 || ph > limit - padNorm + 1e-7) return null;
      if (cursorX + pw > limit + 1e-7) {
        cursorX = padNorm;
        cursorY += rowHeight + padNorm;
        rowHeight = 0;
      }
      if (cursorY + ph > limit + 1e-7) return null;
      placements.push({
        chart: c,
        u0: cursorX,
        v0: cursorY,
        uw: pw,
        vh: ph,
      });
      cursorX += pw + padNorm;
      if (ph > rowHeight) rowHeight = ph;
    }
    return placements;
  };

  let lo = 0;
  let hi = Math.min((1 - 2 * padNorm) / maxDim, Math.sqrt(1 / totalArea) * 1.5);
  let bestPlacements = null;
  for (let iter = 0; iter < 24; iter++) {
    const mid = (lo + hi) * 0.5;
    const res = tryPack(mid);
    if (res) {
      bestPlacements = res;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return bestPlacements || tryPack(lo) || [];
}

/**
 * Generate non-overlapping lightmap UV2 (`uv1`) coordinates for a geometry using
 * signed-dominant-axis chart flood-fill and shelf packing.
 *
 * @param {any} geometry Three.js BufferGeometry or compatible geometry object.
 * @param {{ padding?: number, resolution?: number }} [options]
 * @returns {{ charts: Array<{ id: number, axis: number, uMin: number, vMin: number, uMax: number, vMax: number, worldArea: number, triCount: number }>, utilization: number }}
 */
export function generateLightmapUV3D(geometry, { padding = 2, resolution = 1024 } = {}) {
  if (!geometry) throw new TypeError('generateLightmapUV3D requires a geometry');
  let posAttr = getAttribute(geometry, 'position');
  if (!posAttr?.array) throw new TypeError('Geometry must have a position attribute');

  let indexAttr = getIndex(geometry);
  const res = Math.max(16, Math.floor(Number(resolution) || 1024));
  const padPx = Math.max(0, Number(padding) || 0);
  const padNorm = Math.min(0.08, padPx / res);

  const readTriIndices = () => {
    const idxArr = indexAttr?.array ?? null;
    const count = idxArr ? idxArr.length : posAttr.array.length / 3;
    const triCount = Math.floor(count / 3);
    const tris = new Uint32Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
      const base = t * 3;
      tris[base] = idxArr ? idxArr[base] : base;
      tris[base + 1] = idxArr ? idxArr[base + 1] : base + 1;
      tris[base + 2] = idxArr ? idxArr[base + 2] : base + 2;
    }
    return { tris, triCount };
  };

  let { tris, triCount } = readTriIndices();
  if (triCount === 0) {
    const emptyUv = new Float32Array(0);
    setAttribute(geometry, 'uv1', makeAttributeLike(posAttr, emptyUv, 2));
    return { charts: [], utilization: 0 };
  }

  const computeCharts = () => {
    const pos = posAttr.array;
    const triAxes = new Uint8Array(triCount);
    const triAreas = new Float32Array(triCount);
    const posToTris = new Map();

    const posKey = (vi) => {
      const b = vi * 3;
      return `${Math.round(pos[b] * 1e4)},${Math.round(pos[b + 1] * 1e4)},${Math.round(pos[b + 2] * 1e4)}`;
    };

    for (let t = 0; t < triCount; t++) {
      const i0 = tris[t * 3];
      const i1 = tris[t * 3 + 1];
      const i2 = tris[t * 3 + 2];
      const b0 = i0 * 3;
      const b1 = i1 * 3;
      const b2 = i2 * 3;
      const e1x = pos[b1] - pos[b0];
      const e1y = pos[b1 + 1] - pos[b0 + 1];
      const e1z = pos[b1 + 2] - pos[b0 + 2];
      const e2x = pos[b2] - pos[b0];
      const e2y = pos[b2 + 1] - pos[b0 + 1];
      const e2z = pos[b2 + 2] - pos[b0 + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz);
      triAreas[t] = len * 0.5;
      triAxes[t] = len > 1e-12 ? signedDominantAxis(nx, ny, nz) : 2;

      for (const vi of [i0, i1, i2]) {
        const key = posKey(vi);
        let list = posToTris.get(key);
        if (!list) {
          list = [];
          posToTris.set(key, list);
        }
        list.push(t);
      }
    }

    const triToChart = new Int32Array(triCount).fill(-1);
    const charts = [];
    const queue = [];

    for (let start = 0; start < triCount; start++) {
      if (triToChart[start] !== -1) continue;
      const chartId = charts.length;
      const axis = triAxes[start];
      const triList = [];
      let worldArea = 0;
      let minU = Infinity;
      let minV = Infinity;
      let maxU = -Infinity;
      let maxV = -Infinity;

      triToChart[start] = chartId;
      queue.push(start);
      while (queue.length > 0) {
        const t = queue.pop();
        triList.push(t);
        worldArea += triAreas[t];
        for (let k = 0; k < 3; k++) {
          const vi = tris[t * 3 + k];
          const b = vi * 3;
          const [u, v] = projectPoint(pos[b], pos[b + 1], pos[b + 2], axis);
          if (u < minU) minU = u;
          if (u > maxU) maxU = u;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;

          const neighbors = posToTris.get(posKey(vi)) || [];
          for (const nt of neighbors) {
            if (triToChart[nt] === -1 && triAxes[nt] === axis) {
              triToChart[nt] = chartId;
              queue.push(nt);
            }
          }
        }
      }

      charts.push({
        id: chartId,
        axis,
        triList,
        worldArea,
        minU,
        minV,
        w: Math.max(1e-4, maxU - minU),
        h: Math.max(1e-4, maxV - minV),
      });
    }

    return { triToChart, charts };
  };

  let { triToChart, charts } = computeCharts();

  // If any vertex index is shared across different charts, un-index in place to avoid UV seam bleed
  if (indexAttr?.array) {
    const vertChart = new Int32Array(posAttr.array.length / 3).fill(-1);
    let hasShared = false;
    for (let t = 0; t < triCount; t++) {
      const cid = triToChart[t];
      for (let k = 0; k < 3; k++) {
        const vi = tris[t * 3 + k];
        if (vertChart[vi] !== -1 && vertChart[vi] !== cid) {
          hasShared = true;
          break;
        }
        vertChart[vi] = cid;
      }
      if (hasShared) break;
    }
    if (hasShared) {
      expandGeometryNonIndexedInPlace(geometry);
      posAttr = getAttribute(geometry, 'position');
      indexAttr = getIndex(geometry);
      ({ tris, triCount } = readTriIndices());
      ({ triToChart, charts } = computeCharts());
    }
  }

  const placements = packChartsShelf(charts, padNorm);
  const vertCount = posAttr.array.length / 3;
  const uv1 = new Float32Array(vertCount * 2);
  const pos = posAttr.array;

  const chartSummaries = [];
  let packedAreaSum = 0;

  for (const p of placements) {
    const c = p.chart;
    const scaleU = p.uw / c.w;
    const scaleV = p.vh / c.h;
    for (const t of c.triList) {
      for (let k = 0; k < 3; k++) {
        const vi = tris[t * 3 + k];
        const b = vi * 3;
        const [pu, pv] = projectPoint(pos[b], pos[b + 1], pos[b + 2], c.axis);
        const u = Math.max(0, Math.min(1, p.u0 + (pu - c.minU) * scaleU));
        const v = Math.max(0, Math.min(1, p.v0 + (pv - c.minV) * scaleV));
        uv1[vi * 2] = u;
        uv1[vi * 2 + 1] = v;
      }
    }
    packedAreaSum += p.uw * p.vh;
    chartSummaries.push({
      id: c.id,
      axis: c.axis,
      uMin: p.u0,
      vMin: p.v0,
      uMax: p.u0 + p.uw,
      vMax: p.v0 + p.vh,
      worldArea: c.worldArea,
      triCount: c.triList.length,
    });
  }

  const uv1Attr = makeAttributeLike(posAttr, uv1, 2);
  uv1Attr.needsUpdate = true;
  setAttribute(geometry, 'uv1', uv1Attr);

  return {
    charts: chartSummaries,
    utilization: Math.min(1, packedAreaSum),
  };
}

function halton(index, base) {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

function fibonacciSphereDir(index, total) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - ((index + 0.5) / total) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = goldenAngle * index;
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
}

function collectMeshes(input) {
  const out = [];
  const list = Array.isArray(input) ? input : [input];
  const visit = (obj) => {
    if (!obj) return;
    if (obj.isMesh && obj.geometry && obj.visible !== false) {
      out.push(obj);
    }
    if (Array.isArray(obj.children)) {
      for (const c of obj.children) visit(c);
    }
  };
  for (const item of list) visit(item);
  return out;
}

/**
 * Create a WebGL2 GPU progressive lightmap & ambient occlusion baker.
 * Generates soft directional sun shadows and cosine-weighted hemispherical AO into a `uv1`
 * lightmap texture (`channel = 1`, compatible with `applyBakedLightmap3D`).
 *
 * @param {any} THREE
 * @param {any} renderer THREE.WebGLRenderer
 * @param {{ resolution?: number, shadowResolution?: number, padding?: number }} [options]
 */
export function createLightmapBaker3D(THREE, renderer, {
  resolution = 1024,
  shadowResolution = 256,
  padding = 2,
} = {}) {
  if (!THREE?.WebGLRenderTarget || !THREE?.RawShaderMaterial) {
    throw new TypeError('createLightmapBaker3D requires a complete Three.js namespace');
  }
  if (!renderer?.getContext) {
    throw new TypeError('createLightmapBaker3D requires a Three.js WebGLRenderer');
  }

  const res = Math.max(32, Math.floor(Number(resolution) || 1024));
  const shadowRes = Math.max(64, Math.floor(Number(shadowResolution) || 256));
  const gl = renderer.getContext();
  const hasFloatExt = Boolean(
    gl?.getExtension?.('EXT_color_buffer_float') || gl?.getExtension?.('WEBGL_color_buffer_float')
  );
  if (!hasFloatExt) {
    gl?.getExtension?.('EXT_color_buffer_half_float');
  }
  const hdrType = hasFloatExt ? THREE.FloatType : THREE.HalfFloatType;

  const targetOpts = {
    type: hdrType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  };
  const worldPosRT = new THREE.WebGLRenderTarget(res, res, targetOpts);
  const worldNormalRT = new THREE.WebGLRenderTarget(res, res, targetOpts);
  const accumRT = new THREE.WebGLRenderTarget(res, res, targetOpts);
  const dilateScratchRT = new THREE.WebGLRenderTarget(res, res, targetOpts);
  const dilatePongRT = new THREE.WebGLRenderTarget(res, res, targetOpts);
  const albedoRT = new THREE.WebGLRenderTarget(res, res, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const SURFEL_GRID = 16;
  const surfelTargetOpts = {
    type: hdrType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  };
  const surfelPosRT = new THREE.WebGLRenderTarget(SURFEL_GRID, SURFEL_GRID, surfelTargetOpts);
  const surfelNormalRT = new THREE.WebGLRenderTarget(SURFEL_GRID, SURFEL_GRID, surfelTargetOpts);
  const surfelFluxRT = new THREE.WebGLRenderTarget(SURFEL_GRID, SURFEL_GRID, surfelTargetOpts);
  const shadowRT = new THREE.WebGLRenderTarget(shadowRes, shadowRes, {
    type: hdrType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  const outputRT = new THREE.WebGLRenderTarget(res, res, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  outputRT.texture.channel = 1;
  outputRT.texture.flipY = false;

  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const perspCam = THREE.PerspectiveCamera ? new THREE.PerspectiveCamera(90, 1, 0.1, 100) : null;
  const lightViewProj = new THREE.Matrix4();

  const gbufPosMat = new THREE.RawShaderMaterial({
    vertexShader: `
      attribute vec3 position;
      attribute vec2 uv1;
      uniform mat4 uModelMatrix;
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = uModelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = vec4(uv1 * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorldPos;
      void main() {
        gl_FragColor = vec4(vWorldPos, 1.0);
      }
    `,
    uniforms: { uModelMatrix: { value: new THREE.Matrix4() } },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  const gbufNormalMat = new THREE.RawShaderMaterial({
    vertexShader: `
      attribute vec3 position;
      attribute vec3 normal;
      attribute vec2 uv1;
      uniform mat3 uNormalMatrix;
      varying vec3 vWorldNormal;
      void main() {
        vWorldNormal = normalize(uNormalMatrix * normal);
        gl_Position = vec4(uv1 * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorldNormal;
      void main() {
        gl_FragColor = vec4(normalize(vWorldNormal), 1.0);
      }
    `,
    uniforms: { uNormalMatrix: { value: new THREE.Matrix3() } },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  const depthMat = new THREE.RawShaderMaterial({
    vertexShader: `
      attribute vec3 position;
      uniform mat4 modelMatrix;
      uniform mat4 viewMatrix;
      uniform mat4 projectionMatrix;
      varying float vDepth;
      void main() {
        vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        vDepth = clip.z * 0.5 + 0.5;
        gl_Position = clip;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying float vDepth;
      void main() {
        gl_FragColor = vec4(vDepth, 0.0, 0.0, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NoBlending,
  });

  const accumSampleMat = new THREE.RawShaderMaterial({
    vertexShader: `
      attribute vec3 position;
      attribute vec2 uv;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tWorldPos;
      uniform sampler2D tWorldNormal;
      uniform sampler2D tShadowDepth;
      uniform mat4 uLightViewProj;
      uniform vec3 uSampleDir;
      uniform vec3 uLightContribution;
      uniform float uNormalBias;
      uniform float uDepthBias;
      uniform float uMaxDistNorm;
      uniform float uUseCosWeight;
      void main() {
        vec4 wp = texture2D(tWorldPos, vUv);
        vec4 wn = texture2D(tWorldNormal, vUv);
        if (wn.a < 0.5) discard;
        vec3 N = normalize(wn.xyz);
        float ndotl = max(dot(N, uSampleDir), 0.0);
        if (ndotl <= 0.0001) discard;

        vec3 biasedPos = wp.xyz + N * uNormalBias;
        vec4 clip = uLightViewProj * vec4(biasedPos, 1.0);
        vec3 ndc = clip.xyz / clip.w;
        vec2 suv = ndc.xy * 0.5 + 0.5;
        float sDepth = ndc.z * 0.5 + 0.5;

        float vis = 1.0;
        if (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0 && sDepth >= 0.0 && sDepth <= 1.0) {
          float blocker = texture2D(tShadowDepth, suv).r;
          float delta = sDepth - blocker;
          if (delta > uDepthBias && (uMaxDistNorm <= 0.0 || delta < uMaxDistNorm)) {
            vis = 0.0;
          }
        }
        float weight = uUseCosWeight > 0.5 ? ndotl : ndotl;
        gl_FragColor = vec4(uLightContribution * (weight * vis), 1.0);
      }
    `,
    uniforms: {
      tWorldPos: { value: worldPosRT.texture },
      tWorldNormal: { value: worldNormalRT.texture },
      tShadowDepth: { value: shadowRT.texture },
      uLightViewProj: { value: lightViewProj },
      uSampleDir: { value: new THREE.Vector3(0, 1, 0) },
      uLightContribution: { value: new THREE.Vector3(1, 1, 1) },
      uNormalBias: { value: 0.02 },
      uDepthBias: { value: 0.004 },
      uMaxDistNorm: { value: 0.0 },
      uUseCosWeight: { value: 0.0 },
    },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });

  const dilateMat = new THREE.RawShaderMaterial({
    vertexShader: `
      attribute vec3 position;
      attribute vec2 uv;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tAccum;
      uniform sampler2D tMask;
      uniform vec2 uTexelSize;
      uniform float uEncodeOutput;
      void main() {
        float valid = texture2D(tMask, vUv).a;
        vec3 col = texture2D(tAccum, vUv).rgb;
        float outValid = valid >= 0.5 ? 1.0 : 0.0;
        if (valid < 0.5) {
          vec3 sum = vec3(0.0);
          float count = 0.0;
          for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
              if (dx == 0 && dy == 0) continue;
              vec2 suv = clamp(vUv + vec2(float(dx), float(dy)) * uTexelSize, vec2(0.0), vec2(1.0));
              if (texture2D(tMask, suv).a >= 0.5) {
                sum += texture2D(tAccum, suv).rgb;
                count += 1.0;
              }
            }
          }
          if (count > 0.0) {
            col = sum / count;
            outValid = 1.0;
          }
        }
        if (uEncodeOutput > 0.5) {
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        } else {
          gl_FragColor = vec4(max(col, vec3(0.0)), outValid);
        }
      }
    `,
    uniforms: {
      tAccum: { value: accumRT.texture },
      tMask: { value: worldNormalRT.texture },
      uTexelSize: { value: new THREE.Vector2(1 / res, 1 / res) },
      uEncodeOutput: { value: 0.0 },
    },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  const gbufAlbedoMat = new THREE.RawShaderMaterial({
    vertexShader: `
      attribute vec3 position;
      attribute vec2 uv1;
      varying vec2 vUv1;
      void main() {
        vUv1 = uv1;
        gl_Position = vec4(uv1 * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform vec3 uAlbedo;
      void main() {
        gl_FragColor = vec4(clamp(uAlbedo, 0.0, 1.0), 1.0);
      }
    `,
    uniforms: { uAlbedo: { value: new THREE.Vector3(0.8, 0.8, 0.8) } },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  const pointSpotAccumMat = new THREE.RawShaderMaterial({
    vertexShader: `
      attribute vec3 position;
      attribute vec2 uv;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tWorldPos;
      uniform sampler2D tWorldNormal;
      uniform sampler2D tShadowDepth;
      uniform mat4 uLightViewProj;
      uniform vec3 uLightPos;
      uniform vec3 uLightColor;
      uniform float uLightRange;
      uniform float uDecay;
      uniform vec3 uSpotDir;
      uniform float uSpotCosOuter;
      uniform float uSpotCosInner;
      uniform float uIsSpot;
      uniform float uCastShadow;
      uniform float uNormalBias;
      uniform float uDepthBias;
      void main() {
        vec4 wp = texture2D(tWorldPos, vUv);
        vec4 wn = texture2D(tWorldNormal, vUv);
        if (wn.a < 0.5) discard;
        vec3 N = normalize(wn.xyz);
        vec3 toLight = uLightPos - wp.xyz;
        float dist = length(toLight);
        if (uLightRange > 0.0 && dist > uLightRange) discard;
        vec3 L = toLight / max(dist, 1e-4);
        float ndotl = max(dot(N, L), 0.0);
        if (ndotl <= 0.0001) discard;

        float spotFactor = 1.0;
        if (uIsSpot > 0.5) {
          float cosTheta = dot(-L, normalize(uSpotDir));
          spotFactor = smoothstep(uSpotCosOuter, max(uSpotCosInner, uSpotCosOuter + 1e-4), cosTheta);
          if (spotFactor <= 0.0) discard;
        }

        float rangeWin = uLightRange > 0.0 ? clamp(1.0 - pow(dist / uLightRange, 4.0), 0.0, 1.0) : 1.0;
        float denom = max(0.25, pow(max(dist, 0.5), max(0.5, uDecay)));
        float atten = (rangeWin * rangeWin) / denom;

        vec3 biasedPos = wp.xyz + N * uNormalBias;
        vec4 clip = uLightViewProj * vec4(biasedPos, 1.0);
        if (clip.w <= 0.0001) discard;
        vec3 ndc = clip.xyz / clip.w;
        vec2 suv = ndc.xy * 0.5 + 0.5;
        float sDepth = ndc.z * 0.5 + 0.5;
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 || sDepth < 0.0 || sDepth > 1.0) discard;

        float vis = 1.0;
        if (uCastShadow > 0.5) {
          float blocker = texture2D(tShadowDepth, suv).r;
          if (sDepth - blocker > uDepthBias) vis = 0.0;
        }
        gl_FragColor = vec4(uLightColor * (ndotl * atten * spotFactor * vis), 1.0);
      }
    `,
    uniforms: {
      tWorldPos: { value: worldPosRT.texture },
      tWorldNormal: { value: worldNormalRT.texture },
      tShadowDepth: { value: shadowRT.texture },
      uLightViewProj: { value: lightViewProj },
      uLightPos: { value: new THREE.Vector3() },
      uLightColor: { value: new THREE.Vector3(1, 1, 1) },
      uLightRange: { value: 12.0 },
      uDecay: { value: 2.0 },
      uSpotDir: { value: new THREE.Vector3(0, -1, 0) },
      uSpotCosOuter: { value: 0.7 },
      uSpotCosInner: { value: 0.9 },
      uIsSpot: { value: 0.0 },
      uCastShadow: { value: 1.0 },
      uNormalBias: { value: 0.02 },
      uDepthBias: { value: 0.004 },
    },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });

  const surfelFluxMat = new THREE.RawShaderMaterial({
    vertexShader: `
      attribute vec3 position;
      attribute vec2 uv;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSourceA;
      uniform sampler2D tSourceB;
      uniform float uMode;
      void main() {
        if (uMode < 0.5) {
          gl_FragColor = texture2D(tSourceA, vUv);
        } else {
          vec4 alb = texture2D(tSourceA, vUv);
          vec4 rad = texture2D(tSourceB, vUv);
          gl_FragColor = vec4(alb.rgb * rad.rgb, alb.a);
        }
      }
    `,
    uniforms: {
      tSourceA: { value: worldPosRT.texture },
      tSourceB: { value: accumRT.texture },
      uMode: { value: 0.0 },
    },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  const MAX_BOUNCE_BATCH = 16;
  const surfelPosBatch = Array.from({ length: MAX_BOUNCE_BATCH }, () => new THREE.Vector4(0, 0, 0, 0));
  const surfelNormBatch = Array.from({ length: MAX_BOUNCE_BATCH }, () => new THREE.Vector4(0, 1, 0, 0));
  const surfelFluxBatch = Array.from({ length: MAX_BOUNCE_BATCH }, () => new THREE.Vector4(0, 0, 0, 0));
  const bounceMat = new THREE.RawShaderMaterial({
    vertexShader: `
      attribute vec3 position;
      attribute vec2 uv;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tWorldPos;
      uniform sampler2D tWorldNormal;
      uniform vec4 uSurfelPos[16];
      uniform vec4 uSurfelNormal[16];
      uniform vec4 uSurfelFlux[16];
      uniform int uSurfelCount;
      void main() {
        vec4 wp = texture2D(tWorldPos, vUv);
        vec4 wn = texture2D(tWorldNormal, vUv);
        if (wn.a < 0.5) discard;
        vec3 P = wp.xyz;
        vec3 N = normalize(wn.xyz);
        vec3 indirect = vec3(0.0);
        for (int i = 0; i < 16; i++) {
          if (i >= uSurfelCount) break;
          vec3 toS = uSurfelPos[i].xyz - P;
          float d2 = dot(toS, toS);
          if (d2 < 0.02) continue;
          float d = sqrt(d2);
          vec3 L = toS / d;
          float cosRecv = max(dot(N, L), 0.0);
          float cosEmit = max(dot(uSurfelNormal[i].xyz, -L), 0.0);
          float area = uSurfelPos[i].w;
          float weight = uSurfelNormal[i].w;
          float ff = (cosRecv * cosEmit * area) / (3.14159265 * (d2 + max(0.05, area)));
          indirect += uSurfelFlux[i].rgb * (ff * weight);
        }
        gl_FragColor = vec4(indirect, 1.0);
      }
    `,
    uniforms: {
      tWorldPos: { value: worldPosRT.texture },
      tWorldNormal: { value: worldNormalRT.texture },
      uSurfelPos: { value: surfelPosBatch },
      uSurfelNormal: { value: surfelNormBatch },
      uSurfelFlux: { value: surfelFluxBatch },
      uSurfelCount: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });

  const gbufScene = new THREE.Scene();
  const depthScene = new THREE.Scene();
  depthScene.matrixWorldAutoUpdate = false;
  const quadScene = new THREE.Scene();
  const quadMesh = new THREE.Mesh(quadGeo, accumSampleMat);
  quadMesh.frustumCulled = false;
  quadScene.add(quadMesh);

  let disposed = false;

  function renderShadowWithCamera(meshList, cam) {
    const prevClearColor = renderer.getClearColor ? renderer.getClearColor(new THREE.Color()) : null;
    const prevClearAlpha = renderer.getClearAlpha ? renderer.getClearAlpha() : 1;
    renderer.setRenderTarget(shadowRT);
    renderer.setClearColor?.(0xffffff, 1);
    renderer.clear(true, true, false);
    const proxies = [];
    for (const m of meshList) {
      const proxy = new THREE.Mesh(m.geometry, depthMat);
      proxy.frustumCulled = false;
      proxy.matrixAutoUpdate = false;
      proxy.matrix.copy(m.matrixWorld);
      proxy.matrixWorld.copy(m.matrixWorld);
      depthScene.add(proxy);
      proxies.push(proxy);
    }
    renderer.render(depthScene, cam);
    for (const p of proxies) depthScene.remove(p);
    if (prevClearColor) renderer.setClearColor?.(prevClearColor, prevClearAlpha);
  }

  function renderDepthFromDir(meshList, dirVec, center, radius) {
    const dist = radius * 2.5;
    orthoCam.left = -radius;
    orthoCam.right = radius;
    orthoCam.top = radius;
    orthoCam.bottom = -radius;
    orthoCam.near = 0.05;
    orthoCam.far = dist + radius * 2.5;
    orthoCam.position.set(
      center.x + dirVec.x * dist,
      center.y + dirVec.y * dist,
      center.z + dirVec.z * dist
    );
    orthoCam.up.set(0, Math.abs(dirVec.y) > 0.92 ? 0 : 1, Math.abs(dirVec.y) > 0.92 ? 1 : 0);
    orthoCam.lookAt(center);
    orthoCam.updateMatrixWorld(true);
    orthoCam.updateProjectionMatrix();
    lightViewProj.multiplyMatrices(orthoCam.projectionMatrix, orthoCam.matrixWorldInverse);
    renderShadowWithCamera(meshList, orthoCam);
  }

  const _perspTarget = new THREE.Vector3();
  const _perspDir = new THREE.Vector3();
  function renderDepthFromPerspective(meshList, origin, dirVec, fovDeg, near, far) {
    if (!perspCam) return;
    _perspDir.copy(dirVec).normalize();
    perspCam.fov = fovDeg;
    perspCam.aspect = 1;
    perspCam.near = Math.max(0.02, near);
    perspCam.far = Math.max(perspCam.near + 0.5, far);
    perspCam.position.copy(origin);
    if (Math.abs(_perspDir.y) > 0.92) {
      perspCam.up.set(0, 0, _perspDir.y > 0 ? -1 : 1);
    } else {
      perspCam.up.set(0, 1, 0);
    }
    _perspTarget.copy(origin).add(_perspDir);
    perspCam.lookAt(_perspTarget);
    perspCam.updateMatrixWorld(true);
    perspCam.updateProjectionMatrix();
    lightViewProj.multiplyMatrices(perspCam.projectionMatrix, perspCam.matrixWorldInverse);
    renderShadowWithCamera(meshList, perspCam);
  }

  function toVec3Coords(v, fallback = [0, 0, 0]) {
    if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
    if (v && typeof v === 'object') return [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
    return fallback;
  }

  /**
   * Bake sun shadows, point/spot direct lights, cosine-weighted hemispherical AO,
   * 1-bounce diffuse indirect GI, and multi-pass seam dilation into a lightmap texture.
   * @param {{
   *   meshes?: any,
   *   sun?: { direction?: any, color?: any, intensity?: number, softness?: number },
   *   ambient?: { color?: any, intensity?: number },
   *   lights?: Array<{ type?: 'point' | 'spot', position?: any, color?: any, intensity?: number, distance?: number, decay?: number, direction?: any, angle?: number, penumbra?: number, castShadow?: boolean }>,
   *   samples?: number,
   *   aoSamples?: number,
   *   aoDistance?: number,
   *   bounces?: number,
   *   bounceIntensity?: number,
   *   bounceSurfels?: number,
   *   dilationPasses?: number,
   * }} [options]
   */
  function bake({
    meshes,
    sun = {},
    ambient = { color: [0.25, 0.28, 0.35], intensity: 1.0 },
    lights = [],
    samples = 64,
    aoSamples = 64,
    aoDistance = 2.5,
    bounces = 1,
    bounceIntensity = 0.65,
    bounceSurfels = 128,
    dilationPasses = 4,
  } = {}) {
    if (disposed) throw new Error('LightmapBaker3D is disposed');
    const tStart = performance.now();
    const meshList = collectMeshes(meshes);
    if (meshList.length === 0) {
      throw new TypeError('LightmapBaker3D.bake requires at least one mesh');
    }

    const sceneBox = new THREE.Box3();
    const unbakedMeshes = [];
    for (const m of meshList) {
      m.updateMatrixWorld(true);
      if (!getAttribute(m.geometry, 'uv1')) {
        unbakedMeshes.push(m);
      }
      const box = new THREE.Box3().setFromObject(m);
      sceneBox.union(box);
    }
    if (unbakedMeshes.length > 0) {
      const cols = Math.ceil(Math.sqrt(unbakedMeshes.length));
      const rows = Math.ceil(unbakedMeshes.length / cols);
      const padNorm = Math.min(0.05, padding / res);
      for (let idx = 0; idx < unbakedMeshes.length; idx++) {
        const m = unbakedMeshes[idx];
        generateLightmapUV3D(m.geometry, { padding, resolution: res });
        if (meshList.length > 1) {
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const tileW = 1 / cols;
          const tileH = 1 / rows;
          const u0 = col * tileW + padNorm;
          const v0 = row * tileH + padNorm;
          const uScale = Math.max(1e-4, tileW - 2 * padNorm);
          const vScale = Math.max(1e-4, tileH - 2 * padNorm);
          const uv1 = getAttribute(m.geometry, 'uv1');
          for (let i = 0; i < uv1.array.length; i += 2) {
            uv1.array[i] = u0 + uv1.array[i] * uScale;
            uv1.array[i + 1] = v0 + uv1.array[i + 1] * vScale;
          }
          uv1.needsUpdate = true;
        }
      }
    }
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    sceneBox.getCenter(center);
    sceneBox.getSize(size);
    const radius = Math.max(1.0, size.length() * 0.55);

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevToneMapping = renderer.toneMapping;
    const prevClearColor = renderer.getClearColor ? renderer.getClearColor(new THREE.Color()) : null;
    const prevClearAlpha = renderer.getClearAlpha ? renderer.getClearAlpha() : 1;

    let usedSurfels = 0;
    try {
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.autoClear = false;

      // 1. Rasterize UV-space G-Buffer (worldPos + worldNormal)
      const renderGbuf = (target, mat, setupUniforms) => {
        renderer.setRenderTarget(target);
        renderer.setClearColor?.(0x000000, 0);
        renderer.clear(true, false, false);
        for (const m of meshList) {
          setupUniforms(m);
          const proxy = new THREE.Mesh(m.geometry, mat);
          proxy.frustumCulled = false;
          gbufScene.add(proxy);
          renderer.render(gbufScene, quadCam);
          gbufScene.remove(proxy);
        }
      };

      const normMat3 = new THREE.Matrix3();
      renderGbuf(worldPosRT, gbufPosMat, (m) => {
        gbufPosMat.uniforms.uModelMatrix.value.copy(m.matrixWorld);
      });
      renderGbuf(worldNormalRT, gbufNormalMat, (m) => {
        normMat3.getNormalMatrix(m.matrixWorld);
        gbufNormalMat.uniforms.uNormalMatrix.value.copy(normMat3);
      });
      renderGbuf(albedoRT, gbufAlbedoMat, (m) => {
        const c = m.material?.color;
        if (c && Number.isFinite(c.r)) {
          gbufAlbedoMat.uniforms.uAlbedo.value.set(c.r, c.g, c.b);
        } else {
          gbufAlbedoMat.uniforms.uAlbedo.value.set(0.8, 0.8, 0.8);
        }
      });

      // Clear accumulation target
      renderer.setRenderTarget(accumRT);
      renderer.setClearColor?.(0x000000, 0);
      renderer.clear(true, false, false);

      // 2. Progressive directional sun shadow samples
      const sunDirRaw = sun.direction || [0.5, 0.85, 0.35];
      const baseSunDir = new THREE.Vector3(
        sunDirRaw.x ?? sunDirRaw[0] ?? 0.5,
        sunDirRaw.y ?? sunDirRaw[1] ?? 0.85,
        sunDirRaw.z ?? sunDirRaw[2] ?? 0.35
      ).normalize();
      const sunColor = new THREE.Color(sun.color ?? 0xffffff);
      const sunIntensity = Number.isFinite(sun.intensity) ? sun.intensity : 1.0;
      const softness = Math.max(0, Number(sun.softness) || 0.08);
      const sunCount = Math.max(0, Math.floor(samples));

      // Build tangent basis around baseSunDir for soft shadow cone jitter
      const refUp = Math.abs(baseSunDir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const tangent = new THREE.Vector3().crossVectors(refUp, baseSunDir).normalize();
      const bitangent = new THREE.Vector3().crossVectors(baseSunDir, tangent).normalize();
      const sampleDir = new THREE.Vector3();

      const depthRange = radius * 5.0; // far - near (~dist + 2.5*radius)
      if (sunCount > 0 && sunIntensity > 0) {
        accumSampleMat.uniforms.uLightContribution.value.set(
          (sunColor.r * sunIntensity) / sunCount,
          (sunColor.g * sunIntensity) / sunCount,
          (sunColor.b * sunIntensity) / sunCount
        );
        accumSampleMat.uniforms.uNormalBias.value = radius * 0.008;
        accumSampleMat.uniforms.uDepthBias.value = 0.003;
        accumSampleMat.uniforms.uMaxDistNorm.value = 0.0;
        accumSampleMat.uniforms.uUseCosWeight.value = 0.0;

        for (let i = 0; i < sunCount; i++) {
          const u1 = halton(i + 1, 2);
          const u2 = halton(i + 1, 3);
          const r = Math.sqrt(u1) * softness;
          const phi = u2 * Math.PI * 2;
          sampleDir
            .copy(baseSunDir)
            .addScaledVector(tangent, Math.cos(phi) * r)
            .addScaledVector(bitangent, Math.sin(phi) * r)
            .normalize();

          renderDepthFromDir(meshList, sampleDir, center, radius);
          accumSampleMat.uniforms.uSampleDir.value.copy(sampleDir);
          quadMesh.material = accumSampleMat;
          renderer.setRenderTarget(accumRT);
          renderer.render(quadScene, quadCam);
        }
      }

      // 3. Progressive cosine-weighted hemispherical AO samples
      const aoCount = Math.max(0, Math.floor(aoSamples));
      const ambArr = Array.isArray(ambient.color) ? ambient.color : null;
      const ambColor = ambArr
        ? new THREE.Color(ambArr[0], ambArr[1], ambArr[2])
        : new THREE.Color(ambient.color ?? 0x455060);
      const ambIntensity = Number.isFinite(ambient.intensity) ? ambient.intensity : 1.0;

      if (aoCount > 0 && ambIntensity > 0) {
        // Integral over full sphere of max(N·D, 0) is pi/4 -> 4/N normalizes unoccluded AO to 1.0
        const aoScale = (4.0 * ambIntensity) / aoCount;
        accumSampleMat.uniforms.uLightContribution.value.set(
          ambColor.r * aoScale,
          ambColor.g * aoScale,
          ambColor.b * aoScale
        );
        accumSampleMat.uniforms.uNormalBias.value = radius * 0.006;
        accumSampleMat.uniforms.uDepthBias.value = 0.0025;
        accumSampleMat.uniforms.uMaxDistNorm.value = Math.max(0.01, Number(aoDistance) || 2.5) / depthRange;
        accumSampleMat.uniforms.uUseCosWeight.value = 1.0;

        for (let j = 0; j < aoCount; j++) {
          const [dx, dy, dz] = fibonacciSphereDir(j, aoCount);
          sampleDir.set(dx, dy, dz).normalize();
          renderDepthFromDir(meshList, sampleDir, center, radius);
          accumSampleMat.uniforms.uSampleDir.value.copy(sampleDir);
          quadMesh.material = accumSampleMat;
          renderer.setRenderTarget(accumRT);
          renderer.render(quadScene, quadCam);
        }
      }

      // 3b. Point & Spot direct light passes
      const lightList = Array.isArray(lights) ? lights : [];
      const pointFaces = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1],
      ];
      const lightPosVec = new THREE.Vector3();
      const lightDirVec = new THREE.Vector3();
      for (const lgt of lightList) {
        if (!lgt || typeof lgt !== 'object') continue;
        const lType = lgt.type === 'spot' ? 'spot' : 'point';
        const lInt = Number.isFinite(lgt.intensity) ? lgt.intensity : 1.0;
        if (lInt <= 0) continue;
        const [lx, ly, lz] = toVec3Coords(lgt.position, [0, 2, 0]);
        lightPosVec.set(lx, ly, lz);
        const lColor = new THREE.Color(lgt.color ?? 0xffffff);
        const lRange = Number.isFinite(lgt.distance) && lgt.distance > 0 ? lgt.distance : Math.max(8, radius * 2.5);
        const lDecay = Number.isFinite(lgt.decay) ? lgt.decay : 2.0;
        const castShadow = lgt.castShadow !== false;

        pointSpotAccumMat.uniforms.uLightPos.value.copy(lightPosVec);
        pointSpotAccumMat.uniforms.uLightColor.value.set(lColor.r * lInt, lColor.g * lInt, lColor.b * lInt);
        pointSpotAccumMat.uniforms.uLightRange.value = lRange;
        pointSpotAccumMat.uniforms.uDecay.value = lDecay;
        pointSpotAccumMat.uniforms.uCastShadow.value = castShadow ? 1.0 : 0.0;
        pointSpotAccumMat.uniforms.uNormalBias.value = radius * 0.006;
        pointSpotAccumMat.uniforms.uDepthBias.value = 0.004;

        if (lType === 'spot') {
          const [dx, dy, dz] = toVec3Coords(lgt.direction, [0, -1, 0]);
          lightDirVec.set(dx, dy, dz);
          if (lightDirVec.lengthSq() < 1e-6) lightDirVec.set(0, -1, 0);
          lightDirVec.normalize();
          const angle = Math.max(0.05, Math.min(Math.PI * 0.48, Number(lgt.angle) || 0.6));
          const penumbra = Math.max(0, Math.min(1, Number(lgt.penumbra) || 0.2));
          const outerCos = Math.cos(angle);
          const innerCos = Math.cos(angle * (1 - penumbra));
          pointSpotAccumMat.uniforms.uIsSpot.value = 1.0;
          pointSpotAccumMat.uniforms.uSpotDir.value.copy(lightDirVec);
          pointSpotAccumMat.uniforms.uSpotCosOuter.value = outerCos;
          pointSpotAccumMat.uniforms.uSpotCosInner.value = innerCos;
          renderDepthFromPerspective(meshList, lightPosVec, lightDirVec, (angle * 2 * 180) / Math.PI, 0.05, lRange * 1.25);
          quadMesh.material = pointSpotAccumMat;
          renderer.setRenderTarget(accumRT);
          renderer.render(quadScene, quadCam);
        } else {
          pointSpotAccumMat.uniforms.uIsSpot.value = 0.0;
          for (const [fx, fy, fz] of pointFaces) {
            lightDirVec.set(fx, fy, fz);
            renderDepthFromPerspective(meshList, lightPosVec, lightDirVec, 90.5, 0.05, lRange * 1.25);
            quadMesh.material = pointSpotAccumMat;
            renderer.setRenderTarget(accumRT);
            renderer.render(quadScene, quadCam);
          }
        }
      }

      // 3c. Optional 1-bounce diffuse indirect GI via coarse UV1 surfels
      const bounceCount = Math.max(0, Math.floor(Number(bounces) || 0));
      const bounceWeight = Number.isFinite(bounceIntensity) ? Math.max(0, bounceIntensity) : 0.65;
      const maxBounceSurfels = Math.max(0, Math.floor(Number(bounceSurfels) || 0));
      const canReadFloatSurfels = hasFloatExt && typeof renderer.readRenderTargetPixels === 'function';
      if (bounceCount > 0 && bounceWeight > 0 && maxBounceSurfels > 0 && canReadFloatSurfels) {
        quadMesh.material = surfelFluxMat;
        surfelFluxMat.uniforms.tSourceA.value = worldPosRT.texture;
        surfelFluxMat.uniforms.uMode.value = 0.0;
        renderer.setRenderTarget(surfelPosRT);
        renderer.clear(true, false, false);
        renderer.render(quadScene, quadCam);

        surfelFluxMat.uniforms.tSourceA.value = worldNormalRT.texture;
        surfelFluxMat.uniforms.uMode.value = 0.0;
        renderer.setRenderTarget(surfelNormalRT);
        renderer.clear(true, false, false);
        renderer.render(quadScene, quadCam);

        surfelFluxMat.uniforms.tSourceA.value = albedoRT.texture;
        surfelFluxMat.uniforms.tSourceB.value = accumRT.texture;
        surfelFluxMat.uniforms.uMode.value = 1.0;
        renderer.setRenderTarget(surfelFluxRT);
        renderer.clear(true, false, false);
        renderer.render(quadScene, quadCam);

        const cellCount = SURFEL_GRID * SURFEL_GRID;
        const posBuf = new Float32Array(cellCount * 4);
        const normBuf = new Float32Array(cellCount * 4);
        const fluxBuf = new Float32Array(cellCount * 4);
        renderer.readRenderTargetPixels(surfelPosRT, 0, 0, SURFEL_GRID, SURFEL_GRID, posBuf);
        renderer.readRenderTargetPixels(surfelNormalRT, 0, 0, SURFEL_GRID, SURFEL_GRID, normBuf);
        renderer.readRenderTargetPixels(surfelFluxRT, 0, 0, SURFEL_GRID, SURFEL_GRID, fluxBuf);

        const validSurfels = [];
        for (let i = 0; i < cellCount; i++) {
          const b = i * 4;
          if (!(normBuf[b + 3] >= 0.5)) continue;
          const fr = Math.max(0, fluxBuf[b]);
          const fg = Math.max(0, fluxBuf[b + 1]);
          const fb = Math.max(0, fluxBuf[b + 2]);
          const energy = fr + fg + fb;
          if (energy <= 1e-4) continue;
          validSurfels.push({
            px: posBuf[b], py: posBuf[b + 1], pz: posBuf[b + 2],
            nx: normBuf[b], ny: normBuf[b + 1], nz: normBuf[b + 2],
            fr, fg, fb, energy,
          });
        }
        validSurfels.sort((a, b) => b.energy - a.energy);
        const selected = validSurfels.slice(0, maxBounceSurfels);
        usedSurfels = selected.length;
        if (usedSurfels > 0) {
          const boxArea = 2 * (size.x * size.y + size.y * size.z + size.x * size.z);
          const areaWeight = Math.max(0.05, Math.min(2.5, (boxArea * 0.45) / usedSurfels));
          quadMesh.material = bounceMat;
          renderer.setRenderTarget(accumRT);
          for (let start = 0; start < usedSurfels; start += MAX_BOUNCE_BATCH) {
            const count = Math.min(MAX_BOUNCE_BATCH, usedSurfels - start);
            for (let k = 0; k < count; k++) {
              const s = selected[start + k];
              surfelPosBatch[k].set(s.px, s.py, s.pz, areaWeight);
              surfelNormBatch[k].set(s.nx, s.ny, s.nz, bounceWeight);
              surfelFluxBatch[k].set(s.fr, s.fg, s.fb, 1.0);
            }
            bounceMat.uniforms.uSurfelCount.value = count;
            renderer.render(quadScene, quadCam);
          }
        }
      }

      // 4. Multi-pass seam dilation + RGBA8 encode
      const dilateCount = Math.max(1, Math.min(12, Math.floor(Number(dilationPasses) || 4)));
      quadMesh.material = dilateMat;
      if (dilateCount === 1) {
        dilateMat.uniforms.tAccum.value = accumRT.texture;
        dilateMat.uniforms.tMask.value = worldNormalRT.texture;
        dilateMat.uniforms.uEncodeOutput.value = 1.0;
        renderer.setRenderTarget(outputRT);
        renderer.setClearColor?.(0x000000, 1);
        renderer.clear(true, false, false);
        renderer.render(quadScene, quadCam);
      } else {
        let prevRT = accumRT;
        for (let p = 0; p < dilateCount - 1; p++) {
          const nextRT = p % 2 === 0 ? dilateScratchRT : dilatePongRT;
          dilateMat.uniforms.tAccum.value = prevRT.texture;
          dilateMat.uniforms.tMask.value = p === 0 ? worldNormalRT.texture : prevRT.texture;
          dilateMat.uniforms.uEncodeOutput.value = 0.0;
          renderer.setRenderTarget(nextRT);
          renderer.setClearColor?.(0x000000, 0);
          renderer.clear(true, false, false);
          renderer.render(quadScene, quadCam);
          prevRT = nextRT;
        }
        dilateMat.uniforms.tAccum.value = prevRT.texture;
        dilateMat.uniforms.tMask.value = prevRT.texture;
        dilateMat.uniforms.uEncodeOutput.value = 1.0;
        renderer.setRenderTarget(outputRT);
        renderer.setClearColor?.(0x000000, 1);
        renderer.clear(true, false, false);
        renderer.render(quadScene, quadCam);
      }
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      if (prevToneMapping !== undefined) renderer.toneMapping = prevToneMapping;
      if (prevClearColor) renderer.setClearColor?.(prevClearColor, prevClearAlpha);
    }

    return {
      texture: outputRT.texture,
      renderTarget: outputRT,
      stats: {
        samples: Math.max(0, Math.floor(samples)) + Math.max(0, Math.floor(aoSamples)),
        lights: Array.isArray(lights) ? lights.length : 0,
        bounceSurfels: usedSurfels,
        dilationPasses: Math.max(1, Math.min(12, Math.floor(Number(dilationPasses) || 4))),
        texels: res * res,
        ms: performance.now() - tStart,
      },
    };
  }

  function readPixels() {
    if (disposed) throw new Error('LightmapBaker3D is disposed');
    const buffer = new Uint8Array(res * res * 4);
    renderer.readRenderTargetPixels(outputRT, 0, 0, res, res, buffer);
    return buffer;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    worldPosRT.dispose();
    worldNormalRT.dispose();
    accumRT.dispose();
    dilateScratchRT.dispose();
    dilatePongRT.dispose();
    albedoRT.dispose();
    surfelPosRT.dispose();
    surfelNormalRT.dispose();
    surfelFluxRT.dispose();
    shadowRT.dispose();
    outputRT.dispose();
    quadGeo.dispose();
    gbufPosMat.dispose();
    gbufNormalMat.dispose();
    gbufAlbedoMat.dispose();
    depthMat.dispose();
    accumSampleMat.dispose();
    pointSpotAccumMat.dispose();
    surfelFluxMat.dispose();
    bounceMat.dispose();
    dilateMat.dispose();
    return true;
  }

  return {
    bake,
    readPixels,
    dispose,
    get resolution() {
      return res;
    },
  };
}
