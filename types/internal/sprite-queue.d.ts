/**
 * Shared 2D draw queue. Cache world transforms for the active ancestor chain
 * during collection. A camera pass reads actual transforms again on entry.
 * @param {{ Sprite2D: typeof import('../integrations/canvas2d.js').Sprite2D,
 *   SpriteCrowd2D: typeof import('../integrations/canvas2d.js').SpriteCrowd2D,
 *   cull: boolean, interpolate: boolean, absoluteTextSize?: boolean }} options
 */
export function createSpriteQueue({ Sprite2D, SpriteCrowd2D, cull, interpolate, absoluteTextSize }: {
    Sprite2D: typeof import("../integrations/canvas2d.js").Sprite2D;
    SpriteCrowd2D: typeof import("../integrations/canvas2d.js").SpriteCrowd2D;
    cull: boolean;
    interpolate: boolean;
    absoluteTextSize?: boolean;
}): {
    readonly count: number;
    gather: (roots: readonly Entity[], alpha: number, viewBounds: ViewBounds, stats: QueueStats) => QueueItem[];
    clear: () => void;
    dispose(): void;
};
export type Sprite = import("../integrations/canvas2d.js").Sprite2D;
export type Crowd = import("../integrations/canvas2d.js").SpriteCrowd2D;
export type ViewBounds = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
};
export type QueueStats = {
    culled: number;
    sorted: boolean;
};
export type QueueItem = {
    kind: 0 | 1 | 2;
    entity: Entity | null;
    sprite: Sprite | Crowd | null;
    agentIndex: number;
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
    layer: number;
    z: number;
    ySort: boolean;
};
import { Entity } from '../core/entity.js';
