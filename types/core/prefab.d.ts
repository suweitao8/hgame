/** Data-only Prefabs: no eval, class names or executable code in JSON. */
export class PrefabRegistry {
    /** @type {Map<string, PrefabComponentFactory>} */
    components: Map<string, PrefabComponentFactory>;
    /** @type {Map<string, PrefabDescriptor>} */
    prefabs: Map<string, PrefabDescriptor>;
    /**
     * @param {string} type Unique component type name.
     * @param {PrefabComponentFactory} factory
     * @returns {this}
     */
    registerComponent(type: string, factory: PrefabComponentFactory): this;
    /**
     * Validate and store a clone of a descriptor.
     * @param {string} name Unique prefab name.
     * @param {PrefabDescriptor} descriptor
     * @returns {this}
     */
    register(name: string, descriptor: PrefabDescriptor): this;
    /**
     * Build a fresh Entity tree from a registered prefab.
     * @param {string} name
     * @param {PrefabOverrides} [overrides]
     * @returns {import('./entity.js').Entity}
     */
    instantiate(name: string, overrides?: PrefabOverrides): import("./entity.js").Entity;
}
/**
 * Finite-number Entity transform fields (world units / radians).
 */
export type PrefabTransform = Partial<Record<"x" | "y" | "z" | "width" | "height" | "depth" | "anchorX" | "anchorY" | "rotationX" | "rotationY" | "rotationZ" | "scaleX" | "scaleY" | "scaleZ", number>>;
export type PrefabComponentDescriptor = {
    /**
     * Name registered with {@link PrefabRegistry#registerComponent}.
     */
    type: string;
    /**
     * Cloned (structuredClone) and passed to the factory.
     */
    properties?: Record<string, unknown>;
};
/**
 * Data-only prefab node.
 */
export type PrefabDescriptor = {
    name?: string;
    active?: boolean;
    transform?: PrefabTransform;
    components?: PrefabComponentDescriptor[];
    /**
     * Nesting limited to 32 levels.
     */
    children?: PrefabDescriptor[];
};
/**
 * Per-instance overrides.
 */
export type PrefabOverrides = {
    x?: number;
    y?: number;
    z?: number;
    name?: string;
    active?: boolean;
};
export type PrefabComponentFactory = (properties: Record<string, unknown>) => import("./component.js").Component;
