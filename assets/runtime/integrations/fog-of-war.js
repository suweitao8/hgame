// Renderer integrations for HGame Fog of War (Canvas2D hybrid analytical+memory overlay,
// minimap helper, and Three.js 3D shader/texture overlay).

function clamp01(v) {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function parseColorTuple(color, fallback = [8, 12, 22, 238]) {
  if (Array.isArray(color)) {
    return [
      color[0] ?? fallback[0],
      color[1] ?? fallback[1],
      color[2] ?? fallback[2],
      color[3] ?? fallback[3],
    ];
  }
  if (typeof color === 'number') {
    return [(color >> 16) & 255, (color >> 8) & 255, color & 255, fallback[3]];
  }
  if (typeof color === 'string') {
    const m = color.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const hex = parseInt(m[1], 16);
      return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, fallback[3]];
    }
  }
  return [...fallback];
}

function createOffscreenBuffer(w, h, createBufferCanvas) {
  if (typeof createBufferCanvas === 'function') return createBufferCanvas(w, h);
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

/**
 * Creates a Canvas2D Fog of War overlay supporting `'hybrid'` (persistent explored memory +
 * razor-sharp analytical obstacle shadow polygons), `'analytical'`, and `'grid'` modes,
 * plus an integrated minimap renderer.
 * @param {ReturnType<import('../world/fog-of-war.js').createFogOfWarWorld>} fowWorld
 */
export function createFogOfWarCanvas2DOverlay(fowWorld, {
  mode = 'hybrid',
  fogColor = [8, 12, 22, 240],
  exploredOpacity = 0.62,
  pixelate = false,
  createBufferCanvas = null,
} = {}) {
  const [r, g, b, maxA] = parseColorTuple(fogColor);
  const resX = fowWorld.resX;
  const resY = fowWorld.resY;

  const gridCanvas = createOffscreenBuffer(resX, resY, createBufferCanvas);
  const gridCtx = gridCanvas ? gridCanvas.getContext('2d') : null;
  const gridImg = gridCtx ? gridCtx.createImageData(resX, resY) : null;
  let maskCanvas = null;
  let maskCtx = null;

  const miniRgba = new Uint8ClampedArray(resX * resY * 4);
  let miniImg = gridCtx ? gridCtx.createImageData(resX, resY) : null;

  function ensureMaskSize(w, h) {
    const iw = Math.max(1, w | 0);
    const ih = Math.max(1, h | 0);
    if (!maskCanvas) {
      maskCanvas = createOffscreenBuffer(iw, ih, createBufferCanvas);
      maskCtx = maskCanvas ? maskCanvas.getContext('2d') : null;
    } else if (maskCanvas.width !== iw || maskCanvas.height !== ih) {
      maskCanvas.width = iw;
      maskCanvas.height = ih;
    }
  }

  function updateGridTexture(useLiveInGrid) {
    if (!gridCtx || !gridImg) return;
    const data = gridImg.data;
    const expMem = fowWorld.exploredMemory;
    const disp = fowWorld.displayVisibility;
    const n = resX * resY;

    for (let i = 0; i < n; i++) {
      const i4 = i * 4;
      let clearAmt = 0;
      if (useLiveInGrid) {
        clearAmt = disp[i];
      } else {
        clearAmt = expMem[i] * (1 - exploredOpacity);
      }
      const alpha = Math.round(maxA * clamp01(1 - clearAmt));
      data[i4] = r;
      data[i4 + 1] = g;
      data[i4 + 2] = b;
      data[i4 + 3] = alpha;
    }
    gridCtx.putImageData(gridImg, 0, 0);
  }

  function traceRevealerCutout(ctx, rev) {
    const totalR = rev.viewRadius + rev.softenDistance;
    if (totalR <= 0 || rev.opacity <= 0) return;

    const grad = ctx.createRadialGradient(
      rev.x, rev.y, Math.max(0.01, rev.viewRadius * 0.92),
      rev.x, rev.y, Math.max(0.02, totalR),
    );
    grad.addColorStop(0, `rgba(255,255,255,${rev.opacity})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;

    ctx.beginPath();
    if (rev.useOcclusion && rev.segmentCount >= 2) {
      const fullCircle = rev.viewAngleDeg >= 359.5;
      if (!fullCircle) {
        ctx.moveTo(rev.x, rev.y);
      }
      for (let i = 0; i < rev.segmentCount; i++) {
        const px = rev.x + rev.segDirX[i] * rev.segDist[i];
        const py = rev.y + rev.segDirY[i] * rev.segDist[i];
        if (i === 0 && fullCircle) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (rev.viewAngleDeg >= 359.5) {
      ctx.arc(rev.x, rev.y, totalR, 0, Math.PI * 2);
    } else {
      const halfRad = (rev.viewAngleDeg * 0.5 * Math.PI) / 180;
      ctx.moveTo(rev.x, rev.y);
      ctx.arc(rev.x, rev.y, totalR, rev.yaw - halfRad, rev.yaw + halfRad);
      ctx.closePath();
    }
    ctx.fill();

    // Close-range unobscured sixth-sense circle
    if (rev.unobscuredRadius > 0) {
      const uR = rev.unobscuredRadius + rev.unobscuredSoften;
      const uGrad = ctx.createRadialGradient(
        rev.x, rev.y, Math.max(0.01, rev.unobscuredRadius),
        rev.x, rev.y, Math.max(0.02, uR),
      );
      uGrad.addColorStop(0, `rgba(255,255,255,${rev.opacity})`);
      uGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = uGrad;
      ctx.beginPath();
      ctx.arc(rev.x, rev.y, uR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Draws the Fog of War overlay over a 2D logical viewport (`viewWidth x viewHeight`).
   * Assumes `ctx` is currently in logical viewport pixel coordinates `[0..viewWidth, 0..viewHeight]`.
   */
  function render(ctx, camera, viewWidth = 960, viewHeight = 540) {
    if (!ctx) return;
    ensureMaskSize(viewWidth, viewHeight);
    if (!maskCtx || !maskCanvas) return;

    const camX = camera?.x ?? 0;
    const camY = camera?.y ?? 0;
    const zoom = camera?.zoom ?? 1;
    const rot = camera?.rotation ?? 0;
    const halfW = viewWidth * 0.5;
    const halfH = viewHeight * 0.5;
    const bounds = fowWorld.bounds;

    maskCtx.save();
    maskCtx.setTransform(1, 0, 0, 1, 0, 0);
    maskCtx.clearRect(0, 0, viewWidth, viewHeight);

    maskCtx.translate(halfW, halfH);
    if (rot !== 0) maskCtx.rotate(-rot);
    maskCtx.scale(zoom, zoom);
    maskCtx.translate(-camX - (camera?.offsetX ?? 0), -camY - (camera?.offsetY ?? 0));

    if (mode === 'analytical') {
      maskCtx.globalCompositeOperation = 'source-over';
      maskCtx.fillStyle = `rgba(${r},${g},${b},${maxA / 255})`;
      maskCtx.fillRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
    } else {
      updateGridTexture(mode === 'grid');
      if (gridCanvas) {
        maskCtx.globalCompositeOperation = 'source-over';
        maskCtx.imageSmoothingEnabled = !pixelate;
        maskCtx.drawImage(gridCanvas, bounds.minX, bounds.minY, bounds.width, bounds.height);
      }
    }

    if (mode !== 'grid') {
      maskCtx.globalCompositeOperation = 'destination-out';
      const revealers = fowWorld.getRevealers();
      for (let i = 0; i < revealers.length; i++) {
        const rev = revealers[i];
        if (rev.active) traceRevealerCutout(maskCtx, rev);
      }
    }
    maskCtx.restore();

    ctx.save();
    ctx.drawImage(maskCanvas, 0, 0, viewWidth, viewHeight);
    ctx.restore();
  }

  /**
   * Renders a compact tactical minimap with Fog of War exploration + optional world markers.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {Array<{ x: number, y: number, color?: string, radius?: number }>} [markers]
   */
  function renderMinimap(ctx, x, y, width, height, markers = []) {
    if (!ctx || !gridCtx || !miniImg) return;
    fowWorld.writeMinimapRgba(miniRgba);
    miniImg.data.set(miniRgba);
    gridCtx.putImageData(miniImg, 0, 0);

    ctx.save();
    ctx.fillStyle = 'rgba(8, 12, 22, 0.85)';
    ctx.fillRect(x, y, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(gridCanvas, x, y, width, height);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, width, height);

    const bounds = fowWorld.bounds;
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const u = (m.x - bounds.minX) / bounds.width;
      const v = ((m.y ?? m.z ?? 0) - bounds.minY) / bounds.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      ctx.fillStyle = m.color ?? '#facc15';
      ctx.beginPath();
      ctx.arc(x + u * width, y + v * height, m.radius ?? 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function dispose() {
    maskCanvas = null;
    maskCtx = null;
  }

  return {
    render,
    renderMinimap,
    dispose,
  };
}

const FOW_THREE_VS = /* glsl */ `
varying vec2 vWorldXZ;
varying vec2 vFogUv;
uniform vec4 uFogBounds; // minX, minZ, invW, invH

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldXZ = wp.xz;
  vFogUv = vec2((wp.x - uFogBounds.x) * uFogBounds.z, (wp.z - uFogBounds.y) * uFogBounds.w);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FOW_THREE_FS = /* glsl */ `
precision highp float;
uniform sampler2D uFogTex;
uniform vec4 uUnexploredColor;
uniform vec4 uExploredColor;
uniform vec2 uFogScroll;
uniform float uTime;
uniform float uNoiseAmount;
uniform float uDitherSize;

varying vec2 vWorldXZ;
varying vec2 vFogUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = clamp(vFogUv, 0.0, 1.0);
  vec4 samp = texture2D(uFogTex, uv);
  float liveVis = samp.r;
  float expVis = samp.g;

  float mist = valueNoise(vWorldXZ * 0.14 + uFogScroll * uTime);
  float shroud = clamp(1.0 - max(liveVis, expVis * 0.65), 0.0, 1.0);
  float unexplored = clamp(1.0 - expVis, 0.0, 1.0);

  if (uDitherSize > 0.5) {
    vec2 cell = floor(gl_FragCoord.xy / uDitherSize);
    float thresh = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    shroud = step(thresh, shroud);
  }

  vec4 col = mix(uExploredColor, uUnexploredColor, unexplored);
  col.rgb += (mist - 0.5) * uNoiseAmount * shroud;
  float alpha = col.a * shroud * (1.0 - liveVis);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col.rgb, alpha);
}
`;

/**
 * Creates a Three.js world-aligned Fog of War plane & `DataTexture` synced zero-GC from `fowWorld`.
 * Works seamlessly for 3D top-down / isometric / RTS scenes (`plane: 'xz'`).
 */
export function createFogOfWarThreeOverlay(fowWorld, {
  THREE,
  scene,
  heightY = 0.15,
  unexploredColor = [0.03, 0.05, 0.09, 0.94],
  exploredColor = [0.06, 0.09, 0.16, 0.58],
  fogScroll = [0.25, 0.15],
  noiseAmount = 0.07,
  ditherSize = 0,
  renderOrder = 25,
} = {}) {
  if (!THREE || !scene) throw new TypeError('createFogOfWarThreeOverlay requires THREE and scene');
  const resX = fowWorld.resX;
  const resY = fowWorld.resY;
  const texData = new Uint8Array(resX * resY * 4);
  const fogTex = new THREE.DataTexture(texData, resX, resY, THREE.RGBAFormat);
  fogTex.minFilter = THREE.LinearFilter;
  fogTex.magFilter = THREE.LinearFilter;
  fogTex.generateMipmaps = false;
  fogTex.needsUpdate = true;

  const bounds = fowWorld.bounds;
  const geo = new THREE.PlaneGeometry(bounds.width, bounds.height);
  geo.rotateX(-Math.PI * 0.5);

  const MatCtor = THREE.ShaderMaterial || THREE.RawShaderMaterial;
  const mat = new MatCtor({
    vertexShader: FOW_THREE_VS,
    fragmentShader: FOW_THREE_FS,
    uniforms: {
      uFogTex: { value: fogTex },
      uFogBounds: {
        value: new THREE.Vector4(
          bounds.minX,
          bounds.minY,
          1 / bounds.width,
          1 / bounds.height,
        ),
      },
      uUnexploredColor: { value: new THREE.Vector4(...unexploredColor) },
      uExploredColor: { value: new THREE.Vector4(...exploredColor) },
      uFogScroll: { value: new THREE.Vector2(fogScroll[0], fogScroll[1]) },
      uTime: { value: 0 },
      uNoiseAmount: { value: noiseAmount },
      uDitherSize: { value: ditherSize },
    },
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(bounds.minX + bounds.width * 0.5, heightY, bounds.minY + bounds.height * 0.5);
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  mesh.name = 'HGameFogOfWar3D';
  scene.add(mesh);

  let elapsed = 0;

  function sync(dt = 0.016) {
    elapsed += Math.max(0, dt);
    mat.uniforms.uTime.value = elapsed;
    const live = fowWorld.liveVisibility;
    const exp = fowWorld.exploredMemory;
    const disp = fowWorld.displayVisibility;
    const n = resX * resY;
    for (let i = 0; i < n; i++) {
      const i4 = i * 4;
      texData[i4] = Math.round(clamp01(live[i]) * 255);
      texData[i4 + 1] = Math.round(clamp01(exp[i]) * 255);
      texData[i4 + 2] = Math.round(clamp01(disp[i]) * 255);
      texData[i4 + 3] = 255;
    }
    fogTex.needsUpdate = true;
  }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    fogTex.dispose();
  }

  return {
    mesh,
    texture: fogTex,
    material: mat,
    sync,
    dispose,
  };
}
