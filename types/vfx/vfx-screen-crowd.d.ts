/**
 * Losslessly packs animation frameRow [0..16382] and statusCode [0..15] into a single float32.
 * Preserves backward compatibility with bone-vat.js (statusCode=0 -> frameRow+1.0; negative -> flash).
 * @param {number} frameRow
 * @param {number} [statusCode=0]
 * @returns {number}
 */
export function packCrowdAnimStatus(frameRow: number, statusCode?: number): number;
/**
 * Decodes packed crowd W component back into { frameRow, statusCode }.
 * @param {number} packedW
 * @param {{frameRow:number,statusCode:number}} [out]
 */
export function unpackCrowdAnimStatus(packedW: number, out?: {
    frameRow: number;
    statusCode: number;
}): {
    frameRow: number;
    statusCode: number;
};
export function createScreenFeedbackPass({ mode, THREE, scene, }?: {
    mode?: string;
    THREE?: any;
    scene?: any;
}): {
    screenPulse: ({ ndcX, ndcY, strength, duration, color, }?: {
        ndcX?: number;
        ndcY?: number;
        strength?: number;
        duration?: number;
        color?: number;
    }) => void;
    setLowHpIntensity: (intensity: any) => void;
    setSpeedLines: (intensity: any) => void;
    update: (visualDt: any) => void;
    renderCanvas2D: (ctx: any, viewWidth: any, viewHeight: any) => void;
    reset: () => void;
    dispose: () => void;
};
export const CROWD_STATUS: Readonly<{
    NORMAL: 0;
    FLASH_25: 1;
    FLASH_50: 2;
    FLASH_75: 3;
    FLASH_92: 4;
    FROZEN: 5;
    POISON: 6;
    BURN: 7;
}>;
export const SCREEN_FEEDBACK_VERTEX_GLSL: "\nprecision highp float;\n\nattribute vec3 position;\nattribute vec2 uv;\n\nvarying vec2 vNdc;\nvarying vec2 vUv;\n\nvoid main() {\n  vUv = uv;\n  vNdc = position.xy * 2.0;\n  gl_Position = vec4(vNdc, 0.0, 1.0);\n}\n";
export const SCREEN_FEEDBACK_FRAGMENT_GLSL: "\nprecision highp float;\n\nuniform float uTime;\nuniform float uLowHp;\nuniform float uSpeedLines;\nuniform vec4 uPulse;      // ndcX, ndcY, progress [0..1], strength\nuniform vec3 uPulseColor;\n\nvarying vec2 vNdc;\nvarying vec2 vUv;\n\nvoid main() {\n  vec3 col = vec3(0.0);\n  float alpha = 0.0;\n\n  // 1. Low-HP heartbeat vignette\n  if (uLowHp > 0.005) {\n    float edgeDist = length(vNdc * vec2(0.85, 1.0));\n    float vig = smoothstep(0.65, 1.38, edgeDist);\n    float beat = 0.65 + 0.35 * sin(uTime * 6.5);\n    float aVig = vig * uLowHp * beat * 0.65;\n    col += vec3(0.85, 0.06, 0.08) * aVig;\n    alpha += aVig;\n  }\n\n  // 2. Speed lines (radial edge streaks)\n  if (uSpeedLines > 0.005) {\n    float r = length(vNdc);\n    float ang = atan(vNdc.y, vNdc.x);\n    float rays = pow(abs(sin(ang * 36.0 + floor(uTime * 24.0) * 1.7)), 10.0);\n    float mask = smoothstep(0.58, 1.15, r) * rays * uSpeedLines * 0.45;\n    col += vec3(0.92, 0.96, 1.0) * mask;\n    alpha += mask;\n  }\n\n  // 3. Shockwave pulse ring\n  if (uPulse.w > 0.005 && uPulse.z > 0.0 && uPulse.z < 1.0) {\n    float dist = length(vNdc - uPulse.xy);\n    float ringR = mix(0.04, 1.65, uPulse.z);\n    float ring = (1.0 - smoothstep(0.0, 0.14, abs(dist - ringR))) * (1.0 - uPulse.z) * uPulse.w;\n    col += uPulseColor * ring;\n    alpha += ring * 0.85;\n  }\n\n  if (alpha < 0.005) discard;\n  gl_FragColor = vec4(col / max(0.001, alpha), clamp(alpha, 0.0, 0.9));\n}\n";
