/** Observe client upload commands only while a diagnostics frame is rendering. */
export function beginWebGlUploadProbe(gl: any): {
    read: () => {
        bufferBytes: number;
        textureBytes: number;
        calls: number;
        unmeasuredCalls: number;
    };
    methods: any[];
    stop(): void;
} | null;
export type WebGlUploadTotals = {
    bufferBytes: number;
    textureBytes: number;
    calls: number;
    unmeasuredCalls: number;
};
