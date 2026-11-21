/** Owns one view's color and depth history. */
export function createTemporalAA(THREE: any, createTarget: any, createMaterial: any, createMotion?: null): {
    targets: any[];
    jitter: (camera: any, width: any, height: any, targetWidth?: any, targetHeight?: any) => void;
    restore: (camera: any) => boolean;
    resolve: (world: any, camera: any, color: any, depth: any, depthMode: any, dt: any, runPass: any, trackMotion: any, multisampled: any, reactiveMask?: null) => any;
    reset: () => void;
    release: () => void;
    getMotionClassificationStats: () => any;
    readonly motionTarget: any;
    dispose(): void;
};
