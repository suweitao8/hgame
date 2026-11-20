import { fbm3D } from '../core/prng.js';
import {
  resolveBoolean,
  resolveNumber,
  resolveVec3,
  type ParamMap,
} from '../core/safe-expr.js';
import {
  appendRawMesh,
  buildBeveledBoxRaw,
  createRawMeshData,
  pushOrientedQuad,
  pushOrientedTri,
  pushVertex,
  type RawMeshData,
} from './metric-uv.js';

export interface OpeningSpec {
  when?: boolean | string;
  x: number | string;
  y: number | string;
  w: number | string;
  h: number | string;
}

export function opBeveledBox(
  args: Record<string, unknown>,
  params: ParamMap,
  materialId: number,
  edgeWear: number,
  ao: number,
  wetness: number
): RawMeshData {
  const [w, h, d] = resolveVec3(args.size, params, [1, 1, 1]);
  const bevel = resolveNumber(args.bevel, params, 0.02);
  return buildBeveledBoxRaw(w, h, d, bevel, materialId, edgeWear, ao, wetness);
}

/**
 * Wall with rectangular openings (windows/doors).
 * Wall spans x in [-width/2, +width/2], y in [0, height], z in [-thickness/2, +thickness/2].
 */
export function opBeveledWallOpening(
  args: Record<string, unknown>,
  params: ParamMap,
  materialId: number,
  edgeWear: number,
  ao: number,
  wetness: number
): RawMeshData {
  const width = Math.max(0.1, resolveNumber(args.width, params, 4));
  const height = Math.max(0.1, resolveNumber(args.height, params, 2.5));
  const thickness = Math.max(0.05, resolveNumber(args.thickness, params, 0.35));
  const bevel = resolveNumber(args.bevel, params, 0.02);

  const rawOpenings = Array.isArray(args.openings) ? (args.openings as OpeningSpec[]) : [];
  const activeOpenings: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];

  for (const o of rawOpenings) {
    if (o.when !== undefined && !resolveBoolean(o.when, params, true)) continue;
    const ox = resolveNumber(o.x, params, 0);
    const oy = resolveNumber(o.y, params, 0);
    const ow = Math.max(0.1, resolveNumber(o.w, params, 1));
    const oh = Math.max(0.1, resolveNumber(o.h, params, 1));
    const x0 = Math.max(-width * 0.5 + 0.05, ox - ow * 0.5);
    const x1 = Math.min(width * 0.5 - 0.05, ox + ow * 0.5);
    const y0 = Math.max(0, oy);
    const y1 = Math.min(height - 0.05, oy + oh);
    if (x1 > x0 + 0.05 && y1 > y0 + 0.05) {
      activeOpenings.push({ x0, x1, y0, y1 });
    }
  }

  const out = createRawMeshData();
  const addSubBlock = (x0: number, x1: number, y0: number, y1: number) => {
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw <= 0.005 || bh <= 0.005) return;
    const block = buildBeveledBoxRaw(bw, bh, thickness, bevel, materialId, edgeWear, ao, wetness);
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    for (let i = 0; i < block.positions.length; i += 3) {
      block.positions[i] = block.positions[i]! + cx;
      block.positions[i + 1] = block.positions[i + 1]! + cy;
    }
    appendRawMesh(out, block);
  };

  if (activeOpenings.length === 0) {
    addSubBlock(-width * 0.5, width * 0.5, 0, height);
    return out;
  }

  // Partition X and Y grid lines across all openings
  const xs = new Set<number>([-width * 0.5, width * 0.5]);
  const ys = new Set<number>([0, height]);
  for (const o of activeOpenings) {
    xs.add(o.x0);
    xs.add(o.x1);
    ys.add(o.y0);
    ys.add(o.y1);
  }
  const sortedX = [...xs].sort((a, b) => a - b);
  const sortedY = [...ys].sort((a, b) => a - b);

  for (let xi = 0; xi < sortedX.length - 1; xi++) {
    const x0 = sortedX[xi]!;
    const x1 = sortedX[xi + 1]!;
    const midX = (x0 + x1) * 0.5;
    for (let yi = 0; yi < sortedY.length - 1; yi++) {
      const y0 = sortedY[yi]!;
      const y1 = sortedY[yi + 1]!;
      const midY = (y0 + y1) * 0.5;
      const insideOpening = activeOpenings.some(
        (o) => midX > o.x0 && midX < o.x1 && midY > o.y0 && midY < o.y1
      );
      if (!insideOpening) {
        addSubBlock(x0, x1, y0, y1);
      }
    }
  }
  return out;
}

/**
 * Parametric beveled cylinder centered at (0, 0, 0), axis = Y.
 */
export function opCylinder(
  args: Record<string, unknown>,
  params: ParamMap,
  materialId: number,
  edgeWear: number,
  ao: number,
  wetness: number
): RawMeshData {
  const radiusTop = Math.max(0.01, resolveNumber(args.radiusTop ?? args.radius, params, 0.25));
  const radiusBottom = Math.max(0.01, resolveNumber(args.radiusBottom ?? args.radius, params, radiusTop));
  const height = Math.max(0.02, resolveNumber(args.height, params, 1.0));
  const segments = Math.max(6, Math.min(48, Math.round(resolveNumber(args.segments, params, 16))));
  const mesh = createRawMeshData();

  const hy = height * 0.5;
  const avgR = (radiusTop + radiusBottom) * 0.5;
  const circum = Math.PI * 2 * avgR;

  // Side ring vertices
  const topRing: number[] = [];
  const botRing: number[] = [];
  const topCapRing: number[] = [];
  const botCapRing: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const theta = t * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const u = t * circum;

    const tx = radiusTop * cos;
    const tz = radiusTop * sin;
    const bx = radiusBottom * cos;
    const bz = radiusBottom * sin;

    const slopeY = (radiusBottom - radiusTop) / height;
    const nLen = Math.hypot(cos, slopeY, sin) || 1;
    const nx = cos / nLen;
    const ny = slopeY / nLen;
    const nz = sin / nLen;

    topRing.push(pushVertex(mesh, tx, hy, tz, nx, ny, nz, u, hy, ao, edgeWear * 0.5, wetness, materialId));
    botRing.push(pushVertex(mesh, bx, -hy, bz, nx, ny, nz, u, -hy, ao, edgeWear * 0.5, wetness, materialId));

    if (i < segments) {
      topCapRing.push(pushVertex(mesh, tx, hy, tz, 0, 1, 0, tx, tz, ao, edgeWear * 0.7, wetness, materialId));
      botCapRing.push(pushVertex(mesh, bx, -hy, bz, 0, -1, 0, bx, bz, ao, edgeWear * 0.7, wetness, materialId));
    }
  }

  for (let i = 0; i < segments; i++) {
    const t0 = topRing[i]!;
    const t1 = topRing[i + 1]!;
    const b0 = botRing[i]!;
    const b1 = botRing[i + 1]!;
    mesh.indices.push(b0, t0, t1, b0, t1, b1);
  }

  const topCenter = pushVertex(mesh, 0, hy, 0, 0, 1, 0, 0, 0, ao, edgeWear * 0.1, wetness, materialId);
  const botCenter = pushVertex(mesh, 0, -hy, 0, 0, -1, 0, 0, 0, ao, edgeWear * 0.1, wetness, materialId);
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    mesh.indices.push(topCenter, topCapRing[next]!, topCapRing[i]!);
    mesh.indices.push(botCenter, botCapRing[i]!, botCapRing[next]!);
  }

  return mesh;
}

/**
 * Parametric stairs spanning x in [-width/2, width/2], y in [0, height], z in [-depth/2, depth/2] (rising +Z to -Z).
 */
export function opStairs(
  args: Record<string, unknown>,
  params: ParamMap,
  materialId: number,
  edgeWear: number,
  ao: number,
  wetness: number
): RawMeshData {
  const width = Math.max(0.2, resolveNumber(args.width, params, 2.0));
  const height = Math.max(0.2, resolveNumber(args.height, params, 1.5));
  const depth = Math.max(0.2, resolveNumber(args.depth, params, 2.4));
  const steps = Math.max(2, Math.min(32, Math.round(resolveNumber(args.steps, params, 6))));
  const bevel = resolveNumber(args.bevel, params, 0.018);

  const out = createRawMeshData();
  const stepH = height / steps;
  const stepD = depth / steps;

  for (let s = 0; s < steps; s++) {
    // Solid step block from ground up to (s + 1) * stepH so stairs have solid side profiles
    const blockH = (s + 1) * stepH;
    const cz = depth * 0.5 - (s + 0.5) * stepD;
    const cy = blockH * 0.5;
    const stepAO = ao * (0.72 + 0.28 * ((s + 1) / steps));
    const stepBox = buildBeveledBoxRaw(width, blockH, stepD, bevel, materialId, edgeWear, stepAO, wetness);
    for (let i = 0; i < stepBox.positions.length; i += 3) {
      stepBox.positions[i + 1] = stepBox.positions[i + 1]! + cy;
      stepBox.positions[i + 2] = stepBox.positions[i + 2]! + cz;
    }
    appendRawMesh(out, stepBox);
  }
  return out;
}

/**
 * Subdivided icosahedron displaced by deterministic 3D FBM with smooth/faceted normals & metric UVs.
 */
export function opDisplacedRock(
  args: Record<string, unknown>,
  params: ParamMap,
  materialId: number,
  edgeWear: number,
  ao: number,
  wetness: number
): RawMeshData {
  const radius = Math.max(0.1, resolveNumber(args.radius, params, 0.8));
  const detail = Math.max(1, Math.min(3, Math.round(resolveNumber(args.detail, params, 2))));
  const noiseScale = resolveNumber(args.noiseScale, params, 1.8);
  const displacement = resolveNumber(args.displacement, params, 0.28);
  const squashY = resolveNumber(args.squashY, params, 0.72);
  const seed = Math.round(resolveNumber(args.seed, params, 771));

  // Build unit icosahedron
  const t = (1 + Math.sqrt(5)) / 2;
  const baseVerts: Array<[number, number, number]> = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => {
    const l = Math.hypot(x!, y!, z!);
    return [x! / l, y! / l, z! / l];
  });

  let tris: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  const midCache = new Map<string, number>();
  const getMid = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midCache.get(key);
    if (cached !== undefined) return cached;
    const va = baseVerts[a]!;
    const vb = baseVerts[b]!;
    const mx = va[0] + vb[0];
    const my = va[1] + vb[1];
    const mz = va[2] + vb[2];
    const l = Math.hypot(mx, my, mz) || 1;
    const idx = baseVerts.length;
    baseVerts.push([mx / l, my / l, mz / l]);
    midCache.set(key, idx);
    return idx;
  };

  for (let d = 0; d < detail; d++) {
    const nextTris: Array<[number, number, number]> = [];
    for (const [a, b, c] of tris) {
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      nextTris.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = nextTris;
  }

  // Displace vertices with 3D FBM + faceted rock crags
  const displaced: Array<[number, number, number]> = baseVerts.map(([vx, vy, vz]) => {
    const n = fbm3D(vx * noiseScale, vy * noiseScale, vz * noiseScale, 4, 0.5, 2.05, seed);
    const ridge = 1 - Math.abs(n);
    const r = radius * (1 + n * displacement + (ridge - 0.5) * displacement * 0.35);
    const yFlat = vy < -0.35 ? -0.35 * squashY + (vy + 0.35) * squashY * 0.4 : vy * squashY;
    return [vx * r, yFlat * r, vz * r];
  });

  // Shift so rock bottom rests cleanly at y = 0
  let minY = Infinity;
  for (const p of displaced) {
    if (p[1] < minY) minY = p[1];
  }
  for (const p of displaced) {
    p[1] -= minY;
  }

  // Accumulate vertex normals & edge wear
  const normAcc = displaced.map(() => [0, 0, 0] as [number, number, number]);
  for (const [ia, ib, ic] of tris) {
    const a = displaced[ia]!;
    const b = displaced[ib]!;
    const c = displaced[ic]!;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normAcc[ia]![0] += nx; normAcc[ia]![1] += ny; normAcc[ia]![2] += nz;
    normAcc[ib]![0] += nx; normAcc[ib]![1] += ny; normAcc[ib]![2] += nz;
    normAcc[ic]![0] += nx; normAcc[ic]![1] += ny; normAcc[ic]![2] += nz;
  }

  const mesh = createRawMeshData();
  for (let i = 0; i < displaced.length; i++) {
    const p = displaced[i]!;
    const n = normAcc[i]!;
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const nx = n[0] / l;
    const ny = n[1] / l;
    const nz = n[2] / l;
    const hNorm = Math.min(1, p[1] / Math.max(0.1, radius * squashY * 2));
    const vAO = ao * (0.48 + 0.52 * Math.sqrt(hNorm));
    const vWear = Math.max(0, Math.min(1, edgeWear * (0.5 + ny * 0.5)));
    pushVertex(mesh, p[0], p[1], p[2], nx, ny, nz, p[0], p[2], vAO, vWear, wetness, materialId);
  }
  for (const [ia, ib, ic] of tris) {
    mesh.indices.push(ia, ib, ic);
  }
  return mesh;
}

/**
 * Extrudes a 2D counter-clockwise polygon along Z [-depth/2, depth/2] with convex/ear-clipped caps.
 */
export function opExtrudeProfile(
  args: Record<string, unknown>,
  params: ParamMap,
  materialId: number,
  edgeWear: number,
  ao: number,
  wetness: number
): RawMeshData {
  const rawProfile = Array.isArray(args.profile) ? (args.profile as Array<[number | string, number | string]>) : [];
  const depth = Math.max(0.02, resolveNumber(args.depth, params, 0.4));
  const pts: Array<[number, number]> = rawProfile.map((pt) => [
    resolveNumber(pt[0], params, 0),
    resolveNumber(pt[1], params, 0),
  ]);
  if (pts.length < 3) {
    return buildBeveledBoxRaw(0.5, 0.5, depth, 0.015, materialId, edgeWear, ao, wetness);
  }

  // Ensure CCW winding in XY
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    area += x0 * y1 - x1 * y0;
  }
  if (area < 0) pts.reverse();

  const mesh = createRawMeshData();
  const hz = depth * 0.5;

  // Side walls
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const outX = dy / len;
    const outY = -dx / len;
    pushOrientedQuad(
      mesh,
      [x0, y0, -hz],
      [x1, y1, -hz],
      [x1, y1, hz],
      [x0, y0, hz],
      [outX, outY, 0],
      ao,
      edgeWear * 0.65,
      wetness,
      materialId
    );
  }

  // Simple ear-clipping for front (+hz) and back (-hz) caps
  const remaining = pts.map((_, idx) => idx);
  const cross2 = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const ptInTri = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) => {
    const c1 = cross2(a, b, p);
    const c2 = cross2(b, c, p);
    const c3 = cross2(c, a, p);
    return c1 >= -1e-6 && c2 >= -1e-6 && c3 >= -1e-6;
  };

  let guard = pts.length * 4;
  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const iPrev = remaining[(i - 1 + remaining.length) % remaining.length]!;
      const iCur = remaining[i]!;
      const iNext = remaining[(i + 1) % remaining.length]!;
      const a = pts[iPrev]!;
      const b = pts[iCur]!;
      const c = pts[iNext]!;
      if (cross2(a, b, c) <= 1e-6) continue;
      let hasInside = false;
      for (let j = 0; j < remaining.length; j++) {
        const idx = remaining[j]!;
        if (idx === iPrev || idx === iCur || idx === iNext) continue;
        if (ptInTri(pts[idx]!, a, b, c)) {
          hasInside = true;
          break;
        }
      }
      if (hasInside) continue;
      pushOrientedTri(mesh, [a[0], a[1], hz], [b[0], b[1], hz], [c[0], c[1], hz], [0, 0, 1], ao, edgeWear * 0.15, wetness, materialId);
      pushOrientedTri(mesh, [a[0], a[1], -hz], [c[0], c[1], -hz], [b[0], b[1], -hz], [0, 0, -1], ao, edgeWear * 0.15, wetness, materialId);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) {
    const a = pts[remaining[0]!]!;
    const b = pts[remaining[1]!]!;
    const c = pts[remaining[2]!]!;
    pushOrientedTri(mesh, [a[0], a[1], hz], [b[0], b[1], hz], [c[0], c[1], hz], [0, 0, 1], ao, edgeWear * 0.15, wetness, materialId);
    pushOrientedTri(mesh, [a[0], a[1], -hz], [c[0], c[1], -hz], [b[0], b[1], -hz], [0, 0, -1], ao, edgeWear * 0.15, wetness, materialId);
  }

  return mesh;
}

/**
 * Trapezoidal corrugated metal panel centered at (0, 0, 0), facing +Z/-Z, ribs running vertically along Y.
 * Profile constants match Fable 5.2 industrial container sheet (pitch=0.278, fin=0.070, slope=0.068, fout=0.072, depth=0.036).
 */
export function opCorrugatedPanel(
  args: Record<string, unknown>,
  params: ParamMap,
  materialId: number,
  edgeWear: number,
  ao: number,
  wetness: number
): RawMeshData {
  const width = Math.max(0.2, resolveNumber(args.width, params, 4.0));
  const height = Math.max(0.2, resolveNumber(args.height, params, 2.3));
  const pitch = Math.max(0.08, resolveNumber(args.pitch, params, 0.278));
  const fin = Math.max(0.01, resolveNumber(args.fin, params, 0.07));
  const slope = Math.max(0.01, resolveNumber(args.slope, params, 0.068));
  const fout = Math.max(0.01, resolveNumber(args.fout, params, 0.072));
  const depth = Math.max(0.008, resolveNumber(args.depth, params, 0.036));
  const thick = Math.max(0.008, resolveNumber(args.thickness, params, 0.014));

  const mesh = createRawMeshData();
  const count = Math.max(1, Math.round(width / pitch));
  const actualPitch = width / count;
  const scale = actualPitch / (fin + slope + fout + slope);
  const fIn = fin * scale;
  const fSlope = slope * scale;
  const fOut = fout * scale;
  const hy = height * 0.5;
  const hz = depth * 0.5;

  for (let i = 0; i < count; i++) {
    const x0 = -width * 0.5 + i * actualPitch;
    const x1 = x0 + fIn;
    const x2 = x1 + fSlope;
    const x3 = x2 + fOut;
    const x4 = x0 + actualPitch;

    const segs: Array<[number, number, number, number, number]> = [
      [x0, -hz, x1, -hz, 0.15],
      [x1, -hz, x2, hz, 0.65],
      [x2, hz, x3, hz, 0.9],
      [x3, hz, x4, -hz, 0.65],
    ];
    for (const [ax, az, bx, bz, wearScale] of segs) {
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      // Front face (+Z side)
      pushOrientedQuad(
        mesh,
        [ax, -hy, az],
        [bx, -hy, bz],
        [bx, hy, bz],
        [ax, hy, az],
        [nx, 0, nz],
        ao,
        edgeWear * wearScale,
        wetness,
        materialId
      );
      // Back face (-Z side, inset by thick)
      pushOrientedQuad(
        mesh,
        [bx, -hy, bz - thick],
        [ax, -hy, az - thick],
        [ax, hy, az - thick],
        [bx, hy, bz - thick],
        [-nx, 0, -nz],
        ao,
        edgeWear * wearScale * 0.5,
        wetness,
        materialId
      );
    }
  }
  return mesh;
}

/**
 * Industrial straight or bent flanged pipe segment along +X (centered at origin when straight).
 */
export function opPipeSegment(
  args: Record<string, unknown>,
  params: ParamMap,
  materialId: number,
  edgeWear: number,
  ao: number,
  wetness: number
): RawMeshData {
  const radius = Math.max(0.02, resolveNumber(args.radius, params, 0.11));
  const length = Math.max(0.2, resolveNumber(args.length, params, 2.0));
  const bendAngle = resolveNumber(args.bendAngle, params, 0);
  const bendRadius = Math.max(radius * 1.5, resolveNumber(args.bendRadius, params, 0.4));
  const flangeRadius = resolveNumber(args.flangeRadius, params, radius + 0.045);
  const flangeThickness = resolveNumber(args.flangeThickness, params, 0.06);
  const segments = Math.max(8, Math.min(28, Math.round(resolveNumber(args.segments, params, 14))));

  const out = createRawMeshData();

  if (Math.abs(bendAngle) < 0.01) {
    // Straight pipe rotated to run along X
    const pipe = opCylinder(
      { radiusTop: radius, radiusBottom: radius, height: length, segments },
      params,
      materialId,
      edgeWear,
      ao,
      wetness
    );
    // Rotate Y -> X (x' = -y, y' = x)
    for (let i = 0; i < pipe.positions.length; i += 3) {
      const px = pipe.positions[i]!;
      const py = pipe.positions[i + 1]!;
      pipe.positions[i] = py;
      pipe.positions[i + 1] = -px;
      const nx = pipe.normals[i]!;
      const ny = pipe.normals[i + 1]!;
      pipe.normals[i] = ny;
      pipe.normals[i + 1] = -nx;
    }
    appendRawMesh(out, pipe);

    for (const sx of [-1, 1] as const) {
      const flange = opCylinder(
        { radiusTop: flangeRadius, radiusBottom: flangeRadius, height: flangeThickness, segments },
        params,
        materialId,
        edgeWear * 1.1,
        ao,
        wetness
      );
      const xOff = sx * (length * 0.5 - flangeThickness * 0.5);
      for (let i = 0; i < flange.positions.length; i += 3) {
        const px = flange.positions[i]!;
        const py = flange.positions[i + 1]!;
        flange.positions[i] = py + xOff;
        flange.positions[i + 1] = -px;
        const nx = flange.normals[i]!;
        const ny = flange.normals[i + 1]!;
        flange.normals[i] = ny;
        flange.normals[i + 1] = -nx;
      }
      appendRawMesh(out, flange);
    }
    return out;
  }

  // Curved elbow in XZ plane from angle 0 to bendAngle around (0, 0, bendRadius)
  const arcSteps = Math.max(6, Math.round(Math.abs(bendAngle) * 10));
  const rings: number[][] = [];
  for (let s = 0; s <= arcSteps; s++) {
    const t = s / arcSteps;
    const ang = t * bendAngle;
    const cx = Math.sin(ang) * bendRadius;
    const cz = bendRadius - Math.cos(ang) * bendRadius;
    const tx = Math.cos(ang);
    const tz = Math.sin(ang);
    const rx = -tz;
    const rz = tx;
    const ring: number[] = [];
    for (let k = 0; k <= segments; k++) {
      const phi = (k / segments) * Math.PI * 2;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const nx = rx * cosP;
      const ny = sinP;
      const nz = rz * cosP;
      const px = cx + nx * radius;
      const py = ny * radius;
      const pz = cz + nz * radius;
      ring.push(
        pushVertex(
          out,
          px,
          py,
          pz,
          nx,
          ny,
          nz,
          t * bendRadius * Math.abs(bendAngle),
          (k / segments) * Math.PI * 2 * radius,
          ao,
          edgeWear,
          wetness,
          materialId
        )
      );
    }
    rings.push(ring);
  }
  for (let s = 0; s < arcSteps; s++) {
    const r0 = rings[s]!;
    const r1 = rings[s + 1]!;
    for (let k = 0; k < segments; k++) {
      out.indices.push(r0[k]!, r1[k]!, r1[k + 1]!, r0[k]!, r1[k + 1]!, r0[k + 1]!);
    }
  }
  return out;
}
