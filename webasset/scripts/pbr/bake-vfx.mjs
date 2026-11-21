import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'vfx');

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function bakeWaterNormal() {
  const size = 256;
  const h = new Float32Array(size * size);
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
      for (const w of waves) {
        val += w.amp * Math.sin(Math.PI * 2 * (w.kx * u + w.ky * v) + w.phase);
      }
      h[y * size + x] = val;
    }
  }
  const rgba = new Uint8Array(size * size * 4);
  const strength = 2.6;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dhdx = (h[y * size + xp] - h[y * size + xm]) * strength;
      const dhdy = (h[yp * size + x] - h[ym * size + x]) * strength;
      let nx = -dhdx, ny = dhdy, nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(clamp01((nx + 1) * 0.5) * 255);
      rgba[i + 1] = Math.round(clamp01((ny + 1) * 0.5) * 255);
      rgba[i + 2] = Math.round(clamp01((nz + 1) * 0.5) * 255);
      rgba[i + 3] = 255;
    }
  }
  const out = path.join(OUT_DIR, 'water_normal.webp');
  await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .webp({ quality: 94 })
    .toFile(out);
  return out;
}

function drawLine(rgba, w, h, x0, y0, x1, y1, thickness, col, alphaMul = 1.0) {
  const steps = Math.max(4, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    const r = Math.ceil(thickness + 1);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = Math.round(cx + dx), py = Math.round(cy + dy);
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const dist = Math.hypot(dx, dy);
        if (dist > thickness) continue;
        const a = clamp01(1 - dist / thickness) * alphaMul;
        const idx = (py * w + px) * 4;
        const srcA = Math.round(a * 255);
        if (srcA > rgba[idx + 3]) {
          rgba[idx] = col[0];
          rgba[idx + 1] = col[1];
          rgba[idx + 2] = col[2];
          rgba[idx + 3] = srcA;
        }
      }
    }
  }
}

async function bakeBreakStages() {
  const frameW = 128, frameH = 128, frames = 8;
  const totalW = frameW * frames;
  const rgba = new Uint8Array(totalW * frameH * 4);
  const rng = mulberry32(4209);

  // Build progressive fracture tree branches
  const branches = [];
  for (let b = 0; b < 14; b++) {
    const ang = (b / 14) * Math.PI * 2 + (rng() - 0.5) * 0.25;
    let x = frameW * 0.5, y = frameH * 0.5;
    const segs = [];
    let curAng = ang;
    for (let s = 0; s < 8; s++) {
      const len = 7 + rng() * 9;
      curAng += (rng() - 0.5) * 0.72;
      const nx = x + Math.cos(curAng) * len;
      const ny = y + Math.sin(curAng) * len;
      segs.push({ x0: x, y0: y, x1: nx, y1: ny, step: s });
      if (s >= 1 && rng() > 0.45) {
        const subAng = curAng + (rng() > 0.5 ? 0.75 : -0.75);
        const sx = nx + Math.cos(subAng) * (len * 0.75);
        const sy = ny + Math.sin(subAng) * (len * 0.75);
        segs.push({ x0: nx, y0: ny, x1: sx, y1: sy, step: s + 1 });
      }
      x = nx; y = ny;
    }
    branches.push(segs);
  }

  for (let f = 0; f < frames; f++) {
    const frameBuf = new Uint8Array(frameW * frameH * 4);
    const activeBranches = Math.ceil(((f + 1) / frames) * branches.length);
    const maxStep = f + 1;
    const thick = 1.2 + (f / (frames - 1)) * 1.4;
    for (let b = 0; b < activeBranches; b++) {
      for (const seg of branches[b]) {
        if (seg.step > maxStep) continue;
        drawLine(frameBuf, frameW, frameH, seg.x0 + 1, seg.y0 + 1, seg.x1 + 1, seg.y1 + 1, thick * 1.15, [220, 220, 220], 0.35);
        drawLine(frameBuf, frameW, frameH, seg.x0, seg.y0, seg.x1, seg.y1, thick, [12, 12, 14], 0.94);
      }
    }
    for (let y = 0; y < frameH; y++) {
      const sOff = y * frameW * 4;
      const dOff = (y * totalW + f * frameW) * 4;
      rgba.set(frameBuf.subarray(sOff, sOff + frameW * 4), dOff);
    }
  }

  const out = path.join(OUT_DIR, 'break_stages.webp');
  await sharp(rgba, { raw: { width: totalW, height: frameH, channels: 4 } })
    .webp({ quality: 90, alphaQuality: 95 })
    .toFile(out);
  return out;
}

async function bakeVfxFlipbook() {
  const cell = 128, cols = 4, rows = 4;
  const W = cell * cols, H = cell * rows;
  const rgba = new Uint8Array(W * H * 4);

  const paintCell = (col, row, fn) => {
    const ox = col * cell, oy = row * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const u = (x + 0.5) / cell * 2 - 1;
        const v = (y + 0.5) / cell * 2 - 1;
        const [r, g, b, a] = fn(u, v, col);
        const i = ((oy + y) * W + (ox + x)) * 4;
        rgba[i] = Math.round(clamp01(r) * 255);
        rgba[i + 1] = Math.round(clamp01(g) * 255);
        rgba[i + 2] = Math.round(clamp01(b) * 255);
        rgba[i + 3] = Math.round(clamp01(a) * 255);
      }
    }
  };

  // Row 0: Fire (4 frames)
  for (let c = 0; c < 4; c++) {
    paintCell(c, 0, (u, v, frame) => {
      const sway = Math.sin(v * 3.5 + frame * 1.57) * 0.16 * (1 - v) * 0.5;
      const dx = (u - sway) / (0.48 - 0.18 * clamp01(-v));
      const dy = (v - 0.18) / 0.72;
      const d = Math.hypot(dx, dy);
      const a = Math.pow(clamp01(1 - d), 1.65);
      const core = Math.pow(clamp01(1 - d * 1.6), 1.4);
      return [1.0, 0.35 + 0.62 * core, 0.06 + 0.78 * core * core, a];
    });
  }
  // Row 1: Smoke wisps (4 frames)
  for (let c = 0; c < 4; c++) {
    paintCell(c, 1, (u, v, frame) => {
      const ph = frame * 1.57;
      const d1 = Math.hypot(u - 0.18 * Math.cos(ph), v - 0.15 * Math.sin(ph));
      const d2 = Math.hypot(u + 0.16 * Math.sin(ph), v + 0.14 * Math.cos(ph));
      const d = Math.min(d1, d2) * 0.85 + Math.hypot(u, v) * 0.35;
      const a = Math.pow(clamp01(1 - d / 0.85), 2.1) * 0.78;
      const lum = 0.42 + 0.18 * (1 - clamp01(v + 0.5));
      return [lum, lum, lum * 1.03, a];
    });
  }
  // Row 2: Hot Sparks / Embers (4 frames)
  for (let c = 0; c < 4; c++) {
    paintCell(c, 2, (u, v, frame) => {
      const ang = (frame - 1.5) * 0.25;
      const ru = u * Math.cos(ang) - v * Math.sin(ang);
      const rv = u * Math.sin(ang) + v * Math.cos(ang);
      const d = Math.hypot(ru * 1.8, rv * 0.75);
      const a = Math.pow(clamp01(1 - d * 1.5), 2.2);
      return [1.0, 0.72 + 0.28 * a, 0.25 + 0.6 * a * a, a];
    });
  }
  // Row 3: Soft Glow / Contact Shadow (4 frames)
  for (let c = 0; c < 4; c++) {
    paintCell(c, 3, (u, v, frame) => {
      const d = Math.hypot(u, v);
      const a = Math.pow(clamp01(1 - d), 2.2);
      return frame < 2 ? [1.0, 0.88, 0.62, a * 0.85] : [0.04, 0.04, 0.05, a * 0.7];
    });
  }

  const out = path.join(OUT_DIR, 'vfx_flipbook.webp');
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .webp({ quality: 90, alphaQuality: 92 })
    .toFile(out);
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = await Promise.all([bakeWaterNormal(), bakeBreakStages(), bakeVfxFlipbook()]);
  const meta = {
    version: '1.0.0',
    waterNormal: { url: '/assets/vfx/water_normal.webp', size: [256, 256] },
    breakStages: { url: '/assets/vfx/break_stages.webp', size: [1024, 128], frames: 8 },
    vfxFlipbook: { url: '/assets/vfx/vfx_flipbook.webp', size: [512, 512], cols: 4, rows: 4 },
  };
  await writeFile(path.join(OUT_DIR, 'vfx_table.json'), JSON.stringify(meta, null, 2) + '\n');
  let totalBytes = 0;
  for (const f of files) {
    const s = await stat(f);
    totalBytes += s.size;
    console.log(`[bake-vfx] ${path.basename(f)}: ${(s.size / 1024).toFixed(1)} KB`);
  }
  console.log(`[bake-vfx] Total VFX size: ${(totalBytes / 1024).toFixed(1)} KB (budget < 350 KB)`);
}

main().catch(err => {
  console.error('[bake-vfx] FAILED:', err);
  process.exit(1);
});
