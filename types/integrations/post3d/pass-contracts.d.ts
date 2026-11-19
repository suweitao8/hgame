/**
 * @param {FullscreenPassContract} pass
 * @param {Record<string, {value: unknown}>} uniforms
 * @param {{texture?: unknown, depthTexture?: unknown} | null} target
 */
export function validateFullscreenPass(pass: FullscreenPassContract, uniforms: Record<string, {
    value: unknown;
}>, target: {
    texture?: unknown;
    depthTexture?: unknown;
} | null): void;
/**
 * @typedef {object} FullscreenPassContract
 * @property {string} name Diagnostic pass name.
 * @property {readonly string[]} reads Required sampler uniforms.
 * @property {readonly string[]} [optional] Sampler uniforms with a shader fallback.
 * @property {'screen' | 'color' | 'color-depth' | 'color-or-screen'} writes Writable framebuffer attachments.
 */
/** @type {Readonly<Record<string, FullscreenPassContract>>} */
export const FULLSCREEN_PASSES: Readonly<Record<string, FullscreenPassContract>>;
export type FullscreenPassContract = {
    /**
     * Diagnostic pass name.
     */
    name: string;
    /**
     * Required sampler uniforms.
     */
    reads: readonly string[];
    /**
     * Sampler uniforms with a shader fallback.
     */
    optional?: readonly string[] | undefined;
    /**
     * Writable framebuffer attachments.
     */
    writes: "screen" | "color" | "color-depth" | "color-or-screen";
};
