/**
 * Creates a lightweight realistic water MeshStandardMaterial with dual scrolling normals
 * and Schlick Fresnel edge reflectivity.
 * @param {any} THREE Three.js namespace or compatible mock.
 * @param {Record<string, any>} [options]
 */
export function createRealisticWater3D(THREE: any, { normalMap, shallowColor, deepColor, roughness, metalness, normalScale, normalStrength, scrollA, scrollB, fresnelPower, baseAlpha, side, sharedBlock, }?: Record<string, any> | undefined): any;
/**
 * Creates a lightweight architectural glass material (no depthWrite, low roughness, Fresnel edge reflection).
 * @param {any} THREE
 * @param {Record<string, any>} [options]
 */
export function createRealisticGlassMaterial3D(THREE: any, { color, opacity, roughness, metalness, clearcoat, clearcoatRoughness, side, }?: Record<string, any> | undefined): any;
