/**
 * Composable declarative 3D PBR material system with shared constant uniform blocks,
 * deterministic shader program cache keys (avoiding ad-hoc onBeforeCompile collisions),
 * and modular surface features (Fresnel rim glow, procedural Dissolve, Triplanar UV scale,
 * and Geometric Specular AA). Zero direct 'three' imports.
 */
/**
 * Shared shader uniform block reused across multiple materials so time, wind, or
 * global atmospheric uniforms update once without per-material traversal.
 */
export function createSharedMaterialBlock3D(initialUniforms?: {}): {
    readonly version: number;
    readonly uniforms: any;
    set: (name: any, value: any) => void;
    get: (name: any) => any;
};
/**
 * Build a declarative PBR material combining standard/physical base properties
 * with deterministic shader modules (`fresnel`, `dissolve`, `triplanar`, `specularAA`, `windSway`)
 * and optional `sharedBlock` uniforms.
 *
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 */
export function createComposableMaterial3D(THREE: object, { color, roughness, metalness, clearcoat, clearcoatRoughness, emissive, emissiveIntensity, transparent, opacity, side, fresnel, dissolve, triplanar, specularAA, windSway, sharedBlock, vertexChunks, fragmentChunks, }?: object): any;
