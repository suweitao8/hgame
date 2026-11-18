/**
 * Zero-string-allocation integer digit extractor into a pre-allocated Int32Array.
 * @param {number} intValue
 * @param {boolean} [isCrit=false]
 * @param {boolean} [isHeal=false]
 * @param {boolean} [isMiss=false]
 * @param {Int32Array} [outBuffer=scratchDigits]
 * @returns {number} Glyph count written into outBuffer
 */
export function extractGlyphIndices(intValue: number, isCrit?: boolean | undefined, isHeal?: boolean | undefined, isMiss?: boolean | undefined, outBuffer?: Int32Array | undefined): number;
/**
 * Bakes the 64-glyph (16x4) crisp outlined damage-number atlas canvas.
 * Indices 0..15 match `GLYPH_CHARS` for backward compatibility.
 * @returns {HTMLCanvasElement | null}
 */
export function bakeGlyphAtlasCanvas(): HTMLCanvasElement | null;
/**
 * Creates a clean-room DamageNumbersPro-grade zero-GC floating damage number pool
 * supporting 3D billboards, WebGL2 2D instancing, Canvas2D rendering, and headless mode.
 */
export function createFloatingTextPool({ mode, THREE, scene, gl, is2D, maxFloatingGlyphs, maxPopups, renderThroughWalls, prng, }?: {
    mode?: string | undefined;
    THREE?: any;
    scene?: any;
    gl?: WebGL2RenderingContext | null | undefined;
    is2D?: boolean | undefined;
    maxFloatingGlyphs?: number | undefined;
    maxPopups?: number | undefined;
    renderThroughWalls?: boolean | undefined;
    prng?: {
        nextFloat(): number;
        range(min: any, max: any): any;
        reset(newSeed?: number): void;
    } | undefined;
}): {
    popupNumber: (opts?: object) => number;
    update: (visualDt: number, rawDtOrCameraPos?: number | object | null, maybeCameraPos?: object | null) => void;
    renderWebGL2: (camera: any, viewWidth: any, viewHeight: any) => void;
    renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
    getActivePopups: () => {
        id: number;
        x: number;
        y: number;
        z: number;
        renderX: number;
        renderY: number;
        renderZ: number;
        value: number;
        text: string;
        topText: string;
        bottomText: string;
        alpha: number;
        scaleX: number;
        scaleY: number;
        rotRad: number;
        color: number;
        spamGroup: string;
        destroying: boolean;
        absorbing: boolean;
    }[];
    reset: () => void;
    dispose: () => void;
    getStats(): {
        capacity: number;
        popupCapacity: number;
        activePopups: number;
        activeGlyphs: number;
        totalEmitted: number;
        totalPopupsSpawned: number;
        totalCombined: number;
    };
};
export const GLYPH_CHARS: readonly string[];
export const FLOATING_TEXT_VERTEX_GLSL: "\nprecision highp float;\n\nattribute vec3 position;\nattribute vec2 uv;\nattribute vec4 aTextP0; // x, y, z, alpha\nattribute vec4 aTextP1; // rotRad, scaleX, scaleY, glyphIndex\nattribute vec4 aTextP2; // rgb24, reserved, reserved, reserved\n\nuniform mat4 projectionMatrix;\nuniform mat4 modelViewMatrix;\nuniform float uIs2D;\n\nvarying vec2 vAtlasUv;\nvarying vec3 vColor;\nvarying float vAlpha;\n\nvec3 unpackRgb24(float v) {\n  float r = floor(v / 65536.0);\n  float rem = v - r * 65536.0;\n  float g = floor(rem / 256.0);\n  float b = rem - g * 256.0;\n  return vec3(r, g, b) / 255.0;\n}\n\nvoid main() {\n  float alpha = aTextP0.w;\n  if (alpha <= 0.002) {\n    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n    return;\n  }\n\n  vAlpha = alpha;\n  vColor = unpackRgb24(aTextP2.x);\n\n  float idx = aTextP1.w;\n  float col = mod(idx, 16.0);\n  float row = floor(idx / 16.0);\n  vAtlasUv = vec2((col + uv.x) / 16.0, (3.0 - row + uv.y) / 4.0);\n\n  float c = cos(aTextP1.x);\n  float s = sin(aTextP1.x);\n  vec2 scaled = vec2(position.x * aTextP1.y, position.y * aTextP1.z);\n  vec2 rotated = vec2(scaled.x * c - scaled.y * s, scaled.x * s + scaled.y * c);\n\n  if (uIs2D > 0.5) {\n    vec2 p2 = aTextP0.xy + vec2(rotated.x, -rotated.y);\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(p2, aTextP0.z, 1.0);\n  } else {\n    vec4 mv = modelViewMatrix * vec4(aTextP0.xyz, 1.0);\n    mv.xy += rotated;\n    gl_Position = projectionMatrix * mv;\n  }\n}\n";
export const FLOATING_TEXT_FRAGMENT_GLSL: "\nprecision highp float;\n\nuniform sampler2D uGlyphAtlas;\n\nvarying vec2 vAtlasUv;\nvarying vec3 vColor;\nvarying float vAlpha;\n\nvoid main() {\n  vec4 tex = texture2D(uGlyphAtlas, vAtlasUv);\n  float alpha = tex.a * vAlpha;\n  if (alpha < 0.02) discard;\n  gl_FragColor = vec4(tex.rgb * vColor, alpha);\n}\n";
export const FLOATING_TEXT_WEBGL2_2D_VS: "#version 300 es\nprecision highp float;\n\nlayout(location = 0) in vec2 aQuadPos;\nlayout(location = 1) in vec4 aTextP0;\nlayout(location = 2) in vec4 aTextP1;\nlayout(location = 3) in vec4 aTextP2;\n\nuniform vec2 uCamPos;\nuniform float uCamZoom;\nuniform vec2 uViewSize;\n\nout vec2 vAtlasUv;\nout vec3 vColor;\nout float vAlpha;\n\nvec3 unpackRgb24(float v) {\n  float r = floor(v / 65536.0);\n  float rem = v - r * 65536.0;\n  float g = floor(rem / 256.0);\n  float b = rem - g * 256.0;\n  return vec3(r, g, b) / 255.0;\n}\n\nvoid main() {\n  float alpha = aTextP0.w;\n  if (alpha <= 0.002) {\n    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n    return;\n  }\n\n  vAlpha = alpha;\n  vColor = unpackRgb24(aTextP2.x);\n\n  float idx = aTextP1.w;\n  float col = mod(idx, 16.0);\n  float row = floor(idx / 16.0);\n  vec2 uv = aQuadPos + 0.5;\n  vAtlasUv = vec2((col + uv.x) / 16.0, (3.0 - row + uv.y) / 4.0);\n\n  float c = cos(aTextP1.x);\n  float s = sin(aTextP1.x);\n  vec2 scaled = vec2(aQuadPos.x * aTextP1.y, aQuadPos.y * aTextP1.z);\n  vec2 rotated = vec2(scaled.x * c - scaled.y * s, scaled.x * s + scaled.y * c);\n  vec2 worldPos = aTextP0.xy + vec2(rotated.x, -rotated.y);\n\n  vec2 screenPx = (worldPos - uCamPos) * uCamZoom + uViewSize * 0.5;\n  vec2 ndc = vec2(\n    (screenPx.x / max(1.0, uViewSize.x)) * 2.0 - 1.0,\n    1.0 - (screenPx.y / max(1.0, uViewSize.y)) * 2.0\n  );\n  gl_Position = vec4(ndc, 0.0, 1.0);\n}\n";
export const FLOATING_TEXT_WEBGL2_2D_FS: "#version 300 es\nprecision highp float;\n\nuniform sampler2D uGlyphAtlas;\n\nin vec2 vAtlasUv;\nin vec3 vColor;\nin float vAlpha;\n\nout vec4 fragColor;\n\nvoid main() {\n  vec4 tex = texture(uGlyphAtlas, vAtlasUv);\n  float alpha = tex.a * vAlpha;\n  if (alpha < 0.02) discard;\n  fragColor = vec4(tex.rgb * vColor, alpha);\n}\n";
