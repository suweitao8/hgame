/**
 * Inspect WebGL/WebGL2 compressed texture extension support cleanly.
 * @param {object|null} [glOrRenderer] Three.js WebGLRenderer or raw WebGL2RenderingContext.
 */
export function detectCompressedTextureSupport(glOrRenderer?: object | null): Readonly<{
    astc: boolean;
    etc2: boolean;
    bc7: boolean;
    dxt: boolean;
    preferred: string;
    vramSavingsRatio: number;
    maxTextureSize: number;
}>;
/**
 * Parse KTX2 file header metadata without allocating decoded image buffers.
 * @param {ArrayBuffer|ArrayBufferView} input
 */
export function parseKtx2Header(input: ArrayBuffer | ArrayBufferView): Readonly<{
    vkFormat: number;
    typeSize: number;
    pixelWidth: number;
    pixelHeight: number;
    pixelDepth: number;
    layerCount: number;
    faceCount: number;
    levelCount: number;
    supercompressionScheme: number;
}>;
/**
 * Select the highest-priority GPU-compressed texture variant supported by the device.
 * @param {Record<string, string>} [variants]
 * @param {{ astc?: boolean, etc2?: boolean, bc7?: boolean, dxt?: boolean }} [support]
 */
export function selectOptimalTextureVariant(variants?: Record<string, string> | undefined, support?: {
    astc?: boolean;
    etc2?: boolean;
    bc7?: boolean;
    dxt?: boolean;
} | undefined): Readonly<{
    format: string;
    url: string;
    compressed: true;
}> | Readonly<{
    format: "fallback";
    url: string;
    compressed: false;
}>;
/**
 * Construct a Three.js CompressedTexture from pre-decoded or transcoded GPU mip payloads,
 * or return a serializable descriptor if Three.js is absent.
 */
export function createCompressedTextureFromMipData(THREE?: null, { width, height, format, mipmaps }?: {
    width?: number | undefined;
    height?: number | undefined;
    format?: number | undefined;
    mipmaps?: never[] | undefined;
}): any;
/**
 * Lightweight KTX2 / Basis Universal GPU compressed texture capability & container helpers
 * targeting 4-6x mobile VRAM savings for 50MB single-bundle HTML5 games.
 */
export const KTX2_MAGIC: Uint8Array;
