/**
 * Create a 2-attachment (`Color + Normal/ID`) WebGL2 MRT render target & fullscreen Sobel
 * outline composite shader pass.
 * @param {any} [THREE=null]
 * @param {{ width?: number, height?: number, outlineColor?: number | number[], thickness?: number, threshold?: number }} [options]
 */
export function createMrtOutlinePass3D(THREE?: any, { width, height, outlineColor, thickness, threshold, }?: {
    width?: number;
    height?: number;
    outlineColor?: number | number[];
    thickness?: number;
    threshold?: number;
} | undefined): Readonly<{
    mrtTarget: any;
    material: any;
    uniforms: {
        tColor: {
            value: any;
        };
        tNormalId: {
            value: any;
        };
        uTexelSize: {
            value: any;
        };
        uOutlineColor: {
            value: any;
        };
        uOutlineThickness: {
            value: number;
        };
        uOutlineThreshold: {
            value: number;
        };
    };
    setOutline: ({ color, thickness: nextThick, threshold: nextThresh }?: {
        color?: number | number[];
        thickness?: number;
        threshold?: number;
    } | undefined) => void;
    resize: (nextW: any, nextH: any) => void;
    getStats: () => Readonly<{
        width: number;
        height: number;
        attachments: any;
        thickness: number;
        threshold: number;
        hasShaderMaterial: boolean;
    }>;
    dispose: () => void;
}>;
/**
 * Lightweight WebGL2 MRT screen-space Sobel contour outline pass (`Color + Normal/ID`
 * render target with zero extra geometry draw calls) and GLSL3 shader source.
 */
export const MRT_OUTLINE_FRAGMENT_GLSL3: "\nuniform sampler2D tColor;\nuniform sampler2D tNormalId;\nuniform vec2 uTexelSize;\nuniform vec3 uOutlineColor;\nuniform float uOutlineThickness;\nuniform float uOutlineThreshold;\n\nin vec2 vUv;\nlayout(location = 0) out vec4 fragColor;\n\nvoid main() {\n  vec4 base = texture(tColor, vUv);\n  vec2 stepUv = uTexelSize * max(0.5, uOutlineThickness);\n\n  vec4 nTL = texture(tNormalId, vUv + vec2(-stepUv.x,  stepUv.y));\n  vec4 nTR = texture(tNormalId, vUv + vec2( stepUv.x,  stepUv.y));\n  vec4 nBL = texture(tNormalId, vUv + vec2(-stepUv.x, -stepUv.y));\n  vec4 nBR = texture(tNormalId, vUv + vec2( stepUv.x, -stepUv.y));\n\n  vec3 gx = (nTR.rgb + nBR.rgb) - (nTL.rgb + nBL.rgb);\n  vec3 gy = (nTL.rgb + nTR.rgb) - (nBL.rgb + nBR.rgb);\n  float normalEdge = length(gx) + length(gy);\n  float idEdge = abs(nTR.a - nBL.a) + abs(nTL.a - nBR.a);\n  float edge = clamp(smoothstep(uOutlineThreshold, uOutlineThreshold + 0.35, normalEdge + idEdge * 4.0), 0.0, 1.0);\n\n  fragColor = vec4(mix(base.rgb, uOutlineColor, edge * 0.88), base.a);\n}\n";
