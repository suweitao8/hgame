/**
 * Zero-string-allocation integer digit extractor into a pre-allocated Int32Array.
 * @param {number} intValue
 * @param {boolean} [isCrit=false]
 * @param {boolean} [isHeal=false]
 * @param {boolean} [isMiss=false]
 * @param {Int32Array} [outBuffer=scratchDigits]
 * @returns {number} Glyph count written into outBuffer
 */
export function extractGlyphIndices(intValue: number, isCrit?: boolean, isHeal?: boolean, isMiss?: boolean, outBuffer?: Int32Array): number;
export function bakeGlyphAtlasCanvas(): HTMLCanvasElement;
export function createFloatingTextPool({ mode, THREE, scene, is2D, maxFloatingGlyphs, }?: {
    mode?: string;
    THREE?: any;
    scene?: any;
    is2D?: boolean;
    maxFloatingGlyphs?: number;
}): {
    popupNumber: (opts?: {}) => number;
    update: (visualDt: any) => void;
    renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
    reset: () => void;
    dispose: () => void;
    getStats(): {
        capacity: number;
        totalEmitted: number;
        cursor: number;
    };
};
export const GLYPH_CHARS: readonly string[];
export const FLOATING_TEXT_VERTEX_GLSL: "\nprecision highp float;\n\nattribute vec3 position;\nattribute vec2 uv;\nattribute vec4 aTextP0; // x, y, z, spawnTime\nattribute vec4 aTextP1; // vx, vy, charOffsetPx, duration\nattribute vec4 aTextP2; // glyphIndex, rgb24, scale, isCrit\n\nuniform mat4 projectionMatrix;\nuniform mat4 modelViewMatrix;\nuniform float uTime;\nuniform float uIs2D;\n\nvarying vec2 vAtlasUv;\nvarying vec3 vColor;\nvarying float vAlpha;\n\nvec3 unpackRgb24(float v) {\n  float r = floor(v / 65536.0);\n  float rem = v - r * 65536.0;\n  float g = floor(rem / 256.0);\n  float b = rem - g * 256.0;\n  return vec3(r, g, b) / 255.0;\n}\n\nvoid main() {\n  float age = uTime - aTextP0.w;\n  float dur = aTextP1.w;\n  if (dur <= 0.0 || age < 0.0 || age >= dur) {\n    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n    return;\n  }\n\n  float t = age / dur;\n  vAlpha = 1.0 - smoothstep(0.55, 1.0, t);\n  vColor = unpackRgb24(aTextP2.y);\n\n  float u0 = aTextP2.x / 16.0;\n  vAtlasUv = vec2(u0 + uv.x / 16.0, uv.y);\n\n  float pop = 1.0;\n  if (aTextP2.w > 0.5 && age < 0.12) {\n    float p = age / 0.12;\n    pop = mix(1.65, 1.0, p * p);\n  } else if (age < 0.08) {\n    pop = mix(1.3, 1.0, age / 0.08);\n  }\n\n  float scale = aTextP2.z * pop;\n  float grav = (uIs2D > 0.5) ? 240.0 : 9.0;\n  vec3 worldCenter = aTextP0.xyz + vec3(aTextP1.x * age, aTextP1.y * age - 0.5 * grav * age * age * ((uIs2D > 0.5) ? -1.0 : 1.0), 0.0);\n\n  if (uIs2D > 0.5) {\n    vec2 p2 = worldCenter.xy + vec2(aTextP1.z * scale + position.x * scale * 0.65, position.y * scale * 1.3);\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(p2, worldCenter.z, 1.0);\n  } else {\n    vec4 mv = modelViewMatrix * vec4(worldCenter, 1.0);\n    mv.x += aTextP1.z * scale + position.x * scale * 0.65;\n    mv.y += position.y * scale * 1.3;\n    gl_Position = projectionMatrix * mv;\n  }\n}\n";
export const FLOATING_TEXT_FRAGMENT_GLSL: "\nprecision highp float;\n\nuniform sampler2D uGlyphAtlas;\n\nvarying vec2 vAtlasUv;\nvarying vec3 vColor;\nvarying float vAlpha;\n\nvoid main() {\n  vec4 tex = texture2D(uGlyphAtlas, vAtlasUv);\n  float alpha = tex.a * vAlpha;\n  if (alpha < 0.02) discard;\n  gl_FragColor = vec4(tex.rgb * vColor, alpha);\n}\n";
