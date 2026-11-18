export function readDrawingBufferLimits(renderer: any): {
    maxBufferWidth: number;
    maxBufferHeight: number;
};
export function fitDrawingBuffer(width: any, height: any, requestedRatio: any, { maxPixels, maxBufferWidth, maxBufferHeight, scale, }?: {
    maxPixels?: number | undefined;
    maxBufferWidth?: number | undefined;
    maxBufferHeight?: number | undefined;
    scale?: number | undefined;
}): {
    pixelRatio: number;
    bufferWidth: number;
    bufferHeight: number;
};
