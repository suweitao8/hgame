/** @typedef {{mode: 'idle' | 'full' | 'ranges', queuedBytes: number, ranges: number}} FloatTextureUploadStats */
/**
 * Keeps pending dirty ranges until the renderer consumes their texture version.
 * Range uploads require a renderer that initializes new GPU backing in full.
 */
export function createFloatTextureUpdates(texture: any, data: any, width: any, height: any, partial: any): {
    packed: Float32Array;
    publish: (rowCount?: any, dirtyStarts?: null, dirtyEnds?: null) => void;
    stats: () => {
        mode: "idle" | "full" | "ranges";
        queuedBytes: number;
        ranges: number;
    };
};
export type FloatTextureUploadStats = {
    mode: "idle" | "full" | "ranges";
    queuedBytes: number;
    ranges: number;
};
