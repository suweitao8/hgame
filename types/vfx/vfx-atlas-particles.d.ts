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
 * Compiles color/size/velocity curves into a zero-GC 256x1024 RGBA8 lookup table + DataTexture.
 * Left 128 texels encode RGBA colorCurve; right 128 texels encode 16-bit sizeX (.rg),
 * 8-bit sizeY (.b), and 8-bit integrated velocity displacement (.a).
 */
export function createCurveLutTable(THREE?: object | null): {
    bytes: Uint8Array;
    width: number;
    height: number;
    texture: any;
    readonly rowCount: number;
    readonly version: number;
    compile: (colorCurveRaw: any, sizeCurveRaw: any, sizeYCurveRaw?: null, velocityCurveRaw?: null) => any;
    flush: () => void;
    sampleColor: (row: any, t: any, out?: Float32Array) => Float32Array;
    sampleSize: (row: any, t: any) => number;
    sampleSizeY: (row: any, t: any) => number;
    sampleVelDisp: (row: any, t: any) => number;
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
 * @param {number} [noiseYScale=1]
 * @param {object | null} [ext=null]
 * @param {number} [orbitalX=0]
 * @param {number} [orbitalZ=0]
 * @param {number} [centerOffY=0]
 */
export function evaluateAtlasParticlePosition(x0: number, y0: number, z0: number, vx: number, vy: number, vz: number, gravity: number, drag: number, noiseStrength: number, noiseFreq: number, phase: number, age: number, is2D: boolean, outPos: Float32Array | number[], orbitalY?: number | undefined, centerOffX?: number | undefined, centerOffZ?: number | undefined, noiseYScale?: number | undefined, ext?: object | null, orbitalX?: number | undefined, orbitalZ?: number | undefined, centerOffY?: number | undefined): number[] | Float32Array;
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
    readonly texture: any;
    capacity: number;
    lut: {
        bytes: Uint8Array;
        width: number;
        height: number;
        texture: any;
        readonly rowCount: number;
        readonly version: number;
        compile: (colorCurveRaw: any, sizeCurveRaw: any, sizeYCurveRaw?: null, velocityCurveRaw?: null) => any;
        flush: () => void;
        sampleColor: (row: any, t: any, out?: Float32Array) => Float32Array;
        sampleSize: (row: any, t: any) => number;
        sampleSizeY: (row: any, t: any) => number;
        sampleVelDisp: (row: any, t: any) => number;
        dispose: () => void;
    };
    uberLut: {
        texture: any;
        data: Float32Array;
        width: number;
        height: number;
        allocateRow: (cacheKey: any, matSpec: any, texRects: any) => any;
        packRow: (rowIdx: any, matSpec: any, texRects: any) => void;
        clear: () => void;
        dispose: () => void;
    } | null;
    readonly regions: Record<string, readonly number[]>;
    compileCurves: (colorCurveRaw: any, sizeCurveRaw: any, sizeYCurveRaw?: null, velocityCurveRaw?: null) => any;
    registerUberMaterial: (matSpec: any) => any;
    setAtlas: (textureOrCanvas: object | null, newRegions?: Record<string, readonly number[]> | undefined, options?: {
        flipV?: boolean | null;
    } | undefined) => void;
    setDepthTexture: (depthTexture: any, { near, far, width, height, softFade }?: {
        near?: number | undefined;
        far?: number | undefined;
        width?: number | undefined;
        height?: number | undefined;
        softFade?: number | undefined;
    }) => void;
    setSceneTexture: (sceneTexture: object | null, { width, height, strength }?: {
        width?: number;
        height?: number;
        strength?: number;
    } | undefined) => void;
    setQualityTier: (tier?: string) => void;
    hasActiveDistortion: () => boolean;
    setWind: (wx?: number, wy?: number, wz?: number) => void;
    setEffectTransform: (slotIdx: number, x?: number | undefined, y?: number | undefined, z?: number | undefined, qx?: number | undefined, qy?: number | undefined, qz?: number | undefined, qw?: number | undefined) => void;
    setEffectOffset: (slotIdx: number, x?: number, y?: number, z?: number) => void;
    emit: (opts?: object) => number;
    updateSlot: (blendOrState: any, idx: any, x: any, y: any, z: any, vx: any, vy: any, vz: any) => void;
    killSlot: (blendOrState: any, idx: any) => void;
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
        multiplyCursor: number;
        premultiplyCursor: number;
        distortionCursor: number;
        normalTotal: number;
        additiveTotal: number;
        multiplyTotal: number;
        premultiplyTotal: number;
        distortionTotal: number;
        renderStateChannels: number;
        renderStateTotal: number;
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
export const ATLAS_PARTICLE_VERTEX_GLSL: string;
export const ATLAS_PARTICLE_FRAGMENT_GLSL: string;
export const ATLAS_PARTICLE_DISTORTION_FS: string;
export const ATLAS_PARTICLE_WEBGL2_2D_VS: "#version 300 es\nprecision highp float;\n\nlayout(location = 0) in vec2 aQuadPos;\nlayout(location = 1) in vec4 aAtlasP0;\nlayout(location = 2) in vec4 aAtlasP1;\nlayout(location = 3) in vec4 aAtlasP2;\nlayout(location = 4) in vec4 aAtlasP3;\nlayout(location = 5) in vec4 aAtlasP4;\nlayout(location = 6) in vec4 aAtlasP5;\nlayout(location = 7) in vec4 aAtlasP6;\nlayout(location = 8) in vec4 aAtlasP7;\n\nuniform sampler2D uCurveLut;\nuniform float uTime;\nuniform vec2 uCamPos;\nuniform float uCamZoom;\nuniform vec2 uViewSize;\nuniform vec2 uWind2D;\nuniform vec2 uEffectDeltas2D[32];\n\nout vec2 vUv;\nout float vLifeRatio;\nout float vCurveRow;\nout float vHdr;\nout vec4 vUvRect;\nout vec4 vFlipbook;\nout vec3 vTint;\nflat out float vAlphaCutoff;\n\nvec3 unpackRgb24(float v) {\n  float r = floor(v / 65536.0);\n  float rem = v - r * 65536.0;\n  float g = floor(rem / 256.0);\n  float b = rem - g * 256.0;\n  return vec3(r, g, b) / 255.0;\n}\n\nvec2 unpack2x12Pos(float packedVal, float maxA, float maxB) {\n  float v = floor(clamp(packedVal, 0.0, 16777215.0));\n  float qa = floor(v / 4096.0);\n  float qb = v - qa * 4096.0;\n  return vec2((qa / 4095.0) * maxA, (qb / 4095.0) * maxB);\n}\n\nvec2 unpack2x12Sym(float packedVal, float absA, float absB) {\n  float v = floor(clamp(packedVal, 0.0, 16777215.0));\n  float qa = floor(v / 4096.0);\n  float qb = v - qa * 4096.0;\n  return vec2((qa / 4094.0) * (2.0 * absA) - absA, (qb / 4094.0) * (2.0 * absB) - absB);\n}\n\nvec2 unpack2x12Mixed(float packedVal, float maxA, float absB) {\n  float v = floor(clamp(packedVal, 0.0, 16777215.0));\n  float qa = floor(v / 4096.0);\n  float qb = v - qa * 4096.0;\n  return vec2((qa / 4095.0) * maxA, (qb / 4094.0) * (2.0 * absB) - absB);\n}\n\nvec2 unpackUvPair(float packedVal) {\n  float v = floor(clamp(packedVal, 0.0, 16777215.0));\n  float qu = floor(v / 4096.0);\n  float qv = v - qu * 4096.0;\n  return clamp(vec2(qu, qv) / 3840.0, 0.0, 1.0);\n}\n\nfloat sampleSizeCurve(float row, float t) {\n  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;\n  float s = clamp(t, 0.0, 1.0) * 127.0;\n  float i0 = floor(s);\n  float i1 = min(127.0, i0 + 1.0);\n  float f = s - i0;\n  vec4 t0 = texture(uCurveLut, vec2((128.0 + i0 + 0.5) / 512.0, rowV));\n  vec4 t1 = texture(uCurveLut, vec2((128.0 + i1 + 0.5) / 512.0, rowV));\n  float s0 = (t0.r * 255.0 * 256.0 + t0.g * 255.0) / 65535.0 * 8.0;\n  float s1 = (t1.r * 255.0 * 256.0 + t1.g * 255.0) / 65535.0 * 8.0;\n  return mix(s0, s1, f);\n}\n\nfloat sampleSizeYCurve(float row, float t) {\n  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;\n  float s = clamp(t, 0.0, 1.0) * 127.0;\n  float i0 = floor(s);\n  float i1 = min(127.0, i0 + 1.0);\n  float f = s - i0;\n  vec4 t0 = texture(uCurveLut, vec2((128.0 + i0 + 0.5) / 512.0, rowV));\n  vec4 t1 = texture(uCurveLut, vec2((128.0 + i1 + 0.5) / 512.0, rowV));\n  float s0 = (t0.b * 255.0 * 256.0 + t0.a * 255.0) / 65535.0 * 8.0;\n  float s1 = (t1.b * 255.0 * 256.0 + t1.a * 255.0) / 65535.0 * 8.0;\n  return mix(s0, s1, f);\n}\n\nfloat sampleVelDispCurve(float row, float t) {\n  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;\n  float s = clamp(t, 0.0, 1.0) * 127.0;\n  float i0 = floor(s);\n  float i1 = min(127.0, i0 + 1.0);\n  float f = s - i0;\n  vec4 t0 = texture(uCurveLut, vec2((256.0 + i0 + 0.5) / 512.0, rowV));\n  vec4 t1 = texture(uCurveLut, vec2((256.0 + i1 + 0.5) / 512.0, rowV));\n  float v0 = (t0.r * 255.0 * 256.0 + t0.g * 255.0) / 65535.0 * 8.0 - 4.0;\n  float v1 = (t1.r * 255.0 * 256.0 + t1.g * 255.0) / 65535.0 * 8.0 - 4.0;\n  return mix(v0, v1, f);\n}\n\nvoid main() {\n  float age = uTime - aAtlasP0.w;\n  float dur = aAtlasP1.w;\n  float rowWord = floor(max(0.0, aAtlasP2.w));\n  float materialFlags = floor(rowWord / 1048576.0); rowWord -= materialFlags * 1048576.0;\n  float cullFlag = floor(rowWord / 262144.0); rowWord -= cullFlag * 262144.0;\n  float hasSizeSep = step(131071.5, rowWord); rowWord -= hasSizeSep * 131072.0;\n  float noiseDamp = step(65535.5, rowWord); rowWord -= noiseDamp * 65536.0;\n  float hasVelCurve = step(32767.5, rowWord); rowWord -= hasVelCurve * 32768.0;\n  float renderMode = floor(rowWord / 4096.0); rowWord -= renderMode * 4096.0;\n  float rawCurve = rowWord;\n  bool isPersistent = rawCurve >= 1023.5;\n  bool isLoopCurve = rawCurve >= 1023.5 && rawCurve < 2047.5;\n  float curveRow = mod(rawCurve, 1024.0);\n  if (dur <= 0.0 || age < 0.0 || (!isPersistent && age >= dur)) {\n    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n    return;\n  }\n\n  vec2 rotZPair = unpack2x12Mixed(aAtlasP3.x, 6.2831853, 64.0);\n  vec2 hdrEmPair = unpack2x12Pos(aAtlasP3.y, 35.0, 35.0);\n  vec2 pivotPair = unpack2x12Sym(aAtlasP3.z, 2.0, 2.0);\n  vec2 stretchScales = unpack2x12Mixed(aAtlasP3.w, 15.0, 15.0);\n\n  vec2 uv0 = unpackUvPair(aAtlasP4.x);\n  vec2 uv1 = unpackUvPair(aAtlasP4.y);\n  float fbWord = floor(max(0.0, aAtlasP4.z));\n  float cyclesQ = floor(fbWord / 8192.0); fbWord -= cyclesQ * 8192.0;\n  float fbBlend = step(4095.5, fbWord); fbWord -= fbBlend * 4096.0;\n  float fbRows = floor(fbWord / 64.0) + 1.0;\n  float fbCols = mod(fbWord, 64.0) + 1.0;\n\n  vec2 noisePair = unpack2x12Pos(aAtlasP5.x, 35.0, 15.0);\n  vec2 scaleYPair = unpack2x12Pos(aAtlasP5.y, 64.0, 64.0);\n  float psWord = floor(max(0.0, aAtlasP5.w));\n  float scrollQ = floor(psWord / 262144.0); psWord -= scrollQ * 262144.0;\n  float windQ = floor(psWord / 8192.0); psWord -= windQ * 8192.0;\n  int slotIdx = int(floor(psWord / 256.0));\n  float phaseVal = (psWord - float(slotIdx) * 256.0) / 255.0;\n  float noiseScroll = scrollQ * 0.25;\n  float windMul = windQ * 0.25;\n  vec2 accelXZ = unpack2x12Sym(aAtlasP6.y, 64.0, 64.0);\n\n  float t = isLoopCurve ? fract(age / max(0.001, dur)) : (isPersistent ? 0.0 : age / dur);\n  vLifeRatio = t;\n  float flipUFlag = mod(floor(materialFlags / 4.0), 2.0);\n  float flipVFlag = mod(floor(materialFlags / 8.0), 2.0);\n  vec2 baseUv2 = aQuadPos + 0.5;\n  if (flipUFlag > 0.5) baseUv2.x = 1.0 - baseUv2.x;\n  if (flipVFlag > 0.5) baseUv2.y = 1.0 - baseUv2.y;\n  vUv = baseUv2;\n  vCurveRow = curveRow;\n  vHdr = hdrEmPair.x;\n  vUvRect = vec4(uv0, uv1);\n  vFlipbook = vec4(fbCols, fbRows, cyclesQ / 32.0, fbBlend);\n  vTint = unpackRgb24(aAtlasP4.w);\n\n  vAlphaCutoff = unpackRgb24(aAtlasP7.x).x;\n\n  float k = aAtlasP2.z;\n  vec2 worldPos;\n  vec2 curVel;\n  if (k < -0.5) {\n    worldPos = aAtlasP0.xy;\n    curVel = aAtlasP1.xy;\n  } else {\n    float dispFactor;\n    float velDecay;\n    if (hasVelCurve > 0.5) {\n      dispFactor = sampleVelDispCurve(curveRow, t) * dur;\n      float dtStep = 0.015;\n      float t1 = min(1.0, t + dtStep);\n      float t0 = max(0.0, t - dtStep);\n      velDecay = (sampleVelDispCurve(curveRow, t1) - sampleVelDispCurve(curveRow, t0)) / max(0.001, t1 - t0);\n    } else {\n      dispFactor = (k > 0.001) ? ((1.0 - exp(-k * age)) / k) : age;\n      velDecay = (k > 0.001) ? exp(-k * age) : 1.0;\n    }\n    vec2 gVec = vec2(accelXZ.x, aAtlasP2.y) + uWind2D * windMul;\n    worldPos = aAtlasP0.xy + aAtlasP1.xy * dispFactor + 0.5 * gVec * (age * age);\n    curVel = aAtlasP1.xy * velDecay + gVec * age;\n\n    float nStr = noisePair.x;\n    if (nStr > 0.001) {\n      float nFreq = max(0.05, noisePair.y);\n      float ph = phaseVal * 6.2831853 + noiseScroll * age * 1.7;\n      float wt = age * nFreq * 3.14159265;\n      float dampScale = (noiseDamp > 0.5) ? clamp(length(curVel) * 0.03, 0.15, 2.0) : 1.0;\n      worldPos += vec2(sin(wt + ph) * cos(wt * 0.73 + ph), cos(wt * 1.17 + ph)) * (nStr * min(1.0, age * 1.5) * 12.0 * dampScale);\n    }\n  }\n  if (slotIdx > 0 && slotIdx < 32) {\n    worldPos += uEffectDeltas2D[slotIdx];\n  }\n\n  float curSize = aAtlasP2.x * sampleSizeCurve(curveRow, t);\n  float curSizeY = (hasSizeSep > 0.5) ? (aAtlasP2.x * sampleSizeYCurve(curveRow, t)) : curSize;\n  float aspectY = max(0.05, scaleYPair.y);\n  float rot = rotZPair.x + rotZPair.y * age;\n  vec2 axisX = vec2(cos(rot), sin(rot));\n  vec2 axisY = vec2(-axisX.y, axisX.x);\n  float lenScale = curSize;\n  if (renderMode > 1.5 && renderMode < 2.5) {\n    float spd = length(curVel);\n    if (spd > 0.001) {\n      axisX = curVel / spd;\n      axisY = vec2(-axisX.y, axisX.x);\n    }\n    float lsSignedW = (stretchScales.x <= 0.0001 && abs(stretchScales.y) < 0.05)\n      ? (stretchScales.y < 0.0 ? -0.05 : 0.05)\n      : stretchScales.y;\n    lenScale = (stretchScales.x > 0.0001 || abs(stretchScales.y) > 0.0001)\n      ? (curSize * lsSignedW + spd * stretchScales.x * 0.015)\n      : (curSize * (1.0 + scaleYPair.x * min(spd * 0.015, 4.0)));\n  }\n\n  float billH = (renderMode < 0.5) ? (curSizeY * aspectY) : curSizeY;\n  vec2 posLocal = aQuadPos + pivotPair;\n  vec2 p = worldPos + axisX * (posLocal.x * lenScale) + axisY * (posLocal.y * billH);\n  vec2 screenPx = (p - uCamPos) * uCamZoom + uViewSize * 0.5;\n  vec2 ndc = vec2(\n    (screenPx.x / max(1.0, uViewSize.x)) * 2.0 - 1.0,\n    1.0 - (screenPx.y / max(1.0, uViewSize.y)) * 2.0\n  );\n  gl_Position = vec4(ndc, 0.0, 1.0);\n}\n";
export const ATLAS_PARTICLE_WEBGL2_2D_FS: "#version 300 es\nprecision highp float;\n\nuniform sampler2D uCurveLut;\nuniform sampler2D uAtlasTex;\nuniform float uHasAtlas;\nuniform int uBlendMode; // Straight RGB (0), multiply (1), premultiplied source (2).\n\nin vec2 vUv;\nin float vLifeRatio;\nin float vCurveRow;\nin float vHdr;\nin vec4 vUvRect;\nin vec4 vFlipbook;\nin vec3 vTint;\nflat in float vAlphaCutoff;\n\nout vec4 fragColor;\n\nvec4 sampleColorCurve(float row, float t) {\n  float rowV = (clamp(row, 0.0, 1023.0) + 0.5) / 1024.0;\n  float s = clamp(t, 0.0, 1.0) * 127.0;\n  float i0 = floor(s);\n  float i1 = min(127.0, i0 + 1.0);\n  float f = s - i0;\n  vec4 c0 = texture(uCurveLut, vec2((i0 + 0.5) / 512.0, rowV));\n  vec4 c1 = texture(uCurveLut, vec2((i1 + 0.5) / 512.0, rowV));\n  return mix(c0, c1, f);\n}\n\n\nvec2 vfxFlipbookGrid(vec2 tiles) {\n  return max(vec2(1.0), floor(tiles + 0.5));\n}\n\nfloat vfxFlipbookFramePosition(float lifeRatio, vec2 grid, float cycles) {\n  float total = grid.x * grid.y;\n  cycles = max(0.01, cycles);\n  float phase = lifeRatio * cycles;\n  if (phase >= 1.0 && cycles <= 1.001) return total - 0.001;\n  return min(fract(phase), 0.9999) * total;\n}\n\nvec2 vfxFlipbookFrameUv(float frameIndex, vec2 localUv, vec2 grid) {\n  vec2 cell = vec2(mod(frameIndex, grid.x), floor(frameIndex / grid.x));\n  return (cell + localUv) / grid;\n}\n\n\nvec4 sampleAtlasFrame(float frameIdx, vec2 localUv, vec2 grid) {\n  vec2 cellUv = vfxFlipbookFrameUv(frameIdx, localUv, grid);\n  vec2 mapped = vec2(mix(vUvRect.x, vUvRect.z, cellUv.x), mix(vUvRect.y, vUvRect.w, cellUv.y));\n  return texture(uAtlasTex, mapped);\n}\n\nvoid main() {\n  vec4 curveCol = sampleColorCurve(vCurveRow, vLifeRatio);\n  if (curveCol.a < 0.001) discard;\n\n  vec4 texCol = vec4(1.0);\n  if (uHasAtlas > 0.5) {\n    vec2 topDownUv = vec2(vUv.x, 1.0 - vUv.y);\n    if (vFlipbook.x > 1.5 || vFlipbook.y > 1.5) {\n      vec2 grid = vfxFlipbookGrid(vFlipbook.xy);\n      float framePos = vfxFlipbookFramePosition(vLifeRatio, grid, vFlipbook.z);\n      float f0 = floor(framePos);\n      texCol = sampleAtlasFrame(f0, topDownUv, grid);\n      if (vFlipbook.w > 0.5) {\n        float f1 = min(grid.x * grid.y - 1.0, f0 + 1.0);\n        texCol = mix(texCol, sampleAtlasFrame(f1, topDownUv, grid), fract(framePos));\n      }\n    } else {\n      vec2 mapped = vec2(mix(vUvRect.x, vUvRect.z, topDownUv.x), mix(vUvRect.y, vUvRect.w, topDownUv.y));\n      texCol = texture(uAtlasTex, mapped);\n    }\n  } else {\n    float r = length(vUv * 2.0 - 1.0);\n    if (r > 1.0) discard;\n    texCol.a = exp(-3.6 * r * r);\n  }\n\n  float alpha = texCol.a * curveCol.a;\n  if (alpha < max(0.0005, vAlphaCutoff)) discard;\n  vec3 rgb = texCol.rgb * curveCol.rgb * vTint * max(0.0, vHdr);\n  if (uBlendMode == 1) {\n    fragColor = vec4(mix(vec3(1.0), rgb, clamp(alpha, 0.0, 1.0)), 1.0);\n    return;\n  }\n  if (uBlendMode == 2) {\n    fragColor = vec4(rgb, alpha);\n    return;\n  }\n  float peak = max(rgb.r, max(rgb.g, rgb.b));\n  if (peak > 1.0 && alpha > 0.0 && alpha < 1.0) {\n    float boost = min(peak, 1.0 / alpha);\n    rgb /= boost;\n    alpha *= boost;\n  }\n  fragColor = vec4(rgb, alpha);\n}\n";
export function unpack2x12Pos(packed: any, maxA: any, maxB: any, out?: number[]): number[];
export function unpack2x12Sym(packed: any, absA: any, absB: any, out?: number[]): number[];
export function unpack2x12Mixed(packed: any, maxA: any, absB: any, out?: number[]): number[];
export function unpackUvPair(packed: any, out?: number[]): number[];
