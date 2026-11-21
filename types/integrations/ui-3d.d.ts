/**
 * @typedef {object} WorldHud3DAnchorOptions
 * @property {number} x World X.
 * @property {number} y World Y.
 * @property {number} z World Z.
 * @property {string} [text] Short icon/numeric label (e.g. "♥ 3" or "⚡").
 * @property {number} [progress] Optional bar ratio [0..1].
 * @property {number} [offsetY=0] Screen-space Y offset in pixels.
 * @property {number} [maxDistance=45] Distance beyond which anchor hides.
 * @property {boolean} [visible=true]
 */
/**
 * @typedef {object} WorldHud3DOptions
 * @property {{ worldToScreen: (x: number, y: number, z: number, out?: object | null, viewIndex?: number) => { x: number, y: number, ndcZ: number, visible: boolean }, camera?: { position?: { x: number, y: number, z: number } } }} renderer Three adapter exposing `worldToScreen`.
 * @property {HTMLElement} container Screen overlay element (pointer-events: none).
 * @property {number} [maxItems=32] Pooled DOM anchor count.
 * @property {number} [halfLife=0.045] Screen-space spring smoothing half-life (seconds); 0 disables smoothing.
 * @property {() => HTMLElement} [createElement] Optional custom DOM element factory per pooled slot.
 * @property {(el: HTMLElement, data: WorldHud3DAnchorOptions, screen: { x: number, y: number, scale: number, opacity: number }) => void} [renderElement] Optional custom updater.
 */
/**
 * Pooled world-space-to-screen DOM HUD anchor manager for 3D games.
 * Projects 3D world coordinates via `renderer.worldToScreen`, hides offscreen/behind-camera items,
 * and smooths screen motion with `SpringDamper2D`.
 *
 * @param {WorldHud3DOptions} options
 */
export function createWorldHud3D(options: WorldHud3DOptions): Readonly<{
    update: (items: any, dt?: number) => number;
    getSlotCount: () => number;
    dispose: () => void;
}>;
/**
 * @typedef {object} SpatialPanel3DOptions
 * @property {object} THREE Three.js namespace.
 * @property {{ screenToRay?: (clientX: number, clientY: number, out?: object | null, viewIndex?: number | null) => { origin: { x: number, y: number, z: number }, direction: { x: number, y: number, z: number } } }} [renderer] Three adapter (required for pointer ray picking).
 * @property {number} [width=1.6] World-space panel width.
 * @property {number} [height=1.0] World-space panel height.
 * @property {number} [curveRadius=0] Optional cylindrical arc radius (> 0 bends the panel toward the viewer).
 * @property {number} [pixelWidth=512] Backing canvas width in pixels.
 * @property {number} [pixelHeight=320] Backing canvas height in pixels.
 * @property {number[]} [position=[0, 0, 0]] Base local position `[x, y, z]`.
 * @property {number[]} [rotation=[0, 0, 0]] Base Euler rotation `[rx, ry, rz]` in radians.
 * @property {number} [maxTiltDeg=10] 3D spring hover tilt in degrees.
 * @property {number} [hoverLift=0.12] Forward Z / upward Y lift on hover in world units.
 * @property {number} [idleFloatAmp=0.025] Gentle idle levitation amplitude in world units.
 * @property {boolean} [lit=false] Use `MeshStandardMaterial` instead of `MeshBasicMaterial`.
 * @property {(ctx: CanvasRenderingContext2D, w: number, h: number, state: import('../ui/ux-motion.js').UiSurfaceSpringState) => void} [draw] Canvas draw callback.
 * @property {(panel: object) => void} [onClick] Triggered when a pointer press + release hits the panel.
 * @property {(hovered: boolean, panel: object) => void} [onHoverChange]
 */
/**
 * True 3D spatial interactive UI plane / card for Three.js scenes and viewWorlds.
 * Combines a dynamic `CanvasTexture` plane (flat or curved arc) with spring-driven 3D tilt/hover/press motion,
 * optional mounted 3D hologram preview object, and zero-allocation ray-quad pointer hit testing.
 *
 * @param {SpatialPanel3DOptions} options
 */
export function createSpatialPanel3D(options: SpatialPanel3DOptions): Readonly<{
    object3d: any;
    mesh: any;
    spring: Readonly<{
        setPointerNorm: (nx: any, ny: any) => void;
        setHover: (active: any, nx?: number, ny?: number) => void;
        setPressed: (active: any) => void;
        setFocused: (active: any) => void;
        setSelected: (active: any) => void;
        setDisabled: (value: any) => void;
        step: (dt: any) => import("../ui/ux-motion.js").UiSurfaceSpringState;
        snap: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
        isSettled: () => boolean;
        getState: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
        toCssTransform: () => string;
    }>;
    canvas: HTMLCanvasElement | null;
    texture: any;
    markDirty(): void;
    setPreviewObject(obj3d: any, opts?: {}): void;
    setBaseTransform(pos: any, rot: any): void;
    intersectRay(rayOrigin: any, rayDir: any): {
        distance: number;
        nx: any;
        ny: any;
    } | null;
    applyRayHit(hit: any): void;
    setPressed(active: any): void;
    triggerClick(): void;
    handlePointerMove(clientX: any, clientY: any, viewIndex?: null): {
        distance: number;
        nx: any;
        ny: any;
    } | null;
    handlePointerDown(clientX: any, clientY: any, viewIndex?: null): {
        distance: number;
        nx: any;
        ny: any;
    } | null;
    handlePointerUp(clientX: any, clientY: any, viewIndex?: null): boolean;
    update(dt: any): import("../ui/ux-motion.js").UiSurfaceSpringState;
    dispose(): void;
}>;
/**
 * @typedef {object} SpatialUiGroup3DOptions
 * @property {{ screenToRay?: (clientX: number, clientY: number, out?: object | null, viewIndex?: number | null) => { origin: { x: number, y: number, z: number }, direction: { x: number, y: number, z: number } } }} renderer
 * @property {ReturnType<typeof createSpatialPanel3D>[]} [panels=[]] Initial 3D panels.
 * @property {'manual' | 'fan'} [layout='manual'] `'fan'` arranges panels along a Balatro/Slay-the-Spire 3D arc with neighbor parting.
 * @property {number[]} [origin=[0, 0, 0]] Fan layout center `[x, y, z]`.
 * @property {number} [fanSpacing=1.15] Horizontal distance between fanned cards.
 * @property {number} [fanArcHeight=0.14] Vertical curve droop across the fan.
 * @property {number} [fanAngleRad=0.11] Z-tilt step per card from center.
 * @property {number} [neighborSpread=0.28] Horizontal push applied to neighbors of the hovered card.
 * @property {number} [hoverZBoost=0.22] Forward Z offset for the hovered card in fan mode.
 */
/**
 * Coordinates multiple `createSpatialPanel3D` objects with depth-sorted raycast picking
 * (only the frontmost panel under the pointer reacts) and optional 3D fanned-deck layout.
 *
 * @param {SpatialUiGroup3DOptions} options
 */
export function createSpatialUiGroup3D(options: SpatialUiGroup3DOptions): Readonly<{
    addPanel: (panel: any) => any;
    removePanel: (panel: any) => boolean;
    getPanels: () => Readonly<{
        object3d: any;
        mesh: any;
        spring: Readonly<{
            setPointerNorm: (nx: any, ny: any) => void;
            setHover: (active: any, nx?: number, ny?: number) => void;
            setPressed: (active: any) => void;
            setFocused: (active: any) => void;
            setSelected: (active: any) => void;
            setDisabled: (value: any) => void;
            step: (dt: any) => import("../ui/ux-motion.js").UiSurfaceSpringState;
            snap: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
            isSettled: () => boolean;
            getState: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
            toCssTransform: () => string;
        }>;
        canvas: HTMLCanvasElement | null;
        texture: any;
        markDirty(): void;
        setPreviewObject(obj3d: any, opts?: {}): void;
        setBaseTransform(pos: any, rot: any): void;
        intersectRay(rayOrigin: any, rayDir: any): {
            distance: number;
            nx: any;
            ny: any;
        } | null;
        applyRayHit(hit: any): void;
        setPressed(active: any): void;
        triggerClick(): void;
        handlePointerMove(clientX: any, clientY: any, viewIndex?: null): {
            distance: number;
            nx: any;
            ny: any;
        } | null;
        handlePointerDown(clientX: any, clientY: any, viewIndex?: null): {
            distance: number;
            nx: any;
            ny: any;
        } | null;
        handlePointerUp(clientX: any, clientY: any, viewIndex?: null): boolean;
        update(dt: any): import("../ui/ux-motion.js").UiSurfaceSpringState;
        dispose(): void;
    }>[];
    getHoveredIndex: () => number;
    handlePointerMove: (clientX: any, clientY: any, viewIndex?: null) => {
        index: number;
        panel: Readonly<{
            object3d: any;
            mesh: any;
            spring: Readonly<{
                setPointerNorm: (nx: any, ny: any) => void;
                setHover: (active: any, nx?: number, ny?: number) => void;
                setPressed: (active: any) => void;
                setFocused: (active: any) => void;
                setSelected: (active: any) => void;
                setDisabled: (value: any) => void;
                step: (dt: any) => import("../ui/ux-motion.js").UiSurfaceSpringState;
                snap: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
                isSettled: () => boolean;
                getState: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
                toCssTransform: () => string;
            }>;
            canvas: HTMLCanvasElement | null;
            texture: any;
            markDirty(): void;
            setPreviewObject(obj3d: any, opts?: {}): void;
            setBaseTransform(pos: any, rot: any): void;
            intersectRay(rayOrigin: any, rayDir: any): {
                distance: number;
                nx: any;
                ny: any;
            } | null;
            applyRayHit(hit: any): void;
            setPressed(active: any): void;
            triggerClick(): void;
            handlePointerMove(clientX: any, clientY: any, viewIndex?: null): {
                distance: number;
                nx: any;
                ny: any;
            } | null;
            handlePointerDown(clientX: any, clientY: any, viewIndex?: null): {
                distance: number;
                nx: any;
                ny: any;
            } | null;
            handlePointerUp(clientX: any, clientY: any, viewIndex?: null): boolean;
            update(dt: any): import("../ui/ux-motion.js").UiSurfaceSpringState;
            dispose(): void;
        }>;
        hit: {
            distance: number;
            nx: any;
            ny: any;
        } | null;
    } | null;
    handlePointerDown: (clientX: any, clientY: any, viewIndex?: null) => {
        index: number;
        panel: Readonly<{
            object3d: any;
            mesh: any;
            spring: Readonly<{
                setPointerNorm: (nx: any, ny: any) => void;
                setHover: (active: any, nx?: number, ny?: number) => void;
                setPressed: (active: any) => void;
                setFocused: (active: any) => void;
                setSelected: (active: any) => void;
                setDisabled: (value: any) => void;
                step: (dt: any) => import("../ui/ux-motion.js").UiSurfaceSpringState;
                snap: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
                isSettled: () => boolean;
                getState: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
                toCssTransform: () => string;
            }>;
            canvas: HTMLCanvasElement | null;
            texture: any;
            markDirty(): void;
            setPreviewObject(obj3d: any, opts?: {}): void;
            setBaseTransform(pos: any, rot: any): void;
            intersectRay(rayOrigin: any, rayDir: any): {
                distance: number;
                nx: any;
                ny: any;
            } | null;
            applyRayHit(hit: any): void;
            setPressed(active: any): void;
            triggerClick(): void;
            handlePointerMove(clientX: any, clientY: any, viewIndex?: null): {
                distance: number;
                nx: any;
                ny: any;
            } | null;
            handlePointerDown(clientX: any, clientY: any, viewIndex?: null): {
                distance: number;
                nx: any;
                ny: any;
            } | null;
            handlePointerUp(clientX: any, clientY: any, viewIndex?: null): boolean;
            update(dt: any): import("../ui/ux-motion.js").UiSurfaceSpringState;
            dispose(): void;
        }>;
        hit: {
            distance: number;
            nx: any;
            ny: any;
        } | null;
    } | null;
    handlePointerUp: (clientX: any, clientY: any, viewIndex?: null) => Readonly<{
        object3d: any;
        mesh: any;
        spring: Readonly<{
            setPointerNorm: (nx: any, ny: any) => void;
            setHover: (active: any, nx?: number, ny?: number) => void;
            setPressed: (active: any) => void;
            setFocused: (active: any) => void;
            setSelected: (active: any) => void;
            setDisabled: (value: any) => void;
            step: (dt: any) => import("../ui/ux-motion.js").UiSurfaceSpringState;
            snap: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
            isSettled: () => boolean;
            getState: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
            toCssTransform: () => string;
        }>;
        canvas: HTMLCanvasElement | null;
        texture: any;
        markDirty(): void;
        setPreviewObject(obj3d: any, opts?: {}): void;
        setBaseTransform(pos: any, rot: any): void;
        intersectRay(rayOrigin: any, rayDir: any): {
            distance: number;
            nx: any;
            ny: any;
        } | null;
        applyRayHit(hit: any): void;
        setPressed(active: any): void;
        triggerClick(): void;
        handlePointerMove(clientX: any, clientY: any, viewIndex?: null): {
            distance: number;
            nx: any;
            ny: any;
        } | null;
        handlePointerDown(clientX: any, clientY: any, viewIndex?: null): {
            distance: number;
            nx: any;
            ny: any;
        } | null;
        handlePointerUp(clientX: any, clientY: any, viewIndex?: null): boolean;
        update(dt: any): import("../ui/ux-motion.js").UiSurfaceSpringState;
        dispose(): void;
    }> | null;
    update: (dt: any) => void;
    dispose: () => void;
}>;
export type WorldHud3DAnchorOptions = {
    /**
     * World X.
     */
    x: number;
    /**
     * World Y.
     */
    y: number;
    /**
     * World Z.
     */
    z: number;
    /**
     * Short icon/numeric label (e.g. "♥ 3" or "⚡").
     */
    text?: string | undefined;
    /**
     * Optional bar ratio [0..1].
     */
    progress?: number | undefined;
    /**
     * Screen-space Y offset in pixels.
     */
    offsetY?: number | undefined;
    /**
     * Distance beyond which anchor hides.
     */
    maxDistance?: number | undefined;
    visible?: boolean | undefined;
};
export type WorldHud3DOptions = {
    /**
     * Three adapter exposing `worldToScreen`.
     */
    renderer: {
        worldToScreen: (x: number, y: number, z: number, out?: object | null, viewIndex?: number) => {
            x: number;
            y: number;
            ndcZ: number;
            visible: boolean;
        };
        camera?: {
            position?: {
                x: number;
                y: number;
                z: number;
            };
        };
    };
    /**
     * Screen overlay element (pointer-events: none).
     */
    container: HTMLElement;
    /**
     * Pooled DOM anchor count.
     */
    maxItems?: number | undefined;
    /**
     * Screen-space spring smoothing half-life (seconds); 0 disables smoothing.
     */
    halfLife?: number | undefined;
    /**
     * Optional custom DOM element factory per pooled slot.
     */
    createElement?: (() => HTMLElement) | undefined;
    /**
     * Optional custom updater.
     */
    renderElement?: ((el: HTMLElement, data: WorldHud3DAnchorOptions, screen: {
        x: number;
        y: number;
        scale: number;
        opacity: number;
    }) => void) | undefined;
};
export type SpatialPanel3DOptions = {
    /**
     * Three.js namespace.
     */
    THREE: object;
    /**
     * Three adapter (required for pointer ray picking).
     */
    renderer?: {
        screenToRay?: (clientX: number, clientY: number, out?: object | null, viewIndex?: number | null) => {
            origin: {
                x: number;
                y: number;
                z: number;
            };
            direction: {
                x: number;
                y: number;
                z: number;
            };
        };
    } | undefined;
    /**
     * World-space panel width.
     */
    width?: number | undefined;
    /**
     * World-space panel height.
     */
    height?: number | undefined;
    /**
     * Optional cylindrical arc radius (> 0 bends the panel toward the viewer).
     */
    curveRadius?: number | undefined;
    /**
     * Backing canvas width in pixels.
     */
    pixelWidth?: number | undefined;
    /**
     * Backing canvas height in pixels.
     */
    pixelHeight?: number | undefined;
    /**
     * Base local position `[x, y, z]`.
     */
    position?: number[] | undefined;
    /**
     * Base Euler rotation `[rx, ry, rz]` in radians.
     */
    rotation?: number[] | undefined;
    /**
     * 3D spring hover tilt in degrees.
     */
    maxTiltDeg?: number | undefined;
    /**
     * Forward Z / upward Y lift on hover in world units.
     */
    hoverLift?: number | undefined;
    /**
     * Gentle idle levitation amplitude in world units.
     */
    idleFloatAmp?: number | undefined;
    /**
     * Use `MeshStandardMaterial` instead of `MeshBasicMaterial`.
     */
    lit?: boolean | undefined;
    /**
     * Canvas draw callback.
     */
    draw?: ((ctx: CanvasRenderingContext2D, w: number, h: number, state: import("../ui/ux-motion.js").UiSurfaceSpringState) => void) | undefined;
    /**
     * Triggered when a pointer press + release hits the panel.
     */
    onClick?: ((panel: object) => void) | undefined;
    onHoverChange?: ((hovered: boolean, panel: object) => void) | undefined;
};
export type SpatialUiGroup3DOptions = {
    renderer: {
        screenToRay?: (clientX: number, clientY: number, out?: object | null, viewIndex?: number | null) => {
            origin: {
                x: number;
                y: number;
                z: number;
            };
            direction: {
                x: number;
                y: number;
                z: number;
            };
        };
    };
    /**
     * Initial 3D panels.
     */
    panels?: Readonly<{
        object3d: any;
        mesh: any;
        spring: Readonly<{
            setPointerNorm: (nx: any, ny: any) => void;
            setHover: (active: any, nx?: number, ny?: number) => void;
            setPressed: (active: any) => void;
            setFocused: (active: any) => void;
            setSelected: (active: any) => void;
            setDisabled: (value: any) => void;
            step: (dt: any) => import("../ui/ux-motion.js").UiSurfaceSpringState;
            snap: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
            isSettled: () => boolean;
            getState: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
            toCssTransform: () => string;
        }>;
        canvas: HTMLCanvasElement | null;
        texture: any;
        markDirty(): void;
        setPreviewObject(obj3d: any, opts?: {}): void;
        setBaseTransform(pos: any, rot: any): void;
        intersectRay(rayOrigin: any, rayDir: any): {
            distance: number;
            nx: any;
            ny: any;
        } | null;
        applyRayHit(hit: any): void;
        setPressed(active: any): void;
        triggerClick(): void;
        handlePointerMove(clientX: any, clientY: any, viewIndex?: null): {
            distance: number;
            nx: any;
            ny: any;
        } | null;
        handlePointerDown(clientX: any, clientY: any, viewIndex?: null): {
            distance: number;
            nx: any;
            ny: any;
        } | null;
        handlePointerUp(clientX: any, clientY: any, viewIndex?: null): boolean;
        update(dt: any): import("../ui/ux-motion.js").UiSurfaceSpringState;
        dispose(): void;
    }>[] | undefined;
    /**
     * `'fan'` arranges panels along a Balatro/Slay-the-Spire 3D arc with neighbor parting.
     */
    layout?: "manual" | "fan" | undefined;
    /**
     * Fan layout center `[x, y, z]`.
     */
    origin?: number[] | undefined;
    /**
     * Horizontal distance between fanned cards.
     */
    fanSpacing?: number | undefined;
    /**
     * Vertical curve droop across the fan.
     */
    fanArcHeight?: number | undefined;
    /**
     * Z-tilt step per card from center.
     */
    fanAngleRad?: number | undefined;
    /**
     * Horizontal push applied to neighbors of the hovered card.
     */
    neighborSpread?: number | undefined;
    /**
     * Forward Z offset for the hovered card in fan mode.
     */
    hoverZBoost?: number | undefined;
};
