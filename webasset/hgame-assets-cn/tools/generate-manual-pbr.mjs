import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hash2(ix, iy, seed = 1) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2D(u, v, period, seed) {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const ix0 = ((x0 % period) + period) % period;
  const iy0 = ((y0 % period) + period) % period;
  const ix1 = (ix0 + 1) % period;
  const iy1 = (iy0 + 1) % period;
  const a = hash2(ix0, iy0, seed);
  const b = hash2(ix1, iy0, seed);
  const c = hash2(ix0, iy1, seed);
  const d = hash2(ix1, iy1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function periodicFbm(u, v, basePeriod = 8, octaves = 4, seed = 1) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2D(u, v, p, seed + o * 97) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

function heightToNormal(height, size, strength = 2.5) {
  const normal = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dhdx = (height[y * size + xp] - height[y * size + xm]) * strength;
      const dhdy = (height[yp * size + x] - height[ym * size + x]) * strength;
      let nx = -dhdx;
      let ny = dhdy; // OpenGL +Y up (y=0 top -> positive dhdy means downward slope)
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      normal[i] = Math.round(clamp01((nx + 1) * 0.5) * 255);
      normal[i + 1] = Math.round(clamp01((ny + 1) * 0.5) * 255);
      normal[i + 2] = Math.round(clamp01((nz + 1) * 0.5) * 255);
      normal[i + 3] = 255;
    }
  }
  return normal;
}

function buildBuffers(size, fn) {
  const color = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const rough = new Uint8Array(size * size);
  const metal = new Uint8Array(size * size);
  const ao = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const p = fn(u, v, x, y);
      const i = idx * 4;
      color[i] = Math.round(clamp01(p.r) * 255);
      color[i + 1] = Math.round(clamp01(p.g) * 255);
      color[i + 2] = Math.round(clamp01(p.b) * 255);
      color[i + 3] = Math.round(clamp01(p.a ?? 1) * 255);
      height[idx] = p.h ?? 0.5;
      rough[idx] = Math.round(clamp01(p.rough ?? 0.7) * 255);
      metal[idx] = Math.round(clamp01(p.metal ?? 0) * 255);
      ao[idx] = Math.round(clamp01(p.ao ?? 1) * 255);
    }
  }
  return { color, height, rough, metal, ao };
}

const GENERATORS = {
  cn_tactile_strip(u, v) {
    const gx = (u * 3) % 1;
    const gy = (v * 3) % 1;
    const grout = gx < 0.03 || gx > 0.97 || gy < 0.03 || gy > 0.97;
    const rib = Math.floor(gx * 5);
    const ribPhase = (gx * 5) % 1;
    const onRib = !grout && gy > 0.08 && gy < 0.92 && ribPhase > 0.25 && ribPhase < 0.75;
    const n = periodicFbm(u, v, 12, 3, 11);
    const h = grout ? 0.1 : onRib ? 0.95 - Math.abs(ribPhase - 0.5) * 1.1 : 0.45;
    const shade = (grout ? 0.42 : onRib ? 1.02 : 0.92) * (0.93 + n * 0.14);
    return {
      r: 0.88 * shade,
      g: 0.67 * shade,
      b: 0.12 * shade,
      h: h + n * 0.05,
      rough: grout ? 0.92 : 0.68 + n * 0.1,
      metal: 0,
      ao: grout ? 0.45 : onRib ? 1.0 : 0.85 + rib * 0.01,
    };
  },

  cn_tactile_dot(u, v) {
    const gx = (u * 3) % 1;
    const gy = (v * 3) % 1;
    const grout = gx < 0.03 || gx > 0.97 || gy < 0.03 || gy > 0.97;
    const dx = ((gx * 4) % 1) - 0.5;
    const dy = ((gy * 4) % 1) - 0.5;
    const d = Math.hypot(dx, dy);
    const onDot = !grout && d < 0.28;
    const dome = onDot ? Math.sqrt(Math.max(0, 1 - (d / 0.28) ** 2)) : 0;
    const n = periodicFbm(u, v, 12, 3, 17);
    const shade = (grout ? 0.42 : onDot ? 1.04 : 0.9) * (0.93 + n * 0.14);
    return {
      r: 0.88 * shade,
      g: 0.67 * shade,
      b: 0.12 * shade,
      h: grout ? 0.1 : 0.45 + dome * 0.5 + n * 0.04,
      rough: grout ? 0.92 : 0.68 + n * 0.1,
      metal: 0,
      ao: grout ? 0.45 : onDot ? 1.0 : 0.84,
    };
  },

  cn_epoxy_green(u, v) {
    const n = periodicFbm(u, v, 10, 4, 23);
    const speck = hash2(Math.floor(u * 256), Math.floor(v * 256), 29) > 0.985 ? 0.08 : 0;
    const seam = (u * 2) % 1 < 0.008 || (v * 2) % 1 < 0.008;
    return {
      r: (seam ? 0.14 : 0.14 + n * 0.05) + speck,
      g: (seam ? 0.28 : 0.42 + n * 0.06) + speck,
      b: (seam ? 0.2 : 0.27 + n * 0.04) + speck,
      h: seam ? 0.3 : 0.5 + n * 0.05,
      rough: seam ? 0.7 : 0.28 + n * 0.12,
      metal: 0,
      ao: seam ? 0.65 : 0.98,
    };
  },

  cn_terrazzo_old(u, v) {
    const n = periodicFbm(u, v, 16, 4, 31);
    const cx = Math.floor(u * 64);
    const cy = Math.floor(v * 64);
    const chip = hash2(cx, cy, 37);
    const chipCol = hash2(cx, cy, 41);
    let r = 0.56 + n * 0.08;
    let g = 0.55 + n * 0.08;
    let b = 0.52 + n * 0.07;
    if (chip > 0.68) {
      if (chipCol < 0.35) { r = 0.28; g = 0.29; b = 0.31; }
      else if (chipCol < 0.7) { r = 0.76; g = 0.73; b = 0.68; }
      else { r = 0.58; g = 0.39; b = 0.31; }
    }
    return { r, g, b, h: 0.5 + n * 0.08, rough: chip > 0.68 ? 0.34 : 0.5 + n * 0.15, metal: 0, ao: 0.9 + n * 0.1 };
  },

  cn_manhole_iron(u, v) {
    const d = Math.hypot(u - 0.5, v - 0.5);
    const ring1 = Math.abs(d - 0.42) < 0.025;
    const ring2 = Math.abs(d - 0.28) < 0.018;
    const lug = d < 0.4 && ((Math.floor(u * 16) + Math.floor(v * 16)) % 2 === 0) && Math.hypot(((u * 16) % 1) - 0.5, ((v * 16) % 1) - 0.5) < 0.22;
    const n = periodicFbm(u, v, 16, 4, 43);
    const rust = n > 0.62 ? (n - 0.62) * 1.4 : 0;
    const h = ring1 || ring2 ? 0.9 : lug ? 0.78 : 0.4 + n * 0.1;
    return {
      r: 0.22 + rust * 0.35 + n * 0.05,
      g: 0.22 + rust * 0.14 + n * 0.05,
      b: 0.23 + n * 0.05,
      h,
      rough: clamp01(0.55 + rust * 0.35 + n * 0.15),
      metal: clamp01(0.85 - rust * 0.65),
      ao: lug || ring1 || ring2 ? 0.98 : 0.72,
    };
  },

  cn_curtain_glass(u, v) {
    const gx = (u * 2) % 1;
    const gy = (v * 2) % 1;
    const mullion = gx < 0.04 || gx > 0.96 || gy < 0.04 || gy > 0.96;
    const n = periodicFbm(u, v, 6, 3, 47);
    if (mullion) {
      return { r: 0.24, g: 0.27, b: 0.31, a: 1.0, h: 0.8, rough: 0.36, metal: 0.85, ao: 0.9 };
    }
    return { r: 0.32 + n * 0.06, g: 0.48 + n * 0.08, b: 0.58 + n * 0.08, a: 0.42, h: 0.45, rough: 0.12, metal: 0.15, ao: 1.0 };
  },

  cn_mosaic_white(u, v) {
    const gx = (u * 16) % 1;
    const gy = (v * 16) % 1;
    const tx = Math.floor(u * 16);
    const ty = Math.floor(v * 16);
    const grout = gx < 0.09 || gx > 0.91 || gy < 0.09 || gy > 0.91;
    const tv = (hash2(tx, ty, 53) - 0.5) * 0.06;
    const stain = periodicFbm(u, v, 4, 4, 59);
    const dirt = stain > 0.6 ? (stain - 0.6) * 0.28 : 0;
    const r = grout ? 0.42 : 0.82 + tv - dirt;
    const g = grout ? 0.42 : 0.81 + tv - dirt;
    const b = grout ? 0.4 : 0.78 + tv - dirt * 1.1;
    return {
      r,
      g,
      b,
      h: grout ? 0.2 : 0.78 + tv * 0.5,
      rough: grout ? 0.92 : 0.32 + dirt * 0.8,
      metal: 0,
      ao: grout ? 0.45 : 0.96,
    };
  },

  cn_mosaic_blue(u, v) {
    const p = GENERATORS.cn_mosaic_white(u, v);
    const gx = (u * 16) % 1;
    const gy = (v * 16) % 1;
    const grout = gx < 0.09 || gx > 0.91 || gy < 0.09 || gy > 0.91;
    if (grout) return p;
    const tx = Math.floor(u * 16);
    const ty = Math.floor(v * 16);
    const accent = hash2(tx, ty, 61) > 0.82 ? 0.14 : 0;
    return { ...p, r: 0.36 - accent * 0.2, g: 0.56 - accent * 0.05, b: 0.72 + accent * 0.1 };
  },

  cn_washed_stone(u, v) {
    const n1 = periodicFbm(u, v, 24, 4, 67);
    const n2 = hash2(Math.floor(u * 192), Math.floor(v * 192), 71);
    const grain = (n2 - 0.5) * 0.18;
    const base = 0.54 + n1 * 0.12 + grain;
    return { r: base * 0.98, g: base * 0.97, b: base * 0.94, h: 0.45 + n2 * 0.35 + n1 * 0.15, rough: 0.86 + n1 * 0.1, metal: 0, ao: 0.75 + n2 * 0.25 };
  },

  cn_real_stone_paint(u, v) {
    const n1 = periodicFbm(u, v, 20, 4, 73);
    const speck = hash2(Math.floor(u * 160), Math.floor(v * 160), 79);
    const warm = 0.74 + n1 * 0.1 + (speck > 0.75 ? -0.14 : speck > 0.5 ? 0.06 : 0);
    return { r: warm, g: warm * 0.91, b: warm * 0.74, h: 0.5 + speck * 0.25 + n1 * 0.15, rough: 0.82 + n1 * 0.12, metal: 0, ao: 0.82 + speck * 0.18 };
  },

  cn_acp_panel(u, v) {
    const gx = (u * 2) % 1;
    const gy = (v * 4) % 1;
    const seam = gx < 0.015 || gy < 0.025;
    const n = periodicFbm(u, v, 8, 3, 83);
    return {
      r: seam ? 0.22 : 0.76 + n * 0.04,
      g: seam ? 0.23 : 0.78 + n * 0.04,
      b: seam ? 0.25 : 0.8 + n * 0.04,
      h: seam ? 0.15 : 0.75 + n * 0.02,
      rough: seam ? 0.85 : 0.34 + n * 0.08,
      metal: seam ? 0.1 : 0.68,
      ao: seam ? 0.35 : 0.98,
    };
  },

  cn_metal_louver(u, v) {
    const slat = (v * 12) % 1;
    const gap = slat < 0.22;
    const n = periodicFbm(u, v, 10, 3, 89);
    return {
      r: gap ? 0.16 : 0.46 + n * 0.04,
      g: gap ? 0.17 : 0.48 + n * 0.04,
      b: gap ? 0.19 : 0.52 + n * 0.04,
      h: gap ? 0.1 : 0.4 + slat * 0.55,
      rough: gap ? 0.9 : 0.38 + n * 0.1,
      metal: gap ? 0.2 : 0.82,
      ao: gap ? 0.3 : 0.94,
    };
  },

  cn_corrugated_blue(u, v) {
    const wave = Math.sin(u * Math.PI * 16) * 0.5 + 0.5;
    const n = periodicFbm(u, v, 12, 3, 97);
    const dirty = n > 0.65 ? (n - 0.65) * 0.4 : 0;
    return {
      r: 0.17 + dirty * 0.4,
      g: 0.36 + wave * 0.05 + dirty * 0.2,
      b: 0.66 + wave * 0.06 - dirty * 0.2,
      h: 0.2 + wave * 0.7,
      rough: 0.38 + dirty * 0.5 + n * 0.08,
      metal: 0.65 - dirty * 0.4,
      ao: 0.72 + wave * 0.28,
    };
  },

  cn_corrugated_red(u, v) {
    const p = GENERATORS.cn_corrugated_blue(u, v);
    const wave = Math.sin(u * Math.PI * 16) * 0.5 + 0.5;
    return { ...p, r: 0.64 + wave * 0.06, g: 0.2 + wave * 0.03, b: 0.18 + wave * 0.03 };
  },

  cn_shutter_door(u, v) {
    const slat = (v * 14) % 1;
    const groove = slat < 0.14 || slat > 0.88;
    const n = periodicFbm(u, v, 10, 4, 101);
    const shade = (groove ? 0.55 : 0.85 + Math.sin(slat * Math.PI) * 0.15) * (0.9 + n * 0.18);
    return {
      r: 0.62 * shade,
      g: 0.64 * shade,
      b: 0.67 * shade,
      h: groove ? 0.15 : 0.5 + Math.sin(slat * Math.PI) * 0.4,
      rough: groove ? 0.75 : 0.44 + n * 0.16,
      metal: 0.72,
      ao: groove ? 0.45 : 0.96,
    };
  },

  cn_container_corrugated(u, v) {
    const phase = (u * 8) % 1;
    const ridge = phase > 0.22 && phase < 0.78;
    const slope = phase > 0.15 && phase <= 0.22 ? (phase - 0.15) / 0.07 : phase >= 0.78 && phase < 0.85 ? (0.85 - phase) / 0.07 : ridge ? 1 : 0;
    const n = periodicFbm(u, v, 12, 4, 103);
    const c = 0.74 + slope * 0.06 - (n > 0.68 ? 0.12 : 0);
    return { r: c, g: c * 0.99, b: c * 0.97, h: 0.2 + slope * 0.7, rough: 0.46 + n * 0.2, metal: 0.62, ao: 0.74 + slope * 0.24 };
  },

  cn_greenhouse_film(u, v) {
    const rib = Math.abs((u * 4) % 1 - 0.5) < 0.025;
    const n = periodicFbm(u, v, 8, 4, 107);
    return {
      r: rib ? 0.52 : 0.78 + n * 0.08,
      g: rib ? 0.54 : 0.81 + n * 0.08,
      b: rib ? 0.55 : 0.82 + n * 0.08,
      a: rib ? 0.95 : 0.52,
      h: rib ? 0.85 : 0.45 + n * 0.18,
      rough: rib ? 0.42 : 0.34 + n * 0.14,
      metal: rib ? 0.75 : 0,
      ao: 0.95,
    };
  },

  cn_security_door_red(u, v) {
    const px = Math.abs(u - 0.5);
    const py = Math.abs(v - 0.5);
    const panel = (px < 0.34 && py < 0.38) && (px > 0.28 || py > 0.32);
    const inner = px < 0.22 && (Math.abs(v - 0.27) < 0.12 || Math.abs(v - 0.73) < 0.12);
    const n = periodicFbm(u, v, 12, 3, 109);
    const dip = panel || inner ? 0.82 : 1.0;
    return {
      r: 0.44 * dip + n * 0.04,
      g: 0.16 * dip + n * 0.02,
      b: 0.15 * dip + n * 0.02,
      h: panel || inner ? 0.3 : 0.7,
      rough: 0.44 + n * 0.14,
      metal: 0.45,
      ao: panel || inner ? 0.68 : 0.96,
    };
  },

  cn_ceiling_gypsum(u, v) {
    const n = periodicFbm(u, v, 12, 4, 113);
    const gx = (u * 2) % 1;
    const gy = (v * 2) % 1;
    const seam = gx < 0.012 || gy < 0.012;
    return { r: seam ? 0.65 : 0.86 + n * 0.04, g: seam ? 0.65 : 0.86 + n * 0.04, b: seam ? 0.64 : 0.84 + n * 0.04, h: seam ? 0.25 : 0.6 + n * 0.04, rough: 0.84 + n * 0.08, metal: 0, ao: seam ? 0.6 : 0.98 };
  },

  cn_ceiling_mineral_wool(u, v) {
    const gx = (u * 2) % 1;
    const gy = (v * 2) % 1;
    const grid = gx < 0.025 || gy < 0.025;
    const n = periodicFbm(u, v, 24, 4, 127);
    const pin = hash2(Math.floor(u * 128), Math.floor(v * 128), 131) > 0.9;
    return {
      r: grid ? 0.72 : pin ? 0.54 : 0.82 + n * 0.06,
      g: grid ? 0.73 : pin ? 0.54 : 0.81 + n * 0.06,
      b: grid ? 0.74 : pin ? 0.52 : 0.79 + n * 0.06,
      h: grid ? 0.8 : pin ? 0.2 : 0.58 + n * 0.1,
      rough: grid ? 0.45 : 0.9,
      metal: grid ? 0.35 : 0,
      ao: pin ? 0.45 : 0.94,
    };
  },

  cn_tile_antislip(u, v) {
    const gx = (u * 4) % 1;
    const gy = (v * 4) % 1;
    const grout = gx < 0.035 || gx > 0.965 || gy < 0.035 || gy > 0.965;
    const bump = Math.hypot(((gx * 8) % 1) - 0.5, ((gy * 8) % 1) - 0.5) < 0.25;
    const n = periodicFbm(u, v, 14, 3, 137);
    const c = grout ? 0.36 : (bump ? 0.66 : 0.6) + n * 0.06;
    return { r: c, g: c * 0.98, b: c * 0.95, h: grout ? 0.15 : bump ? 0.82 : 0.55, rough: grout ? 0.92 : 0.72 + n * 0.1, metal: 0, ao: grout ? 0.5 : 0.94 };
  },

  cn_painted_steel(u, v) {
    const n = periodicFbm(u, v, 10, 4, 139);
    const scratch = hash2(Math.floor(u * 128), Math.floor(v * 32), 149) > 0.97 ? 0.1 : 0;
    const c = 0.74 + n * 0.05 + scratch;
    return { r: c, g: c, b: c, h: 0.5 + n * 0.05 - scratch, rough: 0.38 + n * 0.14, metal: 0.58, ao: 0.96 };
  },

  cn_glass_frosted(u, v) {
    const n = periodicFbm(u, v, 32, 4, 151);
    return { r: 0.74 + n * 0.06, g: 0.82 + n * 0.06, b: 0.85 + n * 0.06, a: 0.56, h: 0.5 + n * 0.15, rough: 0.48 + n * 0.12, metal: 0.05, ao: 1.0 };
  },

  cn_luminous_diffuser(u, v) {
    const n = periodicFbm(u, v, 8, 3, 157);
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const vig = edge < 0.06 ? 0.75 + (edge / 0.06) * 0.25 : 1.0;
    return { r: (0.88 + n * 0.05) * vig, g: (0.85 + n * 0.05) * vig, b: (0.76 + n * 0.05) * vig, h: 0.5, rough: 0.38, metal: 0, ao: vig };
  },
};

export async function generateManualTextureSet(assetId, outDir, size = 1024) {
  const fn = GENERATORS[assetId];
  if (!fn) {
    throw new Error(`No manual generator registered for "${assetId}"`);
  }
  await mkdir(outDir, { recursive: true });
  const colorPath = path.join(outDir, 'color.png');
  const normalPath = path.join(outDir, 'normal.png');
  const roughPath = path.join(outDir, 'rough.png');
  const metalPath = path.join(outDir, 'metal.png');
  const aoPath = path.join(outDir, 'ao.png');
  const metaPath = path.join(outDir, 'meta.json');

  if (existsSync(metaPath) && existsSync(colorPath) && existsSync(normalPath) && existsSync(roughPath)) {
    return {
      meta: {
        slot: assetId,
        source: 'manual',
        assetId,
        license: 'CC0-Original',
        files: {
          albedo: 'color.png',
          normal: 'normal.png',
          rough: 'rough.png',
          metal: 'metal.png',
          ao: 'ao.png',
        },
      },
      cached: true,
    };
  }

  const { color, height, rough, metal, ao } = buildBuffers(size, fn);
  const normal = heightToNormal(height, size, 3.0);

  await Promise.all([
    sharp(color, { raw: { width: size, height: size, channels: 4 } }).png().toFile(colorPath),
    sharp(normal, { raw: { width: size, height: size, channels: 4 } }).png().toFile(normalPath),
    sharp(rough, { raw: { width: size, height: size, channels: 1 } }).png().toFile(roughPath),
    sharp(metal, { raw: { width: size, height: size, channels: 1 } }).png().toFile(metalPath),
    sharp(ao, { raw: { width: size, height: size, channels: 1 } }).png().toFile(aoPath),
  ]);

  const meta = {
    slot: assetId,
    source: 'manual',
    assetId,
    license: 'CC0-Original',
    generatedAt: new Date().toISOString(),
    files: {
      albedo: 'color.png',
      normal: 'normal.png',
      rough: 'rough.png',
      metal: 'metal.png',
      ao: 'ao.png',
    },
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  return { meta, cached: false };
}

export async function generateWaterNormalPng(outPath, size = 512) {
  const height = new Float32Array(size * size);
  const waves = [
    { kx: 2, ky: 1, amp: 0.34, phase: 0.2 },
    { kx: -3, ky: 2, amp: 0.25, phase: 1.4 },
    { kx: 1, ky: -4, amp: 0.21, phase: 2.6 },
    { kx: 5, ky: 3, amp: 0.13, phase: 0.8 },
    { kx: -6, ky: -4, amp: 0.09, phase: 3.9 },
    { kx: 8, ky: -5, amp: 0.06, phase: 1.9 },
  ];
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let val = 0;
      for (const w of waves) val += w.amp * Math.sin(Math.PI * 2 * (w.kx * u + w.ky * v) + w.phase);
      height[y * size + x] = val;
    }
  }
  const normal = heightToNormal(height, size, 2.6);
  await mkdir(path.dirname(outPath), { recursive: true });
  await sharp(normal, { raw: { width: size, height: size, channels: 4 } }).png().toFile(outPath);
}
