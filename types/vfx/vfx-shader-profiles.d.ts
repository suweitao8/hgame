/**
 * Resolves Unity Surface/Blend/SrcBlend/DstBlend/Cull/ZWrite/ZTest/AlphaClip
 * into Three.js Material state.
 */
export function resolveThreeRenderState(THREE: any, matSpec?: {}): {
    transparent: boolean;
    opaque: boolean;
    isWarp: boolean;
    premulAlpha: boolean;
    blending: any;
    blendEquation: any;
    blendSrc: any;
    blendDst: any;
    blendSrcAlpha: any;
    blendDstAlpha: any;
    side: any;
    depthTestIdx: number;
    depthWrite: boolean;
    renderOrder: number;
};
/**
 * Registers a shader profile into the global registry.
 */
export function registerShaderProfile(name: any, profileDef: any): void;
/**
 * Retrieves a registered shader profile definition.
 */
export function getShaderProfile(name: any): any;
/**
 * Lists all registered shader profile names.
 */
export function listShaderProfiles(): any[];
/**
 * Returns total unique compiled `(profile, defines)` shader variant count tracked this session.
 */
export function getCompiledShaderVariantCount(): number;
export function resetCompiledShaderVariantTracker(): void;
/**
 * Compiles/instantiates a Three.js `ShaderMaterial` for the requested Shader Profile + MaterialSpec.
 */
export function createProfileMaterial(THREE: any, matSpec?: {}, textures?: {}, shared?: {}): {
    material: any;
    renderState: {
        transparent: boolean;
        opaque: boolean;
        isWarp: boolean;
        premulAlpha: boolean;
        blending: any;
        blendEquation: any;
        blendSrc: any;
        blendDst: any;
        blendSrcAlpha: any;
        blendDstAlpha: any;
        side: any;
        depthTestIdx: number;
        depthWrite: boolean;
        renderOrder: number;
    };
    variantKey: string;
};
