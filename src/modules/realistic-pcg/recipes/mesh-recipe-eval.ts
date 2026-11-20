import * as THREE from 'three';
import {
  resolveBoolean,
  resolveNumber,
  resolveParamValue,
  resolveVec3,
  type ParamMap,
  type ParamValue,
} from '../core/safe-expr.js';
import {
  appendRawMesh,
  buildBufferGeometryFromRaw,
  createRawMeshData,
  recomputeMetricUVs,
  type RawMeshData,
} from '../geometry/metric-uv.js';
import {
  opBeveledBox,
  opBeveledWallOpening,
  opCorrugatedPanel,
  opCylinder,
  opDisplacedRock,
  opExtrudeProfile,
  opPipeSegment,
  opStairs,
} from '../geometry/primitive-ops.js';
import type { MeshPartSpec, MeshRecipe } from './schema-types.js';

export interface EvaluatedMeshResult {
  geometry: THREE.BufferGeometry;
  triangleCount: number;
  partCount: number;
  partTriangles: Array<{ id: string; triangles: number }>;
  materialIdsUsed: number[];
}

export interface MeshEvalContext {
  recipes: Map<string, MeshRecipe>;
  resolveMaterialId: (materialName: string) => number;
}

function applyTransformToRaw(
  raw: RawMeshData,
  pos: [number, number, number],
  rot: [number, number, number],
  scale: [number, number, number]
): void {
  const mat = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  mat.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q, new THREE.Vector3(scale[0], scale[1], scale[2]));

  const e = mat.elements;
  const v = new THREE.Vector3();
  const nMat = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    q,
    new THREE.Vector3(1 / (scale[0] || 1), 1 / (scale[1] || 1), 1 / (scale[2] || 1))
  );
  const ne = nMat.elements;

  for (let i = 0; i < raw.positions.length; i += 3) {
    const x = raw.positions[i]!;
    const y = raw.positions[i + 1]!;
    const z = raw.positions[i + 2]!;
    v.set(
      e[0]! * x + e[4]! * y + e[8]! * z + e[12]!,
      e[1]! * x + e[5]! * y + e[9]! * z + e[13]!,
      e[2]! * x + e[6]! * y + e[10]! * z + e[14]!
    );
    raw.positions[i] = v.x;
    raw.positions[i + 1] = v.y;
    raw.positions[i + 2] = v.z;

    const nx = raw.normals[i]!;
    const ny = raw.normals[i + 1]!;
    const nz = raw.normals[i + 2]!;
    const tnx = ne[0]! * nx + ne[4]! * ny + ne[8]! * nz;
    const tny = ne[1]! * nx + ne[5]! * ny + ne[9]! * nz;
    const tnz = ne[2]! * nx + ne[6]! * ny + ne[10]! * nz;
    const nLen = Math.hypot(tnx, tny, tnz) || 1;
    raw.normals[i] = tnx / nLen;
    raw.normals[i + 1] = tny / nLen;
    raw.normals[i + 2] = tnz / nLen;
  }

  // Handle negative scale mirroring by flipping triangle winding
  if (scale[0] * scale[1] * scale[2] < 0) {
    for (let i = 0; i < raw.indices.length; i += 3) {
      const tmp = raw.indices[i + 1]!;
      raw.indices[i + 1] = raw.indices[i + 2]!;
      raw.indices[i + 2] = tmp;
    }
  }
}

function applyGroundAO(raw: RawMeshData, aoFloor = 0.42, heightSpan = 0.75): void {
  for (let i = 0; i < raw.positions.length; i += 3) {
    const y = raw.positions[i + 1]!;
    const t = Math.max(0, Math.min(1, y / heightSpan));
    const factor = aoFloor + (1 - aoFloor) * Math.sqrt(t);
    raw.colors[i] = Math.min(raw.colors[i]!, factor);
  }
}

function cloneRaw(raw: RawMeshData): RawMeshData {
  return {
    positions: raw.positions.slice(),
    normals: raw.normals.slice(),
    uvs: raw.uvs.slice(),
    colors: raw.colors.slice(),
    materialIds: raw.materialIds.slice(),
    indices: raw.indices.slice(),
  };
}

function resolveSlotMaterialName(
  ref: string | undefined,
  slots: Record<string, string>,
  overrides?: Record<string, string>
): string {
  if (!ref) {
    const first = Object.values(slots)[0];
    if (!first) throw new Error('No material specified and materialSlots is empty');
    return first;
  }
  if (ref.startsWith('$')) {
    const slotKey = ref.slice(1);
    if (overrides && overrides[slotKey]) {
      const ov = overrides[slotKey]!;
      return ov.startsWith('$') ? slots[ov.slice(1)] ?? ov : ov;
    }
    const found = slots[slotKey];
    if (!found) throw new Error(`Missing materialSlot "${slotKey}"`);
    return found;
  }
  return ref;
}

function evaluateRecipeRaw(
  recipe: MeshRecipe,
  ctx: MeshEvalContext,
  paramOverrides: ParamMap | undefined,
  materialOverrides: Record<string, string> | undefined,
  visitStack: Set<string>,
  partTriangles: Array<{ id: string; triangles: number }>
): RawMeshData {
  if (visitStack.has(recipe.id)) {
    throw new Error(`Cyclic mesh ref detected at "${recipe.id}"`);
  }
  visitStack.add(recipe.id);

  const params: ParamMap = { ...(recipe.params ?? {}), ...(paramOverrides ?? {}) };
  const mergedSlots: Record<string, string> = { ...recipe.materialSlots };
  if (materialOverrides) {
    for (const [k, v] of Object.entries(materialOverrides)) {
      mergedSlots[k] = v;
    }
  }

  const out = createRawMeshData();

  for (const part of recipe.parts) {
    if (part.when !== undefined && !resolveBoolean(part.when, params, true)) {
      continue;
    }

    const basePartRaw = evaluateSinglePart(part, recipe, params, mergedSlots, ctx, visitStack, partTriangles);

    // 1. Optional repeat (linear or circular)
    const repeatedRaw = createRawMeshData();
    const count = part.repeat ? Math.max(1, Math.round(resolveNumber(part.repeat.count, params, 1))) : 1;
    const stepPos = part.repeat?.stepPos ? resolveVec3(part.repeat.stepPos, params, [0, 0, 0]) : [0, 0, 0];
    const stepRot = part.repeat?.stepRot ? resolveVec3(part.repeat.stepRot, params, [0, 0, 0]) : [0, 0, 0];
    const circleRadius = part.repeat?.radius !== undefined ? resolveNumber(part.repeat.radius, params, 0) : 0;
    const angleStep = part.repeat?.angleStep !== undefined ? resolveNumber(part.repeat.angleStep, params, 0) : 0;

    for (let rIdx = 0; rIdx < count; rIdx++) {
      const copy = count === 1 ? basePartRaw : cloneRaw(basePartRaw);
      if (part.repeat) {
        let px = stepPos[0]! * rIdx;
        let py = stepPos[1]! * rIdx;
        let pz = stepPos[2]! * rIdx;
        let rx = stepRot[0]! * rIdx;
        let ry = stepRot[1]! * rIdx;
        let rz = stepRot[2]! * rIdx;
        if (circleRadius !== 0 && angleStep !== 0) {
          const ang = angleStep * rIdx;
          px += Math.cos(ang) * circleRadius;
          pz += Math.sin(ang) * circleRadius;
          ry += -ang;
        }
        applyTransformToRaw(copy, [px, py, pz], [rx, ry, rz], [1, 1, 1]);
      }
      appendRawMesh(repeatedRaw, copy);
    }

    // 2. Apply part transform before mirroring so recipe offsets (e.g. +X corner legs) mirror across the recipe axis
    const pos = resolveVec3(part.transform?.pos, params, [0, 0, 0]);
    const rot = resolveVec3(part.transform?.rot, params, [0, 0, 0]);
    const scale = resolveVec3(part.transform?.scale, params, [1, 1, 1]);
    if (
      pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0 ||
      rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0 ||
      scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1
    ) {
      applyTransformToRaw(repeatedRaw, pos, rot, scale);
    }

    // 3. Optional mirror across recipe axis
    const finalPartRaw = createRawMeshData();
    if (part.mirror) {
      if (part.mirror.keepOriginal !== false) {
        appendRawMesh(finalPartRaw, repeatedRaw);
      }
      const m = cloneRaw(repeatedRaw);
      const sx = part.mirror.axis === 'x' ? -1 : 1;
      const sy = part.mirror.axis === 'y' ? -1 : 1;
      const sz = part.mirror.axis === 'z' ? -1 : 1;
      applyTransformToRaw(m, [0, 0, 0], [0, 0, 0], [sx, sy, sz]);
      appendRawMesh(finalPartRaw, m);
    } else {
      appendRawMesh(finalPartRaw, repeatedRaw);
    }

    // Recompute metric UVs in recipe physical meter space when non-unit scale or rotation occurred
    if (part.op !== 'displaced_rock' && part.op !== 'cylinder') {
      recomputeMetricUVs(finalPartRaw);
    }

    if (part.vertexMeta?.groundAO && resolveBoolean(part.vertexMeta.groundAO, params, false)) {
      const aoFloor = resolveNumber(part.vertexMeta.aoFloor, params, 0.42);
      applyGroundAO(finalPartRaw, aoFloor, 0.65);
    }

    partTriangles.push({ id: `${recipe.id}:${part.id}`, triangles: finalPartRaw.indices.length / 3 });
    appendRawMesh(out, finalPartRaw);
  }

  visitStack.delete(recipe.id);
  return out;
}

function evaluateSinglePart(
  part: MeshPartSpec,
  parentRecipe: MeshRecipe,
  params: ParamMap,
  mergedSlots: Record<string, string>,
  ctx: MeshEvalContext,
  visitStack: Set<string>,
  partTriangles: Array<{ id: string; triangles: number }>
): RawMeshData {
  if (part.op === 'ref') {
    if (!part.ref) throw new Error(`Part "${part.id}" in "${parentRecipe.id}" is op="ref" without ref target`);
    const target = ctx.recipes.get(part.ref);
    if (!target) throw new Error(`Unknown ref mesh "${part.ref}" in "${parentRecipe.id}"`);

    const subParams: ParamMap = {};
    if (part.params) {
      for (const [k, v] of Object.entries(part.params)) {
        subParams[k] = resolveParamValue<ParamValue>(v, params);
      }
    }
    const subMatOverrides: Record<string, string> = {};
    if (part.materialOverrides) {
      for (const [k, v] of Object.entries(part.materialOverrides)) {
        subMatOverrides[k] = resolveSlotMaterialName(v, mergedSlots);
      }
    }
    return evaluateRecipeRaw(target, ctx, subParams, subMatOverrides, visitStack, partTriangles);
  }

  const matName = resolveSlotMaterialName(part.material, mergedSlots);
  const materialId = ctx.resolveMaterialId(matName);
  const edgeWear = resolveNumber(part.vertexMeta?.edgeWear, params, 0.5);
  const wetness = resolveNumber(part.vertexMeta?.wetness, params, 0.0);
  const ao = 1.0;
  const args = part.args ?? {};

  switch (part.op) {
    case 'beveled_box':
      return opBeveledBox(args, params, materialId, edgeWear, ao, wetness);
    case 'beveled_wall_opening':
      return opBeveledWallOpening(args, params, materialId, edgeWear, ao, wetness);
    case 'cylinder':
      return opCylinder(args, params, materialId, edgeWear, ao, wetness);
    case 'stairs':
      return opStairs(args, params, materialId, edgeWear, ao, wetness);
    case 'displaced_rock':
      return opDisplacedRock(args, params, materialId, edgeWear, ao, wetness);
    case 'extrude_profile':
      return opExtrudeProfile(args, params, materialId, edgeWear, ao, wetness);
    case 'corrugated_panel':
      return opCorrugatedPanel(args, params, materialId, edgeWear, ao, wetness);
    case 'pipe_segment':
      return opPipeSegment(args, params, materialId, edgeWear, ao, wetness);
    default:
      throw new Error(`Unsupported mesh op "${String(part.op)}"`);
  }
}

export function evaluateMeshRecipe(
  recipe: MeshRecipe,
  ctx: MeshEvalContext,
  options: {
    params?: ParamMap;
    materialOverrides?: Record<string, string>;
  } = {}
): EvaluatedMeshResult {
  const partTriangles: Array<{ id: string; triangles: number }> = [];
  const raw = evaluateRecipeRaw(
    recipe,
    ctx,
    options.params,
    options.materialOverrides,
    new Set<string>(),
    partTriangles
  );
  const geometry = buildBufferGeometryFromRaw(raw);
  const matSet = new Set<number>();
  for (const m of raw.materialIds) matSet.add(m);

  return {
    geometry,
    triangleCount: raw.indices.length / 3,
    partCount: partTriangles.length,
    partTriangles,
    materialIdsUsed: [...matSet],
  };
}
