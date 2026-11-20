import type { ParamMap, ParamValue } from '../core/safe-expr.js';

export type MaterialNodeOp =
  | 'fbm'
  | 'worley'
  | 'brick_pattern'
  | 'wood_grain'
  | 'plank_pattern'
  | 'stripes'
  | 'speckle'
  | 'corrugated_wave'
  | 'edge_wear_mask'
  | 'vertical_streak'
  | 'rivet_grid'
  | 'sand_ripples'
  | 'fabric_weave'
  | 'remap'
  | 'clamp'
  | 'invert'
  | 'power'
  | 'domain_warp'
  | 'blur'
  | 'height_to_normal'
  | 'blend'
  | 'mix_scalar'
  | 'mix_color'
  | 'color_ramp';

export interface MaterialNodeSpec {
  id: string;
  op: MaterialNodeOp;
  args: Record<string, unknown>;
}

export type InlineMaterialOutput =
  | string
  | number
  | {
      op: MaterialNodeOp;
      args?: Record<string, unknown>;
      [key: string]: unknown;
    };

export interface MaterialOutputsSpec {
  albedo: InlineMaterialOutput;
  height: InlineMaterialOutput;
  normal: InlineMaterialOutput;
  ao: InlineMaterialOutput;
  roughness: InlineMaterialOutput;
  metalness: InlineMaterialOutput;
  porosity: InlineMaterialOutput;
}

export interface MaterialRecipe {
  format: 'hgame.material';
  version: 1;
  id: string;
  meta: {
    category: string;
    tileMeters: number;
    seed: number;
  };
  params?: ParamMap;
  nodes: MaterialNodeSpec[];
  outputs: MaterialOutputsSpec;
}

export type MeshPartOp =
  | 'beveled_box'
  | 'beveled_wall_opening'
  | 'cylinder'
  | 'stairs'
  | 'displaced_rock'
  | 'extrude_profile'
  | 'corrugated_panel'
  | 'pipe_segment'
  | 'ref';

export interface PartTransformSpec {
  pos?: [number | string, number | string, number | string];
  rot?: [number | string, number | string, number | string]; // radians [x, y, z]
  scale?: [number | string, number | string, number | string];
}

export interface PartRepeatSpec {
  count: number | string;
  stepPos?: [number | string, number | string, number | string];
  stepRot?: [number | string, number | string, number | string];
  radius?: number | string;
  angleStep?: number | string;
}

export interface PartMirrorSpec {
  axis: 'x' | 'y' | 'z';
  keepOriginal?: boolean;
}

export interface PartVertexMetaSpec {
  edgeWear?: number | string;
  wetness?: number | string;
  groundAO?: boolean | string;
  aoFloor?: number | string;
}

export interface MeshPartSpec {
  id: string;
  op: MeshPartOp;
  when?: boolean | string;
  material?: string;
  ref?: string;
  params?: Record<string, ParamValue | string>;
  materialOverrides?: Record<string, string>;
  args?: Record<string, unknown>;
  transform?: PartTransformSpec;
  repeat?: PartRepeatSpec;
  mirror?: PartMirrorSpec;
  vertexMeta?: PartVertexMetaSpec;
}

export interface MeshRecipe {
  format: 'hgame.mesh';
  version: 1;
  id: string;
  meta: {
    unit: 'meter';
    collider: 'auto_boxes' | 'trimesh' | 'none';
  };
  params?: ParamMap;
  materialSlots: Record<string, string>;
  parts: MeshPartSpec[];
}

export interface ManifestEntry {
  id: string;
  path: string;
}

export interface ProceduralManifest {
  format: 'hgame.manifest';
  version: 1;
  materials: ManifestEntry[];
  meshes: ManifestEntry[];
}

export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

export interface TriMeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}
