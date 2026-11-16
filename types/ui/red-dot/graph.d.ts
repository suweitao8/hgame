/**
 * Builds an inactive/empty frozen state snapshot for a node path.
 * @param {string} path
 * @param {boolean} [unlocked=true]
 * @param {boolean} [muted=false]
 * @returns {import('./helpers.js').RedDotState}
 */
export function buildEmptyState(path: string, unlocked?: boolean | undefined, muted?: boolean | undefined): import("./helpers.js").RedDotState;
/**
 * Graph and dirty-propagation engine for RedDotSystem.
 * @param {object} ctx Shared mutable system state.
 */
export function createRedDotGraph(ctx: object): {
    ensureNode: (rawPath: any) => any;
    markDirtyUp: (startNode: any) => void;
    markAllDirty: () => void;
    isReachable: (fromNode: any, targetNode: any) => boolean;
    recomputeNode: (node: any, changedNodes: any) => void;
    ensureClean: (node: any, changedNodes: any, visiting?: Set<any>) => void;
    updateSubtreeUnlock: (rootNode: any) => void;
    explainPath: (normalized: any) => {
        path: any;
        state: any;
        blockedByUnlock: string | null;
        muted: boolean;
        activeSources: {
            path: any;
            count: any;
            style: any;
            reasons: string[];
        }[];
    };
};
