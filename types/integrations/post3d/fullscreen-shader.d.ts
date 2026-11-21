/**
 * Creates a Three HDR pass from GLSL3 defining `vec4 shadeFullscreen(vec2 uv)`.
 * The caller owns the returned material and can update its custom uniforms.
 * @param {object} THREE Three.js namespace.
 * @param {object} options
 * @param {string} options.id Unique HDR pass id.
 * @param {string} options.fragment GLSL3 declarations and shadeFullscreen implementation.
 * @param {Record<string, {value: unknown}>} [options.uniforms] Caller-defined shader uniforms.
 * @param {boolean} [options.sceneDepth=false] Request original world depth and camera projection.
 * @param {boolean} [options.enabled=true] Whether this pass runs.
 */
export function createFullscreenShaderPass(THREE: object, { id, fragment, uniforms, sceneDepth, enabled }?: {
    id: string;
    fragment: string;
    uniforms?: Record<string, {
        value: unknown;
    }> | undefined;
    sceneDepth?: boolean | undefined;
    enabled?: boolean | undefined;
}): {
    id: string;
    material: any;
    inputs: {
        color: string;
        depth: string;
        depthView: Readonly<{
            inverseProjection: "hgameInverseProjection";
            clipDepthMode: "hgameClipDepthMode";
            far: "hgameCameraFar";
        }>;
    } | {
        color: string;
        depth?: undefined;
        depthView?: undefined;
    };
    enabled: boolean;
};
