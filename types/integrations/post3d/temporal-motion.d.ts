/** Tracks the previous transforms of native opaque meshes independently for each temporal view. */
export function createTemporalMotion(THREE: any, renderer: any, makeTarget: any, draw: any, maxTextureSize: any): {
    render: (world: any, camera: any, depth: any, depthMode: any, currentProjection: any, currentJitter: any, previousProjection: any, previousView: any, historyWeight: any, multisampled: any) => any;
    reset: () => void;
    release: () => void;
    getClassificationStats: () => {
        rigid: number;
        instanced: number;
        skinned: number;
        gpuAnimated: number;
        excluded: number;
        total: number;
    };
    readonly target: any;
    dispose(): void;
};
