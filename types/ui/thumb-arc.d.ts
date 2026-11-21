/**
 * Evaluate whether a screen-space coordinate lies inside the lower-half portrait thumb comfort zone.
 * @param {{ x: number, y: number }} point
 * @param {{ width: number, height: number }} viewport
 * @param {object} [options]
 * @param {number} [options.minCenterYRatio=0.5]
 * @param {number} [options.maxComfortRadiusRatio=0.88]
 */
export function isInThumbComfortZone(point: {
    x: number;
    y: number;
}, viewport: {
    width: number;
    height: number;
}, { minCenterYRatio, maxComfortRadiusRatio, }?: {
    minCenterYRatio?: number | undefined;
    maxComfortRadiusRatio?: number | undefined;
} | undefined): Readonly<{
    inLowerHalf: boolean;
    inRightArc: boolean;
    distanceFromCorner: number;
    ok: boolean;
}>;
/**
 * Compute concentric bottom-right semi-arc placements for mobile portrait action buttons.
 * Primary slot sits directly under the thumb at the bottom-right hub (`ring = 0`), while
 * secondary actions fan along inner (`ring = 1`) and outer (`ring = 2`) quarter-arcs between
 * `startAngleDeg` (upward-left from corner) and `endAngleDeg` (upward), clamped strictly
 * to the lower half (`cy >= viewportHeight * minCenterYRatio`) and safe-area margins.
 *
 * @param {object} options
 * @param {number} options.viewportWidth
 * @param {number} options.viewportHeight
 * @param {Array<{ id: string, label?: string, primary?: boolean, size?: number, icon?: string, cooldown?: number }>} options.items
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} [options.safeArea]
 * @param {number} [options.primarySize=68]
 * @param {number} [options.secondarySize=52]
 * @param {number} [options.arcRadius=108]
 * @param {number} [options.outerArcRadius=172]
 * @param {number} [options.minCenterYRatio=0.52]
 * @param {number} [options.startAngleDeg=185]
 * @param {number} [options.endAngleDeg=265]
 */
export function computeThumbArcLayout({ viewportWidth, viewportHeight, items, safeArea, primarySize, secondarySize, arcRadius, outerArcRadius, minCenterYRatio, startAngleDeg, endAngleDeg, }?: {
    viewportWidth: number;
    viewportHeight: number;
    items: Array<{
        id: string;
        label?: string;
        primary?: boolean;
        size?: number;
        icon?: string;
        cooldown?: number;
    }>;
    safeArea?: {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
    } | undefined;
    primarySize?: number | undefined;
    secondarySize?: number | undefined;
    arcRadius?: number | undefined;
    outerArcRadius?: number | undefined;
    minCenterYRatio?: number | undefined;
    startAngleDeg?: number | undefined;
    endAngleDeg?: number | undefined;
}): Readonly<{
    origin: Readonly<{
        x: number;
        y: number;
    }>;
    zoneRadius: number;
    allInLowerHalf: boolean;
    items: {
        id: string;
        size: number;
        radius: number;
        cx: any;
        cy: any;
        x: number;
        y: number;
        ring: number;
        angleDeg: number;
        inComfortZone: boolean;
        label?: string;
        primary?: boolean;
        icon?: string;
        cooldown?: number;
    }[];
}>;
/**
 * Lightweight Canvas2D bottom-right semi-arc action HUD with radial cooldown fill and pointer hit-testing.
 * @param {object} [options]
 * @param {Array<{ id: string, label?: string, primary?: boolean, icon?: string, cooldownRatio?: number, onPress?: () => void }>} [options.items=[]]
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} [options.safeArea]
 * @param {((id: string, item: object) => void) | null} [options.onAction=null]
 */
export function createThumbArcHud({ items, safeArea, onAction, }?: {
    items?: {
        id: string;
        label?: string;
        primary?: boolean;
        icon?: string;
        cooldownRatio?: number;
        onPress?: () => void;
    }[] | undefined;
    safeArea?: {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
    } | undefined;
    onAction?: ((id: string, item: object) => void) | null | undefined;
} | undefined): Readonly<{
    setItems: (nextItems: any) => void;
    layout: (viewportWidth: any, viewportHeight: any) => Readonly<{
        origin: Readonly<{
            x: number;
            y: number;
        }>;
        zoneRadius: number;
        allInLowerHalf: boolean;
        items: {
            id: string;
            size: number;
            radius: number;
            cx: any;
            cy: any;
            x: number;
            y: number;
            ring: number;
            angleDeg: number;
            inComfortZone: boolean;
            label?: string;
            primary?: boolean;
            icon?: string;
            cooldown?: number;
        }[];
    }>;
    render: (ctx: any, viewportWidth: any, viewportHeight: any, { showComfortArc }?: {
        showComfortArc?: boolean | undefined;
    }) => Readonly<{
        origin: Readonly<{
            x: number;
            y: number;
        }>;
        zoneRadius: number;
        allInLowerHalf: boolean;
        items: {
            id: string;
            size: number;
            radius: number;
            cx: any;
            cy: any;
            x: number;
            y: number;
            ring: number;
            angleDeg: number;
            inComfortZone: boolean;
            label?: string;
            primary?: boolean;
            icon?: string;
            cooldown?: number;
        }[];
    }>;
    hitTest: (px: any, py: any) => any;
    pointerDown: (px: any, py: any) => any;
    pointerUp: (px: any, py: any) => any;
    getLastLayout: () => any;
}>;
/**
 * Mobile-First Portrait Bottom-Right Thumb-Arc Comfort Zone Layout & HUD Renderer.
 * Ensures clickable mobile interactions fan ergonomically around the bottom-right thumb
 * quarter-arc / semi-arc, never drifting into the hard-to-reach upper half of the screen.
 */
export const DEFAULT_THUMB_ARC_SPEC: Readonly<{
    anchor: "bottom-right";
    minCenterYRatio: 0.52;
    minButtonSize: 48;
    primarySize: 68;
    secondarySize: 52;
    arcRadius: 108;
    outerArcRadius: 172;
    startAngleDeg: 185;
    endAngleDeg: 265;
    cornerMarginRight: 18;
    cornerMarginBottom: 18;
}>;
