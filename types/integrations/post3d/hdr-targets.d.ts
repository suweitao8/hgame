/**
 * Pane-local full-size HDR intermediates with read/write lifetimes within a frame.
 * @template {{width: number, height: number, depthBuffer: boolean, texture: unknown, dispose?: () => void}} Target
 * @param {(width: number, height: number, depthBuffer: boolean) => Target} makeTarget
 */
export function createHdrTargets<Target extends {
    width: number;
    height: number;
    depthBuffer: boolean;
    texture: unknown;
    dispose?: () => void;
}>(makeTarget: (width: number, height: number, depthBuffer: boolean) => Target): {
    acquire: (width: number, height: number, depthBuffer: boolean, inputs?: Record<string, {
        value: unknown;
    }> | undefined) => Target;
    release: (target: Target) => void;
    beginFrame(): void;
    finishFrame: () => void;
    trimColor: (count: number) => void;
    /** @param {{recordTarget: (target: Target) => void}} sink */
    record(sink: {
        recordTarget: (target: Target) => void;
    }): void;
    dispose(): void;
};
