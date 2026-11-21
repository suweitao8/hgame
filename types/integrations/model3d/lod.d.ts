/**
 * Switches one actor between a skeletal model, a shared Bone-VAT slot and a distant proxy.
 * The current tier stays visible while a replacement prepares. The next update samples
 * the replacement at the latest transform and clip time before releasing the old tier.
 * @param {ModelLodOptions3D} options
 * @returns {ModelLod3D}
 */
export function createModelLod3D({ near, crowd, far, crowdDistance, farDistance, hysteresis, signal, budget, budgetId, tierBytes, crossFadeSeconds }: ModelLodOptions3D): ModelLod3D;
export type ModelLodState3D = {
    /**
     * Actor position in the representations' common coordinate space.
     */
    x: number;
    /**
     * Actor height. The shared Bone-VAT crowd uses its configured ground plane.
     */
    y: number;
    /**
     * Actor position in the representations' common coordinate space.
     */
    z: number;
    /**
     * Yaw in radians.
     */
    rotationY: number;
    /**
     * A looping clip shared by the skeletal model and the crowd.
     */
    clip: string;
    /**
     * Authoritative clip time in seconds.
     */
    time: number;
    /**
     * Optional secondary composite blend clip preserved across LOD transitions.
     */
    secondaryClip?: string | null | undefined;
    /**
     * Secondary clip time in seconds.
     */
    secondaryTime?: number | undefined;
    /**
     * Blend weight in [0, 1] for secondary composite clip.
     */
    blendWeight?: number | undefined;
};
export type ModelLodSlot3D = {
    /**
     * Apply the actual state and attach on first call. Throw if preparation cannot finish.
     */
    sync: (state: ModelLodState3D) => void;
    /**
     * Detach if shown and release owned resources, including for a prepared slot that was never shown.
     */
    dispose: () => void;
};
export type ModelLodTier3D = "near" | "crowd" | "far";
export type ModelLodFactory3D = (options: {
    signal: AbortSignal;
}) => ModelLodSlot3D | Promise<ModelLodSlot3D>;
export type ModelLodOptions3D = {
    /**
     * Prepare a detached skeletal representation.
     */
    near: ModelLodFactory3D;
    /**
     * Shared standalone crowd, updated once after all controllers.
     */
    crowd: import("./bone-vat.js").BoneVatCrowd3D;
    /**
     * Prepare a detached proxy, such as a group from createHLODProxyGroup3D.
     */
    far: ModelLodFactory3D;
    /**
     * Distance at which the crowd tier begins.
     */
    crowdDistance?: number | undefined;
    /**
     * Distance at which the proxy tier begins.
     */
    farDistance?: number | undefined;
    /**
     * Fractional dead band on either side of each threshold, in [0, 1).
     */
    hysteresis?: number | undefined;
    /**
     * Scene activation or another owner lifetime.
     */
    signal?: AbortSignal | undefined;
    /**
     * Optional unified representation budget controller (`createRepresentationBudget3D`).
     */
    budget?: object | null;
    /**
     * Identifier key inside the representation budget.
     */
    budgetId?: string | null | undefined;
    /**
     * Optional per-tier estimated byte footprint.
     */
    tierBytes?: Partial<Record<ModelLodTier3D, number>> | null | undefined;
    /**
     * Optional smooth crossfade transition duration across LOD swaps.
     */
    crossFadeSeconds?: number | undefined;
};
export type ModelLod3D = {
    /**
     * Currently shown representation.
     */
    tier: ModelLodTier3D | null;
    /**
     * Tier preparing or awaiting the next update.
     */
    pendingTier: ModelLodTier3D | null;
    /**
     * Latest transition failure, or null.
     */
    error: unknown;
    /**
     * Return latest composite animation handoff state.
     */
    getAnimationState: () => {
        clip: string;
        time: number;
        secondaryClip: string | null;
        secondaryTime: number;
        blendWeight: number;
    } | null;
    /**
     * Return smooth LOD crossfade state.
     */
    getCrossFadeState: () => {
        active: boolean;
        alpha: number;
        fromTier: ModelLodTier3D | null;
        toTier: ModelLodTier3D | null;
    };
    /**
     * Select a tier and apply the latest actor state.
     */
    update: (distance: number, state: ModelLodState3D) => void;
    /**
     * Allow another attempt on the next update after a failed transition.
     */
    retry: () => void;
    /**
     * Cancel pending work and release the shown representation. Leaves the shared crowd owned by the caller.
     */
    dispose: () => boolean;
};
