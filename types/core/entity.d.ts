/**
 * @typedef {object} EntityOptions
 * @property {string} [name=''] Lookup name used by {@link Scene#find}.
 * @property {number} [x=0] Local position, world units.
 * @property {number} [y=0]
 * @property {number} [z=0]
 * @property {boolean} [active=true]
 * @property {number} [width=0] Size in world units (pixels for 2D).
 * @property {number} [height=0]
 * @property {number} [depth=0]
 * @property {number} [anchorX=0.5] Normalized pivot (0..1).
 * @property {number} [anchorY=0.5] Normalized pivot (0..1).
 * @property {number} [rotationX=0] Euler rotation, radians (XYZ order).
 * @property {number} [rotationY=0] Radians.
 * @property {number} [rotationZ=0] Radians.
 * @property {number} [scaleX=1]
 * @property {number} [scaleY=1]
 * @property {number} [scaleZ=1]
 * @property {boolean} [interpolate=false] Render-interpolate between fixed ticks.
 * @property {import('./tags.js').TagInput | Record<string, number> | null} [tags=null] Initial gameplay tags.
 */
/** @typedef {{ x: number, y: number, z: number }} Vec3Like Mutable 3D point. */
/** Independent of Canvas, Three.js, DOM and any physics implementation. */
export class Entity {
    /** @param {EntityOptions} [options] */
    constructor({ name, x, y, z, active, width, height, depth, anchorX, anchorY, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, interpolate, tags }?: EntityOptions | undefined);
    id: number;
    name: string;
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    depth: number;
    anchorX: number;
    anchorY: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    interpolate: boolean;
    _prevX: number;
    _prevY: number;
    _prevZ: number;
    _prevRotationX: number;
    _prevRotationY: number;
    _prevRotationZ: number;
    _active: boolean;
    /** @type {Entity[]} */
    children: Entity[];
    /** @type {Component[]} */
    components: Component[];
    /** @type {Entity | null} */
    parent: Entity | null;
    /** @type {import('./scene.js').Scene | null} */
    scene: import("./scene.js").Scene | null;
    destroyed: boolean;
    /** @type {import('./tags.js').TagContainer | null} */
    _tags: import("./tags.js").TagContainer | null;
    /** Lazily created tag container. @returns {import('./tags.js').TagContainer} */
    get tags(): import("./tags.js").TagContainer;
    /**
     * @param {import('./tags.js').TagInput} tagOrTags
     * @param {number} [count=1] Stack count to add.
     * @returns {this}
     */
    addTag(tagOrTags: import("./tags.js").TagInput, count?: number | undefined): this;
    /**
     * @param {import('./tags.js').TagInput} tagOrTags
     * @param {number | boolean | { all?: boolean }} [count=1] Stacks to remove (`Infinity` / `true` removes all).
     * @returns {boolean} True when something was removed.
     */
    removeTag(tagOrTags: import("./tags.js").TagInput, count?: number | boolean | {
        all?: boolean;
    } | undefined): boolean;
    /**
     * @param {string} tag
     * @param {{ exact?: boolean }} [options] `exact` disables hierarchical matching.
     * @returns {boolean}
     */
    hasTag(tag: string, { exact }?: {
        exact?: boolean;
    } | undefined): boolean;
    /** @param {import('./tags.js').TagQuery} query @returns {boolean} */
    matchesTags(query: import("./tags.js").TagQuery): boolean;
    /** Reset interpolation history to the current transform (use after teleporting). @returns {this} */
    snapTransform(): this;
    /** @returns {void} */
    _capturePreviousTransform(): void;
    /** @param {boolean} value */
    set active(value: boolean);
    /** Local active flag. @type {boolean} */
    get active(): boolean;
    /** True when this entity, every ancestor and its Scene are active. @type {boolean} */
    get activeInHierarchy(): boolean;
    /** Attach a child entity (re-parenting if needed). @param {Entity} child @returns {Entity} */
    add(child: Entity): Entity;
    /**
     * Attach a component instance.
     * @template {Component} T
     * @param {T} component
     * @returns {T}
     */
    addComponent<T extends Component>(component: T): T;
    /**
     * @template {Component} T
     * @param {abstract new (...args: never[]) => T} Type
     * @returns {T | null}
     */
    getComponent<T extends Component>(Type: abstract new (...args: never[]) => T): T | null;
    /**
     * @template {Component} T
     * @param {abstract new (...args: never[]) => T} Type
     * @returns {T[]}
     */
    getComponents<T extends Component>(Type: abstract new (...args: never[]) => T): T[];
    /** @param {import('./scene.js').Scene | null} scene @returns {void} */
    _bindScene(scene: import("./scene.js").Scene | null): void;
    /** @returns {void} */
    _deactivate(): void;
    /** @returns {void} */
    _syncComponents(): void;
    /**
     * Column-major 4x4 world matrix (XYZ Euler TRS). View-layer only; never feed back into deterministic sims.
     * @param {Float64Array} [out] 16-element destination (allocated when omitted).
     * @returns {Float64Array} `out`
     */
    worldMatrixInto(out?: Float64Array | undefined): Float64Array;
    /** Newly allocated world matrix. @returns {Float64Array} */
    worldMatrix(): Float64Array;
    /**
     * @template {Vec3Like} [T=Vec3Like]
     * @param {T | null} [out] Destination to fill (allocation-free).
     * @returns {T | Vec3Like}
     */
    worldPosition<T extends Vec3Like = Vec3Like>(out?: T | null | undefined): T | Vec3Like;
    /**
     * World matrix blended between the previous and current fixed tick.
     * @param {number} [alpha=1] 0..1 blend factor (`app.renderAlpha`).
     * @param {Float64Array} [out]
     * @returns {Float64Array}
     */
    interpolatedWorldMatrixInto(alpha?: number | undefined, out?: Float64Array | undefined): Float64Array;
    /**
     * @template {Vec3Like} [T=Vec3Like]
     * @param {number} [alpha=1] 0..1 blend factor.
     * @param {T | null} [out]
     * @returns {T | Vec3Like}
     */
    interpolatedWorldPosition<T extends Vec3Like = Vec3Like>(alpha?: number | undefined, out?: T | null | undefined): T | Vec3Like;
    /** Remove from the parent / Scene without destroying. @returns {this} */
    detach(): this;
    /** Destroy the entity, its children and components. @returns {boolean} False if already destroyed. */
    destroy(): boolean;
}
export type EntityOptions = {
    /**
     * Lookup name used by {@link Scene#find}.
     */
    name?: string | undefined;
    /**
     * Local position, world units.
     */
    x?: number | undefined;
    y?: number | undefined;
    z?: number | undefined;
    active?: boolean | undefined;
    /**
     * Size in world units (pixels for 2D).
     */
    width?: number | undefined;
    height?: number | undefined;
    depth?: number | undefined;
    /**
     * Normalized pivot (0..1).
     */
    anchorX?: number | undefined;
    /**
     * Normalized pivot (0..1).
     */
    anchorY?: number | undefined;
    /**
     * Euler rotation, radians (XYZ order).
     */
    rotationX?: number | undefined;
    /**
     * Radians.
     */
    rotationY?: number | undefined;
    /**
     * Radians.
     */
    rotationZ?: number | undefined;
    scaleX?: number | undefined;
    scaleY?: number | undefined;
    scaleZ?: number | undefined;
    /**
     * Render-interpolate between fixed ticks.
     */
    interpolate?: boolean | undefined;
    /**
     * Initial gameplay tags.
     */
    tags?: Record<string, number> | import("./tags.js").TagInput | null | undefined;
};
/**
 * Mutable 3D point.
 */
export type Vec3Like = {
    x: number;
    y: number;
    z: number;
};
import { Component } from './component.js';
