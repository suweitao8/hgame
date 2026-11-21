/**
 * Options of createWebGL2DAdapter: every Canvas2DAdapterOptions field plus the WebGL-specific ones below.
 * @typedef {Canvas2DAdapterOptions & WebGL2DAdapterExtraOptions} WebGL2DAdapterOptions
 */
/**
 * @typedef {object} WebGL2DAdapterExtraOptions
 * @property {number} [maxBatchInstances=16384] Instances per draw batch (integer 64..262144).
 * @property {boolean} [allowFallback=true] Fall back to the Canvas2D adapter when WebGL2 is unavailable; when false an Error is thrown instead.
 */
/**
 * Per-frame statistics of the WebGL2 backend.
 * @typedef {Renderer2DStats & { drawCalls: number, instances: number }} WebGL2DStats
 */
/**
 * WebGL2 adapter (the shared renderer API plus GL specifics).
 * @typedef {Renderer2DAdapter & WebGL2DAdapterMembers} WebGL2DAdapter
 */
/**
 * @typedef {object} WebGL2DAdapterMembers
 * @property {WebGL2RenderingContext} gl The WebGL2 context.
 * @property {true} isWebGL2 Always true for this adapter (getter); the fallback adapter has no such member.
 * @property {boolean} contextLost True while the GL context is lost (getter).
 * @property {WebGL2DStats} stats Copy of last-frame statistics including drawCalls/instances (getter).
 */
/**
 * Hardware-instanced WebGL2 2D renderer capable of 5,000-10,000+ sprites/sec
 * with shader-driven tint, silhouette hit-flash, and analytical ground shadows.
 * Falls back transparently to Canvas2D when WebGL2 is unavailable.
 * @param {WebGL2DAdapterOptions} options
 * @returns {WebGL2DAdapter | Canvas2DAdapter} A WebGL2 adapter, or the Canvas2D fallback (check stats.backend or 'gl' in adapter).
 */
export function createWebGL2DAdapter({ canvas, width, height, background, pixelRatio, imageSmoothing, interpolate, cull, quality, maxBatchInstances, allowFallback, createBufferCanvas, diagnostics2d, budgetOptions, }?: WebGL2DAdapterOptions): WebGL2DAdapter | Canvas2DAdapter;
/**
 * Options of createWebGL2DAdapter: every Canvas2DAdapterOptions field plus the WebGL-specific ones below.
 */
export type WebGL2DAdapterOptions = Canvas2DAdapterOptions & WebGL2DAdapterExtraOptions;
export type WebGL2DAdapterExtraOptions = {
    /**
     * Instances per draw batch (integer 64..262144).
     */
    maxBatchInstances?: number | undefined;
    /**
     * Fall back to the Canvas2D adapter when WebGL2 is unavailable; when false an Error is thrown instead.
     */
    allowFallback?: boolean | undefined;
};
/**
 * Per-frame statistics of the WebGL2 backend.
 */
export type WebGL2DStats = Renderer2DStats & {
    drawCalls: number;
    instances: number;
};
/**
 * WebGL2 adapter (the shared renderer API plus GL specifics).
 */
export type WebGL2DAdapter = Renderer2DAdapter & WebGL2DAdapterMembers;
export type WebGL2DAdapterMembers = {
    /**
     * The WebGL2 context.
     */
    gl: WebGL2RenderingContext;
    /**
     * Always true for this adapter (getter); the fallback adapter has no such member.
     */
    isWebGL2: true;
    /**
     * True while the GL context is lost (getter).
     */
    contextLost: boolean;
    /**
     * Copy of last-frame statistics including drawCalls/instances (getter).
     */
    stats: WebGL2DStats;
};
export type Canvas2DAdapter = import("./canvas2d.js").Canvas2DAdapter;
export type Canvas2DAdapterOptions = import("./canvas2d.js").Canvas2DAdapterOptions;
export type Renderer2DAdapter = import("./canvas2d.js").Renderer2DAdapter;
export type Renderer2DStats = import("./canvas2d.js").Renderer2DStats;
import { Camera2D } from './canvas2d.js';
import { Sprite2D } from './canvas2d.js';
import { SpriteCrowd2D } from './canvas2d.js';
export { Camera2D, Sprite2D, SpriteCrowd2D };
