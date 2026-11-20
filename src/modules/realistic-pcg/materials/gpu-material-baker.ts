import * as THREE from 'three';
import { resolveBoolean, resolveNumber, type ParamMap } from '../core/safe-expr.js';
import type { BakedMaterialBuffers } from '../recipes/material-graph-eval.js';
import type { MaterialNodeSpec, MaterialRecipe } from '../recipes/schema-types.js';
import { parseHexColor, srgbChannelToLinear } from '../recipes/schema-validator.js';

const GLSL_NOISE_LIB = /* glsl */ `
precision highp float;

float h12(vec2 p, float s) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + s * 0.0173);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 h22(vec2 p, float s) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + s * 0.0137);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float pnoise(vec2 uv, vec2 per, float s) {
  vec2 p = uv * per;
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = h12(mod(i, per), s);
  float b = h12(mod(i + vec2(1.0, 0.0), per), s);
  float c = h12(mod(i + vec2(0.0, 1.0), per), s);
  float d = h12(mod(i + vec2(1.0, 1.0), per), s);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float pfbm(vec2 uv, vec2 freq, int octaves, float pers, float lac, float s) {
  float sum = 0.0;
  float amp = 1.0;
  float norm = 0.0;
  vec2 f = max(vec2(1.0), floor(freq + 0.5));
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * pnoise(uv, f, s + float(i) * 19.0);
    norm += amp;
    amp *= pers;
    f *= lac;
  }
  return clamp(sum / max(1e-4, norm), 0.0, 1.0);
}

vec4 pworley(vec2 uv, float scale, float jitter, float s) {
  float per = max(1.0, floor(scale + 0.5));
  vec2 p = uv * per;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 9.0;
  float d2 = 9.0;
  float cid = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 c = mod(i + g, per);
      vec2 rnd = (h22(c, s) - 0.5) * jitter + 0.5;
      vec2 r = g + rnd - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        cid = h12(c + 7.3, s);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float f1 = min(1.0, sqrt(d1));
  float f2 = min(1.0, sqrt(d2));
  return vec4(f1, f2, clamp(f2 - f1, 0.0, 1.0), cid);
}

vec3 pbrick(vec2 uv, float rows, float cols, float stagger, float mortar, float bevel, float variation, float s) {
  float gy = uv.y * rows;
  float r = floor(gy);
  float fy = gy - r;
  float wr = mod(r, rows);
  float shift = mod(wr, 2.0) >= 1.0 ? stagger : 0.0;
  float gx = uv.x * cols + shift;
  float c = floor(gx);
  float fx = gx - c;
  float wc = mod(c, cols);
  float cellRand = h12(vec2(wc, wr), s + 3.1);
  float mx = mortar * (cols / rows);
  float dx = min(fx, 1.0 - fx) - mx * 0.5;
  float dy = min(fy, 1.0 - fy) - mortar * 0.5;
  float dEdge = min(dx, dy);
  float mask = dEdge > 0.0 ? smoothstep(0.0, max(1e-4, bevel * 0.4), dEdge) : 0.0;
  float bev = dEdge > 0.0 ? smoothstep(0.0, max(1e-4, bevel), dEdge) : 0.0;
  float rh = 1.0 - variation * 0.35 + (cellRand - 0.5) * variation * 0.4;
  float h = clamp(0.18 + mask * bev * 0.72 * rh, 0.0, 1.0);
  return vec3(h, mask, cellRand);
}

vec4 pplank(vec2 uv, float planks, float joints, float gap, float bevel, float variation, float nailsOn, float s) {
  float px = uv.x * planks;
  float pi = floor(px);
  float fx = px - pi;
  float wp = mod(pi, planks);
  float stag = h12(vec2(wp, 3.0), s + 4.1) * 0.8;
  float py = (uv.y + stag) * joints;
  float ji = floor(py);
  float fy = py - ji;
  float wj = mod(ji, joints);
  float cellRand = h12(vec2(wp, wj), s + 7.1);
  float dx = min(fx, 1.0 - fx) - gap * 0.5 * planks;
  float dy = min(fy, 1.0 - fy) - gap * 0.5 * joints;
  float dEdge = min(dx, dy);
  float mask = dEdge > 0.0 ? smoothstep(0.0, max(1e-4, bevel * 0.5), dEdge) : 0.0;
  float bev = dEdge > 0.0 ? smoothstep(0.0, max(1e-4, bevel), dEdge) : 0.0;
  float nail = 0.0;
  if (nailsOn > 0.5 && mask > 0.5) {
    float ny = min(abs(fy - 0.08), abs(fy - 0.92)) / joints;
    float nx = min(abs(fx - 0.25), abs(fx - 0.75)) / planks;
    nail = 1.0 - smoothstep(0.005, 0.011, length(vec2(nx, ny)));
  }
  float pb = 1.0 - variation * 0.25 + (cellRand - 0.5) * variation * 0.3;
  float fiber = (pnoise(uv, vec2(planks * 14.0, joints * 3.0), s + 5.7) - 0.5) * 0.12;
  float h = clamp(0.12 + mask * bev * 0.78 * pb + fiber * mask - nail * 0.22, 0.0, 1.0);
  return vec4(h, mask, cellRand, nail);
}

vec3 pwood(vec2 uv, float scale, float ringScale, float distortion, float sx, float sy, float s) {
  float warp = (pnoise(uv, vec2(scale * sx, scale * sy), s + 5.1) - 0.5) * 2.0;
  float rc = uv.x * ringScale + warp * distortion * 4.0;
  float ringWave = 0.5 + 0.5 * sin(rc * 6.2831853);
  float fine = pnoise(uv, vec2(scale * 6.0, scale * 2.0), s + 13.1);
  float g = clamp(ringWave * 0.65 + fine * 0.35, 0.0, 1.0);
  return vec3(clamp(0.35 + g * 0.55, 0.0, 1.0), g, 1.0);
}

vec3 pcorrugated(vec2 uv, float count, float axisY, float fin, float slope, float fout, float depth) {
  float coord = axisY > 0.5 ? uv.y : uv.x;
  float ph = fract(coord * count);
  float t1 = fin;
  float t2 = t1 + slope;
  float t3 = t2 + fout;
  float t4 = min(1.0, t3 + slope);
  float h = 0.0;
  float ridge = 0.0;
  float edge = 0.0;
  if (ph < t1) {
    h = 0.0;
  } else if (ph < t2) {
    float t = (ph - t1) / max(1e-4, slope);
    h = smoothstep(0.0, 1.0, t);
    ridge = smoothstep(0.45, 0.95, t);
    edge = sin(t * 3.1415926);
  } else if (ph < t3) {
    h = 1.0;
    ridge = 1.0;
    float dEdge = min(ph - t2, t3 - ph);
    edge = 1.0 - smoothstep(0.0, 0.04, dEdge);
  } else if (ph < t4) {
    float t = 1.0 - (ph - t3) / max(1e-4, t4 - t3);
    h = smoothstep(0.0, 1.0, t);
    ridge = smoothstep(0.45, 0.95, t);
    edge = sin(t * 3.1415926);
  }
  return vec3(h * depth, ridge, edge);
}

float pweave(vec2 uv, float threads, float slub, float s) {
  vec2 p = uv * threads;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float over = mod(i.x + i.y, 2.0);
  float wx = 0.75 + slub * (h12(vec2(mod(i.x, threads), 7.0), s + 5.9) - 0.5) * 1.4;
  float wy = 0.75 + slub * (h12(vec2(3.0, mod(i.y, threads)), s + 5.3) - 0.5) * 1.4;
  float tx = max(0.0, 1.0 - abs(f.x - 0.5) * 2.0 / max(0.1, wx));
  float ty = max(0.0, 1.0 - abs(f.y - 0.5) * 2.0 / max(0.1, wy));
  float warp = sqrt(tx) * (over >= 0.5 ? 1.0 : 0.52) * (0.62 + 0.38 * sin(f.y * 3.1415926));
  float weft = sqrt(ty) * (over >= 0.5 ? 0.52 : 1.0) * (0.62 + 0.38 * sin(f.x * 3.1415926));
  float n = (pnoise(uv, vec2(threads), s + 6.1) - 0.5) * 0.16 * slub;
  return clamp(max(warp, weft) + n, 0.0, 1.0);
}

float psand(vec2 uv, float freq, float warpScale, float warpStrength, float sharpness, float grainScale, float s) {
  float w = pfbm(uv, vec2(warpScale), 3, 0.5, 2.0, s + 10.1);
  float w2 = pfbm(uv, vec2(warpScale * 3.0), 2, 0.5, 2.0, s + 21.1);
  float rr = 0.5 + 0.5 * sin((uv.y * freq + w * warpStrength + w2 * 1.1) * 6.2831853);
  float patchM = smoothstep(0.25, 0.62, w + 0.15);
  float rip = pow(max(0.0, rr), sharpness) * patchM;
  float fine = pfbm(uv, vec2(grainScale), 2, 0.5, 2.0, s + 31.3);
  return clamp(rip * 0.72 + fine * 0.28, 0.0, 1.0);
}

vec2 privet(vec2 uv, float cols, float rows, float rad) {
  vec2 f = fract(uv * vec2(cols, rows)) - 0.5;
  float d = length(f) / max(0.005, rad);
  float m = d < 1.0 ? (1.0 - smoothstep(0.75, 1.0, d)) : 0.0;
  float dome = d < 1.0 ? sqrt(max(0.0, 1.0 - d * d)) : 0.0;
  return vec2(dome, m);
}

float pspeckle(vec2 uv, float scale, float density, float softness, float s) {
  float per = max(2.0, floor(scale + 0.5));
  vec2 g = uv * per;
  vec2 ig = mod(floor(g), per);
  vec2 fg = fract(g) - 0.5;
  float h = h12(ig, s + 6.13);
  if (h >= density) return 0.0;
  vec2 r2 = h22(ig, s + 9.7);
  float rMax = 0.25 + r2.x * 0.25;
  vec2 off = (r2 - 0.5) * 0.25;
  float d = length(fg - off);
  return 1.0 - smoothstep(rMax * (1.0 - softness * 0.8), rMax, d);
}

float pstripes(vec2 uv, float count, float axisMode, float width, float softness, float noiseAmt, float s) {
  float coord = axisMode > 1.5 ? (uv.x + uv.y) : (axisMode > 0.5 ? uv.y : uv.x);
  float n = noiseAmt > 0.0 ? (pnoise(uv, vec2(count * 2.0), s + 9.9) - 0.5) * 2.0 * noiseAmt : 0.0;
  float p = fract(coord * count + n);
  float dist = abs(p - 0.5) * 2.0;
  return 1.0 - smoothstep(width - softness, width + softness, dist);
}

float srgbToLin(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
vec3 srgbToLin3(vec3 c) {
  return vec3(srgbToLin(c.r), srgbToLin(c.g), srgbToLin(c.b));
}
float linToSrgb(float c) {
  c = clamp(c, 0.0, 1.0);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
vec3 linToSrgb3(vec3 c) {
  return vec3(linToSrgb(c.r), linToSrgb(c.g), linToSrgb(c.b));
}

vec2 packH16(float h) {
  h = clamp(h, 0.0, 1.0);
  float s = h * 255.0;
  float hi = floor(s) / 255.0;
  float lo = fract(s);
  return vec2(hi, lo);
}
float unpackH16(vec2 rg) {
  return rg.r + rg.g / 255.0;
}
`;

function fLit(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  const s = n.toFixed(6);
  return s.includes('.') ? s : s + '.0';
}

function hexToGlslVec3(hex: string): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return 'vec3(0.5)';
  return `vec3(${fLit(rgb[0] / 255)}, ${fLit(rgb[1] / 255)}, ${fLit(rgb[2] / 255)})`;
}

function hexToGlslLinVec3(hex: string): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return 'vec3(0.2)';
  return `vec3(${fLit(srgbChannelToLinear(rgb[0]))}, ${fLit(srgbChannelToLinear(rgb[1]))}, ${fLit(srgbChannelToLinear(rgb[2]))})`;
}

function sanitizeId(id: string): string {
  return 'n_' + id.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+/, '');
}

export interface GpuBakerContext {
  bakeMaterial(recipe: MaterialRecipe, size: number, paramOverrides?: ParamMap): BakedMaterialBuffers;
  dispose(): void;
}

export function createGpuMaterialBaker(renderer: THREE.WebGLRenderer): GpuBakerContext {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadMesh = new THREE.Mesh(quadGeo);
  quadMesh.frustumCulled = false;
  scene.add(quadMesh);

  let cachedSize = 0;
  let mrtRT: THREE.WebGLRenderTarget | null = null;
  let outRT: THREE.WebGLRenderTarget | null = null;

  function ensureTargets(size: number): void {
    if (cachedSize === size && mrtRT && outRT) return;
    mrtRT?.dispose();
    outRT?.dispose();
    const opts = {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    mrtRT = new THREE.WebGLRenderTarget(size, size, { ...opts, count: 3 });
    outRT = new THREE.WebGLRenderTarget(size, size, opts);
    cachedSize = size;
  }

  function compileGraphBody(
    recipe: MaterialRecipe,
    params: ParamMap,
    size: number
  ): {
    body: string;
    heightVar: string;
    normalStrength: number;
    albedoExpr: string;
    aoExpr: string;
    roughExpr: string;
    metalExpr: string;
    porosityExpr: string;
    hasBlur: boolean;
  } {
    const seedF = (recipe.meta.seed % 9973) * 0.01;
    const nodeById = new Map<string, MaterialNodeSpec>();
    for (const n of recipe.nodes) nodeById.set(n.id, n);

    const execList: MaterialNodeSpec[] = [];
    const added = new Set<string>();
    const visit = (id: string) => {
      if (added.has(id)) return;
      const n = nodeById.get(id);
      if (!n) return;
      for (const k of ['input', 'a', 'b', 'mask', 'warpX', 'warpY']) {
        const ref = n.args[k];
        if (typeof ref === 'string' && !ref.startsWith('#') && !ref.startsWith('$')) {
          visit(ref.split('.')[0]!);
        }
      }
      added.add(id);
      execList.push(n);
    };
    for (const n of recipe.nodes) visit(n.id);

    // Append inline outputs
    const outputKeys: Array<keyof MaterialRecipe['outputs']> = [
      'albedo', 'height', 'normal', 'ao', 'roughness', 'metalness', 'porosity',
    ];
    const inlineNames: Partial<Record<keyof MaterialRecipe['outputs'], string>> = {};
    for (const ok of outputKeys) {
      const spec = recipe.outputs[ok];
      if (spec && typeof spec === 'object') {
        const synId = `inline_out_${ok}`;
        const args = spec.args ? spec.args : { ...spec };
        execList.push({ id: synId, op: spec.op, args });
        inlineNames[ok] = synId;
      }
    }

    const colorVars = new Set<string>();
    const lines: string[] = [];
    let hasBlur = false;
    let normalStrength = 2.0;
    let heightNodeName = '';

    const refScalar = (ref: unknown, def = 0): string => {
      if (typeof ref === 'number') return fLit(ref);
      if (typeof ref === 'string') {
        if (ref.startsWith('$') || ref.startsWith('expr:')) {
          return fLit(resolveNumber(ref, params, def));
        }
        const [base, sub] = ref.split('.');
        const v = sanitizeId(base!);
        if (sub) return `${v}_${sub}`;
        return v;
      }
      return fLit(def);
    };

    const refColor = (ref: unknown): string => {
      if (typeof ref === 'string') {
        if (ref.startsWith('#')) return hexToGlslVec3(ref);
        if (ref.startsWith('$') || ref.startsWith('expr:')) {
          return `vec3(${fLit(resolveNumber(ref, params, 0.5))})`;
        }
        const v = sanitizeId(ref.split('.')[0]!);
        return colorVars.has(v) ? v : `vec3(${refScalar(ref, 0.5)})`;
      }
      if (typeof ref === 'number') return `vec3(${fLit(ref)})`;
      return 'vec3(0.5)';
    };

    const isColorRef = (ref: unknown): boolean => {
      if (typeof ref !== 'string') return false;
      if (ref.startsWith('#')) return true;
      return colorVars.has(sanitizeId(ref.split('.')[0]!));
    };

    for (const node of execList) {
      const v = sanitizeId(node.id);
      const args = node.args;
      switch (node.op) {
        case 'fbm': {
          const scale = resolveNumber(args.scale, params, 8);
          const oct = Math.max(1, Math.min(8, Math.round(resolveNumber(args.octaves, params, 4))));
          const pers = resolveNumber(args.persistence, params, 0.5);
          const lac = resolveNumber(args.lacunarity, params, 2);
          lines.push(`float ${v} = pfbm(uv, vec2(${fLit(scale)}), ${oct}, ${fLit(pers)}, ${fLit(lac)}, ${fLit(seedF)});`);
          break;
        }
        case 'worley': {
          const scale = resolveNumber(args.scale, params, 8);
          const jitter = resolveNumber(args.jitter, params, 0.9);
          const mode = String(args.mode ?? 'f1');
          lines.push(`vec4 ${v}_w = pworley(uv, ${fLit(scale)}, ${fLit(jitter)}, ${fLit(seedF + 0.17)});`);
          lines.push(`float ${v}_f1 = ${v}_w.x; float ${v}_f2 = ${v}_w.y; float ${v}_f2_minus_f1 = ${v}_w.z; float ${v}_cellRand = ${v}_w.w;`);
          lines.push(`float ${v}_edge = 1.0 - smoothstep(0.02, 0.16, ${v}_f2_minus_f1);`);
          const mainPick =
            mode === 'f2' ? `${v}_f2` :
            mode === 'f2_minus_f1' ? `${v}_f2_minus_f1` :
            mode === 'cell_rand' ? `${v}_cellRand` :
            mode === 'edge' ? `${v}_edge` : `${v}_f1`;
          lines.push(`float ${v} = ${mainPick};`);
          break;
        }
        case 'brick_pattern': {
          const rows = resolveNumber(args.rows, params, 8);
          const cols = resolveNumber(args.cols, params, 4);
          const stagger = resolveNumber(args.stagger, params, 0.5);
          const mortar = resolveNumber(args.mortar, params, 0.04);
          const bevel = resolveNumber(args.bevel, params, 0.03);
          const variation = resolveNumber(args.variation, params, 0.35);
          lines.push(`vec3 ${v}_b = pbrick(uv, ${fLit(rows)}, ${fLit(cols)}, ${fLit(stagger)}, ${fLit(mortar)}, ${fLit(bevel)}, ${fLit(variation)}, ${fLit(seedF)});`);
          lines.push(`float ${v} = ${v}_b.x; float ${v}_height = ${v}_b.x; float ${v}_mask = ${v}_b.y; float ${v}_cellRand = ${v}_b.z;`);
          break;
        }
        case 'plank_pattern': {
          const planks = resolveNumber(args.planks, params, 6);
          const joints = resolveNumber(args.joints, params, 2);
          const gap = resolveNumber(args.gap, params, 0.015);
          const bevel = resolveNumber(args.bevel, params, 0.025);
          const variation = resolveNumber(args.variation, params, 0.4);
          const nails = resolveBoolean(args.nails, params, true) ? 1 : 0;
          lines.push(`vec4 ${v}_p = pplank(uv, ${fLit(planks)}, ${fLit(joints)}, ${fLit(gap)}, ${fLit(bevel)}, ${fLit(variation)}, ${fLit(nails)}, ${fLit(seedF)});`);
          lines.push(`float ${v} = ${v}_p.x; float ${v}_height = ${v}_p.x; float ${v}_mask = ${v}_p.y; float ${v}_cellRand = ${v}_p.z; float ${v}_nails = ${v}_p.w;`);
          break;
        }
        case 'wood_grain': {
          const scale = resolveNumber(args.scale, params, 6);
          const ringScale = resolveNumber(args.ringScale, params, 18);
          const distortion = resolveNumber(args.distortion, params, 0.35);
          const sx = resolveNumber(args.stretchX, params, 1);
          const sy = resolveNumber(args.stretchY, params, 6);
          lines.push(`vec3 ${v}_wg = pwood(uv, ${fLit(scale)}, ${fLit(ringScale)}, ${fLit(distortion)}, ${fLit(sx)}, ${fLit(sy)}, ${fLit(seedF)});`);
          lines.push(`float ${v} = ${v}_wg.x; float ${v}_height = ${v}_wg.x; float ${v}_grain = ${v}_wg.y; float ${v}_mask = ${v}_wg.z;`);
          break;
        }
        case 'corrugated_wave': {
          const count = resolveNumber(args.count, params, 5);
          const axisY = String(args.axis ?? 'x') === 'y' ? 1 : 0;
          const fin = resolveNumber(args.fin, params, 0.26);
          const slope = resolveNumber(args.slope, params, 0.24);
          const fout = resolveNumber(args.fout, params, 0.26);
          const depth = resolveNumber(args.depth, params, 1.0);
          lines.push(`vec3 ${v}_cw = pcorrugated(uv, ${fLit(count)}, ${fLit(axisY)}, ${fLit(fin)}, ${fLit(slope)}, ${fLit(fout)}, ${fLit(depth)});`);
          lines.push(`float ${v} = ${v}_cw.x; float ${v}_height = ${v}_cw.x; float ${v}_ridge = ${v}_cw.y; float ${v}_edge = ${v}_cw.z;`);
          break;
        }
        case 'edge_wear_mask': {
          const src = refScalar(args.input, 0.5);
          const low = resolveNumber(args.low, params, 0.35);
          const high = resolveNumber(args.high, params, 0.65);
          const ns = resolveNumber(args.noiseScale, params, 10);
          const spread = resolveNumber(args.spread, params, 0.45);
          lines.push(`float ${v}_n = pfbm(uv, vec2(${fLit(ns)}), 3, 0.55, 2.0, ${fLit(seedF + 0.43)});`);
          lines.push(`float ${v} = smoothstep(${fLit(low)}, ${fLit(high)}, clamp(${src} * 0.8 + (${v}_n - 0.5) * ${fLit(spread)}, 0.0, 1.0));`);
          break;
        }
        case 'vertical_streak': {
          const scaleX = resolveNumber(args.scaleX, params, 14);
          const scaleY = resolveNumber(args.scaleY, params, 3);
          const thresh = resolveNumber(args.threshold, params, 0.54);
          const seedOff = resolveNumber(args.seedOffset, params, 0) * 0.01;
          const baseSrc = args.input ? refScalar(args.input, 0.5) : '0.5';
          lines.push(`float ${v}_col = smoothstep(0.25, 0.78, pnoise(vec2(uv.x, 0.37), vec2(${fLit(scaleX)}, 1.0), ${fLit(seedF + 0.81 + seedOff)}));`);
          lines.push(`float ${v}_acc = 0.0; for (int k = 0; k < 6; k++) { float dy = float(k) * 0.035; float n = pfbm(vec2(uv.x, fract(uv.y + dy)), vec2(${fLit(scaleX)}, ${fLit(scaleY)}), 3, 0.52, 2.0, ${fLit(seedF + 0.88 + seedOff)}); float src = smoothstep(${fLit(thresh - 0.06)}, ${fLit(thresh + 0.06)}, ${baseSrc} * 0.5 + n * 0.5); ${v}_acc = max(${v}_acc, src * ${v}_col * pow(0.84, float(k))); }`);
          lines.push(`float ${v} = clamp(${v}_acc * ${v}_acc, 0.0, 1.0);`);
          break;
        }
        case 'rivet_grid': {
          const cols = resolveNumber(args.cols, params, 4);
          const rows = resolveNumber(args.rows, params, 2);
          const rad = resolveNumber(args.radius, params, 0.08);
          lines.push(`vec2 ${v}_rv = privet(uv, ${fLit(cols)}, ${fLit(rows)}, ${fLit(rad)});`);
          lines.push(`float ${v} = ${v}_rv.x; float ${v}_height = ${v}_rv.x; float ${v}_mask = ${v}_rv.y;`);
          break;
        }
        case 'sand_ripples': {
          const freq = resolveNumber(args.freq, params, 16);
          const ws = resolveNumber(args.warpScale, params, 3);
          const wstr = resolveNumber(args.warpStrength, params, 4.2);
          const sharp = resolveNumber(args.sharpness, params, 1.7);
          const gs = resolveNumber(args.grainScale, params, 28);
          lines.push(`float ${v} = psand(uv, ${fLit(freq)}, ${fLit(ws)}, ${fLit(wstr)}, ${fLit(sharp)}, ${fLit(gs)}, ${fLit(seedF)});`);
          break;
        }
        case 'fabric_weave': {
          const threads = resolveNumber(args.threads, params, 48);
          const slub = resolveNumber(args.slub, params, 0.3);
          lines.push(`float ${v} = pweave(uv, ${fLit(threads)}, ${fLit(slub)}, ${fLit(seedF)});`);
          break;
        }
        case 'stripes': {
          const count = resolveNumber(args.count, params, 12);
          const axis = String(args.axis ?? 'x');
          const axisMode = axis === 'diag' ? 2 : axis === 'y' ? 1 : 0;
          const width = resolveNumber(args.width, params, 0.5);
          const soft = resolveNumber(args.softness, params, 0.15);
          const n = resolveNumber(args.noise, params, 0.08);
          lines.push(`float ${v} = pstripes(uv, ${fLit(count)}, ${fLit(axisMode)}, ${fLit(width)}, ${fLit(soft)}, ${fLit(n)}, ${fLit(seedF)});`);
          break;
        }
        case 'speckle': {
          const scale = resolveNumber(args.scale, params, 32);
          const density = resolveNumber(args.density, params, 0.35);
          const soft = resolveNumber(args.softness, params, 0.5);
          const soff = resolveNumber(args.seedOffset, params, 0) * 0.01;
          lines.push(`float ${v} = pspeckle(uv, ${fLit(scale)}, ${fLit(density)}, ${fLit(soft)}, ${fLit(seedF + soff)});`);
          break;
        }
        case 'remap': {
          const src = refScalar(args.input, 0);
          const i0 = resolveNumber(args.inMin, params, 0);
          const i1 = resolveNumber(args.inMax, params, 1);
          const o0 = resolveNumber(args.outMin, params, 0);
          const o1 = resolveNumber(args.outMax, params, 1);
          const span = Math.abs(i1 - i0) < 1e-5 ? 1e-5 : i1 - i0;
          lines.push(`float ${v} = mix(${fLit(o0)}, ${fLit(o1)}, clamp((${src} - ${fLit(i0)}) / ${fLit(span)}, 0.0, 1.0));`);
          break;
        }
        case 'clamp': {
          const src = refScalar(args.input, 0);
          const mn = resolveNumber(args.min, params, 0);
          const mx = resolveNumber(args.max, params, 1);
          lines.push(`float ${v} = clamp(${src}, ${fLit(mn)}, ${fLit(mx)});`);
          break;
        }
        case 'invert': {
          lines.push(`float ${v} = 1.0 - (${refScalar(args.input, 0)});`);
          break;
        }
        case 'power': {
          const exp = resolveNumber(args.exp, params, 1);
          lines.push(`float ${v} = pow(max(0.0, ${refScalar(args.input, 0)}), ${fLit(exp)});`);
          break;
        }
        case 'blur': {
          hasBlur = true;
          lines.push(`float ${v} = ${refScalar(args.input, 0)};`);
          break;
        }
        case 'domain_warp': {
          lines.push(`float ${v} = ${refScalar(args.input, 0.5)};`);
          break;
        }
        case 'height_to_normal': {
          normalStrength = resolveNumber(args.strength, params, 2.0);
          heightNodeName = typeof args.input === 'string' ? args.input : '';
          colorVars.add(v);
          lines.push(`vec3 ${v} = vec3(0.5, 0.5, 1.0);`);
          break;
        }
        case 'mix_scalar': {
          lines.push(`float ${v} = mix(${refScalar(args.a, 0)}, ${refScalar(args.b, 1)}, clamp(${refScalar(args.mask, 0.5)}, 0.0, 1.0));`);
          break;
        }
        case 'mix_color': {
          colorVars.add(v);
          const aC = refColor(args.a);
          const bC = refColor(args.b);
          const m = `clamp(${refScalar(args.mask, 0.5)}, 0.0, 1.0)`;
          lines.push(`vec3 ${v} = linToSrgb3(mix(srgbToLin3(${aC}), srgbToLin3(${bC}), ${m}));`);
          break;
        }
        case 'color_ramp': {
          colorVars.add(v);
          const inp = refScalar(args.input, 0.5);
          const rawStops = (args.stops ?? [[0, '#444444'], [1, '#aaaaaa']]) as Array<[number, string]>;
          const stops = [...rawStops].sort((a, b) => a[0] - b[0]);
          lines.push(`vec3 ${v}_lin = ${hexToGlslLinVec3(stops[0]![1])};`);
          for (let sIdx = 0; sIdx < stops.length - 1; sIdx++) {
            const s0 = stops[sIdx]!;
            const s1 = stops[sIdx + 1]!;
            const span = Math.max(1e-5, s1[0] - s0[0]);
            lines.push(
              `if (${inp} >= ${fLit(s0[0])}) { ${v}_lin = mix(${hexToGlslLinVec3(s0[1])}, ${hexToGlslLinVec3(s1[1])}, clamp((${inp} - ${fLit(s0[0])}) / ${fLit(span)}, 0.0, 1.0)); }`
            );
          }
          lines.push(`vec3 ${v} = linToSrgb3(${v}_lin);`);
          break;
        }
        case 'blend': {
          const mode = String(args.mode ?? 'multiply');
          const str = Math.max(0, Math.min(1, resolveNumber(args.strength, params, 1.0)));
          const isCol = isColorRef(args.a) || isColorRef(args.b);
          const fn = (a: string, b: string) => {
            switch (mode) {
              case 'add': return `clamp(${a} + ${b} * ${fLit(str)}, 0.0, 1.0)`;
              case 'sub': return `clamp(${a} - ${b} * ${fLit(str)}, 0.0, 1.0)`;
              case 'min': return `mix(${a}, min(${a}, ${b}), ${fLit(str)})`;
              case 'max': return `mix(${a}, max(${a}, ${b}), ${fLit(str)})`;
              case 'screen': return `mix(${a}, 1.0 - (1.0 - ${a}) * (1.0 - ${b}), ${fLit(str)})`;
              case 'overlay': return `mix(${a}, (${a} < 0.5 ? 2.0 * ${a} * ${b} : 1.0 - 2.0 * (1.0 - ${a}) * (1.0 - ${b})), ${fLit(str)})`;
              default: return `mix(${a}, ${a} * ${b}, ${fLit(str)})`;
            }
          };
          if (isCol) {
            colorVars.add(v);
            lines.push(`vec3 ${v} = ${fn(refColor(args.a), refColor(args.b))};`);
          } else {
            lines.push(`float ${v} = ${fn(refScalar(args.a, 0), refScalar(args.b, 0))};`);
          }
          break;
        }
      }
    }

    const outExprColor = (k: keyof MaterialRecipe['outputs']): string => {
      const syn = inlineNames[k];
      if (syn) return refColor(syn);
      return refColor(recipe.outputs[k]);
    };
    const outExprScalar = (k: keyof MaterialRecipe['outputs'], def: number): string => {
      const syn = inlineNames[k];
      if (syn) return refScalar(syn, def);
      return refScalar(recipe.outputs[k], def);
    };

    return {
      body: lines.join('\n'),
      heightVar: heightNodeName ? refScalar(heightNodeName, 0.5) : outExprScalar('height', 0.5),
      normalStrength,
      albedoExpr: outExprColor('albedo'),
      aoExpr: outExprScalar('ao', 1.0),
      roughExpr: outExprScalar('roughness', 0.7),
      metalExpr: outExprScalar('metalness', 0.0),
      porosityExpr: outExprScalar('porosity', 0.3),
      hasBlur,
    };
  }

  const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const sharedNormalMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tH: { value: null },
      uPx: { value: 1.0 / 512.0 },
      uStr: { value: 2.0 },
    },
    fragmentShader: `${GLSL_NOISE_LIB}
varying vec2 vUv;
uniform sampler2D tH;
uniform float uPx;
uniform float uStr;
float sampleH(vec2 uv) { return unpackH16(texture2D(tH, uv).rg); }
void main() {
  float tl = sampleH(vUv + vec2(-uPx, -uPx));
  float t  = sampleH(vUv + vec2( 0.0, -uPx));
  float tr = sampleH(vUv + vec2( uPx, -uPx));
  float l  = sampleH(vUv + vec2(-uPx,  0.0));
  float r  = sampleH(vUv + vec2( uPx,  0.0));
  float bl = sampleH(vUv + vec2(-uPx,  uPx));
  float b  = sampleH(vUv + vec2( 0.0,  uPx));
  float br = sampleH(vUv + vec2( uPx,  uPx));
  float dX = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float dY = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
  vec3 n = normalize(vec3(-dX * uStr, dY * uStr, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`,
  });

  return {
    bakeMaterial(recipe: MaterialRecipe, size: number, paramOverrides?: ParamMap): BakedMaterialBuffers {
      ensureTargets(size);
      const params: ParamMap = { ...(recipe.params ?? {}), ...(paramOverrides ?? {}) };
      const compiled = compileGraphBody(recipe, params, size);
      const prevRT = renderer.getRenderTarget();

      // Single-pass WebGL2 MRT DAG evaluation (cuts noise/FBM math by 3x)
      // Attachment 0: Albedo (with non-metal luma guardrail) + Height
      // Attachment 1: ORM + Porosity
      // Attachment 2: Packed 16-bit Height for Sobel Normal pass
      const dagMat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        glslVersion: THREE.GLSL3,
        depthTest: false,
        depthWrite: false,
        fragmentShader: `${GLSL_NOISE_LIB}
varying vec2 vUv;
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oOrm;
layout(location = 2) out vec4 oHeight;
void main() {
  vec2 uv = vUv;
  ${compiled.body}
  float hOut = clamp(${compiled.heightVar}, 0.0, 1.0);
  vec2 h16 = packH16(hOut);
  float met = clamp(${compiled.metalExpr}, 0.0, 1.0);
  vec3 albS = clamp(${compiled.albedoExpr}, 0.0, 1.0);
  if (met < 0.5) {
    vec3 lin = srgbToLin3(albS);
    float luma = dot(lin, vec3(0.2126, 0.7152, 0.0722));
    if (luma < 0.04) {
      lin = luma > 1e-4 ? lin * (0.04 / luma) : vec3(0.04);
      albS = linToSrgb3(lin);
    } else if (luma > 0.85) {
      lin *= 0.85 / luma;
      albS = linToSrgb3(lin);
    }
  }
  float ao = clamp(${compiled.aoExpr}, 0.0, 1.0);
  float rgh = clamp(${compiled.roughExpr}, 0.05, 1.0);
  float por = clamp(${compiled.porosityExpr}, 0.0, 1.0);
  oAlbedo = vec4(albS, hOut);
  oOrm = vec4(ao, rgh, met, por);
  oHeight = vec4(h16.x, h16.y, met, hOut);
}`,
      });

      quadMesh.material = dagMat;
      renderer.setRenderTarget(mrtRT);
      renderer.render(scene, camera);
      dagMat.dispose();

      const albedoData = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(mrtRT!, 0, 0, size, size, albedoData, undefined, 0);

      const ormData = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(mrtRT!, 0, 0, size, size, ormData, undefined, 1);

      // Pass 2: Shared Sobel 3x3 Tangent Normal from mrtRT attachment 2 (OpenGL +Y convention)
      sharedNormalMat.uniforms.tH!.value = mrtRT!.textures[2];
      sharedNormalMat.uniforms.uPx!.value = 1.0 / size;
      sharedNormalMat.uniforms.uStr!.value = compiled.normalStrength;
      quadMesh.material = sharedNormalMat;
      renderer.setRenderTarget(outRT);
      renderer.render(scene, camera);
      const normalData = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(outRT!, 0, 0, size, size, normalData);

      renderer.setRenderTarget(prevRT);

      // Compute summary stats cleanly (sample stride 4 for speed)
      let minR = 1;
      let maxR = 0;
      let minL = 1;
      let maxL = 0;
      for (let i = 0; i < ormData.length; i += 16) {
        const r = ormData[i + 1]! / 255;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        const rl = srgbChannelToLinear(albedoData[i]!);
        const gl = srgbChannelToLinear(albedoData[i + 1]!);
        const bl = srgbChannelToLinear(albedoData[i + 2]!);
        const luma = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
        if (luma < minL) minL = luma;
        if (luma > maxL) maxL = luma;
      }

      return {
        id: recipe.id,
        size,
        albedoData,
        normalData,
        ormData,
        stats: {
          minRoughness: minR,
          maxRoughness: maxR,
          minLinearLuma: minL,
          maxLinearLuma: maxL,
        },
      };
    },

    dispose(): void {
      mrtRT?.dispose();
      outRT?.dispose();
      mrtRT = null;
      outRT = null;
      sharedNormalMat.dispose();
      quadGeo.dispose();
      scene.clear();
    },
  };
}
