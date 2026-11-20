/**
 * Evaluates a piecewise-linear RGBA color curve at normalized lifetime `t` [0..1].
 * @param {Array<[number, number[]]> | null | undefined} stops
 * @param {number} t
 * @param {Float32Array | number[]} [out]
 * @returns {Float32Array | number[]}
 */
export function evaluateColorCurve(stops: Array<[number, number[]]> | null | undefined, t: number, out?: number[] | Float32Array | undefined): Float32Array | number[];
/**
 * Evaluates a piecewise-linear scalar size curve at normalized lifetime `t` [0..1].
 * @param {Array<[number, number]> | null | undefined} keys
 * @param {number} t
 * @returns {number}
 */
export function evaluateSizeCurve(keys: Array<[number, number]> | null | undefined, t: number): number;
/**
 * Compiles color/size curves into a zero-GC 256x1024 RGBA8 lookup table + DataTexture.
 * Left 128 texels encode RGBA colorCurve; right 128 texels encode 16-bit sizeCurve [0..8].
 */
export function createCurveLutTable(THREE?: object | null): {
    bytes: Uint8Array;
    width: number;
    height: number;
    texture: any;
    readonly rowCount: number;
    compile: (colorCurveRaw: any, sizeCurveRaw: any) => any;
    flush: () => void;
    sampleColor: (row: any, t: any, out?: Float32Array) => Float32Array;
    sampleSize: (row: any, t: any) => number;
    dispose: () => void;
};
/**
 * Generates a self-contained procedural 512x512 VFX texture atlas (sprites + 8x1 fireball flipbook).
 * @param {object | null} [THREE=null]
 * @returns {{ canvas: HTMLCanvasElement | OffscreenCanvas | null, texture: object | null, regions: Record<string, readonly number[]> }}
 */
export function createProceduralVfxAtlas(THREE?: object | null): {
    canvas: HTMLCanvasElement | OffscreenCanvas | null;
    texture: object | null;
    regions: Record<string, readonly number[]>;
};
/**
 * Computes analytical + GPU-matched particle position at `age` seconds for trail/follow sync.
 * @param {number} x0
 * @param {number} y0
 * @param {number} z0
 * @param {number} vx
 * @param {number} vy
 * @param {number} vz
 * @param {number} gravity
 * @param {number} drag
 * @param {number} noiseStrength
 * @param {number} noiseFreq
 * @param {number} phase
 * @param {number} age
 * @param {boolean} is2D
 * @param {Float32Array | number[]} outPos
 * @param {number} [orbitalY=0]
 * @param {number} [centerOffX=0]
 * @param {number} [centerOffZ=0]
 */
export function evaluateAtlasParticlePosition(x0: number, y0: number, z0: number, vx: number, vy: number, vz: number, gravity: number, drag: number, noiseStrength: number, noiseFreq: number, phase: number, age: number, is2D: boolean, outPos: Float32Array | number[], orbitalY?: number | undefined, centerOffX?: number | undefined, centerOffZ?: number | undefined, noiseYScale?: number): number[] | Float32Array;
/**
 * Textured, flipbook, and curve-driven zero-GC GPU particle pool supporting
 * billboard, horizontal ground, and velocity-stretched modes across 3D/WebGL2/Canvas2D/Headless.
 * @param {object} [options]
 * @param {string} [options.mode='headless']
 * @param {object | null} [options.THREE=null]
 * @param {object | null} [options.scene=null]
 * @param {WebGL2RenderingContext | null} [options.gl=null]
 * @param {number} [options.maxParticles]
 * @param {boolean} [options.is2D]
 * @param {ReturnType<typeof createVisualPrng>} [options.prng]
 * @param {object | null} [options.atlasTexture=null]
 * @param {Record<string, readonly number[]> | null} [options.atlasRegions=null]
 */
export function createAtlasParticlePool({ mode, THREE, scene, gl, maxParticles, is2D, prng, atlasTexture, atlasRegions, }?: {
    mode?: string | undefined;
    THREE?: object | null;
    scene?: object | null;
    gl?: WebGL2RenderingContext | null | undefined;
    maxParticles?: number | undefined;
    is2D?: boolean | undefined;
    prng?: {
        nextFloat(): number;
        range(min: any, max: any): any;
        reset(newSeed?: number): void;
    } | undefined;
    atlasTexture?: object | null;
    atlasRegions?: Record<string, readonly number[]> | null | undefined;
} | undefined): {
    capacity: number;
    lut: {
        bytes: Uint8Array;
        width: number;
        height: number;
        texture: any;
        readonly rowCount: number;
        compile: (colorCurveRaw: any, sizeCurveRaw: any) => any;
        flush: () => void;
        sampleColor: (row: any, t: any, out?: Float32Array) => Float32Array;
        sampleSize: (row: any, t: any) => number;
        dispose: () => void;
    };
    regions: Record<string, readonly number[]>;
    compileCurves: (colorCurveRaw: any, sizeCurveRaw: any) => any;
    setAtlas: (textureOrCanvas: object | null, newRegions?: Record<string, readonly number[]> | undefined) => void;
    setDepthTexture: (depthTexture: any, { near, far, width, height, softFade }?: {
        near?: number | undefined;
        far?: number | undefined;
        width?: number | undefined;
        height?: number | undefined;
        softFade?: number | undefined;
    }) => void;
    emit: (opts?: object) => number;
    updateSlot: (additive: any, idx: any, x: any, y: any, z: any, vx: any, vy: any, vz: any) => void;
    killSlot: (additive: any, idx: any) => void;
    flushDirty: () => void;
    update: (visualDt: any) => void;
    renderWebGL2: (camera: any, viewWidth: any, viewHeight: any) => void;
    renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
    reset: () => void;
    dispose: () => void;
    readonly time: number;
    getStats(): {
        capacity: number;
        curveRows: number;
        normalCursor: number;
        additiveCursor: number;
        normalTotal: number;
        additiveTotal: number;
    };
};
export const VFX_RENDER_MODE: Readonly<{
    BILLBOARD: 0;
    HORIZONTAL: 1;
    STRETCHED: 2;
    MESH: 3;
    VERTICAL: 4;
}>;
/**
 * Default UV region map for the built-in 512x512 procedural VFX atlas.
 * Coordinates are top-left normalized `[u0, v0, u1, v1]`.
 */
export const PROCEDURAL_VFX_ATLAS_REGIONS: Readonly<{
    glow: readonly number[];
    spark: readonly number[];
    ring: readonly number[];
    wave: readonly number[];
    smoke: readonly number[];
    shard: readonly number[];
    rune_ring: readonly number[];
    trail: readonly number[];
    fireball_flipbook: readonly number[];
    shield_hex: readonly number[];
    snowflake: readonly number[];
}>;
export const ATLAS_PARTICLE_VERTEX_GLSL: "\nprecision highp float;\n\nattribute vec3 position;\nattribute vec2 uv;\nattribute vec4 aAtlasP0; // x0, y0, z0, spawnTime\nattribute vec4 aAtlasP1; // vx, vy, vz, duration\nattribute vec4 aAtlasP2; // sizeStart, gravity, drag, curveRow\nattribute vec4 aAtlasP3; // rot0, angularVel, hdr, renderMode (0=billboard, 1=horizontal, 2=stretched)\nattribute vec4 aAtlasP4; // u0, v0, u1, v1\nattribute vec4 aAtlasP5; // cols, rows, cycles, blendFlag\nattribute vec4 aAtlasP6; // noiseStrength, noiseFreq, stretch, phase\nattribute vec4 aAtlasP7; // tintRgb24, orbitalY, centerOffX, centerOffZ\n\nuniform mat4 projectionMatrix;\nuniform mat4 modelViewMatrix;\nuniform sampler2D uCurveLut;\nuniform float uTime;\nuniform float uIs2D;\n\nvarying vec2 vUv;\nvarying float vLifeRatio;\nvarying float vCurveRow;\nvarying float vHdr;\nvarying vec4 vUvRect;\nvarying vec4 vFlipbook;\nvarying vec3 vTint;\n\nvec3 unpackRgb24(float v) {\n  float r = floor(v / 65536.0);\n  float rem = v - r * 65536.0;\n  float g = floor(rem / 256.0);\n  float b = rem - g * 256.0;\n  return vec3(r, g, b) / 255.0;\n}\n\nfloat sampleSizeCurve(float row, float t) {\n  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;\n  float s = clamp(t, 0.0, 1.0) * 127.0;\n  float i0 = floor(s);\n  float i1 = min(127.0, i0 + 1.0);\n  float f = s - i0;\n  vec4 t0 = texture2D(uCurveLut, vec2((128.0 + i0 + 0.5) / 256.0, rowV));\n  vec4 t1 = texture2D(uCurveLut, vec2((128.0 + i1 + 0.5) / 256.0, rowV));\n  float s0 = (t0.r * 255.0 * 256.0 + t0.g * 255.0) / 65535.0 * 8.0;\n  float s1 = (t1.r * 255.0 * 256.0 + t1.g * 255.0) / 65535.0 * 8.0;\n  return mix(s0, s1, f);\n}\n\nvoid main() {\n  float age = uTime - aAtlasP0.w;\n  float dur = aAtlasP1.w;\n  float rawCurve = aAtlasP2.w;\n  bool isPersistent = rawCurve >= 1023.5;\n  bool isLoopCurve = rawCurve >= 1023.5 && rawCurve < 2047.5;\n  float curveRow = mod(rawCurve, 1024.0);\n  if (dur <= 0.0 || age < 0.0 || (!isPersistent && age >= dur)) {\n    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n    return;\n  }\n\n  float t = isLoopCurve ? fract(age / max(0.001, dur)) : (isPersistent ? 0.0 : age / dur);\n  vLifeRatio = t;\n  vUv = uv;\n  vCurveRow = curveRow;\n  vHdr = aAtlasP3.z;\n  vUvRect = aAtlasP4;\n  vFlipbook = aAtlasP5;\n  vTint = unpackRgb24(aAtlasP7.x);\n\n  float k = aAtlasP2.z;\n  vec3 worldPos;\n  vec3 curVel;\n  if (k < -0.5) {\n    worldPos = aAtlasP0.xyz;\n    curVel = aAtlasP1.xyz;\n  } else {\n    float dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;\n    float velDecay = (k > 0.001) ? exp(-k * age) : 1.0;\n    vec3 gVec = (uIs2D > 0.5) ? vec3(0.0, aAtlasP2.y, 0.0) : vec3(0.0, -aAtlasP2.y, 0.0);\n    worldPos = aAtlasP0.xyz + aAtlasP1.xyz * dispFactor + 0.5 * gVec * (age * age);\n    curVel = aAtlasP1.xyz * velDecay + gVec * age;\n\n    float orb = aAtlasP7.y;\n    if (abs(orb) > 0.0001 && uIs2D < 0.5) {\n      vec2 cxz = aAtlasP0.xz - aAtlasP7.zw;\n      vec2 rel = worldPos.xz - cxz;\n      float oa = orb * age;\n      float oc = cos(oa);\n      float os = sin(oa);\n      worldPos.xz = cxz + vec2(rel.x * oc - rel.y * os, rel.x * os + rel.y * oc);\n      curVel.xz = vec2(curVel.x * oc - curVel.z * os, curVel.x * os + curVel.z * oc);\n    }\n\n    float nStr = aAtlasP6.x;\n    if (nStr > 0.001) {\n      float nFreq = max(0.08, aAtlasP6.y);\n      float ph = aAtlasP6.w * 6.2831853;\n      float travelSpd = length(aAtlasP1.xyz) + abs(aAtlasP7.y) * length(aAtlasP7.zw);\n      float spatialRate = 1.0 + clamp((travelSpd - 2.2) * 0.25, 0.0, 5.5);\n      float w1 = nFreq * 2.5 * spatialRate;\n      float w2 = nFreq * 4.2 * spatialRate;\n      float rm = aAtlasP3.w;\n      float yScale = (rm > 1.5 && rm < 2.5) ? 1.0 : aAtlasP6.z;\n      vec3 disp1 = vec3(\n        (sin(w1 * age + ph) - sin(ph)) / w1,\n        (sin(w1 * age * 1.13 + ph * 2.1) - sin(ph * 2.1)) / (w1 * 1.13),\n        (cos(ph * 1.7) - cos(w1 * age + ph * 1.7)) / w1\n      );\n      vec3 disp2 = vec3(\n        (cos(ph * 2.9) - cos(w2 * age + ph * 2.9)) / w2,\n        (sin(w2 * age * 0.91 + ph * 1.4) - sin(ph * 1.4)) / (w2 * 0.91),\n        (sin(w2 * age + ph * 2.3) - sin(ph * 2.3)) / w2\n      );\n      vec3 noiseOff = (disp1 + 0.45 * disp2) * nStr * 1.18 * (spatialRate > 1.01 ? (0.45 + 0.55 * spatialRate) : 1.0);\n      noiseOff.y *= yScale;\n      worldPos += noiseOff;\n    }\n  }\n\n  float curSize = aAtlasP2.x * sampleSizeCurve(curveRow, t);\n  float rot = aAtlasP3.x + aAtlasP3.y * age;\n  float renderMode = aAtlasP3.w;\n\n  if (uIs2D > 0.5) {\n    float c = cos(rot);\n    float s = sin(rot);\n    vec2 axisX = vec2(c, s);\n    vec2 axisY = vec2(-s, c);\n    float lenScale = curSize;\n    if (renderMode > 1.5 && renderMode < 2.5) {\n      float spd = length(curVel.xy);\n      if (spd > 0.001) {\n        axisX = curVel.xy / spd;\n        axisY = vec2(-axisX.y, axisX.x);\n      }\n      lenScale = curSize * (1.0 + aAtlasP6.z * min(spd * 0.015, 4.0));\n    }\n    vec2 p2 = worldPos.xy + axisX * (position.x * lenScale) + axisY * (position.y * curSize);\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(p2, worldPos.z, 1.0);\n  } else if (renderMode > 0.5 && renderMode < 1.5) {\n    float c = cos(rot);\n    float s = sin(rot);\n    vec3 worldQuad = worldPos + vec3(\n      (position.x * c - position.y * s) * curSize,\n      0.0,\n      (position.x * s + position.y * c) * curSize\n    );\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldQuad, 1.0);\n  } else if (renderMode > 3.5) {\n    vec3 camRight = vec3(modelViewMatrix[0][0], 0.0, modelViewMatrix[2][0]);\n    float rLen = length(camRight);\n    camRight = rLen > 0.0001 ? (camRight / rLen) : vec3(1.0, 0.0, 0.0);\n    vec3 upW = vec3(0.0, 1.0, 0.0);\n    float c = cos(rot);\n    float s = sin(rot);\n    float aspectY = max(0.05, aAtlasP6.z);\n    vec2 rPos = vec2(\n      (position.x * c - position.y * s) * curSize,\n      (position.x * s + position.y * c) * curSize * aspectY\n    );\n    vec3 worldQuad = worldPos + camRight * rPos.x + upW * rPos.y;\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldQuad, 1.0);\n  } else {\n    vec4 mvCenter = modelViewMatrix * vec4(worldPos, 1.0);\n    vec2 rightAxis;\n    float major = curSize;\n    if (renderMode > 1.5 && renderMode < 2.5) {\n      vec3 viewVel = mat3(modelViewMatrix) * curVel;\n      float spd = length(viewVel.xy);\n      rightAxis = spd > 0.001 ? (viewVel.xy / spd) : vec2(cos(rot), sin(rot));\n      major = curSize * (1.0 + aAtlasP6.z * min(spd * 0.08, 4.5));\n    } else {\n      rightAxis = vec2(cos(rot), sin(rot));\n    }\n    vec2 upAxis = vec2(-rightAxis.y, rightAxis.x);\n    float billH = (renderMode < 0.5 && aAtlasP6.x <= 0.001) ? (curSize * max(0.05, aAtlasP6.z)) : curSize;\n    float minBill = (renderMode < 0.5 && curSize > 0.001) ? abs(mvCenter.z) * 0.0042 : 0.0;\n    mvCenter.xy += rightAxis * (position.x * max(major, minBill)) + upAxis * (position.y * max(billH, minBill));\n    gl_Position = projectionMatrix * mvCenter;\n  }\n}\n";
export const ATLAS_PARTICLE_FRAGMENT_GLSL: "\nprecision highp float;\n\nuniform sampler2D uCurveLut;\nuniform sampler2D uAtlasTex;\nuniform sampler2D uSoftDepthTex;\nuniform float uHasAtlas;\nuniform float uFlipV;\nuniform float uHasSoftDepth;\nuniform float uSoftFade;\nuniform vec2 uInvViewport;\nuniform vec2 uCamNearFar;\n\nvarying vec2 vUv;\nvarying float vLifeRatio;\nvarying float vCurveRow;\nvarying float vHdr;\nvarying vec4 vUvRect;\nvarying vec4 vFlipbook;\nvarying vec3 vTint;\n\nfloat linearizeDepth(float zNdc) {\n  float z = zNdc * 2.0 - 1.0;\n  float n = uCamNearFar.x;\n  float f = uCamNearFar.y;\n  return (2.0 * n * f) / max(0.0001, f + n - z * (f - n));\n}\n\nvec4 sampleColorCurve(float row, float t) {\n  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;\n  float s = clamp(t, 0.0, 1.0) * 127.0;\n  float i0 = floor(s);\n  float i1 = min(127.0, i0 + 1.0);\n  float f = s - i0;\n  vec4 c0 = texture2D(uCurveLut, vec2((i0 + 0.5) / 256.0, rowV));\n  vec4 c1 = texture2D(uCurveLut, vec2((i1 + 0.5) / 256.0, rowV));\n  return mix(c0, c1, f);\n}\n\nvec4 sampleAtlasFrame(float frameIdx, vec2 localUv) {\n  float cols = max(1.0, floor(vFlipbook.x + 0.5));\n  float rows = max(1.0, floor(vFlipbook.y + 0.5));\n  float col = mod(frameIdx, cols);\n  float row = floor(frameIdx / cols);\n  vec2 cellUv = vec2((col + localUv.x) / cols, (row + localUv.y) / rows);\n  vec2 mapped = vec2(\n    mix(vUvRect.x, vUvRect.z, cellUv.x),\n    mix(vUvRect.y, vUvRect.w, cellUv.y)\n  );\n  if (uFlipV > 0.5) mapped.y = 1.0 - mapped.y;\n  return texture2D(uAtlasTex, mapped);\n}\n\nvoid main() {\n  vec4 curveCol = sampleColorCurve(vCurveRow, vLifeRatio);\n  if (curveCol.a < 0.001) discard;\n\n  vec4 texCol = vec4(1.0);\n  if (uHasAtlas > 0.5) {\n    vec2 topDownUv = vec2(vUv.x, 1.0 - vUv.y);\n    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {\n      float total = max(1.0, floor(vFlipbook.x + 0.5) * floor(vFlipbook.y + 0.5));\n      float cycles = max(0.01, vFlipbook.z);\n      float framePos = clamp(fract(vLifeRatio * cycles), 0.0, 0.9999) * total;\n      if (vLifeRatio * cycles >= 1.0 && cycles <= 1.001) {\n        framePos = total - 0.001;\n      }\n      float f0 = floor(framePos);\n      texCol = sampleAtlasFrame(f0, topDownUv);\n      if (vFlipbook.w > 0.5) {\n        float f1 = min(total - 1.0, f0 + 1.0);\n        vec4 nextCol = sampleAtlasFrame(f1, topDownUv);\n        texCol = mix(texCol, nextCol, fract(framePos));\n      }\n    } else {\n      vec2 mapped = vec2(\n        mix(vUvRect.x, vUvRect.z, topDownUv.x),\n        mix(vUvRect.y, vUvRect.w, topDownUv.y)\n      );\n      if (uFlipV > 0.5) mapped.y = 1.0 - mapped.y;\n      texCol = texture2D(uAtlasTex, mapped);\n    }\n  } else {\n    float r = length(vUv * 2.0 - 1.0);\n    if (r > 1.0) discard;\n    texCol.a = exp(-3.6 * r * r);\n  }\n\n  float softMul = 1.0;\n  if (uHasSoftDepth > 0.5 && uSoftFade > 0.001) {\n    float sceneDepthRaw = texture2D(uSoftDepthTex, gl_FragCoord.xy * uInvViewport).r;\n    float sceneZ = linearizeDepth(sceneDepthRaw);\n    float partZ = linearizeDepth(gl_FragCoord.z);\n    softMul = clamp((sceneZ - partZ) / uSoftFade, 0.0, 1.0);\n  }\n\n  float alpha = texCol.a * curveCol.a * softMul;\n  if (alpha < 0.0005) discard;\n  vec3 rgb = texCol.rgb * curveCol.rgb * vTint * max(0.0, vHdr);\n  // Preserve HDR hue and intensity on fixed-point RGBA8 framebuffers before hardware clamp.\n  float peak = max(rgb.r, max(rgb.g, rgb.b));\n  if (peak > 1.0 && alpha > 0.0 && alpha < 1.0) {\n    float boost = min(peak, 1.0 / alpha);\n    rgb /= boost;\n    alpha *= boost;\n  }\n  gl_FragColor = vec4(rgb, alpha);\n}\n";
export const ATLAS_PARTICLE_WEBGL2_2D_VS: "#version 300 es\nprecision highp float;\n\nlayout(location = 0) in vec2 aQuadPos;\nlayout(location = 1) in vec4 aAtlasP0;\nlayout(location = 2) in vec4 aAtlasP1;\nlayout(location = 3) in vec4 aAtlasP2;\nlayout(location = 4) in vec4 aAtlasP3;\nlayout(location = 5) in vec4 aAtlasP4;\nlayout(location = 6) in vec4 aAtlasP5;\nlayout(location = 7) in vec4 aAtlasP6;\nlayout(location = 8) in vec4 aAtlasP7;\n\nuniform sampler2D uCurveLut;\nuniform float uTime;\nuniform vec2 uCamPos;\nuniform float uCamZoom;\nuniform vec2 uViewSize;\n\nout vec2 vUv;\nout float vLifeRatio;\nout float vCurveRow;\nout float vHdr;\nout vec4 vUvRect;\nout vec4 vFlipbook;\nout vec3 vTint;\n\nvec3 unpackRgb24(float v) {\n  float r = floor(v / 65536.0);\n  float rem = v - r * 65536.0;\n  float g = floor(rem / 256.0);\n  float b = rem - g * 256.0;\n  return vec3(r, g, b) / 255.0;\n}\n\nfloat sampleSizeCurve(float row, float t) {\n  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;\n  float s = clamp(t, 0.0, 1.0) * 127.0;\n  float i0 = floor(s);\n  float i1 = min(127.0, i0 + 1.0);\n  float f = s - i0;\n  vec4 t0 = texture(uCurveLut, vec2((128.0 + i0 + 0.5) / 256.0, rowV));\n  vec4 t1 = texture(uCurveLut, vec2((128.0 + i1 + 0.5) / 256.0, rowV));\n  float s0 = (t0.r * 255.0 * 256.0 + t0.g * 255.0) / 65535.0 * 8.0;\n  float s1 = (t1.r * 255.0 * 256.0 + t1.g * 255.0) / 65535.0 * 8.0;\n  return mix(s0, s1, f);\n}\n\nvoid main() {\n  float age = uTime - aAtlasP0.w;\n  float dur = aAtlasP1.w;\n  float rawCurve = aAtlasP2.w;\n  bool isPersistent = rawCurve >= 1023.5;\n  bool isLoopCurve = rawCurve >= 1023.5 && rawCurve < 2047.5;\n  float curveRow = mod(rawCurve, 1024.0);\n  if (dur <= 0.0 || age < 0.0 || (!isPersistent && age >= dur)) {\n    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n    return;\n  }\n  float t = isLoopCurve ? fract(age / max(0.001, dur)) : (isPersistent ? 0.0 : age / dur);\n  vLifeRatio = t;\n  vUv = aQuadPos + 0.5;\n  vCurveRow = curveRow;\n  vHdr = aAtlasP3.z;\n  vUvRect = aAtlasP4;\n  vFlipbook = aAtlasP5;\n  vTint = unpackRgb24(aAtlasP7.x);\n\n  float k = aAtlasP2.z;\n  vec2 worldPos;\n  vec2 curVel;\n  if (k < -0.5) {\n    worldPos = aAtlasP0.xy;\n    curVel = aAtlasP1.xy;\n  } else {\n    float dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;\n    float velDecay = (k > 0.001) ? exp(-k * age) : 1.0;\n    vec2 gVec = vec2(0.0, aAtlasP2.y);\n    worldPos = aAtlasP0.xy + aAtlasP1.xy * dispFactor + 0.5 * gVec * (age * age);\n    curVel = aAtlasP1.xy * velDecay + gVec * age;\n\n    float nStr = aAtlasP6.x;\n    if (nStr > 0.001) {\n      float nFreq = max(0.05, aAtlasP6.y);\n      float ph = aAtlasP6.w * 6.2831853;\n      float wt = age * nFreq * 3.14159265;\n      worldPos += vec2(sin(wt + ph) * cos(wt * 0.73 + ph), cos(wt * 1.17 + ph)) * (nStr * min(1.0, age * 1.5) * 12.0);\n    }\n  }\n\n  float curSize = aAtlasP2.x * sampleSizeCurve(curveRow, t);\n  float rot = aAtlasP3.x + aAtlasP3.y * age;\n  vec2 axisX = vec2(cos(rot), sin(rot));\n  vec2 axisY = vec2(-axisX.y, axisX.x);\n  float lenScale = curSize;\n  if (aAtlasP3.w > 1.5 && aAtlasP3.w < 2.5) {\n    float spd = length(curVel);\n    if (spd > 0.001) {\n      axisX = curVel / spd;\n      axisY = vec2(-axisX.y, axisX.x);\n    }\n    lenScale = curSize * (1.0 + aAtlasP6.z * min(spd * 0.015, 4.0));\n  }\n\n  float billH = (aAtlasP3.w < 0.5 && aAtlasP6.x <= 0.001) ? (curSize * max(0.05, aAtlasP6.z)) : curSize;\n  vec2 p = worldPos + axisX * (aQuadPos.x * lenScale) + axisY * (aQuadPos.y * billH);\n  vec2 screenPx = (p - uCamPos) * uCamZoom + uViewSize * 0.5;\n  vec2 ndc = vec2(\n    (screenPx.x / max(1.0, uViewSize.x)) * 2.0 - 1.0,\n    1.0 - (screenPx.y / max(1.0, uViewSize.y)) * 2.0\n  );\n  gl_Position = vec4(ndc, 0.0, 1.0);\n}\n";
export const ATLAS_PARTICLE_WEBGL2_2D_FS: "#version 300 es\nprecision highp float;\n\nuniform sampler2D uCurveLut;\nuniform sampler2D uAtlasTex;\nuniform float uHasAtlas;\n\nin vec2 vUv;\nin float vLifeRatio;\nin float vCurveRow;\nin float vHdr;\nin vec4 vUvRect;\nin vec4 vFlipbook;\nin vec3 vTint;\n\nout vec4 fragColor;\n\nvec4 sampleColorCurve(float row, float t) {\n  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;\n  float s = clamp(t, 0.0, 1.0) * 127.0;\n  float i0 = floor(s);\n  float i1 = min(127.0, i0 + 1.0);\n  float f = s - i0;\n  vec4 c0 = texture(uCurveLut, vec2((i0 + 0.5) / 256.0, rowV));\n  vec4 c1 = texture(uCurveLut, vec2((i1 + 0.5) / 256.0, rowV));\n  return mix(c0, c1, f);\n}\n\nvec4 sampleAtlasFrame(float frameIdx, vec2 localUv) {\n  float cols = max(1.0, floor(vFlipbook.x + 0.5));\n  float rows = max(1.0, floor(vFlipbook.y + 0.5));\n  float col = mod(frameIdx, cols);\n  float row = floor(frameIdx / cols);\n  vec2 cellUv = vec2((col + localUv.x) / cols, (row + localUv.y) / rows);\n  vec2 mapped = vec2(mix(vUvRect.x, vUvRect.z, cellUv.x), mix(vUvRect.y, vUvRect.w, cellUv.y));\n  return texture(uAtlasTex, mapped);\n}\n\nvoid main() {\n  vec4 curveCol = sampleColorCurve(vCurveRow, vLifeRatio);\n  if (curveCol.a < 0.001) discard;\n\n  vec4 texCol = vec4(1.0);\n  if (uHasAtlas > 0.5) {\n    vec2 topDownUv = vec2(vUv.x, 1.0 - vUv.y);\n    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {\n      float total = max(1.0, floor(vFlipbook.x + 0.5) * floor(vFlipbook.y + 0.5));\n      float cycles = max(0.01, vFlipbook.z);\n      float framePos = clamp(fract(vLifeRatio * cycles), 0.0, 0.9999) * total;\n      float f0 = floor(framePos);\n      texCol = sampleAtlasFrame(f0, topDownUv);\n      if (vFlipbook.w > 0.5) {\n        float f1 = min(total - 1.0, f0 + 1.0);\n        texCol = mix(texCol, sampleAtlasFrame(f1, topDownUv), fract(framePos));\n      }\n    } else {\n      vec2 mapped = vec2(mix(vUvRect.x, vUvRect.z, topDownUv.x), mix(vUvRect.y, vUvRect.w, topDownUv.y));\n      texCol = texture(uAtlasTex, mapped);\n    }\n  } else {\n    float r = length(vUv * 2.0 - 1.0);\n    if (r > 1.0) discard;\n    texCol.a = exp(-3.6 * r * r);\n  }\n\n  float alpha = texCol.a * curveCol.a;\n  if (alpha < 0.0005) discard;\n  vec3 rgb = texCol.rgb * curveCol.rgb * vTint * max(0.0, vHdr);\n  float peak = max(rgb.r, max(rgb.g, rgb.b));\n  if (peak > 1.0 && alpha > 0.0 && alpha < 1.0) {\n    float boost = min(peak, 1.0 / alpha);\n    rgb /= boost;\n    alpha *= boost;\n  }\n  fragColor = vec4(rgb, alpha);\n}\n";
