import {
  fbm2DPeriodic,
  fillFbm2DRows,
  hash2i,
  perlin2DPeriodic,
  worley2DPeriodic,
  type WorleySample,
} from '../core/prng.js';
import { resolveBoolean, resolveNumber, type ParamMap } from '../core/safe-expr.js';
import type {
  InlineMaterialOutput,
  MaterialNodeOp,
  MaterialNodeSpec,
  MaterialRecipe,
} from './schema-types.js';
import { parseHexColor, srgbChannelToLinear } from './schema-validator.js';

export interface BakedMaterialBuffers {
  id: string;
  size: number;
  albedoData: Uint8Array; // RGBA sRGB + Height in A
  normalData: Uint8Array; // RGBA Linear tangent normal + 255 in A
  ormData: Uint8Array; // RGBA Linear (R=AO, G=Roughness, B=Metalness, A=Porosity)
  stats: {
    minRoughness: number;
    maxRoughness: number;
    minLinearLuma: number;
    maxLinearLuma: number;
  };
}

type BufferValue =
  | { kind: 'scalar'; data: Float32Array }
  | { kind: 'color'; data: Float32Array }; // length = size * size * 3 (sRGB 0..1)

interface ExecNode {
  id: string;
  op: MaterialNodeOp;
  args: Record<string, unknown>;
}

const LUT_SIZE = 4096;
const SRGB_TO_LIN_LUT = new Float32Array(LUT_SIZE);
const LIN_TO_SRGB_LUT = new Float32Array(LUT_SIZE);
for (let i = 0; i < LUT_SIZE; i++) {
  const x = i / (LUT_SIZE - 1);
  SRGB_TO_LIN_LUT[i] = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  LIN_TO_SRGB_LUT[i] = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function fastSrgbToLinear(s: number): number {
  const idx = s <= 0 ? 0 : s >= 1 ? LUT_SIZE - 1 : (s * (LUT_SIZE - 1) + 0.5) | 0;
  return SRGB_TO_LIN_LUT[idx]!;
}

function linearToSrgbChannel(lin: number): number {
  const idx = lin <= 0 ? 0 : lin >= 1 ? LUT_SIZE - 1 : (lin * (LUT_SIZE - 1) + 0.5) | 0;
  return LIN_TO_SRGB_LUT[idx]!;
}

function hexToSrgbNorm(hex: string): [number, number, number] {
  const rgb = parseHexColor(hex);
  if (!rgb) throw new Error(`Invalid hex color "${hex}"`);
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

function hexToLinear(hex: string): [number, number, number] {
  const rgb = parseHexColor(hex);
  if (!rgb) throw new Error(`Invalid hex color "${hex}"`);
  return [
    srgbChannelToLinear(rgb[0]),
    srgbChannelToLinear(rgb[1]),
    srgbChannelToLinear(rgb[2]),
  ];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function wrapIdx(i: number, n: number): number {
  const r = i % n;
  return r < 0 ? r + n : r;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface MaterialBakeJob {
  readonly id: string;
  readonly size: number;
  step(budgetMs?: number): boolean;
  getResult(): BakedMaterialBuffers;
}

export function createMaterialBakeJob(
  recipe: MaterialRecipe,
  size: number,
  paramOverrides?: ParamMap
): MaterialBakeJob {
  const params: ParamMap = { ...(recipe.params ?? {}), ...(paramOverrides ?? {}) };
  const seed = recipe.meta.seed | 0;
  const pixelCount = size * size;
  const invSize = 1 / size;

  const ports = new Map<string, BufferValue>();
  const execList: ExecNode[] = [];
  const added = new Set<string>();

  // Topologically sort nodes based on explicit dependencies
  const nodeById = new Map<string, MaterialNodeSpec>();
  for (const n of recipe.nodes) nodeById.set(n.id, n);

  const visit = (id: string) => {
    if (added.has(id)) return;
    const node = nodeById.get(id);
    if (!node) return;
    for (const k of ['input', 'a', 'b', 'mask', 'warpX', 'warpY']) {
      const ref = node.args[k];
      if (typeof ref === 'string' && !ref.startsWith('#') && !ref.startsWith('$')) {
        visit(ref.split('.')[0]!);
      }
    }
    added.add(id);
    execList.push({ id: node.id, op: node.op, args: node.args });
  };
  for (const n of recipe.nodes) visit(n.id);

  // Append inline output ops
  const outputInlineId: Partial<Record<keyof MaterialRecipe['outputs'], string>> = {};
  const outputKeys: Array<keyof MaterialRecipe['outputs']> = [
    'albedo',
    'height',
    'normal',
    'ao',
    'roughness',
    'metalness',
    'porosity',
  ];
  for (const ok of outputKeys) {
    const spec: InlineMaterialOutput = recipe.outputs[ok];
    if (spec && typeof spec === 'object') {
      const synId = `__out_${ok}`;
      const args = spec.args ? spec.args : { ...spec };
      execList.push({ id: synId, op: spec.op, args });
      outputInlineId[ok] = synId;
    }
  }

  const resolveScalarBuf = (ref: unknown, fallback = 0): Float32Array | number => {
    if (typeof ref === 'number') return ref;
    if (typeof ref === 'string') {
      if (ref.startsWith('$') || ref.startsWith('expr:')) {
        return resolveNumber(ref, params, fallback);
      }
      const p = ports.get(ref);
      if (!p) throw new Error(`Missing material port "${ref}" in "${recipe.id}"`);
      if (p.kind !== 'scalar') {
        throw new Error(`Expected scalar port for "${ref}", got color`);
      }
      return p.data;
    }
    return fallback;
  };

  const resolveColorOrScalarBuf = (
    ref: unknown
  ): { kind: 'const_color'; rgb: [number, number, number] } | { kind: 'color'; data: Float32Array } | { kind: 'scalar'; data: Float32Array } | { kind: 'const_scalar'; val: number } => {
    if (typeof ref === 'number') return { kind: 'const_scalar', val: ref };
    if (typeof ref === 'string') {
      if (ref.startsWith('#')) {
        return { kind: 'const_color', rgb: hexToSrgbNorm(ref) };
      }
      if (ref.startsWith('$') || ref.startsWith('expr:')) {
        return { kind: 'const_scalar', val: resolveNumber(ref, params) };
      }
      const p = ports.get(ref);
      if (!p) throw new Error(`Missing material port "${ref}" in "${recipe.id}"`);
      return p;
    }
    return { kind: 'const_scalar', val: 0 };
  };

  let nodeIdx = 0;
  let rowIdx = 0;
  let blurPhase = 0; // 0 = horiz, 1 = vert
  let blurTmp: Float32Array | null = null;
  let curBuffers: Record<string, Float32Array> = {};
  let packedResult: BakedMaterialBuffers | null = null;
  let packRow = 0;
  let albedoOut: Uint8Array | null = null;
  let normalOut: Uint8Array | null = null;
  let ormOut: Uint8Array | null = null;
  let minRough = 1;
  let maxRough = 0;
  let minLuma = 1;
  let maxLuma = 0;

  const CHUNK_ROWS = 16;
  const worleyScratch: WorleySample = { f1: 0, f2: 0, f2MinusF1: 0, cellRand: 0 };

  function initNodeBuffers(node: ExecNode): void {
    curBuffers = {};
    blurPhase = 0;
    blurTmp = null;
    if (node.op === 'worley') {
      const main = new Float32Array(pixelCount);
      const f1 = new Float32Array(pixelCount);
      const f2 = new Float32Array(pixelCount);
      const f2mf1 = new Float32Array(pixelCount);
      const cellRand = new Float32Array(pixelCount);
      const edge = new Float32Array(pixelCount);
      curBuffers = { main, f1, f2, f2mf1, cellRand, edge };
      ports.set(node.id, { kind: 'scalar', data: main });
      ports.set(`${node.id}.f1`, { kind: 'scalar', data: f1 });
      ports.set(`${node.id}.f2`, { kind: 'scalar', data: f2 });
      ports.set(`${node.id}.f2_minus_f1`, { kind: 'scalar', data: f2mf1 });
      ports.set(`${node.id}.cellRand`, { kind: 'scalar', data: cellRand });
      ports.set(`${node.id}.edge`, { kind: 'scalar', data: edge });
    } else if (node.op === 'brick_pattern') {
      const height = new Float32Array(pixelCount);
      const mask = new Float32Array(pixelCount);
      const cellRand = new Float32Array(pixelCount);
      curBuffers = { height, mask, cellRand };
      ports.set(node.id, { kind: 'scalar', data: height });
      ports.set(`${node.id}.height`, { kind: 'scalar', data: height });
      ports.set(`${node.id}.mask`, { kind: 'scalar', data: mask });
      ports.set(`${node.id}.cellRand`, { kind: 'scalar', data: cellRand });
    } else if (node.op === 'wood_grain') {
      const height = new Float32Array(pixelCount);
      const grain = new Float32Array(pixelCount);
      const mask = new Float32Array(pixelCount);
      curBuffers = { height, grain, mask };
      ports.set(node.id, { kind: 'scalar', data: height });
      ports.set(`${node.id}.height`, { kind: 'scalar', data: height });
      ports.set(`${node.id}.grain`, { kind: 'scalar', data: grain });
      ports.set(`${node.id}.mask`, { kind: 'scalar', data: mask });
    } else if (node.op === 'plank_pattern') {
      const height = new Float32Array(pixelCount);
      const mask = new Float32Array(pixelCount);
      const cellRand = new Float32Array(pixelCount);
      const nails = new Float32Array(pixelCount);
      curBuffers = { height, mask, cellRand, nails };
      ports.set(node.id, { kind: 'scalar', data: height });
      ports.set(`${node.id}.height`, { kind: 'scalar', data: height });
      ports.set(`${node.id}.mask`, { kind: 'scalar', data: mask });
      ports.set(`${node.id}.cellRand`, { kind: 'scalar', data: cellRand });
      ports.set(`${node.id}.nails`, { kind: 'scalar', data: nails });
    } else if (node.op === 'corrugated_wave') {
      const height = new Float32Array(pixelCount);
      const ridge = new Float32Array(pixelCount);
      const edge = new Float32Array(pixelCount);
      curBuffers = { height, ridge, edge };
      ports.set(node.id, { kind: 'scalar', data: height });
      ports.set(`${node.id}.height`, { kind: 'scalar', data: height });
      ports.set(`${node.id}.ridge`, { kind: 'scalar', data: ridge });
      ports.set(`${node.id}.edge`, { kind: 'scalar', data: edge });
    } else if (node.op === 'rivet_grid') {
      const height = new Float32Array(pixelCount);
      const mask = new Float32Array(pixelCount);
      curBuffers = { height, mask };
      ports.set(node.id, { kind: 'scalar', data: height });
      ports.set(`${node.id}.height`, { kind: 'scalar', data: height });
      ports.set(`${node.id}.mask`, { kind: 'scalar', data: mask });
    } else if (
      node.op === 'height_to_normal' ||
      node.op === 'mix_color' ||
      node.op === 'color_ramp'
    ) {
      const rgb = new Float32Array(pixelCount * 3);
      curBuffers = { rgb };
      ports.set(node.id, { kind: 'color', data: rgb });
    } else if (node.op === 'blend') {
      const aSrc = resolveColorOrScalarBuf(node.args.a);
      const bSrc = resolveColorOrScalarBuf(node.args.b);
      if (
        aSrc.kind === 'color' ||
        aSrc.kind === 'const_color' ||
        bSrc.kind === 'color' ||
        bSrc.kind === 'const_color'
      ) {
        const rgb = new Float32Array(pixelCount * 3);
        curBuffers = { rgb };
        ports.set(node.id, { kind: 'color', data: rgb });
      } else {
        const out = new Float32Array(pixelCount);
        curBuffers = { out };
        ports.set(node.id, { kind: 'scalar', data: out });
      }
    } else {
      const out = new Float32Array(pixelCount);
      curBuffers = { out };
      ports.set(node.id, { kind: 'scalar', data: out });
      if (node.op === 'blur') {
        blurTmp = new Float32Array(pixelCount);
      }
    }
  }

  function processNodeRows(node: ExecNode, yStart: number, yEnd: number): boolean {
    const args = node.args;

    switch (node.op) {
      case 'fbm': {
        const scale = resolveNumber(args.scale, params, 8);
        const octaves = Math.max(1, Math.min(8, Math.round(resolveNumber(args.octaves, params, 4))));
        const persistence = resolveNumber(args.persistence, params, 0.5);
        const lacunarity = resolveNumber(args.lacunarity, params, 2);
        const out = curBuffers.out!;
        fillFbm2DRows(out, size, yStart, yEnd, scale, octaves, persistence, lacunarity, seed);
        return true;
      }

      case 'worley': {
        const scale = resolveNumber(args.scale, params, 8);
        const mode = String(args.mode ?? 'f1');
        const jitter = resolveNumber(args.jitter, params, 0.9);
        const main = curBuffers.main!;
        const f1B = curBuffers.f1!;
        const f2B = curBuffers.f2!;
        const f2mf1B = curBuffers.f2mf1!;
        const crB = curBuffers.cellRand!;
        const edgeB = curBuffers.edge!;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            worley2DPeriodic(u, v, scale, jitter, seed + 17, worleyScratch);
            const idx = rowOff + x;
            f1B[idx] = worleyScratch.f1;
            f2B[idx] = worleyScratch.f2;
            f2mf1B[idx] = worleyScratch.f2MinusF1;
            crB[idx] = worleyScratch.cellRand;
            const e = 1 - smoothstep(0.02, 0.16, worleyScratch.f2MinusF1);
            edgeB[idx] = e;
            main[idx] =
              mode === 'f2'
                ? worleyScratch.f2
                : mode === 'f2_minus_f1'
                ? worleyScratch.f2MinusF1
                : mode === 'cell_rand'
                ? worleyScratch.cellRand
                : mode === 'edge'
                ? e
                : worleyScratch.f1;
          }
        }
        return true;
      }

      case 'brick_pattern': {
        const rows = Math.max(1, Math.round(resolveNumber(args.rows, params, 8)));
        const cols = Math.max(1, Math.round(resolveNumber(args.cols, params, 4)));
        const stagger = resolveNumber(args.stagger, params, 0.5);
        const mortar = Math.max(0.002, resolveNumber(args.mortar, params, 0.04));
        const bevel = Math.max(0.002, resolveNumber(args.bevel, params, 0.03));
        const variation = resolveNumber(args.variation, params, 0.35);

        const heightB = curBuffers.height!;
        const maskB = curBuffers.mask!;
        const crB = curBuffers.cellRand!;

        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const gy = v * rows;
          const row = Math.floor(gy);
          const fy = gy - row;
          const wRow = wrapIdx(row, rows);
          const rowShift = (wRow & 1) === 1 ? stagger : 0;
          const rowOff = y * size;

          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const gx = u * cols + rowShift;
            const col = Math.floor(gx);
            const fx = gx - col;
            const wCol = wrapIdx(col, cols);

            const cellH = hash2i(wCol, wRow, seed + 307);
            const randVal = (cellH & 0xffff) / 65535;
            const randHeight = 1 - variation * 0.35 + (randVal - 0.5) * variation * 0.4;

            // Distance to nearest brick edge in normalized cell units
            const mortarX = mortar * (cols / rows);
            const mortarY = mortar;
            const dx = Math.min(fx, 1 - fx) - mortarX * 0.5;
            const dy = Math.min(fy, 1 - fy) - mortarY * 0.5;
            const dEdge = Math.min(dx, dy);

            const mask = dEdge > 0 ? smoothstep(0, bevel * 0.4, dEdge) : 0;
            const bevelRamp = dEdge > 0 ? smoothstep(0, bevel, dEdge) : 0;
            const idx = rowOff + x;
            maskB[idx] = mask;
            crB[idx] = randVal;
            heightB[idx] = clamp01(0.18 + mask * bevelRamp * 0.72 * randHeight);
          }
        }
        return true;
      }

      case 'wood_grain': {
        const scale = resolveNumber(args.scale, params, 6);
        const ringScale = resolveNumber(args.ringScale, params, 18);
        const distortion = resolveNumber(args.distortion, params, 0.35);
        const knots = Math.max(0, Math.round(resolveNumber(args.knots, params, 2)));
        const stretchX = Math.max(1, Math.round(resolveNumber(args.stretchX, params, 1)));
        const stretchY = Math.max(1, Math.round(resolveNumber(args.stretchY, params, 6)));

        const heightB = curBuffers.height!;
        const grainB = curBuffers.grain!;
        const maskB = curBuffers.mask!;

        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const warp = perlin2DPeriodic(u, v, scale * stretchX, scale * stretchY, seed + 51);
            let ringCoord = u * ringScale + warp * distortion * 4.0;
            // Subtle deterministic knots
            let knotMask = 0;
            for (let k = 0; k < knots; k++) {
              const kh = hash2i(k, 13, seed + 911);
              const ku = (kh & 0xffff) / 65535;
              const kv = ((kh >>> 16) & 0xffff) / 65535;
              let du = u - ku;
              let dv = v - kv;
              if (du > 0.5) du -= 1;
              if (du < -0.5) du += 1;
              if (dv > 0.5) dv -= 1;
              if (dv < -0.5) dv += 1;
              const dist = Math.sqrt(du * du * 18 + dv * dv * 3);
              if (dist < 0.35) {
                const influence = 1 - dist / 0.35;
                ringCoord += influence * 2.5;
                knotMask = Math.max(knotMask, influence * influence);
              }
            }
            const ringWave = 0.5 + 0.5 * Math.sin(ringCoord * Math.PI * 2);
            const fine = perlin2DPeriodic(u, v, scale * 6, scale * 2, seed + 131) * 0.5 + 0.5;
            const g = clamp01(ringWave * 0.65 + fine * 0.35);
            const idx = rowOff + x;
            grainB[idx] = g;
            maskB[idx] = clamp01(1 - knotMask * 0.7);
            heightB[idx] = clamp01(0.35 + g * 0.55 - knotMask * 0.18);
          }
        }
        return true;
      }

      case 'plank_pattern': {
        const planks = Math.max(1, Math.round(resolveNumber(args.planks, params, 6)));
        const joints = Math.max(1, Math.round(resolveNumber(args.joints, params, 2)));
        const gap = Math.max(0.002, resolveNumber(args.gap, params, 0.015));
        const bevel = Math.max(0.002, resolveNumber(args.bevel, params, 0.025));
        const variation = resolveNumber(args.variation, params, 0.4);
        const showNails = resolveBoolean(args.nails, params, true);

        const heightB = curBuffers.height!;
        const maskB = curBuffers.mask!;
        const crB = curBuffers.cellRand!;
        const nailsB = curBuffers.nails!;

        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const px = u * planks;
            const plankIdx = Math.floor(px);
            const fx = px - plankIdx;
            const wPlank = wrapIdx(plankIdx, planks);

            const staggerV = ((hash2i(wPlank, 3, seed + 401) & 0xffff) / 65535) * 0.8;
            const py = (v + staggerV) * joints;
            const jointIdx = Math.floor(py);
            const fy = py - jointIdx;
            const wJoint = wrapIdx(jointIdx, joints);

            const cellH = hash2i(wPlank, wJoint, seed + 701);
            const randVal = (cellH & 0xffff) / 65535;

            const dx = Math.min(fx, 1 - fx) - gap * 0.5 * planks;
            const dy = Math.min(fy, 1 - fy) - gap * 0.5 * joints;
            const dEdge = Math.min(dx, dy);

            const mask = dEdge > 0 ? smoothstep(0, bevel * 0.5, dEdge) : 0;
            const bev = dEdge > 0 ? smoothstep(0, bevel, dEdge) : 0;

            let nail = 0;
            if (showNails && mask > 0.5) {
              // Two small nails near top/bottom end of each plank
              const ny1 = Math.abs(fy - 0.08) * (1 / joints);
              const ny2 = Math.abs(fy - 0.92) * (1 / joints);
              const nx1 = Math.abs(fx - 0.25) / planks;
              const nx2 = Math.abs(fx - 0.75) / planks;
              const dNail = Math.min(
                Math.hypot(nx1, ny1),
                Math.hypot(nx2, ny1),
                Math.hypot(nx1, ny2),
                Math.hypot(nx2, ny2)
              );
              nail = 1 - smoothstep(0.005, 0.011, dNail);
            }

            const idx = rowOff + x;
            maskB[idx] = mask;
            crB[idx] = randVal;
            nailsB[idx] = nail;
            const fiber = perlin2DPeriodic(u, v, planks * 14, joints * 3, seed + 557) * 0.06;
            const plankBias = 1 - variation * 0.25 + (randVal - 0.5) * variation * 0.3;
            heightB[idx] = clamp01(0.12 + mask * bev * 0.78 * plankBias + fiber * mask - nail * 0.22);
          }
        }
        return true;
      }

      case 'corrugated_wave': {
        // Trapezoidal corrugated profile from Fable 5.2 (pitch = fin + slope + fout + slope)
        const count = Math.max(1, Math.round(resolveNumber(args.count, params, 5)));
        const axis = String(args.axis ?? 'x');
        const fin = clamp01(resolveNumber(args.fin, params, 0.26));
        const slope = Math.max(0.02, clamp01(resolveNumber(args.slope, params, 0.24)));
        const fout = clamp01(resolveNumber(args.fout, params, 0.26));
        const depth = clamp01(resolveNumber(args.depth, params, 1.0));
        const heightB = curBuffers.height!;
        const ridgeB = curBuffers.ridge!;
        const edgeB = curBuffers.edge!;

        const t1 = fin;
        const t2 = t1 + slope;
        const t3 = t2 + fout;
        const t4 = Math.min(1.0, t3 + slope);

        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const coord = axis === 'y' ? v : u;
            const ph = (coord * count) % 1;
            let h = 0;
            let ridge = 0;
            let edge = 0;
            if (ph < t1) {
              h = 0;
            } else if (ph < t2) {
              const t = (ph - t1) / slope;
              h = smoothstep(0, 1, t);
              ridge = smoothstep(0.45, 0.95, t);
              edge = Math.sin(t * Math.PI);
            } else if (ph < t3) {
              h = 1;
              ridge = 1;
              const dEdge = Math.min(ph - t2, t3 - ph);
              edge = 1 - smoothstep(0, 0.04, dEdge);
            } else if (ph < t4) {
              const t = 1 - (ph - t3) / Math.max(0.01, t4 - t3);
              h = smoothstep(0, 1, t);
              ridge = smoothstep(0.45, 0.95, t);
              edge = Math.sin(t * Math.PI);
            }
            const idx = rowOff + x;
            heightB[idx] = h * depth;
            ridgeB[idx] = ridge;
            edgeB[idx] = edge;
          }
        }
        return true;
      }

      case 'edge_wear_mask': {
        const src = resolveScalarBuf(args.input, 0.5);
        const low = resolveNumber(args.low, params, 0.35);
        const high = resolveNumber(args.high, params, 0.65);
        const noiseScale = Math.max(2, Math.round(resolveNumber(args.noiseScale, params, 10)));
        const spread = resolveNumber(args.spread, params, 0.45);
        const out = curBuffers.out!;

        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const ym = y === 0 ? size - 1 : y - 1;
          const yp = y + 1 >= size ? 0 : y + 1;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const idx = rowOff + x;
            const val = typeof src === 'number' ? src : src[idx]!;
            let grad = 0;
            if (typeof src !== 'number') {
              const xm = x === 0 ? size - 1 : x - 1;
              const xp = x + 1 >= size ? 0 : x + 1;
              const dx = src[rowOff + xp]! - src[rowOff + xm]!;
              const dy = src[yp * size + x]! - src[ym * size + x]!;
              grad = Math.min(1, Math.hypot(dx, dy) * 3.5);
            }
            const n = fbm2DPeriodic((x + 0.5) * invSize, v, noiseScale, 3, 0.55, 2, seed + 433);
            const raw = clamp01(val * 0.65 + grad * 0.55 + (n - 0.5) * spread);
            out[idx] = smoothstep(low, high, raw);
          }
        }
        return true;
      }

      case 'vertical_streak': {
        // Two-pass seamless vertical drip decay inspired by fable52-fps-repro/demos/02-materials
        const scaleX = Math.max(2, Math.round(resolveNumber(args.scaleX, params, 14)));
        const scaleY = Math.max(1, Math.round(resolveNumber(args.scaleY, params, 3)));
        const threshold = resolveNumber(args.threshold, params, 0.54);
        const decayPerTile = resolveNumber(args.decay, params, 0.16);
        const seedOff = Math.round(resolveNumber(args.seedOffset, params, 0));
        const srcInput = args.input ? resolveScalarBuf(args.input, 0) : null;
        const out = curBuffers.out!;
        const dec = Math.exp(-0.693 / Math.max(0.02, decayPerTile * size));

        // Process column-wise in vertical-wrap passes once per node
        if (yStart === 0) {
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const colMask = smoothstep(
              0.25,
              0.78,
              perlin2DPeriodic(u, 0.37, scaleX, 1, seed + 811 + seedOff) * 0.5 + 0.5
            );
            let streak = 0;
            for (let pass = 0; pass < 2; pass++) {
              for (let y = size - 1; y >= 0; y--) {
                const v = (y + 0.5) * invSize;
                const i = y * size + x;
                const n = fbm2DPeriodic(u, v, scaleX, 3, 0.52, 2, seed + 887 + seedOff);
                const base = srcInput ? (typeof srcInput === 'number' ? srcInput : srcInput[i]!) : n;
                const src = smoothstep(threshold - 0.06, threshold + 0.06, base * 0.65 + n * 0.35);
                streak = Math.max(src * colMask, streak * dec);
                if (pass === 1) {
                  out[i] = clamp01(streak * streak * (1 - src * 0.45));
                }
              }
            }
          }
          rowIdx = size;
        }
        return true;
      }

      case 'rivet_grid': {
        const cols = Math.max(1, Math.round(resolveNumber(args.cols, params, 4)));
        const rows = Math.max(1, Math.round(resolveNumber(args.rows, params, 2)));
        const radius = Math.max(0.01, resolveNumber(args.radius, params, 0.08));
        const heightB = curBuffers.height!;
        const maskB = curBuffers.mask!;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const fy = ((v * rows) % 1) - 0.5;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const fx = ((u * cols) % 1) - 0.5;
            const d = Math.hypot(fx, fy) / radius;
            const m = d < 1 ? 1 - smoothstep(0.75, 1.0, d) : 0;
            const dome = d < 1 ? Math.sqrt(Math.max(0, 1 - d * d)) : 0;
            const idx = rowOff + x;
            maskB[idx] = m;
            heightB[idx] = dome;
          }
        }
        return true;
      }

      case 'sand_ripples': {
        // Wind-blown sand ripples + fine grain from worm-rider/src/tex.js
        const freq = resolveNumber(args.freq, params, 16);
        const warpScale = Math.max(1, Math.round(resolveNumber(args.warpScale, params, 3)));
        const warpStrength = resolveNumber(args.warpStrength, params, 4.2);
        const sharpness = resolveNumber(args.sharpness, params, 1.7);
        const grainScale = Math.max(4, Math.round(resolveNumber(args.grainScale, params, 28)));
        const out = curBuffers.out!;

        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const w = fbm2DPeriodic(u, v, warpScale, 3, 0.5, 2, seed + 101);
            const w2 = fbm2DPeriodic(u, v, warpScale * 3, 2, 0.5, 2, seed + 211);
            const rr = 0.5 + 0.5 * Math.sin((v * freq + w * warpStrength + w2 * 1.1) * Math.PI * 2);
            const patch = smoothstep(0.25, 0.62, w + 0.15);
            const rip = Math.pow(rr, sharpness) * patch;
            const fine = fbm2DPeriodic(u, v, grainScale, 2, 0.5, 2, seed + 313);
            out[rowOff + x] = clamp01(rip * 0.72 + fine * 0.28);
          }
        }
        return true;
      }

      case 'fabric_weave': {
        // Plain-weave warp/weft with linen slub irregularity from room-at-dawn/src/scene/materials.js
        let threads = Math.max(4, Math.round(resolveNumber(args.threads, params, 48)));
        threads = (threads + 1) & ~1;
        const slub = resolveNumber(args.slub, params, 0.3);
        const out = curBuffers.out!;

        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const py = v * threads;
          const iy = Math.floor(py);
          const fy = py - iy;
          const wy = 0.75 + slub * (((hash2i(3, wrapIdx(iy, threads), seed + 53) & 0xffff) / 65535) - 0.5) * 1.4;
          const ty = Math.max(0, 1 - Math.abs(fy - 0.5) * 2 / wy);
          const rowOff = y * size;

          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const px = u * threads;
            const ix = Math.floor(px);
            const fx = px - ix;
            const over = ((ix + iy) & 1) === 1;
            const wx = 0.75 + slub * (((hash2i(wrapIdx(ix, threads), 7, seed + 59) & 0xffff) / 65535) - 0.5) * 1.4;
            const tx = Math.max(0, 1 - Math.abs(fx - 0.5) * 2 / wx);
            const warp = Math.sqrt(tx) * (over ? 1.0 : 0.52) * (0.62 + 0.38 * Math.sin(fy * Math.PI));
            const weft = Math.sqrt(ty) * (over ? 0.52 : 1.0) * (0.62 + 0.38 * Math.sin(fx * Math.PI));
            const n = (perlin2DPeriodic(u, v, threads, threads, seed + 61) * 0.5) * 0.16 * slub;
            out[rowOff + x] = clamp01(Math.max(warp, weft) + n);
          }
        }
        return true;
      }

      case 'stripes': {
        const count = Math.max(1, Math.round(resolveNumber(args.count, params, 12)));
        const axis = String(args.axis ?? 'x');
        const width = resolveNumber(args.width, params, 0.5);
        const softness = Math.max(0.005, resolveNumber(args.softness, params, 0.15));
        const noiseAmt = resolveNumber(args.noise, params, 0.08);
        const out = curBuffers.out!;

        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const coord = axis === 'y' ? v : axis === 'diag' ? u + v : u;
            const n = noiseAmt > 0 ? perlin2DPeriodic(u, v, count * 2, count * 2, seed + 99) * noiseAmt : 0;
            const phase = (coord * count + n) % 1;
            const p = phase < 0 ? phase + 1 : phase;
            const dist = Math.abs(p - 0.5) * 2;
            out[rowOff + x] = 1 - smoothstep(width - softness, width + softness, dist);
          }
        }
        return true;
      }

      case 'speckle': {
        const scale = Math.max(2, Math.round(resolveNumber(args.scale, params, 32)));
        const density = clamp01(resolveNumber(args.density, params, 0.35));
        const softness = clamp01(resolveNumber(args.softness, params, 0.5));
        const seedOff = Math.round(resolveNumber(args.seedOffset, params, 0));
        const out = curBuffers.out!;

        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const gy = v * scale;
          const iy = wrapIdx(Math.floor(gy), scale);
          const fy = gy - Math.floor(gy) - 0.5;
          const rowOff = y * size;

          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const gx = u * scale;
            const ix = wrapIdx(Math.floor(gx), scale);
            const fx = gx - Math.floor(gx) - 0.5;
            const h = hash2i(ix, iy, seed + 613 + seedOff);
            const active = ((h & 0xffff) / 65535) < density;
            if (!active) {
              out[rowOff + x] = 0;
            } else {
              const rMax = 0.25 + (((h >>> 16) & 0xff) / 255) * 0.25;
              const ox = ((((h >>> 24) & 0xf) / 15) - 0.5) * 0.25;
              const oy = ((((h >>> 28) & 0xf) / 15) - 0.5) * 0.25;
              const d = Math.hypot(fx - ox, fy - oy);
              out[rowOff + x] = 1 - smoothstep(rMax * (1 - softness * 0.8), rMax, d);
            }
          }
        }
        return true;
      }

      case 'remap': {
        const src = resolveScalarBuf(args.input, 0);
        const inMin = resolveNumber(args.inMin, params, 0);
        const inMax = resolveNumber(args.inMax, params, 1);
        const outMin = resolveNumber(args.outMin, params, 0);
        const outMax = resolveNumber(args.outMax, params, 1);
        const invRange = 1 / (Math.abs(inMax - inMin) < 1e-6 ? 1e-6 : inMax - inMin);
        const out = curBuffers.out!;

        if (typeof src === 'number') {
          const t = clamp01((src - inMin) * invRange);
          const val = outMin + t * (outMax - outMin);
          out.fill(val, yStart * size, yEnd * size);
        } else {
          const start = yStart * size;
          const end = yEnd * size;
          for (let i = start; i < end; i++) {
            const t = clamp01((src[i]! - inMin) * invRange);
            out[i] = outMin + t * (outMax - outMin);
          }
        }
        return true;
      }

      case 'clamp': {
        const src = resolveScalarBuf(args.input, 0);
        const minV = resolveNumber(args.min, params, 0);
        const maxV = resolveNumber(args.max, params, 1);
        const out = curBuffers.out!;
        const start = yStart * size;
        const end = yEnd * size;
        if (typeof src === 'number') {
          out.fill(Math.max(minV, Math.min(maxV, src)), start, end);
        } else {
          for (let i = start; i < end; i++) {
            const v = src[i]!;
            out[i] = v < minV ? minV : v > maxV ? maxV : v;
          }
        }
        return true;
      }

      case 'invert': {
        const src = resolveScalarBuf(args.input, 0);
        const out = curBuffers.out!;
        const start = yStart * size;
        const end = yEnd * size;
        if (typeof src === 'number') {
          out.fill(1 - src, start, end);
        } else {
          for (let i = start; i < end; i++) out[i] = 1 - src[i]!;
        }
        return true;
      }

      case 'power': {
        const src = resolveScalarBuf(args.input, 0);
        const exp = resolveNumber(args.exp, params, 1);
        const out = curBuffers.out!;
        const start = yStart * size;
        const end = yEnd * size;
        if (typeof src === 'number') {
          out.fill(Math.pow(Math.max(0, src), exp), start, end);
        } else {
          for (let i = start; i < end; i++) out[i] = Math.pow(Math.max(0, src[i]!), exp);
        }
        return true;
      }

      case 'domain_warp': {
        const src = resolveScalarBuf(args.input, 0);
        const warpX = args.warpX ? resolveScalarBuf(args.warpX, 0.5) : null;
        const warpY = args.warpY ? resolveScalarBuf(args.warpY, 0.5) : null;
        const strength = resolveNumber(args.strength, params, 0.04);
        const warpScale = resolveNumber(args.scale, params, 4);
        const out = curBuffers.out!;

        if (typeof src === 'number') {
          out.fill(src, yStart * size, yEnd * size);
          return true;
        }

        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const idx = rowOff + x;
            const u = (x + 0.5) * invSize;
            const wx =
              warpX !== null
                ? (typeof warpX === 'number' ? warpX : warpX[idx]!) - 0.5
                : perlin2DPeriodic(u, v, warpScale, warpScale, seed + 193);
            const wy =
              warpY !== null
                ? (typeof warpY === 'number' ? warpY : warpY[idx]!) - 0.5
                : perlin2DPeriodic(u, v, warpScale, warpScale, seed + 389);

            const sx = (u + wx * strength) * size - 0.5;
            const sy = (v + wy * strength) * size - 0.5;
            const x0 = Math.floor(sx);
            const y0 = Math.floor(sy);
            const tx = sx - x0;
            const ty = sy - y0;
            const ix0 = wrapIdx(x0, size);
            const ix1 = ix0 + 1 >= size ? 0 : ix0 + 1;
            const iy0 = wrapIdx(y0, size);
            const iy1 = iy0 + 1 >= size ? 0 : iy0 + 1;

            const v00 = src[iy0 * size + ix0]!;
            const v10 = src[iy0 * size + ix1]!;
            const v01 = src[iy1 * size + ix0]!;
            const v11 = src[iy1 * size + ix1]!;
            const a = v00 + (v10 - v00) * tx;
            const b = v01 + (v11 - v01) * tx;
            out[idx] = a + (b - a) * ty;
          }
        }
        return true;
      }

      case 'blur': {
        const src = resolveScalarBuf(args.input, 0);
        const radius = Math.max(1, Math.min(8, Math.round(resolveNumber(args.radius, params, 2))));
        const out = curBuffers.out!;
        if (typeof src === 'number') {
          out.fill(src, yStart * size, yEnd * size);
          return true;
        }
        const tmp = blurTmp!;
        const invKernel = 1 / (radius * 2 + 1);
        if (blurPhase === 0) {
          for (let y = yStart; y < yEnd; y++) {
            const rowOff = y * size;
            for (let x = 0; x < size; x++) {
              let sum = 0;
              for (let dx = -radius; dx <= radius; dx++) {
                sum += src[rowOff + wrapIdx(x + dx, size)]!;
              }
              tmp[rowOff + x] = sum * invKernel;
            }
          }
          if (yEnd >= size) {
            blurPhase = 1;
            rowIdx = 0;
            return false;
          }
          return true;
        } else {
          for (let y = yStart; y < yEnd; y++) {
            const rowOff = y * size;
            for (let x = 0; x < size; x++) {
              let sum = 0;
              for (let dy = -radius; dy <= radius; dy++) {
                sum += tmp[wrapIdx(y + dy, size) * size + x]!;
              }
              out[rowOff + x] = sum * invKernel;
            }
          }
          return true;
        }
      }

      case 'height_to_normal': {
        const src = resolveScalarBuf(args.input, 0.5);
        const strength = resolveNumber(args.strength, params, 2.0);
        const rgb = curBuffers.rgb!;
        if (typeof src === 'number') {
          for (let y = yStart; y < yEnd; y++) {
            const rowOff = y * size * 3;
            for (let x = 0; x < size; x++) {
              const o = rowOff + x * 3;
              rgb[o] = 0.5;
              rgb[o + 1] = 0.5;
              rgb[o + 2] = 1.0;
            }
          }
          return true;
        }

        for (let y = yStart; y < yEnd; y++) {
          const ym = y === 0 ? size - 1 : y - 1;
          const yp = y + 1 >= size ? 0 : y + 1;
          const rowM = ym * size;
          const rowC = y * size;
          const rowP = yp * size;
          for (let x = 0; x < size; x++) {
            const xm = x === 0 ? size - 1 : x - 1;
            const xp = x + 1 >= size ? 0 : x + 1;
            const tl = src[rowM + xm]!;
            const t = src[rowM + x]!;
            const tr = src[rowM + xp]!;
            const l = src[rowC + xm]!;
            const r = src[rowC + xp]!;
            const bl = src[rowP + xm]!;
            const b = src[rowP + x]!;
            const br = src[rowP + xp]!;

            const dX = tr + 2 * r + br - (tl + 2 * l + bl);
            const dY = bl + 2 * b + br - (tl + 2 * t + tr);
            const nx = -dX * strength;
            const ny = dY * strength; // +Y OpenGL tangent-space convention
            const nz = 1.0;
            const invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
            const o = (rowC + x) * 3;
            rgb[o] = nx * invLen * 0.5 + 0.5;
            rgb[o + 1] = ny * invLen * 0.5 + 0.5;
            rgb[o + 2] = nz * invLen * 0.5 + 0.5;
          }
        }
        return true;
      }

      case 'blend': {
        const mode = String(args.mode ?? 'multiply');
        const strength = clamp01(resolveNumber(args.strength, params, 1.0));
        const aSrc = resolveColorOrScalarBuf(args.a);
        const bSrc = resolveColorOrScalarBuf(args.b);

        const blendOp = (a: number, b: number): number => {
          switch (mode) {
            case 'add':
              return clamp01(a + b * strength);
            case 'sub':
              return clamp01(a - b * strength);
            case 'min':
              return a + (Math.min(a, b) - a) * strength;
            case 'max':
              return a + (Math.max(a, b) - a) * strength;
            case 'screen':
              return a + (1 - (1 - a) * (1 - b) - a) * strength;
            case 'overlay': {
              const ov = a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
              return a + (ov - a) * strength;
            }
            case 'multiply':
            default:
              return a + (a * b - a) * strength;
          }
        };

        if (curBuffers.rgb) {
          const rgb = curBuffers.rgb;
          const start = yStart * size;
          const end = yEnd * size;
          for (let i = start; i < end; i++) {
            const o = i * 3;
            for (let c = 0; c < 3; c++) {
              const av =
                aSrc.kind === 'color'
                  ? aSrc.data[o + c]!
                  : aSrc.kind === 'const_color'
                  ? aSrc.rgb[c]!
                  : aSrc.kind === 'scalar'
                  ? aSrc.data[i]!
                  : aSrc.val;
              const bv =
                bSrc.kind === 'color'
                  ? bSrc.data[o + c]!
                  : bSrc.kind === 'const_color'
                  ? bSrc.rgb[c]!
                  : bSrc.kind === 'scalar'
                  ? bSrc.data[i]!
                  : bSrc.val;
              rgb[o + c] = blendOp(av, bv);
            }
          }
        } else {
          const out = curBuffers.out!;
          const start = yStart * size;
          const end = yEnd * size;
          for (let i = start; i < end; i++) {
            const av = aSrc.kind === 'scalar' ? aSrc.data[i]! : aSrc.kind === 'const_scalar' ? aSrc.val : 0;
            const bv = bSrc.kind === 'scalar' ? bSrc.data[i]! : bSrc.kind === 'const_scalar' ? bSrc.val : 0;
            out[i] = blendOp(av, bv);
          }
        }
        return true;
      }

      case 'mix_scalar': {
        const aSrc = resolveScalarBuf(args.a, 0);
        const bSrc = resolveScalarBuf(args.b, 1);
        const mSrc = resolveScalarBuf(args.mask, 0.5);
        const out = curBuffers.out!;
        const start = yStart * size;
        const end = yEnd * size;
        for (let i = start; i < end; i++) {
          const a = typeof aSrc === 'number' ? aSrc : aSrc[i]!;
          const b = typeof bSrc === 'number' ? bSrc : bSrc[i]!;
          const m = typeof mSrc === 'number' ? mSrc : mSrc[i]!;
          out[i] = a + (b - a) * clamp01(m);
        }
        return true;
      }

      case 'mix_color': {
        const aSrc = resolveColorOrScalarBuf(args.a);
        const bSrc = resolveColorOrScalarBuf(args.b);
        const mSrc = resolveScalarBuf(args.mask, 0.5);
        const rgb = curBuffers.rgb!;
        const start = yStart * size;
        const end = yEnd * size;

        const aLin = aSrc.kind === 'const_color' ? aSrc.rgb.map((v) => fastSrgbToLinear(v)) : null;
        const bLin = bSrc.kind === 'const_color' ? bSrc.rgb.map((v) => fastSrgbToLinear(v)) : null;

        for (let i = start; i < end; i++) {
          const m = clamp01(typeof mSrc === 'number' ? mSrc : mSrc[i]!);
          const o = i * 3;
          for (let c = 0; c < 3; c++) {
            const av = aLin
              ? aLin[c]!
              : aSrc.kind === 'color'
              ? fastSrgbToLinear(aSrc.data[o + c]!)
              : aSrc.kind === 'scalar'
              ? aSrc.data[i]!
              : 0;
            const bv = bLin
              ? bLin[c]!
              : bSrc.kind === 'color'
              ? fastSrgbToLinear(bSrc.data[o + c]!)
              : bSrc.kind === 'scalar'
              ? bSrc.data[i]!
              : 0;
            rgb[o + c] = linearToSrgbChannel(av + (bv - av) * m);
          }
        }
        return true;
      }

      case 'color_ramp': {
        const inSrc = resolveScalarBuf(args.input, 0.5);
        const rawStops = (args.stops ?? [
          [0, '#444444'],
          [1, '#aaaaaa'],
        ]) as Array<[number, string]>;
        const stops = rawStops
          .map(([t, hex]) => ({ t: Number(t), lin: hexToLinear(hex) }))
          .sort((a, b) => a.t - b.t);
        const rgb = curBuffers.rgb!;
        const start = yStart * size;
        const end = yEnd * size;
        const lastStop = stops[stops.length - 1]!;
        const firstStop = stops[0]!;

        for (let i = start; i < end; i++) {
          const x = typeof inSrc === 'number' ? inSrc : inSrc[i]!;
          let rLin: number;
          let gLin: number;
          let bLin: number;
          if (x <= firstStop.t) {
            [rLin, gLin, bLin] = firstStop.lin;
          } else if (x >= lastStop.t) {
            [rLin, gLin, bLin] = lastStop.lin;
          } else {
            let s0 = firstStop;
            let s1 = lastStop;
            for (let k = 0; k < stops.length - 1; k++) {
              if (x >= stops[k]!.t && x <= stops[k + 1]!.t) {
                s0 = stops[k]!;
                s1 = stops[k + 1]!;
                break;
              }
            }
            const span = Math.max(1e-6, s1.t - s0.t);
            const f = (x - s0.t) / span;
            rLin = s0.lin[0] + (s1.lin[0] - s0.lin[0]) * f;
            gLin = s0.lin[1] + (s1.lin[1] - s0.lin[1]) * f;
            bLin = s0.lin[2] + (s1.lin[2] - s0.lin[2]) * f;
          }
          const o = i * 3;
          rgb[o] = linearToSrgbChannel(rLin);
          rgb[o + 1] = linearToSrgbChannel(gLin);
          rgb[o + 2] = linearToSrgbChannel(bLin);
        }
        return true;
      }
    }
  }

  function resolveOutputSource(key: keyof MaterialRecipe['outputs']) {
    const syn = outputInlineId[key];
    if (syn) return resolveColorOrScalarBuf(syn);
    return resolveColorOrScalarBuf(recipe.outputs[key]);
  }

  function packRows(yStart: number, yEnd: number): void {
    if (!albedoOut) {
      albedoOut = new Uint8Array(pixelCount * 4);
      normalOut = new Uint8Array(pixelCount * 4);
      ormOut = new Uint8Array(pixelCount * 4);
    }
    const albSrc = resolveOutputSource('albedo');
    const hgtSrc = resolveOutputSource('height');
    const nrmSrc = resolveOutputSource('normal');
    const aoSrc = resolveOutputSource('ao');
    const rghSrc = resolveOutputSource('roughness');
    const metSrc = resolveOutputSource('metalness');
    const porSrc = resolveOutputSource('porosity');

    const start = yStart * size;
    const end = yEnd * size;

    const readScalar = (
      src: ReturnType<typeof resolveColorOrScalarBuf>,
      i: number,
      def: number
    ): number => {
      if (src.kind === 'scalar') return src.data[i]!;
      if (src.kind === 'const_scalar') return src.val;
      if (src.kind === 'color') return src.data[i * 3]!;
      return def;
    };

    for (let i = start; i < end; i++) {
      const o3 = i * 3;
      const o4 = i * 4;

      let rS = 0.5;
      let gS = 0.5;
      let bS = 0.5;
      if (albSrc.kind === 'color') {
        rS = albSrc.data[o3]!;
        gS = albSrc.data[o3 + 1]!;
        bS = albSrc.data[o3 + 2]!;
      } else if (albSrc.kind === 'const_color') {
        rS = albSrc.rgb[0];
        gS = albSrc.rgb[1];
        bS = albSrc.rgb[2];
      } else if (albSrc.kind === 'scalar') {
        rS = gS = bS = albSrc.data[i]!;
      }

      const metal = clamp01(readScalar(metSrc, i, 0));
      let rLin = fastSrgbToLinear(rS);
      let gLin = fastSrgbToLinear(gS);
      let bLin = fastSrgbToLinear(bS);
      let luma = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;

      // Physical guardrail for non-metals: linear luminance within [0.04, 0.85]
      if (metal < 0.5) {
        if (luma < 0.04) {
          const boost = luma > 1e-4 ? 0.04 / luma : 1;
          if (luma <= 1e-4) {
            rLin = gLin = bLin = 0.04;
          } else {
            rLin *= boost;
            gLin *= boost;
            bLin *= boost;
          }
          luma = 0.04;
          rS = linearToSrgbChannel(rLin);
          gS = linearToSrgbChannel(gLin);
          bS = linearToSrgbChannel(bLin);
        } else if (luma > 0.85) {
          const scale = 0.85 / luma;
          rLin *= scale;
          gLin *= scale;
          bLin *= scale;
          luma = 0.85;
          rS = linearToSrgbChannel(rLin);
          gS = linearToSrgbChannel(gLin);
          bS = linearToSrgbChannel(bLin);
        }
      }
      if (luma < minLuma) minLuma = luma;
      if (luma > maxLuma) maxLuma = luma;

      const hgt = clamp01(readScalar(hgtSrc, i, 0.5));
      albedoOut[o4] = Math.round(clamp01(rS) * 255);
      albedoOut[o4 + 1] = Math.round(clamp01(gS) * 255);
      albedoOut[o4 + 2] = Math.round(clamp01(bS) * 255);
      albedoOut[o4 + 3] = Math.round(hgt * 255);

      if (nrmSrc.kind === 'color') {
        normalOut![o4] = Math.round(clamp01(nrmSrc.data[o3]!) * 255);
        normalOut![o4 + 1] = Math.round(clamp01(nrmSrc.data[o3 + 1]!) * 255);
        normalOut![o4 + 2] = Math.round(clamp01(nrmSrc.data[o3 + 2]!) * 255);
      } else {
        normalOut![o4] = 128;
        normalOut![o4 + 1] = 128;
        normalOut![o4 + 2] = 255;
      }
      normalOut![o4 + 3] = 255;

      const ao = clamp01(readScalar(aoSrc, i, 1));
      const rough = Math.max(0.05, Math.min(1, readScalar(rghSrc, i, 0.7)));
      const por = clamp01(readScalar(porSrc, i, 0.3));
      if (rough < minRough) minRough = rough;
      if (rough > maxRough) maxRough = rough;

      ormOut![o4] = Math.round(ao * 255);
      ormOut![o4 + 1] = Math.round(rough * 255);
      ormOut![o4 + 2] = Math.round(metal * 255);
      ormOut![o4 + 3] = Math.round(por * 255);
    }
  }

  return {
    id: recipe.id,
    size,
    step(budgetMs = 8): boolean {
      if (packedResult) return true;
      const sliceStart = performance.now();

      while (nodeIdx < execList.length) {
        const node = execList[nodeIdx]!;
        if (rowIdx === 0 && blurPhase === 0) {
          initNodeBuffers(node);
        }
        while (rowIdx < size) {
          const yEnd = Math.min(size, rowIdx + CHUNK_ROWS);
          const finishedPhase = processNodeRows(node, rowIdx, yEnd);
          if (!finishedPhase) {
            // Switched phase inside blur
            if (performance.now() - sliceStart >= budgetMs) return false;
            continue;
          }
          rowIdx = yEnd;
          if (performance.now() - sliceStart >= budgetMs) {
            return false;
          }
        }
        nodeIdx++;
        rowIdx = 0;
        blurPhase = 0;
      }

      while (packRow < size) {
        const yEnd = Math.min(size, packRow + CHUNK_ROWS * 2);
        packRows(packRow, yEnd);
        packRow = yEnd;
        if (packRow < size && performance.now() - sliceStart >= budgetMs) {
          return false;
        }
      }

      packedResult = {
        id: recipe.id,
        size,
        albedoData: albedoOut!,
        normalData: normalOut!,
        ormData: ormOut!,
        stats: {
          minRoughness: minRough,
          maxRoughness: maxRough,
          minLinearLuma: minLuma,
          maxLinearLuma: maxLuma,
        },
      };
      return true;
    },
    getResult(): BakedMaterialBuffers {
      while (!packedResult) {
        this.step(Infinity);
      }
      return packedResult;
    },
  };
}

export function evaluateMaterialGraphSync(
  recipe: MaterialRecipe,
  size: number,
  paramOverrides?: ParamMap
): BakedMaterialBuffers {
  const job = createMaterialBakeJob(recipe, size, paramOverrides);
  job.step(Infinity);
  return job.getResult();
}
