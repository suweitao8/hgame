/**
 * @param {ProceduralModelOptions} options
 * @returns {ProceduralModelSlots}
 */
export function createProceduralModelSlots({ THREE, slots, materialPalette, GLTFLoader, projectBaseUrl, }?: ProceduralModelOptions): ProceduralModelSlots;
/**
 * Minimal structural Three.js Object3D.
 */
export type ProceduralObject3D = {
    name: string;
    clone: (recursive?: boolean) => ProceduralObject3D;
    updateMatrixWorld: (force?: boolean) => void;
    traverse: (callback: (object: object) => void) => void;
};
/**
 * The subset of the THREE namespace used for procedural shapes.
 */
export type ProceduralModelThree = {
    Group: new () => ProceduralObject3D;
    BoxGeometry: new (width: number, height: number, depth: number) => {
        dispose(): void;
    };
    CylinderGeometry: new (radiusTop: number, radiusBottom: number, height: number, radialSegments: number) => {
        dispose(): void;
    };
    IcosahedronGeometry: new (radius: number, detail: number) => {
        dispose(): void;
    };
    Mesh: new (geometry: object, material: object | object[]) => ProceduralObject3D;
    InstancedMesh: new (geometry: object, material: object | object[], count: number) => ProceduralObject3D;
    Object3D: new () => object;
    Matrix4: new () => object;
};
export type ProceduralShape = "box" | "slab" | "stair" | "column" | "foliage" | "fence" | "door" | "window" | "bench" | "lantern" | "arch" | "crate" | "barrel" | "crystal" | "rock" | "pine" | "turret";
export type ProceduralSlotDefinition = {
    shape: ProceduralShape;
    /**
     * Material-palette name.
     */
    material: string;
    /**
     * Accent palette name; defaults to `material`.
     */
    accent?: string | undefined;
    /**
     * Palette name for the top face of 'box'.
     */
    topMaterial?: string | undefined;
    /**
     * Width, height, depth in world units (each 0..100].
     */
    size?: [number, number, number] | undefined;
    /**
     * Relative `assets/models/<name>.glb` replacement.
     */
    replacement?: string | null | undefined;
};
export type ProceduralSlotSpec = {
    shape: ProceduralShape;
    material: string;
    accent: string;
    topMaterial: string | null;
    size: [number, number, number];
    replacement: string | null;
};
export type ProceduralModelOptions = {
    THREE: ProceduralModelThree;
    /**
     * Keys match `group.name` (lowercase dotted ids).
     */
    slots: Record<string, ProceduralSlotDefinition>;
    /**
     * e.g. from createWorldMaterialPalette.
     */
    materialPalette: {
        get(name: string): object;
    };
    /**
     * Only needed if a replacement is configured.
     */
    GLTFLoader?: (new () => {
        loadAsync(url: string): Promise<{
            scene: ProceduralObject3D;
            animations?: unknown[];
        }>;
    }) | undefined;
    /**
     * Base for resolving replacement URLs.
     */
    projectBaseUrl?: string | undefined;
};
export type ProceduralPlacement = {
    /**
     * World units.
     */
    x?: number | undefined;
    y?: number | undefined;
    z?: number | undefined;
    /**
     * Radians.
     */
    rotationY?: number | undefined;
    /**
     * Uniform scale, > 0.
     */
    scale?: number | undefined;
};
export type ProceduralModelSlots = {
    /**
     * Copy of a slot definition.
     */
    get: (id: string) => ProceduralSlotSpec;
    /**
     * Shared, cached prototype.
     */
    prototype: (id: string) => Promise<ProceduralObject3D>;
    /**
     * Deep clone of the prototype.
     */
    instantiate: (id: string) => Promise<ProceduralObject3D>;
    /**
     * 1..20000 placements; InstancedMesh or fallback Group.
     */
    instantiateBatch: (id: string, placements: Array<ProceduralPlacement | {
        isMatrix4: true;
    }>) => Promise<ProceduralObject3D>;
    setReplacement: (id: string, url: string | null) => void;
    dispose: () => Promise<void>;
};
