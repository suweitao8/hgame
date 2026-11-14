/**
 * Pure-GPU Ping-Pong FBO Swarm Simulator (`RGBA32F` WebGL2).
 *
 * Updates 100k–262k autonomous units entirely on the GPU via ping-pong `RGBA32F`
 * state textures sampling `FlowField2D` direction/obstacle data, exposing a
 * zero-copy `THREE.Texture` or raw `WebGLTexture` for `BoneVatCrowd3D` and
 * `WebGL2D` vertex shaders (`texelFetch`).
 *
 * Automatically falls back to deterministic CPU stepping in headless/Node
 * environments when neither a Three.js `WebGLRenderer` nor a WebGL2 context is supplied.
 */

const MAX_GPU_SWARM_CAPACITY = 262144;

/**
 * Minimal structural Three.js interface accepted by `createGpuSwarmWebGL2`.
 * @typedef {object} GpuSwarmThreeLike
 * @property {number} FloatType
 * @property {number} HalfFloatType
 * @property {number} RGBAFormat
 * @property {number} UnsignedByteType
 * @property {number} NearestFilter
 * @property {number} LinearFilter
 * @property {number} ClampToEdgeWrapping
 * @property {number} GLSL3
 * @property {new () => unknown} Scene
 * @property {new (l: number, r: number, t: number, b: number, n: number, f: number) => unknown} OrthographicCamera
 * @property {new (w: number, h: number) => unknown} PlaneGeometry
 * @property {new (g: unknown, m: unknown) => { frustumCulled: boolean }} Mesh
 * @property {new (opts: Record<string, unknown>) => { uniforms: Record<string, { value: unknown }>, dispose?: () => void }} RawShaderMaterial
 * @property {new (w: number, h: number, opts: Record<string, unknown>) => { texture: unknown, dispose?: () => void }} WebGLRenderTarget
 * @property {new (data: ArrayBufferView, w: number, h: number, fmt: number, type: number) => { minFilter: number, magFilter: number, wrapS: number, wrapT: number, needsUpdate: boolean, generateMipmaps: boolean, flipY: boolean, dispose?: () => void }} DataTexture
 */

/**
 * Minimal Three.js renderer surface accepted by `createGpuSwarmWebGL2`.
 * @typedef {object} GpuSwarmRendererLike
 * @property {() => unknown} getRenderTarget
 * @property {(target: unknown) => void} setRenderTarget
 * @property {(scene: unknown, camera: unknown) => void} render
 * @property {boolean} [autoClear]
 * @property {{ isWebGL2?: boolean }} [capabilities]
 * @property {() => WebGL2RenderingContext} [getContext]
 */

/**
 * @typedef {object} GpuSwarmOptions
 * @property {number} [capacity=102400] Max unit capacity (`1..262144`).
 * @property {GpuSwarmThreeLike | null} [THREE=null] Optional Three.js module for Three.js WebGLRenderTarget mode.
 * @property {GpuSwarmRendererLike | null} [renderer=null] Optional Three.js WebGLRenderer.
 * @property {WebGL2RenderingContext | null} [gl=null] Optional raw WebGL2 context for 2D / custom pipelines.
 * @property {number} [speed=3.5] Default movement speed in world units/sec.
 * @property {number} [curlStrength=0.65] Procedural spatial swirl separating overlapping streams.
 * @property {number} [animFps=12] Animation frame advance rate.
 * @property {number} [frameCount=16] Cyclic VAT/sprite frame wrap count.
 * @property {number} [originX=-128] Default FlowField origin X.
 * @property {number} [originY=-128] Default FlowField origin Y/Z.
 * @property {number} [worldWidth=256] Default FlowField span X.
 * @property {number} [worldHeight=256] Default FlowField span Y/Z.
 */

/**
 * @typedef {object} GpuSwarmSpawnOptions
 * @property {number} [x=0]
 * @property {number} [y=0]
 * @property {number} [rot=0]
 * @property {number} [frameOffset=0]
 */

/**
 * @typedef {object} GpuSwarmStepOptions
 * @property {number} [heroX=0]
 * @property {number} [heroY=0]
 * @property {number} [speed]
 */

/**
 * @typedef {object} GpuSwarmStepResult
 * @property {number} count
 * @property {boolean} gpuAccelerated
 * @property {number} uploadedBytes
 */

/**
 * @typedef {object} GpuSwarmWebGL2
 * @property {number} capacity
 * @property {number} texWidth
 * @property {number} texHeight
 * @property {number} count
 * @property {boolean} isGpuAccelerated
 * @property {unknown} texture Active `THREE.Texture` when running with Three.js (`null` otherwise).
 * @property {WebGLTexture | null} glTexture Active `WebGLTexture` when running on raw WebGL2 (`null` otherwise).
 * @property {Float32Array} data Underlying CPU state/staging buffer (`4` floats per texel).
 * @property {(opts?: GpuSwarmSpawnOptions) => number} spawn
 * @property {(count: number, generator?: ((index: number) => GpuSwarmSpawnOptions) | null) => number} spawnWave
 * @property {() => void} clear
 * @property {(flowField: { cols: number, rows: number, cellSize: number, originX: number, originY: number, rg8: Uint8Array, cost: Float32Array }) => void} updateFlowField
 * @property {(dt: number, opts?: GpuSwarmStepOptions) => GpuSwarmStepResult} step
 * @property {() => void} dispose
 */

function fastAtan2(y, x) {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  if (ax === 0 && ay === 0) return 0;
  const a = ax < ay ? ax / ay : ay / ax;
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.5707963267948966 - r;
  if (x < 0) r = 3.141592653589793 - r;
  return y < 0 ? -r : r;
}

const GLSL3_BLIT_VERT = [
  'precision highp float;',
  'in vec3 position;',
  'void main() {',
  '  gl_Position = vec4(position.xy, 0.0, 1.0);',
  '}',
].join('\n');

const GLSL3_BLIT_FRAG = [
  'precision highp float;',
  'precision highp sampler2D;',
  'uniform highp sampler2D uSrcTex;',
  'out vec4 fragColor;',
  'void main() {',
  '  fragColor = texelFetch(uSrcTex, ivec2(gl_FragCoord.xy), 0);',
  '}',
].join('\n');

const GLSL3_SIM_FRAG = [
  'precision highp float;',
  'precision highp sampler2D;',
  'uniform highp sampler2D uStateTex;',
  'uniform sampler2D uFlowTex;',
  'uniform vec4 uMeta;',    // (dt, heroX, heroY, speed)
  'uniform vec4 uWorld;',   // (originX, originY, invWorldW, invWorldH)
  'uniform vec4 uExtra;',   // (curlStrength, animFps, frameCount, texWidth)
  'uniform vec2 uFlags;',   // (liveCount, hasFlow)
  'out vec4 fragColor;',
  'void main() {',
  '  ivec2 coord = ivec2(gl_FragCoord.xy);',
  '  vec4 st = texelFetch(uStateTex, coord, 0);',
  '  int texW = max(1, int(uExtra.w + 0.5));',
  '  int gid = coord.y * texW + coord.x;',
  '  if (gid >= int(uFlags.x + 0.5)) {',
  '    fragColor = st;',
  '    return;',
  '  }',
  '  float dt = uMeta.x;',
  '  if (dt <= 0.0) {',
  '    fragColor = st;',
  '    return;',
  '  }',
  '  vec2 pos = st.rg;',
  '  float rot = st.b;',
  '  float framePos = max(0.0, abs(st.a) - 1.0);',
  '  float hash = fract(sin(float(gid) * 12.9898 + 78.233) * 43758.5453);',
  '  float unitSpeed = uMeta.w * (0.85 + 0.30 * hash);',
  '  vec2 dir = vec2(0.0);',
  '  if (uFlags.y > 0.5) {',
  '    vec2 fuv = clamp((pos - uWorld.xy) * uWorld.zw, vec2(0.0), vec2(1.0));',
  '    vec4 flow = texture(uFlowTex, fuv);',
  '    vec2 rawDir = (flow.rg * 255.0 - 128.0);',
  '    float d2 = dot(rawDir, rawDir);',
  '    if (d2 > 2.0 && flow.b < 0.75) {',
  '      dir = rawDir * inversesqrt(d2);',
  '    }',
  '  }',
  '  if (dot(dir, dir) < 0.01) {',
  '    vec2 toHero = uMeta.yz - pos;',
  '    float h2 = dot(toHero, toHero);',
  '    if (h2 > 0.04) dir = toHero * inversesqrt(h2);',
  '  }',
  '  float phase = float(gid) * 0.013;',
  '  vec2 swirl = vec2(sin(pos.y * 0.37 + phase), cos(pos.x * 0.37 - phase)) * (uExtra.x * 0.35);',
  '  vec2 vel = dir * unitSpeed + swirl;',
  '  pos += vel * dt;',
  '  if (dot(vel, vel) > 0.0001) {',
  '    rot = atan(vel.x, vel.y);',
  '  }',
  '  float fCount = max(1.0, uExtra.z);',
  '  framePos = mod(framePos + dt * uExtra.y, fCount);',
  '  fragColor = vec4(pos.x, pos.y, rot, framePos + 1.0);',
  '}',
].join('\n');

function compileGlProgram(gl, vsSrc, fsSrc) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  gl.shaderSource(vs, vsSrc);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(vs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`GpuSwarmWebGL2 vertex shader error: ${log}`);
  }
  gl.shaderSource(fs, fsSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`GpuSwarmWebGL2 fragment shader error: ${log}`);
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`GpuSwarmWebGL2 program link error: ${log}`);
  }
  return prog;
}

/**
 * Creates a WebGL2 `RGBA32F` Ping-Pong FBO GPU Swarm simulator (up to `262,144` units).
 * @param {GpuSwarmOptions} [options]
 * @returns {GpuSwarmWebGL2}
 */
export function createGpuSwarmWebGL2({
  capacity = 102400,
  THREE = null,
  renderer = null,
  gl = null,
  speed = 3.5,
  curlStrength = 0.65,
  animFps = 12,
  frameCount = 16,
  originX = -128,
  originY = -128,
  worldWidth = 256,
  worldHeight = 256,
} = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_GPU_SWARM_CAPACITY) {
    throw new RangeError(`createGpuSwarmWebGL2 capacity must be an integer in 1..${MAX_GPU_SWARM_CAPACITY}`);
  }

  const texWidth = Math.max(4, Math.ceil(Math.sqrt(capacity)));
  const texHeight = Math.ceil(capacity / texWidth);
  const fCount = Math.max(1, Number(frameCount) || 1);
  const fpsVal = Math.max(0, Number(animFps) || 0);
  const curlVal = Math.max(0, Number(curlStrength) || 0);
  const defaultSpeed = Number.isFinite(speed) ? speed : 3.5;

  const stateData = new Float32Array(texWidth * texHeight * 4);
  let liveCount = 0;
  let dirtyInitial = false;
  let readIndex = 0;
  let disposed = false;

  let flowCols = 1;
  let flowRows = 1;
  let flowOriginX = originX;
  let flowOriginY = originY;
  let invFlowW = worldWidth > 0 ? 1 / worldWidth : 1 / 256;
  let invFlowH = worldHeight > 0 ? 1 / worldHeight : 1 / 256;
  let flowBytes = new Uint8Array([128, 128, 0, 255]);
  let hasFlow = false;

  // --- Mode A: Three.js WebGLRenderTarget Ping-Pong ---
  const threeCtx = renderer?.getContext?.() || null;
  const canThreeGpu = Boolean(
    THREE && renderer
    && renderer.capabilities?.isWebGL2 !== false
    && (!threeCtx || Boolean(threeCtx.getExtension?.('EXT_color_buffer_float')))
  );
  let threeState = null;

  // --- Mode B: Raw WebGL2 Ping-Pong FBO ---
  const rawGl = !canThreeGpu ? gl : null;
  const canRawGpu = Boolean(
    rawGl
    && typeof rawGl.createFramebuffer === 'function'
    && typeof rawGl.createVertexArray === 'function'
    && rawGl.getExtension?.('EXT_color_buffer_float')
  );
  let rawState = null;

  if (canThreeGpu) {
    const rtOpts = {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    const rts = [
      new THREE.WebGLRenderTarget(texWidth, texHeight, rtOpts),
      new THREE.WebGLRenderTarget(texWidth, texHeight, rtOpts),
    ];
    const initTex = new THREE.DataTexture(stateData, texWidth, texHeight, THREE.RGBAFormat, THREE.FloatType);
    initTex.minFilter = THREE.NearestFilter;
    initTex.magFilter = THREE.NearestFilter;
    initTex.wrapS = THREE.ClampToEdgeWrapping;
    initTex.wrapT = THREE.ClampToEdgeWrapping;
    initTex.generateMipmaps = false;
    initTex.flipY = false;

    let flowTex = new THREE.DataTexture(flowBytes, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    flowTex.minFilter = THREE.LinearFilter;
    flowTex.magFilter = THREE.LinearFilter;
    flowTex.wrapS = THREE.ClampToEdgeWrapping;
    flowTex.wrapT = THREE.ClampToEdgeWrapping;
    flowTex.generateMipmaps = false;
    flowTex.flipY = false;
    flowTex.needsUpdate = true;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);

    const blitMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uSrcTex: { value: initTex } },
      vertexShader: GLSL3_BLIT_VERT,
      fragmentShader: GLSL3_BLIT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const simMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uStateTex: { value: rts[0].texture },
        uFlowTex: { value: flowTex },
        uMeta: { value: [0, 0, 0, defaultSpeed] },
        uWorld: { value: [flowOriginX, flowOriginY, invFlowW, invFlowH] },
        uExtra: { value: [curlVal, fpsVal, fCount, texWidth] },
        uFlags: { value: [0, 0] },
      },
      vertexShader: GLSL3_BLIT_VERT,
      fragmentShader: GLSL3_SIM_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quadMesh = new THREE.Mesh(quadGeo, simMat);
    quadMesh.frustumCulled = false;
    // Note: keep helper scene detached; render directly into target when stepping.
    scene.add?.(quadMesh);

    threeState = { rts, initTex, flowTex, scene, camera, quadGeo, blitMat, simMat, quadMesh };
  } else if (canRawGpu) {
    const texs = [rawGl.createTexture(), rawGl.createTexture()];
    const fbos = [rawGl.createFramebuffer(), rawGl.createFramebuffer()];
    const prevTex = rawGl.getParameter(rawGl.TEXTURE_BINDING_2D);
    const prevFbo = rawGl.getParameter(rawGl.FRAMEBUFFER_BINDING);
    for (let i = 0; i < 2; i++) {
      rawGl.bindTexture(rawGl.TEXTURE_2D, texs[i]);
      rawGl.texParameteri(rawGl.TEXTURE_2D, rawGl.TEXTURE_MIN_FILTER, rawGl.NEAREST);
      rawGl.texParameteri(rawGl.TEXTURE_2D, rawGl.TEXTURE_MAG_FILTER, rawGl.NEAREST);
      rawGl.texParameteri(rawGl.TEXTURE_2D, rawGl.TEXTURE_WRAP_S, rawGl.CLAMP_TO_EDGE);
      rawGl.texParameteri(rawGl.TEXTURE_2D, rawGl.TEXTURE_WRAP_T, rawGl.CLAMP_TO_EDGE);
      rawGl.texImage2D(rawGl.TEXTURE_2D, 0, rawGl.RGBA32F, texWidth, texHeight, 0, rawGl.RGBA, rawGl.FLOAT, null);
      rawGl.bindFramebuffer(rawGl.FRAMEBUFFER, fbos[i]);
      rawGl.framebufferTexture2D(rawGl.FRAMEBUFFER, rawGl.COLOR_ATTACHMENT0, rawGl.TEXTURE_2D, texs[i], 0);
    }

    const flowTex = rawGl.createTexture();
    rawGl.bindTexture(rawGl.TEXTURE_2D, flowTex);
    rawGl.texParameteri(rawGl.TEXTURE_2D, rawGl.TEXTURE_MIN_FILTER, rawGl.LINEAR);
    rawGl.texParameteri(rawGl.TEXTURE_2D, rawGl.TEXTURE_MAG_FILTER, rawGl.LINEAR);
    rawGl.texParameteri(rawGl.TEXTURE_2D, rawGl.TEXTURE_WRAP_S, rawGl.CLAMP_TO_EDGE);
    rawGl.texParameteri(rawGl.TEXTURE_2D, rawGl.TEXTURE_WRAP_T, rawGl.CLAMP_TO_EDGE);
    rawGl.texImage2D(rawGl.TEXTURE_2D, 0, rawGl.RGBA, 1, 1, 0, rawGl.RGBA, rawGl.UNSIGNED_BYTE, flowBytes);

    rawGl.bindFramebuffer(rawGl.FRAMEBUFFER, prevFbo);
    rawGl.bindTexture(rawGl.TEXTURE_2D, prevTex);

    const vsQuad = '#version 300 es\n' + [
      'const vec2 TRI[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));',
      'void main() {',
      '  gl_Position = vec4(TRI[gl_VertexID], 0.0, 1.0);',
      '}',
    ].join('\n');
    const fsSim = '#version 300 es\n' + GLSL3_SIM_FRAG;
    const program = compileGlProgram(rawGl, vsQuad, fsSim);
    const vao = rawGl.createVertexArray();
    rawState = {
      texs,
      fbos,
      flowTex,
      program,
      vao,
      uStateTex: rawGl.getUniformLocation(program, 'uStateTex'),
      uFlowTex: rawGl.getUniformLocation(program, 'uFlowTex'),
      uMeta: rawGl.getUniformLocation(program, 'uMeta'),
      uWorld: rawGl.getUniformLocation(program, 'uWorld'),
      uExtra: rawGl.getUniformLocation(program, 'uExtra'),
      uFlags: rawGl.getUniformLocation(program, 'uFlags'),
    };
  }

  function flushInitialUpload() {
    if (!dirtyInitial || liveCount === 0) {
      dirtyInitial = false;
      return 0;
    }
    if (threeState) {
      threeState.initTex.needsUpdate = true;
      const prevTarget = renderer.getRenderTarget();
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      threeState.quadMesh.material = threeState.blitMat;
      renderer.setRenderTarget(threeState.rts[readIndex]);
      renderer.render(threeState.scene, threeState.camera);
      threeState.quadMesh.material = threeState.simMat;
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
    } else if (rawState) {
      const prevTex = rawGl.getParameter(rawGl.TEXTURE_BINDING_2D);
      rawGl.bindTexture(rawGl.TEXTURE_2D, rawState.texs[readIndex]);
      rawGl.texSubImage2D(rawGl.TEXTURE_2D, 0, 0, 0, texWidth, texHeight, rawGl.RGBA, rawGl.FLOAT, stateData);
      rawGl.bindTexture(rawGl.TEXTURE_2D, prevTex);
    }
    dirtyInitial = false;
    return stateData.byteLength;
  }

  function spawn({ x = 0, y = 0, rot = 0, frameOffset = 0 } = {}) {
    if (disposed || liveCount >= capacity) return -1;
    const id = liveCount++;
    const off = id * 4;
    const phase = ((frameOffset % fCount) + fCount) % fCount;
    stateData[off] = x;
    stateData[off + 1] = y;
    stateData[off + 2] = rot;
    stateData[off + 3] = 1.0 + phase;
    dirtyInitial = true;
    return id;
  }

  function spawnWave(count, generator = null) {
    if (disposed) return 0;
    const n = Math.max(0, Math.min(capacity - liveCount, Math.floor(count || 0)));
    for (let i = 0; i < n; i++) {
      if (typeof generator === 'function') {
        const g = generator(i) || {};
        spawn(g);
      } else {
        const a = (i * 2.399963229728653) % (Math.PI * 2);
        const r = 10 + Math.sqrt((i + 1) / Math.max(1, n)) * 110;
        spawn({
          x: Math.cos(a) * r,
          y: Math.sin(a) * r,
          rot: a + Math.PI,
          frameOffset: (i * 0.37) % fCount,
        });
      }
    }
    return n;
  }

  function clear() {
    liveCount = 0;
    stateData.fill(0);
    dirtyInitial = false;
  }

  function updateFlowField(flowField) {
    if (!flowField || !flowField.rg8 || !flowField.cost) {
      throw new TypeError('updateFlowField requires a FlowField2D instance');
    }
    const cols = Math.max(1, flowField.cols | 0);
    const rows = Math.max(1, flowField.rows | 0);
    const total = cols * rows;
    const needSize = total * 4;
    const sizeChanged = cols !== flowCols || rows !== flowRows || flowBytes.length !== needSize;
    if (sizeChanged) {
      flowBytes = new Uint8Array(needSize);
    }
    flowCols = cols;
    flowRows = rows;
    flowOriginX = Number.isFinite(flowField.originX) ? flowField.originX : originX;
    flowOriginY = Number.isFinite(flowField.originY) ? flowField.originY : originY;
    const cs = flowField.cellSize > 0 ? flowField.cellSize : 2;
    invFlowW = 1 / (cols * cs);
    invFlowH = 1 / (rows * cs);

    const rg8 = flowField.rg8;
    const cost = flowField.cost;
    for (let i = 0; i < total; i++) {
      const i2 = i * 2;
      const i4 = i * 4;
      flowBytes[i4] = rg8[i2];
      flowBytes[i4 + 1] = rg8[i2 + 1];
      flowBytes[i4 + 2] = cost[i] >= 100000 ? 255 : 0;
      flowBytes[i4 + 3] = 255;
    }
    hasFlow = true;

    if (threeState) {
      if (sizeChanged) {
        threeState.flowTex.dispose?.();
        const nt = new THREE.DataTexture(flowBytes, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
        nt.minFilter = THREE.LinearFilter;
        nt.magFilter = THREE.LinearFilter;
        nt.wrapS = THREE.ClampToEdgeWrapping;
        nt.wrapT = THREE.ClampToEdgeWrapping;
        nt.generateMipmaps = false;
        nt.flipY = false;
        threeState.flowTex = nt;
        threeState.simMat.uniforms.uFlowTex.value = nt;
      }
      threeState.flowTex.needsUpdate = true;
    } else if (rawState) {
      const prevTex = rawGl.getParameter(rawGl.TEXTURE_BINDING_2D);
      rawGl.bindTexture(rawGl.TEXTURE_2D, rawState.flowTex);
      rawGl.texImage2D(rawGl.TEXTURE_2D, 0, rawGl.RGBA, cols, rows, 0, rawGl.RGBA, rawGl.UNSIGNED_BYTE, flowBytes);
      rawGl.bindTexture(rawGl.TEXTURE_2D, prevTex);
    }
  }

  function stepCpu(dtSec, hx, hy, spd) {
    if (dtSec <= 0 || liveCount === 0) return;
    for (let i = 0; i < liveCount; i++) {
      const off = i * 4;
      let px = stateData[off];
      let py = stateData[off + 1];
      let dx = 0;
      let dy = 0;

      if (hasFlow) {
        const u = Math.max(0, Math.min(0.999999, (px - flowOriginX) * invFlowW));
        const v = Math.max(0, Math.min(0.999999, (py - flowOriginY) * invFlowH));
        const cx = Math.floor(u * flowCols);
        const cy = Math.floor(v * flowRows);
        const idx4 = (cy * flowCols + cx) * 4;
        if (flowBytes[idx4 + 2] < 192) {
          const rdx = flowBytes[idx4] - 128;
          const rdy = flowBytes[idx4 + 1] - 128;
          const d2 = rdx * rdx + rdy * rdy;
          if (d2 > 2) {
            const invL = 1 / Math.sqrt(d2);
            dx = rdx * invL;
            dy = rdy * invL;
          }
        }
      }
      if (dx === 0 && dy === 0) {
        const tx = hx - px;
        const ty = hy - py;
        const h2 = tx * tx + ty * ty;
        if (h2 > 0.04) {
          const invH = 1 / Math.sqrt(h2);
          dx = tx * invH;
          dy = ty * invH;
        }
      }

      const h = (Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1;
      const frac = h < 0 ? h + 1 : h;
      const unitSpd = spd * (0.85 + 0.30 * frac);
      const phase = i * 0.013;
      const sx = Math.sin(py * 0.37 + phase) * curlVal * 0.35;
      const sy = Math.cos(px * 0.37 - phase) * curlVal * 0.35;
      const vx = dx * unitSpd + sx;
      const vy = dy * unitSpd + sy;
      px += vx * dtSec;
      py += vy * dtSec;
      stateData[off] = px;
      stateData[off + 1] = py;
      if (vx * vx + vy * vy > 0.0001) {
        stateData[off + 2] = fastAtan2(vx, vy);
      }
      const nextF = (Math.max(0, Math.abs(stateData[off + 3]) - 1.0) + dtSec * fpsVal) % fCount;
      stateData[off + 3] = nextF + 1.0;
    }
  }

  function step(dt = 0, { heroX = 0, heroY = 0, speed: spd = defaultSpeed } = {}) {
    if (disposed) return { count: 0, gpuAccelerated: false, uploadedBytes: 0 };
    const dtSec = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const effSpd = Number.isFinite(spd) ? spd : defaultSpeed;
    const uploaded = flushInitialUpload();
    if (liveCount === 0) {
      return { count: 0, gpuAccelerated: Boolean(threeState || rawState), uploadedBytes: uploaded };
    }

    if (threeState) {
      const dstIndex = 1 - readIndex;
      const u = threeState.simMat.uniforms;
      u.uStateTex.value = threeState.rts[readIndex].texture;
      u.uFlowTex.value = threeState.flowTex;
      u.uMeta.value[0] = dtSec;
      u.uMeta.value[1] = heroX;
      u.uMeta.value[2] = heroY;
      u.uMeta.value[3] = effSpd;
      u.uWorld.value[0] = flowOriginX;
      u.uWorld.value[1] = flowOriginY;
      u.uWorld.value[2] = invFlowW;
      u.uWorld.value[3] = invFlowH;
      u.uExtra.value[0] = curlVal;
      u.uExtra.value[1] = fpsVal;
      u.uExtra.value[2] = fCount;
      u.uExtra.value[3] = texWidth;
      u.uFlags.value[0] = liveCount;
      u.uFlags.value[1] = hasFlow ? 1 : 0;

      const prevTarget = renderer.getRenderTarget();
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      threeState.quadMesh.material = threeState.simMat;
      renderer.setRenderTarget(threeState.rts[dstIndex]);
      renderer.render(threeState.scene, threeState.camera);
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      readIndex = dstIndex;
      return { count: liveCount, gpuAccelerated: true, uploadedBytes: uploaded };
    }

    if (rawState) {
      const dstIndex = 1 - readIndex;
      const prevFbo = rawGl.getParameter(rawGl.FRAMEBUFFER_BINDING);
      const prevProg = rawGl.getParameter(rawGl.CURRENT_PROGRAM);
      const prevVao = rawGl.getParameter(rawGl.VERTEX_ARRAY_BINDING);
      const prevActiveTex = rawGl.getParameter(rawGl.ACTIVE_TEXTURE);
      const prevViewport = rawGl.getParameter(rawGl.VIEWPORT);
      const prevBlend = rawGl.isEnabled(rawGl.BLEND);
      const prevScissor = rawGl.isEnabled(rawGl.SCISSOR_TEST);

      rawGl.disable(rawGl.BLEND);
      rawGl.disable(rawGl.SCISSOR_TEST);
      rawGl.bindFramebuffer(rawGl.FRAMEBUFFER, rawState.fbos[dstIndex]);
      rawGl.viewport(0, 0, texWidth, texHeight);
      rawGl.useProgram(rawState.program);
      rawGl.bindVertexArray(rawState.vao);

      rawGl.activeTexture(rawGl.TEXTURE0);
      rawGl.bindTexture(rawGl.TEXTURE_2D, rawState.texs[readIndex]);
      rawGl.uniform1i(rawState.uStateTex, 0);

      rawGl.activeTexture(rawGl.TEXTURE0 + 1);
      rawGl.bindTexture(rawGl.TEXTURE_2D, rawState.flowTex);
      rawGl.uniform1i(rawState.uFlowTex, 1);

      rawGl.uniform4f(rawState.uMeta, dtSec, heroX, heroY, effSpd);
      rawGl.uniform4f(rawState.uWorld, flowOriginX, flowOriginY, invFlowW, invFlowH);
      rawGl.uniform4f(rawState.uExtra, curlVal, fpsVal, fCount, texWidth);
      rawGl.uniform2f(rawState.uFlags, liveCount, hasFlow ? 1 : 0);

      rawGl.drawArrays(rawGl.TRIANGLES, 0, 3);

      rawGl.bindFramebuffer(rawGl.FRAMEBUFFER, prevFbo);
      rawGl.useProgram(prevProg);
      rawGl.bindVertexArray(prevVao);
      rawGl.activeTexture(prevActiveTex);
      if (prevViewport) rawGl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
      if (prevBlend) rawGl.enable(rawGl.BLEND);
      if (prevScissor) rawGl.enable(rawGl.SCISSOR_TEST);

      readIndex = dstIndex;
      return { count: liveCount, gpuAccelerated: true, uploadedBytes: uploaded };
    }

    stepCpu(dtSec, heroX, heroY, effSpd);
    return { count: liveCount, gpuAccelerated: false, uploadedBytes: 0 };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clear();
    if (threeState) {
      threeState.rts[0].dispose?.();
      threeState.rts[1].dispose?.();
      threeState.initTex.dispose?.();
      threeState.flowTex.dispose?.();
      threeState.quadGeo.dispose?.();
      threeState.blitMat.dispose?.();
      threeState.simMat.dispose?.();
      threeState = null;
    }
    if (rawState) {
      rawGl.deleteTexture(rawState.texs[0]);
      rawGl.deleteTexture(rawState.texs[1]);
      rawGl.deleteTexture(rawState.flowTex);
      rawGl.deleteFramebuffer(rawState.fbos[0]);
      rawGl.deleteFramebuffer(rawState.fbos[1]);
      rawGl.deleteVertexArray(rawState.vao);
      rawGl.deleteProgram(rawState.program);
      rawState = null;
    }
  }

  return {
    capacity,
    texWidth,
    texHeight,
    get count() { return liveCount; },
    get isGpuAccelerated() { return Boolean(threeState || rawState); },
    get texture() { return threeState ? threeState.rts[readIndex].texture : null; },
    get glTexture() { return rawState ? rawState.texs[readIndex] : null; },
    get data() { return stateData; },
    spawn,
    spawnWave,
    clear,
    updateFlowField,
    step,
    dispose,
  };
}
