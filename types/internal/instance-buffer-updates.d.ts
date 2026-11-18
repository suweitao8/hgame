/** @param {number} componentsPerRow */
export function createInstanceUpdateRanges(componentsPerRow: number): {
    reset: () => void;
    add: (row: number) => void;
    submit: (attribute: {
        array: {
            length: number;
        };
        needsUpdate: boolean;
        clearUpdateRanges?: () => void;
        addUpdateRange?: (start: number, count: number) => void;
    } | null | undefined) => number;
};
