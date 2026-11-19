/** Owns one view's color and depth history. */
export function createTemporalAA(THREE: any, createTarget: any, createMaterial: any): {
    targets: any[];
    jitter: (camera: any, width: any, height: any) => void;
    restore: (camera: any) => boolean;
    resolve: (world: any, camera: any, color: any, depth: any, depthMode: any, dt: any, runPass: any) => any;
    reset: () => void;
    release: () => void;
    dispose(): void;
};
