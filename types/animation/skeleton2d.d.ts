/**
 * Lightweight 2D Skeletal Animation & Analytical 2-Bone IK System for 50MB HTML5
 * mobile-portrait games (cuts sprite atlas memory by >70% vs dense frame sheets).
 */
/**
 * Create a hierarchical 2D skeleton with topological FK, pose blending, and analytical 2-bone IK.
 * @param {object} [options]
 * @param {Array<{ id: string, parent?: string|null, x?: number, y?: number, angle?: number, length?: number, scaleX?: number, scaleY?: number }>} [options.bones=[]]
 * @param {Array<{ id: string, bone: string, width?: number, height?: number, color?: string }>} [options.slots=[]]
 */
export function createSkeleton2D({ bones, slots }?: {
    bones?: {
        id: string;
        parent?: string | null;
        x?: number;
        y?: number;
        angle?: number;
        length?: number;
        scaleX?: number;
        scaleY?: number;
    }[] | undefined;
    slots?: {
        id: string;
        bone: string;
        width?: number;
        height?: number;
        color?: string;
    }[] | undefined;
} | undefined): Readonly<{
    updateWorldTransforms: () => void;
    applyPose: (poseA?: {}, poseB?: null, t?: number) => void;
    solveTwoBoneIk2D: (rootId: any, midId: any, targetX: any, targetY: any, flip?: number) => boolean;
    getBoneWorld: (id: any) => {
        id: any;
        x: any;
        y: any;
        tipX: any;
        tipY: any;
        angle: any;
    } | null;
    getRenderSlots: () => {
        id: string;
        bone: any;
        x: any;
        y: any;
        tipX: any;
        tipY: any;
        angle: any;
        width: number;
        height: number;
        color: string;
    }[];
    readonly boneCount: number;
}>;
