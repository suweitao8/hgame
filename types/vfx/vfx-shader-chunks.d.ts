/**
 * Compiles either `[v0, v1, ...]` uniform samples or `[[t0, v0], [t1, v1], ...]` keyframes
 * into a fixed 16-point `Float32Array` Curve LUT for O(1) runtime interpolation.
 * @param {number[] | Array<[number, number]> | number | null | undefined} curveRaw
 * @param {number} [scalar=1.0]
 * @param {number} [defaultVal=1.0]
 * @returns {Float32Array}
 */
export function compileCurveLut16(curveRaw: number[] | Array<[number, number]> | number | null | undefined, scalar?: number | undefined, defaultVal?: number | undefined): Float32Array;
/**
 * O(1) linear interpolation on a precompiled 16-point Curve LUT.
 * @param {Float32Array} lut
 * @param {number} t
 * @returns {number}
 */
export function sampleCurveLut16(lut: Float32Array, t: number): number;
/**
 * Compiles a Unity Shuriken MinMaxCurve descriptor (`Constant`, `TwoConstants`, `Curve`, `TwoCurves`)
 * into zero-GC 16-point `Float32Array` LUTs.
 * @param {number | number[] | object | null | undefined} cfg
 * @param {number} [defaultVal=0]
 */
export function compileMinMaxCurve(cfg: number | number[] | object | null | undefined, defaultVal?: number | undefined): {
    kind: string;
    lut: Float32Array;
    lutMin?: undefined;
    lutMax?: undefined;
    min?: undefined;
    max?: undefined;
    v?: undefined;
} | {
    kind: string;
    lutMin: Float32Array;
    lutMax: Float32Array;
    lut?: undefined;
    min?: undefined;
    max?: undefined;
    v?: undefined;
} | {
    kind: string;
    min: any;
    max: any;
    lut?: undefined;
    lutMin?: undefined;
    lutMax?: undefined;
    v?: undefined;
} | {
    kind: string;
    v: any;
    lut?: undefined;
    lutMin?: undefined;
    lutMax?: undefined;
    min?: undefined;
    max?: undefined;
};
/**
 * Evaluates a compiled MinMaxCurve in O(1) using birth-locked `randSeed` [0..1].
 */
export function evaluateMinMaxCurve(compiled: any, t: any, randSeed?: number): any;
/**
 * Converts a single sRGB channel [0..1+] to Linear space.
 */
export function srgbToLinear(c: any): number;
/**
 * Compiles a Unity MinMaxGradient into Linear-space 16-point RGBA LUTs.
 * Supports constant color, two colors, gradient, and two gradients.
 */
export function compileMinMaxGradient(cfg: any, isLinear?: boolean): {
    kind: string;
    rgba: number[];
    lut?: undefined;
    min?: undefined;
    max?: undefined;
    lutMin?: undefined;
    lutMax?: undefined;
} | {
    kind: string;
    lut: Float32Array;
    rgba?: undefined;
    min?: undefined;
    max?: undefined;
    lutMin?: undefined;
    lutMax?: undefined;
} | {
    kind: string;
    min: number[];
    max: number[];
    rgba?: undefined;
    lut?: undefined;
    lutMin?: undefined;
    lutMax?: undefined;
} | {
    kind: string;
    lutMin: Float32Array;
    lutMax: Float32Array;
    rgba?: undefined;
    lut?: undefined;
    min?: undefined;
    max?: undefined;
};
/**
 * Evaluates a compiled MinMaxGradient into `out` Linear RGBA array.
 */
export function evaluateMinMaxGradient(compiled: any, t: any, randSeed?: number, out?: number[]): any;
/**
 * Resolve shaderKind float ID from normalized material spec.
 */
export function resolveUberShaderKindId(shaderKind: any): 0 | 1 | 2 | 3;
/**
 * Pack a Piloto ShaderGraph material specification (UberFXSG / Piloto Warp / PBR FX)
 * into a 32-texel RGBA32F row of `uMaterialLut`.
 */
export function packUberMaterialRow(data: any, rowIndex: any, mat?: {}, texRects?: null): void;
/**
 * Create a RGBA32F DataTexture holding Piloto material rows.
 */
export function createUberMaterialLut(THREE: any, maxRows?: number): {
    texture: any;
    data: Float32Array;
    width: number;
    height: number;
    allocateRow: (cacheKey: any, matSpec: any, texRects: any) => any;
    packRow: (rowIdx: any, matSpec: any, texRects: any) => void;
    clear: () => void;
    dispose: () => void;
};
/**
 * Compile Shuriken CustomDataModule channel definition (Vector4 / 4-curve / constant / random / color)
 * into fast 16-sample LUT arrays for CPU per-frame evaluation.
 */
export function compileCustomDataCurves(customDataCfg: any): {
    custom1: {
        kind: string;
        grad: {
            kind: string;
            rgba: number[];
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            lut: Float32Array;
            rgba?: undefined;
            min?: undefined;
            max?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            min: number[];
            max: number[];
            rgba?: undefined;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            rgba?: undefined;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
        };
        comps?: undefined;
    } | {
        kind: string;
        comps: ({
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        })[];
        grad?: undefined;
    } | null;
    custom2: {
        kind: string;
        grad: {
            kind: string;
            rgba: number[];
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            lut: Float32Array;
            rgba?: undefined;
            min?: undefined;
            max?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            min: number[];
            max: number[];
            rgba?: undefined;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            rgba?: undefined;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
        };
        comps?: undefined;
    } | {
        kind: string;
        comps: ({
            kind: string;
            lut: Float32Array;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            lutMin: Float32Array;
            lutMax: Float32Array;
            lut?: undefined;
            min?: undefined;
            max?: undefined;
            v?: undefined;
        } | {
            kind: string;
            min: any;
            max: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            v?: undefined;
        } | {
            kind: string;
            v: any;
            lut?: undefined;
            lutMin?: undefined;
            lutMax?: undefined;
            min?: undefined;
            max?: undefined;
        })[];
        grad?: undefined;
    } | null;
} | null;
export function evaluateCustomDataChannel(compiledChannel: any, lifeRatio: any, randSeed: any, out4: any, offset?: number): void;
export const VFX_CURVE_LUT_SAMPLES: 16;
export const UBER_MAT_LUT_WIDTH: 32;
export const UBER_MAT_LUT_ROWS: 256;
export const UBER_SHADER_KIND: Readonly<{
    LEGACY: 0;
    UBER_FX: 1;
    PILOTO_WARP: 2;
    PBR_FX: 3;
}>;
export const UBER_FLAG_USE_SOFT_ALPHA: 1;
export const UBER_FLAG_USE_ALPHA_OVERRIDE: 2;
export const UBER_FLAG_USE_RAMP: 4;
export const UBER_FLAG_USE_UV_OFFSET: 8;
export const UBER_FLAG_FRESNEL: 16;
export const UBER_FLAG_INVERT_FRESNEL: 32;
export const UBER_FLAG_TINT_FRESNEL: 64;
export const UBER_FLAG_DISABLE_EROSION: 128;
export const UBER_FLAG_ALPHA_TEST: 256;
export const UBER_FLAG_POLAR_COORDS: 512;
export const UBER_FLAG_UNPACK_NORMALS: 1024;
export const UBER_FLAG_IS_PARTICLE: 2048;
export const UBER_FLAG_USE_BASE_AS_NORMAL: 4096;
export const UBER_FLAG_DOUBLE_SIDED: 8192;
export const UBER_FLAG_USE_MULTIPLY: 16384;
export const UBER_FLAG_USE_ADDITIVE: 32768;
export const UBER_FLAG_FLIPBOOK_MAIN: 65536;
export const UBER_FLAG_USE_DETAIL_VERTEX_OFFSET: 131072;
export const UBER_TEX_BIT_MAIN: 1;
export const UBER_TEX_BIT_DETAIL: 2;
export const UBER_TEX_BIT_ALPHA_OV: 4;
export const UBER_TEX_BIT_NORMAL: 8;
export const UBER_TEX_BIT_ORM: 16;
export const UBER_TEX_BIT_EMISSION: 32;
export const UBER_TEX_BIT_DISSOLVE: 64;
export const UBER_CLAMP_BIT_MAIN_U: 128;
export const UBER_CLAMP_BIT_MAIN_V: 256;
export const UBER_CLAMP_BIT_DETAIL_U: 512;
export const UBER_CLAMP_BIT_DETAIL_V: 1024;
export const UBER_CLAMP_BIT_ALPHA_OV_U: 2048;
export const UBER_CLAMP_BIT_ALPHA_OV_V: 4096;
export { VFX_FLIPBOOK_GLSL };
/**
 * Shared GLSL primitive helpers (Depth, SoftFade, ChannelPicker, Desaturate, SafeSmoothstep, Polar, Ramp, Flipbook).
 */
export const VFX_COMMON_GLSL: "\nfloat vfxLinearizeDepth(float zNdc, vec2 camNearFar) {\n  float z = zNdc * 2.0 - 1.0;\n  float n = camNearFar.x;\n  float f = camNearFar.y;\n  return (2.0 * n * f) / max(0.0001, f + n - z * (f - n));\n}\n\nfloat vfxComputeSoftFade(\n  sampler2D depthTex,\n  float hasDepth,\n  vec2 fragCoord,\n  vec2 invViewport,\n  vec2 camNearFar,\n  float fragDepthZ,\n  float softFade\n) {\n  if (hasDepth < 0.5 || softFade <= 0.0001) return 1.0;\n  float sceneDepthRaw = texture2D(depthTex, fragCoord * invViewport).r;\n  float sceneZ = vfxLinearizeDepth(sceneDepthRaw, camNearFar);\n  float partZ = vfxLinearizeDepth(fragDepthZ, camNearFar);\n  return clamp((sceneZ - partZ) / max(0.0001, softFade), 0.0, 1.0);\n}\n\nvec4 vfxChannelPicker(vec4 rgba, vec4 mask) {\n  return rgba * mask;\n}\n\nfloat vfxChannelPickerAdd(vec4 rgba, vec4 mask) {\n  return clamp(dot(rgba, mask), 0.0, 1.0);\n}\n\nfloat vfxChannelPickerClamped(vec4 rgba, vec4 mask) {\n  return clamp(dot(clamp(rgba * mask, 0.0, 1.0), vec4(1.0)), 0.0, 1.0);\n}\n\nvec3 vfxDesaturate(vec3 rgb, float amt) {\n  const vec3 lumaW = vec3(0.2126729, 0.7151522, 0.0721750);\n  float luma = dot(rgb, lumaW);\n  return mix(rgb, vec3(luma), clamp(amt, 0.0, 1.0));\n}\n\nfloat vfxSafeSmoothstep(float e0, float e1, float x) {\n  float d = e1 - e0;\n  float sd = abs(d) < 1e-5 ? (d < 0.0 ? -1e-5 : 1e-5) : d;\n  float t = clamp((x - e0) / sd, 0.0, 1.0);\n  return t * t * (3.0 - 2.0 * t);\n}\n\nbool vfxHasFlag(float flags, float bitVal) {\n  return mod(floor(flags / bitVal + 0.001), 2.0) > 0.5;\n}\n\nvec2 vfxPolarCoords(vec2 uv, vec2 center) {\n  vec2 d = uv - center;\n  float r = length(d) * 2.0;\n  float ang = atan(d.y, d.x) * 0.15915494309 + 0.5;\n  return vec2(r, ang);\n}\n\nvec4 vfxSampleAtlasRectWrapped(sampler2D atlasTex, vec4 rect, vec2 uv, float flipV, bool clampU, bool clampV) {\n  vec2 tiled = vec2(\n    clampU ? clamp(uv.x, 0.001, 0.999) : fract(uv.x),\n    clampV ? clamp(uv.y, 0.001, 0.999) : fract(uv.y)\n  );\n  vec2 mapped = vec2(\n    mix(rect.x, rect.z, tiled.x),\n    mix(rect.y, rect.w, tiled.y)\n  );\n  if (flipV > 0.5) mapped.y = 1.0 - mapped.y;\n  return texture2D(atlasTex, mapped);\n}\n\nvec4 vfxSampleAtlasRect(sampler2D atlasTex, vec4 rect, vec2 uv, float flipV) {\n  return vfxSampleAtlasRectWrapped(atlasTex, rect, uv, flipV, false, false);\n}\n\n\nvec2 vfxFlipbookGrid(vec2 tiles) {\n  return max(vec2(1.0), floor(tiles + 0.5));\n}\n\nfloat vfxFlipbookFramePosition(float lifeRatio, vec2 grid, float cycles) {\n  float total = grid.x * grid.y;\n  cycles = max(0.01, cycles);\n  float phase = lifeRatio * cycles;\n  if (phase >= 1.0 && cycles <= 1.001) return total - 0.001;\n  return min(fract(phase), 0.9999) * total;\n}\n\nvec2 vfxFlipbookFrameUv(float frameIndex, vec2 localUv, vec2 grid) {\n  vec2 cell = vec2(mod(frameIndex, grid.x), floor(frameIndex / grid.x));\n  return (cell + localUv) / grid;\n}\n\n\n// Splits uv0 into flipbook cell coordinates (supports top-down grid + rowMode random/custom).\n// Returns (uvA, uvB) packed in vec4; meta.z = frame index, meta.w = next-frame blend.\nvec4 vfxComputeFlipbookUvPair(vec2 uv0, vec4 flipbookGridInfo, float frameIndex) {\n  vec2 grid = max(vec2(1.0), floor(flipbookGridInfo.xy + 0.5));\n  if (grid.x <= 1.0 && grid.y <= 1.0) {\n    return vec4(uv0, uv0);\n  }\n  float total = grid.x * grid.y;\n  float f0 = clamp(floor(frameIndex), 0.0, total - 1.0);\n  float f1 = min(f0 + 1.0, total - 1.0);\n  float col0 = mod(f0, grid.x);\n  float row0 = floor(f0 / grid.x);\n  float col1 = mod(f1, grid.x);\n  float row1 = floor(f1 / grid.x);\n  // Flip V inside cell so Unity top-left flipbook grid maps cleanly to OpenGL UV (bottom-up).\n  vec2 cellUvA = vec2((col0 + uv0.x) / grid.x, 1.0 - (row0 + 1.0 - uv0.y) / grid.y);\n  vec2 cellUvB = vec2((col1 + uv0.x) / grid.x, 1.0 - (row1 + 1.0 - uv0.y) / grid.y);\n  return vec4(cellUvA, cellUvB);\n}\n\nvec3 vfxEvalUberRamp(\n  vec3 satMain,\n  vec3 lastColor,\n  vec3 midColor,\n  vec3 whiteColor,\n  float midHigh,\n  float midLow\n) {\n  float denom = max(1e-5, abs(1.0 - midHigh)) * (1.0 - midHigh < 0.0 ? -1.0 : 1.0);\n  vec3 remappedHigh = clamp((satMain - vec3(midHigh)) / denom, 0.0, 1.0);\n  vec3 remappedLow = clamp((satMain * (remappedHigh - vec3(midLow))) / denom, 0.0, 1.0);\n  vec3 lo = mix(lastColor, midColor, remappedLow);\n  vec3 hi = mix(midColor, whiteColor, remappedHigh);\n  return mix(lo, hi, clamp(satMain, 0.0, 1.0));\n}\n";
/**
 * Unified VFX Vertex Data Bus attributes & varyings shared by all Shader Profiles
 * across Billboard / Stretched / Horizontal / Vertical / Mesh / Trail renderers.
 */
export const VFX_VERTEX_BUS_ATTRS_GLSL: "\nattribute vec3 position;\nattribute vec3 normal;\nattribute vec2 uv;\nattribute vec2 uv1;\n\nattribute vec4 aColor;   // Linear RGBA (StartColor * ColorOverLifetime)\nattribute vec4 aCustom1; // Shuriken Custom1.xyzw (or AgePercent in .x)\nattribute vec4 aCustom2; // Shuriken Custom2.xyzw\nattribute vec4 aMeta;    // x=age01, y=stableRandom, z=flipbookFrame, w=flipbookNextBlend\n\nattribute vec4 aInstPos;      // xyz = world/local origin, w = active (>0.5)\nattribute vec4 aInstRot;      // xyz = euler/rot (rad), w = stretchLengthScale\nattribute vec4 aInstScale;    // xyz = 3D scale, w = stretchVelocityScale\nattribute vec4 aInstVel;      // xyz = current velocity, w = pivotOffsetY\n\nvarying vec2 vUv0;\nvarying vec2 vUv0Blend;\nvarying vec2 vUv2;\nvarying vec4 vColor;\nvarying vec4 vCustom1;\nvarying vec4 vCustom2;\nvarying vec4 vMeta;\nvarying vec3 vNormalW;\nvarying vec3 vViewDirW;\nvarying vec4 vScreenPos;\nvarying float vEyeZ;\n";
/**
 * Unified Vertex Shell executing:
 *  1) Flipbook UV0 grid split (before any texture sampling so Main/Detail/AlphaOverride share it)
 *  2) Pluggable vec3 evalVertexOffset(VfxVertIn vin) hook (e.g. DetailNoise * Custom2.x)
 *  3) RenderMode vertex transform (0=Billboard, 1=Horizontal, 2=Stretched, 3=Mesh, 4=Vertical)
 *  4) Standard unified varyings output
 */
export const VFX_VERTEX_SHELL_GLSL: "\nstruct VfxVertIn {\n  vec3 pos;\n  vec3 normal;\n  vec2 uv0;\n  vec2 uv2;\n  vec4 color;\n  vec4 custom1;\n  vec4 custom2;\n  vec4 meta;\n};\n\nuniform mat4 modelMatrix;\nuniform mat4 viewMatrix;\nuniform mat4 modelViewMatrix;\nuniform mat4 projectionMatrix;\nuniform vec3 cameraPosition;\nuniform float uTime;\nuniform float uRenderMode; // 0=billboard, 1=horizontal, 2=stretched, 3=mesh, 4=vertical\nuniform vec4 uFlipbookGrid; // x=cols, y=rows, z=blendEnabled, w=unused\nuniform vec2 uPivot2D;\nuniform float uHasUv2;\n\nmat3 vfxEulerXYZ(vec3 r) {\n  float cx = cos(r.x), sx = sin(r.x);\n  float cy = cos(r.y), sy = sin(r.y);\n  float cz = cos(r.z), sz = sin(r.z);\n  return mat3(\n    cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz,\n    -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz,\n    sy * cx, -sx, cy * cx\n  );\n}\n\nmat3 vfxQuatFromAlign(vec3 fwd, vec3 dir) {\n  float d = dot(fwd, dir);\n  if (d > 0.9999) return mat3(1.0);\n  if (d < -0.9999) {\n    vec3 ortho = abs(fwd.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);\n    vec3 ax = normalize(cross(fwd, ortho));\n    return mat3(\n      2.0 * ax.x * ax.x - 1.0, 2.0 * ax.x * ax.y, 2.0 * ax.x * ax.z,\n      2.0 * ax.x * ax.y, 2.0 * ax.y * ax.y - 1.0, 2.0 * ax.y * ax.z,\n      2.0 * ax.x * ax.z, 2.0 * ax.y * ax.z, 2.0 * ax.z * ax.z - 1.0\n    );\n  }\n  vec3 c = cross(fwd, dir);\n  float s = sqrt((1.0 + d) * 2.0);\n  float invS = 1.0 / s;\n  vec4 q = vec4(c * invS, s * 0.5);\n  float xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;\n  float xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;\n  float wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;\n  return mat3(\n    1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy),\n    2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx),\n    2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy)\n  );\n}\n\nvec3 evalVertexOffset(VfxVertIn vin);\n\nvoid vfxExecuteVertexShell(vec3 rawPos, vec3 rawNormal, vec2 rawUv0, vec2 rawUv2) {\n  if (aInstPos.w < 0.5) {\n    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n    vUv0 = vec2(0.0);\n    vUv0Blend = vec2(0.0);\n    vUv2 = vec2(0.0);\n    vColor = vec4(0.0);\n    vCustom1 = vec4(0.0);\n    vCustom2 = vec4(0.0);\n    vMeta = vec4(0.0);\n    vNormalW = vec3(0.0, 1.0, 0.0);\n    vViewDirW = vec3(0.0, 0.0, 1.0);\n    vScreenPos = vec4(0.0);\n    vEyeZ = 0.0;\n    return;\n  }\n\n  vec4 fbUv = vfxComputeFlipbookUvPair(rawUv0, uFlipbookGrid, aMeta.z);\n  vUv0 = fbUv.xy;\n  vUv0Blend = fbUv.zw;\n  vUv2 = uHasUv2 > 0.5 ? rawUv2 : rawUv0;\n  vColor = aColor;\n  vCustom1 = aCustom1;\n  vCustom2 = aCustom2;\n  vMeta = aMeta;\n\n  VfxVertIn vin;\n  vin.pos = rawPos;\n  vin.normal = length(rawNormal) > 0.0001 ? normalize(rawNormal) : vec3(0.0, 0.0, 1.0);\n  vin.uv0 = vUv0;\n  vin.uv2 = vUv2;\n  vin.color = aColor;\n  vin.custom1 = aCustom1;\n  vin.custom2 = aCustom2;\n  vin.meta = aMeta;\n\n  vec3 localPos = evalVertexOffset(vin);\n  vec3 worldPos;\n  vec3 worldNormal;\n\n  if (uRenderMode > 2.5 && uRenderMode < 3.5) {\n    // Mesh mode (3D Euler + optional velocity alignment + 3D scale)\n    vec3 scaled = localPos * aInstScale.xyz;\n    mat3 rotM = vfxEulerXYZ(aInstRot.xyz);\n    if (aInstScale.w > 0.5 && dot(aInstVel.xyz, aInstVel.xyz) > 1e-6) {\n      rotM = vfxQuatFromAlign(vec3(0.0, 1.0, 0.0), normalize(aInstVel.xyz)) * rotM;\n    }\n    vec3 relW = rotM * scaled;\n    worldPos = aInstPos.xyz + relW;\n    worldNormal = normalize(rotM * (vin.normal / max(vec3(0.001), abs(aInstScale.xyz))));\n  } else {\n    vec2 quadLocal = localPos.xy - uPivot2D;\n    vec3 scaled2D = vec3(quadLocal * aInstScale.xy, localPos.z * aInstScale.z);\n    if (uRenderMode > 0.5 && uRenderMode < 1.5) {\n      // Horizontal billboard (XZ plane)\n      float c = cos(aInstRot.z), s = sin(aInstRot.z);\n      vec3 flatP = vec3(scaled2D.x * c - scaled2D.y * s, scaled2D.z, scaled2D.x * s + scaled2D.y * c);\n      worldPos = aInstPos.xyz + flatP;\n      worldNormal = vec3(0.0, 1.0, 0.0);\n    } else if (uRenderMode > 3.5) {\n      // Vertical billboard (Y-up facing camera horizontally)\n      vec3 camFwd = normalize(vec3(viewMatrix[0][2], 0.0, viewMatrix[2][2]));\n      vec3 camRight = normalize(cross(vec3(0.0, 1.0, 0.0), camFwd));\n      float c = cos(aInstRot.z), s = sin(aInstRot.z);\n      vec2 rotP = vec2(scaled2D.x * c - scaled2D.y * s, scaled2D.x * s + scaled2D.y * c);\n      worldPos = aInstPos.xyz + camRight * rotP.x + vec3(0.0, 1.0, 0.0) * rotP.y;\n      worldNormal = camFwd;\n    } else if (uRenderMode > 1.5 && uRenderMode < 2.5) {\n      // Stretched billboard along world velocity\n      vec3 velW = aInstVel.xyz;\n      float spd = length(velW);\n      vec3 camDir = normalize(cameraPosition - aInstPos.xyz);\n      vec3 axisX = spd > 0.001 ? (velW / spd) : vec3(1.0, 0.0, 0.0);\n      vec3 axisY = cross(camDir, axisX);\n      float yLen = length(axisY);\n      axisY = yLen > 0.001 ? (axisY / yLen) : vec3(0.0, 1.0, 0.0);\n      vec3 axisZ = cross(axisX, axisY);\n      float major = aInstScale.x * max(0.05, aInstRot.w) + spd * aInstScale.w;\n      vec2 p2 = vec2(quadLocal.x * major, quadLocal.y * aInstScale.y);\n      worldPos = aInstPos.xyz + axisX * p2.x + axisY * p2.y + axisZ * scaled2D.z;\n      worldNormal = camDir;\n    } else {\n      // Camera-facing Billboard\n      vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);\n      vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);\n      vec3 camFwd = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);\n      float c = cos(aInstRot.z), s = sin(aInstRot.z);\n      vec2 rotP = vec2(scaled2D.x * c - scaled2D.y * s, scaled2D.x * s + scaled2D.y * c);\n      worldPos = aInstPos.xyz + camRight * rotP.x + camUp * rotP.y + camFwd * scaled2D.z;\n      worldNormal = camFwd;\n    }\n  }\n\n  vec4 wPos4 = modelMatrix * vec4(worldPos, 1.0);\n  vec4 mvPos = viewMatrix * wPos4;\n  vNormalW = normalize(mat3(modelMatrix) * worldNormal);\n  vViewDirW = normalize(cameraPosition - wPos4.xyz);\n  vEyeZ = -mvPos.z;\n  vec4 clipPos = projectionMatrix * mvPos;\n  vScreenPos = clipPos;\n  gl_Position = clipPos;\n}\n";
export const VFX_UBER_LUT_GLSL: string;
export const VFX_UBER_FRAGMENT_GLSL: string;
import { VFX_FLIPBOOK_GLSL } from './vfx-flipbook.js';
