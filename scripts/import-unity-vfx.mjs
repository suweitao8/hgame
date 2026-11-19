#!/usr/bin/env node
/**
 * Clean-room Unity ParticleSystem YAML (.prefab + .mat + .meta) -> HGame .vfx.json converter.
 * Outputs normalized declarative .vfx.json recipes and an asset dependency manifest
 * without bundling or committing any third-party assets.
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const opts = {
    unityRoot: '',
    prefab: '',
    out: '',
    manifestOut: '',
    id: '',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--unity-root' || a === '-r') opts.unityRoot = argv[++i] ?? '';
    else if (a === '--prefab' || a === '-p') opts.prefab = argv[++i] ?? '';
    else if (a === '--out' || a === '-o') opts.out = argv[++i] ?? '';
    else if (a === '--manifest' || a === '-m') opts.manifestOut = argv[++i] ?? '';
    else if (a === '--id') opts.id = argv[++i] ?? '';
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function buildGuidIndex(dir, rootDir, map = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) buildGuidIndex(full, rootDir, map);
    else if (entry.name.endsWith('.meta')) {
      const txt = fs.readFileSync(full, 'utf8');
      const g = txt.match(/^guid:\s*([0-9a-f]+)/m);
      if (g) {
        const assetPath = full.slice(0, -5);
        const alphaUsage = Number((txt.match(/^\s*alphaUsage:\s*(\d+)/m) || [])[1] ?? 1);
        const alphaIsTransparency = /alphaIsTransparency:\s*1/.test(txt);
        map.set(g[1], {
          relPath: path.relative(rootDir, assetPath).replace(/\\/g, '/'),
          fullPath: assetPath,
          fromGrayScale: alphaUsage === 2,
          alphaIsTransparency,
        });
      }
    }
  }
  return map;
}

function extractSection(body, name) {
  const idx = body.indexOf(`  ${name}:`);
  if (idx === -1) return '';
  const rest = body.slice(idx);
  const next = rest.slice(name.length + 4).search(/\n  [A-Za-z0-9_]+:/);
  return next === -1 ? rest : rest.slice(0, name.length + 4 + next);
}

function readMinMaxScalar(block, fieldName, fallback = 0) {
  const sub = block.match(new RegExp(`(?:^|\\n) {4}${fieldName}:[^\\n]*\\n([\\s\\S]*?)(?=\\n {4}[A-Za-z_]|$)`));
  if (!sub) return fallback;
  const mode = Number((sub[1].match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
  const numOrInf = (m) => {
    if (!m) return null;
    if (m[1] === 'Infinity') return Infinity;
    if (m[1] === '-Infinity') return -Infinity;
    return Number(m[1]);
  };
  const parsedMax = numOrInf(sub[1].match(/\bscalar:\s*(Infinity|-Infinity|[-\d.eE+]+)/));
  const maxVal = parsedMax !== null ? parsedMax : fallback;
  const parsedMin = numOrInf(sub[1].match(/\bminScalar:\s*(Infinity|-Infinity|[-\d.eE+]+)/));
  const minVal = parsedMin !== null ? parsedMin : maxVal;
  if (mode === 3 && minVal !== maxVal) {
    const lo = Math.min(minVal, maxVal);
    const hi = Math.max(minVal, maxVal);
    return [Number.isFinite(lo) ? Number(lo.toFixed(4)) : lo, Number.isFinite(hi) ? Number(hi.toFixed(4)) : hi];
  }
  return Number.isFinite(maxVal) ? Number(maxVal.toFixed(4)) : maxVal;
}

function srgbToLinear(c) {
  const v = Math.max(0, Number(c) || 0);
  if (v <= 0.04045) return v / 12.92;
  return Math.pow((v + 0.055) / 1.055, 2.4);
}

function parseColorObject(str, toLinear = true) {
  const r = Number((str.match(/r:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
  const g = Number((str.match(/g:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
  const b = Number((str.match(/b:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
  const a = Number((str.match(/a:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
  return toLinear ? [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a] : [r, g, b, a];
}

function normalizeHdrColor(rgba) {
  const maxRgb = Math.max(rgba[0], rgba[1], rgba[2], 1);
  return {
    hdr: Number(maxRgb.toFixed(3)),
    rgb: [
      Number((rgba[0] / maxRgb).toFixed(4)),
      Number((rgba[1] / maxRgb).toFixed(4)),
      Number((rgba[2] / maxRgb).toFixed(4)),
    ],
    a: Number(rgba[3].toFixed(4)),
  };
}

function parseCurveKeys(curveBlock) {
  const maxCurveText = curveBlock.split(/\n\s*minCurve:/)[0] || curveBlock;
  const postInf = Number((maxCurveText.match(/m_PostInfinity:\s*(\d+)/) || [])[1] ?? 2);
  const re = /time:\s*([-\d.eE+]+)\s*\r?\n\s*value:\s*([-\d.eE+]+)(?:\s*\r?\n\s*inSlope:\s*([-\d.eE+]+)\s*\r?\n\s*outSlope:\s*([-\d.eE+]+))?/g;
  const raw = [];
  for (const k of maxCurveText.matchAll(re)) {
    const t = Math.max(0, Math.min(1, Number(k[1])));
    const v = Math.max(0, Number(k[2]));
    const inS = k[3] !== undefined ? Number(k[3]) : null;
    const outS = k[4] !== undefined ? Number(k[4]) : null;
    if (raw.length === 0 || t >= raw[raw.length - 1].t) {
      raw.push({ t, v, inS: Number.isFinite(inS) ? inS : null, outS: Number.isFinite(outS) ? outS : null });
    } else {
      break;
    }
  }
  if (raw.length < 2) return null;
  const out = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i];
    const b = raw[i + 1];
    const dt = b.t - a.t;
    out.push([Number(a.t.toFixed(3)), Number(a.v.toFixed(3))]);
    if (dt > 0.05 && a.outS !== null && b.inS !== null) {
      const linearSlope = (b.v - a.v) / dt;
      if (Math.abs(a.outS - linearSlope) > 0.15 || Math.abs(b.inS - linearSlope) > 0.15) {
        const sub = 6;
        for (let s = 1; s < sub; s++) {
          const u = s / sub;
          const u2 = u * u;
          const u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1;
          const h10 = u3 - 2 * u2 + u;
          const h01 = -2 * u3 + 3 * u2;
          const h11 = u3 - u2;
          const hv = Math.max(0, h00 * a.v + h10 * dt * a.outS + h01 * b.v + h11 * dt * b.inS);
          const ht = a.t + dt * u;
          out.push([Number(ht.toFixed(3)), Number(hv.toFixed(3))]);
        }
      }
    }
  }
  const last = raw[raw.length - 1];
  out.push([Number(last.t.toFixed(3)), Number(last.v.toFixed(3))]);

  const tStart = out[0][0];
  const period = out[out.length - 1][0] - tStart;
  if ((postInf === 0 || postInf === 1) && period > 0.02 && out[out.length - 1][0] < 0.995) {
    const tiled = [...out];
    const maxStops = 56;
    let cycle = 1;
    let done = false;
    while (!done && tiled.length < maxStops) {
      const baseT = out[out.length - 1][0] + (cycle - 1) * period;
      const reverse = postInf === 1 && (cycle % 2 === 1);
      const seq = reverse ? [...out].reverse() : out;
      for (let idx = 1; idx < seq.length; idx++) {
        const localT = reverse ? (out[out.length - 1][0] - seq[idx][0]) : (seq[idx][0] - tStart);
        const absT = baseT + localT;
        const val = seq[idx][1];
        if (absT >= 1.0) {
          const prev = tiled[tiled.length - 1];
          const span = Math.max(1e-6, absT - prev[0]);
          const f = (1.0 - prev[0]) / span;
          const endVal = prev[1] + (val - prev[1]) * Math.max(0, Math.min(1, f));
          tiled.push([1, Number(endVal.toFixed(3))]);
          done = true;
          break;
        }
        tiled.push([Number(absT.toFixed(3)), val]);
        if (tiled.length >= maxStops) {
          done = true;
          break;
        }
      }
      cycle += 1;
    }
    return tiled;
  }
  return out;
}

function parseGradientStops(colorMod) {
  const numC = Math.min(8, Number((colorMod.match(/m_NumColorKeys:\s*(\d+)/) || [])[1] ?? 2));
  const numA = Math.min(8, Number((colorMod.match(/m_NumAlphaKeys:\s*(\d+)/) || [])[1] ?? 2));
  const cols = [];
  for (let i = 0; i < numC; i++) {
    const km = colorMod.match(new RegExp(`key${i}:\\s*\\{([^}]+)\\}`));
    const tm = colorMod.match(new RegExp(`ctime${i}:\\s*(\\d+)`));
    if (km) {
      const c = parseColorObject(km[1]);
      const t = tm ? Number(tm[1]) / 65535 : i / Math.max(1, numC - 1);
      cols.push({ t, r: c[0], g: c[1], b: c[2] });
    }
  }
  const alphas = [];
  for (let i = 0; i < numA; i++) {
    const km = colorMod.match(new RegExp(`key${i}:\\s*\\{([^}]+)\\}`));
    const tm = colorMod.match(new RegExp(`atime${i}:\\s*(\\d+)`));
    if (km) {
      const c = parseColorObject(km[1]);
      const t = tm ? Number(tm[1]) / 65535 : i / Math.max(1, numA - 1);
      alphas.push({ t, a: c[3] });
    }
  }
  const times = [...new Set([...cols.map((c) => Number(c.t.toFixed(3))), ...alphas.map((a) => Number(a.t.toFixed(3)))])].sort((a, b) => a - b);
  const sampleAt = (arr, t, keys) => {
    if (arr.length === 0) return keys.map(() => 1);
    if (t <= arr[0].t) return keys.map((k) => arr[0][k]);
    if (t >= arr[arr.length - 1].t) return keys.map((k) => arr[arr.length - 1][k]);
    for (let i = 0; i < arr.length - 1; i++) {
      if (t <= arr[i + 1].t) {
        const f = (t - arr[i].t) / Math.max(1e-6, arr[i + 1].t - arr[i].t);
        return keys.map((k) => arr[i][k] + (arr[i + 1][k] - arr[i][k]) * f);
      }
    }
    return keys.map((k) => arr[arr.length - 1][k]);
  };
  const stops = times.slice(0, 8).map((t) => {
    const [r, g, b] = sampleAt(cols, t, ['r', 'g', 'b']);
    const [a] = sampleAt(alphas, t, ['a']);
    return [t, [Number(r.toFixed(3)), Number(g.toFixed(3)), Number(b.toFixed(3)), Number(a.toFixed(3))]];
  });
  return stops.length > 0 ? stops : null;
}

function inspectMaterial(matInfo, guidMap, deps) {
  if (!matInfo || !fs.existsSync(matInfo.fullPath)) return null;
  const txt = fs.readFileSync(matInfo.fullPath, 'utf8');
  const mainTexGuid = (txt.match(/- _(?:MainTex|BaseMap):[\s\S]*?guid:\s*([0-9a-f]{32})/) || [])[1];
  const colorMatch = txt.match(/- _(?:Color|BaseColor):\s*\{([^}]+)\}/);
  const color = colorMatch ? normalizeHdrColor(parseColorObject(colorMatch[1], false)) : { hdr: 1, rgb: [1, 1, 1], a: 1 };
  const isAdditive = /_Blend:\s*2\b/.test(txt) || /_DstBlend:\s*1\b/.test(txt) || /_ADDITIVE/i.test(txt);
  const isLit = /_NORMALMAP|_METALLIC|_SPECGLOSSMAP|Standard Surface/i.test(txt) || /guid:\s*0406db5a14f94604a8c57ccfbc9f3b46/.test(txt);
  const isOpaque = /_Mode:\s*0\b/.test(txt) || /_Surface:\s*0\b/.test(txt);
  const flipbookMode = Number((txt.match(/- _FlipbookMode:\s*([\d.]+)/) || [])[1] ?? 0);

  let spriteKey = null;
  if (mainTexGuid && guidMap.has(mainTexGuid)) {
    const tex = guidMap.get(mainTexGuid);
    deps.textures.set(tex.relPath, tex);
    spriteKey = path.basename(tex.relPath, path.extname(tex.relPath))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  const matName = path.basename(matInfo.relPath, path.extname(matInfo.relPath));
  return {
    matName,
    spriteKey,
    hdr: color.hdr,
    tintRgb: color.rgb,
    blend: isAdditive ? 'additive' : 'alpha',
    lit: isLit,
    opaque: isOpaque,
    isDistortionOnly: color.hdr > 100 && /distortion/i.test(matName),
    flipbookBlend: flipbookMode >= 1,
  };
}

function normAssetKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function resolveMeshKey(fbxRelPath, matName) {
  const fbxBase = path.basename(fbxRelPath, path.extname(fbxRelPath));
  const fbxKey = normAssetKey(fbxBase.replace(/\([^)]*\)/g, ''));
  const rawFbxKey = normAssetKey(fbxBase);
  if (!matName) return rawFbxKey;
  const matKey = normAssetKey(matName);
  if (matKey === fbxKey || matKey === rawFbxKey) return rawFbxKey;
  if (matKey.startsWith(fbxKey + '_')) return matKey;
  return `${rawFbxKey}__${matKey}`;
}

function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function unityEulerToQuat(dx, dy, dz) {
  const rad = Math.PI / 180;
  const hx = dx * rad * 0.5, hy = dy * rad * 0.5, hz = dz * rad * 0.5;
  const qx = [Math.sin(hx), 0, 0, Math.cos(hx)];
  const qy = [0, Math.sin(hy), 0, Math.cos(hy)];
  const qz = [0, 0, Math.sin(hz), Math.cos(hz)];
  // Unity Inspector Euler rotation order: Y * X * Z
  return quatMul(qy, quatMul(qx, qz));
}

function computeShapeRotation(trRotMatch, sRotMatch, mappedType) {
  if (mappedType === 'sphere' || mappedType === 'point') return null;
  const qTr = trRotMatch
    ? [Number(trRotMatch[1]), Number(trRotMatch[2]), Number(trRotMatch[3]), Number(trRotMatch[4])]
    : [0, 0, 0, 1];
  const qSh = sRotMatch
    ? unityEulerToQuat(Number(sRotMatch[1]), Number(sRotMatch[2]), Number(sRotMatch[3]))
    : [0, 0, 0, 1];
  // Canonical Unity shapes point +Z; HGame cone/circle/hemisphere use +Y (+90 deg X offset from +Y to +Z).
  const s45 = Math.SQRT1_2;
  const qOff = quatMul(quatMul(qTr, qSh), [s45, 0, 0, s45]);
  const [x, y, z, w] = qOff;
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - z * w);
  const r02 = 2 * (x * z + y * w);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - x * w);
  const r21 = 2 * (y * z + x * w);
  const r22 = 1 - 2 * (x * x + y * y);
  // Check transformed +Y axis (r01, r11, r21) to omit redundant identity/planar rotations.
  if (mappedType === 'circle' && Math.abs(r11) > 0.985) return null;
  if (mappedType !== 'circle' && r11 > 0.985) return null;
  const ry = Math.asin(Math.max(-1, Math.min(1, r02)));
  let rx = 0, rz = 0;
  if (Math.abs(r02) < 0.9995) {
    rx = Math.atan2(-r12, r22);
    rz = Math.atan2(-r01, r00);
  } else {
    rx = Math.atan2(r21, r11);
    rz = 0;
  }
  return [Number(rx.toFixed(4)), Number(ry.toFixed(4)), Number(rz.toFixed(4))];
}

function mapShapeType(unityType) {
  switch (Number(unityType)) {
    case 0:
    case 1:
    case 6: return 'sphere';
    case 2:
    case 3: return 'hemisphere';
    case 4:
    case 7:
    case 8:
    case 9: return 'cone';
    case 5:
    case 15:
    case 16:
    case 18: return 'box';
    case 10:
    case 11:
    case 17:
    case 19:
    case 20: return 'circle';
    case 12: return 'edge';
    default: return 'sphere';
  }
}

export function convertUnityPrefab({ unityRoot, prefabPath, id }) {
  const guidMap = buildGuidIndex(unityRoot, unityRoot);
  const raw = fs.readFileSync(prefabPath, 'utf8');
  const docs = raw.split(/^--- !u!/m).slice(1);
  const goNames = new Map();
  const transforms = [];
  const trById = new Map();
  const trByGo = new Map();
  const psByGo = new Map();
  const psById = new Map();
  const psrByGo = new Map();
  const lightByGo = new Map();

  for (const d of docs) {
    const firstNl = d.indexOf('\n');
    const [cls, fidPart] = d.slice(0, firstNl).trim().split(/\s+/);
    const fid = fidPart.replace('&', '');
    const body = d.slice(firstNl + 1);
    if (cls === '1') {
      const nm = (body.match(/^\s*m_Name:\s*(.+)$/m) || [])[1]?.trim() || 'layer';
      const act = !/^\s*m_IsActive:\s*0\b/m.test(body);
      goNames.set(fid, { name: nm, active: act });
    } else if (cls === '4') {
      transforms.push({ fid, body });
      trById.set(fid, body);
      const goId = (body.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/) || [])[1];
      if (goId) trByGo.set(goId, body);
    } else if (cls === '198') {
      const goId = (body.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/) || [])[1];
      if (goId) {
        psByGo.set(goId, body);
        psById.set(fid, { fid, goId, body });
      }
    } else if (cls === '199') {
      const goId = (body.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/) || [])[1];
      if (goId) psrByGo.set(goId, body);
    } else if (cls === '108') {
      const goId = (body.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/) || [])[1];
      if (goId) lightByGo.set(goId, body);
    }
  }

  // Track which ParticleSystems are invoked strictly as SubEmitters so they do not auto-fire at t=0.
  const subEmitterPsIds = new Set();
  for (const psEntry of psById.values()) {
    const subMod = extractSection(psEntry.body, 'SubModule');
    if (/^\s*enabled:\s*1\b/m.test(subMod)) {
      for (const em of subMod.matchAll(/emitter:\s*\{fileID:\s*(\d+)\}/g)) {
        if (em[1] !== '0' && psById.has(em[1])) subEmitterPsIds.add(em[1]);
      }
    }
  }

  const deps = { textures: new Map(), meshes: new Map() };
  const recipeId = id || path.basename(prefabPath, '.prefab').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  const layers = [];
  let recipeLoop = false;
  let maxDuration = 0.5;
  let lightPulse = null;
  let subCounter = 0;

  function computeHierarchyOffset(trBody) {
    let x = 0, y = 0, z = 0;
    let cur = trBody;
    let guard = 0;
    while (cur && guard++ < 8) {
      const fId = (cur.match(/m_Father:\s*\{fileID:\s*(\d+)\}/) || [])[1] ?? '0';
      if (fId === '0') break;
      const posM = cur.match(/m_LocalPosition:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
      if (posM) {
        x += Number(posM[1]);
        y += Number(posM[2]);
        z += Number(posM[3]);
      }
      cur = trById.get(fId);
    }
    return [Number(x.toFixed(4)), Number(y.toFixed(4)), Number(z.toFixed(4))];
  }

  function convertParticleLayer(goId, trBody, isSubChild, subDepth) {
    const go = goNames.get(goId) || { name: 'layer', active: true };
    const ps = psByGo.get(goId);
    const psr = psrByGo.get(goId);
    if (!ps || !psr) return null;

    const offset = isSubChild ? [0, 0, 0] : computeHierarchyOffset(trBody);
    const trRotM = trBody ? trBody.match(/m_LocalRotation:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+),\s*w:\s*([-\d.eE+]+)\}/) : null;

    const isLoop = /^\s*looping:\s*1\b/m.test(ps);
    const isPrewarm = /^\s*prewarm:\s*1\b/m.test(ps);
    if (isLoop) recipeLoop = true;
    const dur = Number((ps.match(/^\s*lengthInSec:\s*([-\d.eE+]+)/m) || [])[1] ?? 2);
    const delay = readMinMaxScalar(ps, 'startDelay', 0);

    const initMod = extractSection(ps, 'InitialModule');
    const maxParticles = Number((initMod.match(/^\s*maxNumParticles:\s*(\d+)/m) || [])[1] ?? 1000);
    const size3D = /^\s*size3D:\s*1\b/m.test(initMod);
    const rawLife = readMinMaxScalar(initMod, 'startLifetime', 1);
    const isInf = (v) => typeof v === 'number' && !Number.isFinite(v);
    const hasInfiniteLife = Array.isArray(rawLife) ? (isInf(rawLife[0]) || isInf(rawLife[1])) : isInf(rawLife);
    const fixInf = (v) => (isInf(v) ? dur : v);
    const life = Array.isArray(rawLife) ? [fixInf(rawLife[0]), fixInf(rawLife[1])] : fixInf(rawLife);
    const speed = readMinMaxScalar(initMod, 'startSpeed', 0);
    const size = readMinMaxScalar(initMod, 'startSize', 1);
    const sizeY = size3D ? readMinMaxScalar(initMod, 'startSizeY', 1) : size;
    const sizeXMax = Array.isArray(size) ? size[1] : size;
    const sizeYMax = Array.isArray(sizeY) ? sizeY[1] : sizeY;
    const aspectY = size3D && sizeXMax > 0.0001 && Math.abs(sizeYMax / sizeXMax - 1) > 0.05
      ? Number((sizeYMax / sizeXMax).toFixed(3))
      : undefined;
    const rot = readMinMaxScalar(initMod, 'startRotation', 0);
    const gravScalar = readMinMaxScalar(initMod, 'gravityModifier', 0);

    const maxLife = Array.isArray(life) ? life[1] : life;
    maxDuration = Math.max(maxDuration, isLoop ? dur : (Number(delay) + maxLife));

    const scBlock = initMod.match(/(?:^|\n) {4}startColor:[^\n]*\n[\s\S]*?(?=\n {4}[a-zA-Z]|$)/)?.[0] || '';
    const scMode = Number((scBlock.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
    const maxColM = scBlock.match(/maxColor:\s*\{([^}]+)\}/);
    const minColM = scBlock.match(/minColor:\s*\{([^}]+)\}/);
    const maxCol = maxColM ? parseColorObject(maxColM[1]) : [1, 1, 1, 1];
    const minCol = minColM ? parseColorObject(minColM[1]) : maxCol;

    const emMod = extractSection(ps, 'EmissionModule');
    const rate = readMinMaxScalar(emMod, 'rateOverTime', 0);
    const rateDist = readMinMaxScalar(emMod, 'rateOverDistance', 0);
    const bursts = [];
    const burstCount = Number((emMod.match(/m_BurstCount:\s*(\d+)/) || [])[1] ?? 0);
    const burstsPart = emMod.split('m_Bursts:')[1] || '';
    if (burstCount > 0 && burstsPart) {
      const burstMatches = [...burstsPart.matchAll(/-\s*serializedVersion:\s*\d+\s*\n\s*time:\s*([-\d.eE+]+)[\s\S]*?minMaxState:\s*(\d+)[\s\S]*?\bscalar:\s*([-\d.eE+]+)[\s\S]*?\bminScalar:\s*([-\d.eE+]+)[\s\S]*?cycleCount:\s*(\d+)[\s\S]*?repeatInterval:\s*([-\d.eE+]+)/g)];
      for (let bi = 0; bi < Math.min(burstCount, burstMatches.length); bi++) {
        const bm = burstMatches[bi];
        const bMode = Number(bm[2]);
        const bMax = Math.max(1, Math.round(Number(bm[3])));
        const bMin = Math.max(1, Math.round(Number(bm[4])));
        bursts.push({
          time: Number(bm[1]),
          count: bMode === 3 && bMin !== bMax ? [Math.min(bMin, bMax), Math.max(bMin, bMax)] : bMax,
          cycles: Math.max(1, Number(bm[5])),
          interval: Number(bm[6]),
        });
      }
    }
    const effectiveBursts = bursts;
    const effectiveRate = rate;
    const hasPositiveRate = Array.isArray(effectiveRate) ? effectiveRate[1] > 0 : effectiveRate > 0;
    const hasPositiveRateDist = Array.isArray(rateDist) ? rateDist[1] > 0 : rateDist > 0;

    const matsBlock = (psr.match(/m_Materials:\s*\n([\s\S]*?)\n  m_/) || ['', ''])[1];
    const matGuids = [...matsBlock.matchAll(/guid:\s*([0-9a-f]{32})/g)].map((m) => m[1]);
    const mainMat = inspectMaterial(guidMap.get(matGuids[0]), guidMap, deps);
    const trailMat = matGuids[1] ? inspectMaterial(guidMap.get(matGuids[1]), guidMap, deps) : null;

    const rmNum = Number((psr.match(/^\s*m_RenderMode:\s*(\d+)/m) || [])[1] ?? 0);
    const renderMode = rmNum === 4 ? 'mesh' : rmNum === 3 ? 'vertical' : rmNum === 2 ? 'horizontal' : rmNum === 1 ? 'stretched' : 'billboard';
    if (renderMode === 'mesh' && mainMat?.isDistortionOnly) return null;

    const forceMod = extractSection(ps, 'ForceModule');
    let netGravity = gravScalar * 9.81;
    if (/enabled:\s*1/.test(forceMod)) {
      const fy = readMinMaxScalar(forceMod, 'y', 0);
      const fyVal = Array.isArray(fy) ? (fy[0] + fy[1]) * 0.5 : fy;
      netGravity -= fyVal;
    }

    const meshGuid = (psr.match(/m_Mesh:[\s\S]*?guid:\s*([0-9a-f]{32})/) || [])[1];
    let meshKey = 'crystal';
    if (meshGuid && guidMap.has(meshGuid)) {
      const mInfo = guidMap.get(meshGuid);
      deps.meshes.set(mInfo.relPath, mInfo);
      meshKey = resolveMeshKey(mInfo.relPath, mainMat?.matName);
    }

    const layer = {
      name: go.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
      kind: renderMode === 'mesh' ? 'mesh' : 'particle',
      renderMode,
      blend: mainMat?.blend || 'alpha',
      hdr: mainMat?.hdr ?? 1.0,
      ...(maxParticles > 0 && maxParticles < 1000 ? { maxParticles } : {}),
      ...(isPrewarm && !isSubChild ? { prewarm: true } : {}),
      ...(typeof delay === 'number' && delay > 0 ? { delay } : {}),
      ...(effectiveBursts.length > 0 ? { bursts: effectiveBursts } : {}),
      ...(hasPositiveRate ? { rate: effectiveRate } : {}),
      ...(hasPositiveRateDist ? { rateOverDistance: rateDist } : {}),
      ...(hasInfiniteLife ? { persistent: true } : {}),
      life,
      speed,
      size,
      ...(aspectY !== undefined ? { aspectY } : {}),
      rotation: rot,
      ...(Math.abs(netGravity) > 0.001 ? { gravity: Number(netGravity.toFixed(3)) } : {}),
    };

    if (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0) {
      layer.offset = offset;
    }

    if (renderMode === 'mesh') {
      layer.mesh = meshKey;
      layer.forwardAxis = 'y';
      if (mainMat?.lit) layer.lit = true;
      if (mainMat?.opaque) layer.opaque = true;
      if (Array.isArray(speed) ? speed[1] > 0.1 : speed > 0.1) layer.alignToVelocity = true;
    } else if (mainMat?.spriteKey) {
      layer.sprite = mainMat.spriteKey;
    }

    if (scMode === 2) {
      layer.startColor = [minCol.slice(0, 3), maxCol.slice(0, 3)];
    }

    const shapeMod = extractSection(ps, 'ShapeModule');
    if (/enabled:\s*1/.test(shapeMod)) {
      const st = (shapeMod.match(/type:\s*(\d+)/) || [])[1] ?? 0;
      const mappedType = mapShapeType(st);
      const rad = Number((shapeMod.match(/radius:[\s\S]*?value:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
      const ang = Number((shapeMod.match(/\bangle:\s*([-\d.eE+]+)/) || [])[1] ?? 25);
      const radThick = Number((shapeMod.match(/\bradiusThickness:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
      const randPos = Number((shapeMod.match(/\brandomPositionAmount:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
      const alignDir = /alignToDirection:\s*1\b/.test(shapeMod);
      const sRotM = shapeMod.match(/m_Rotation:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
      const sSclM = shapeMod.match(/m_Scale:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
      const shapeObj = {
        type: mappedType,
        radius: rad > 0 && rad < 0.001 ? Number(rad.toFixed(4)) : Number(rad.toFixed(3)),
        angle: Number(ang.toFixed(1)),
      };
      if (radThick < 0.05) shapeObj.shell = true;
      else if (radThick < 0.99) shapeObj.radiusThickness = Number(radThick.toFixed(3));
      if (randPos > 0.001) shapeObj.randomPos = Number(randPos.toFixed(3));
      if (alignDir) shapeObj.alignToDirection = true;
      if (sSclM) {
        let sx = Number(sSclM[1]);
        let sy = Number(sSclM[2]);
        let sz = Number(sSclM[3]);
        const rx = sRotM ? Math.abs(Number(sRotM[1])) : 0;
        if (mappedType === 'circle' && Math.abs(rx - 90) < 5) {
          // Unity Circle defaults to XY; with Rx(90) XY scale (sx, sy) maps to XZ (sx, sz, sy).
          [sy, sz] = [sz, sy];
        }
        if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001 || Math.abs(sz - 1) > 0.001) {
          shapeObj.scale = [Number(sx.toFixed(3)), Number(sy.toFixed(3)), Number(sz.toFixed(3))];
        }
      }
      const shapeRot = computeShapeRotation(trRotM, sRotM, mappedType);
      if (shapeRot) shapeObj.rotation = shapeRot;
      layer.shape = shapeObj;
    }

    const sizeMod = extractSection(ps, 'SizeModule');
    if (/enabled:\s*1/.test(sizeMod)) {
      const curveBlock = sizeMod.split('x:')[1]?.split('y:')[0] || sizeMod;
      const sc = parseCurveKeys(curveBlock);
      if (sc) layer.sizeCurve = sc;
    }

    const startMul = scMode === 2 ? [1, 1, 1, maxCol[3]] : maxCol;
    const colorMod = extractSection(ps, 'ColorModule');
    const colCurve = /enabled:\s*1/.test(colorMod) ? parseGradientStops(colorMod) : null;
    if (colCurve) {
      // When startColor is random range (scMode === 2), per-particle tint applies startColor; otherwise bake maxCol here.
      layer.colorCurve = colCurve.map(([t, rgba]) => [
        t,
        [
          Number((rgba[0] * startMul[0] * (mainMat?.tintRgb?.[0] ?? 1)).toFixed(3)),
          Number((rgba[1] * startMul[1] * (mainMat?.tintRgb?.[1] ?? 1)).toFixed(3)),
          Number((rgba[2] * startMul[2] * (mainMat?.tintRgb?.[2] ?? 1)).toFixed(3)),
          Number((rgba[3] * startMul[3]).toFixed(3)),
        ],
      ]);
    } else {
      const constRgba = [
        Number((startMul[0] * (mainMat?.tintRgb?.[0] ?? 1)).toFixed(3)),
        Number((startMul[1] * (mainMat?.tintRgb?.[1] ?? 1)).toFixed(3)),
        Number((startMul[2] * (mainMat?.tintRgb?.[2] ?? 1)).toFixed(3)),
        Number(startMul[3].toFixed(3)),
      ];
      layer.colorCurve = [
        [0, constRgba],
        [1, constRgba],
      ];
    }
    if (hasInfiniteLife && (colCurve || layer.sizeCurve)) {
      layer.curveCycle = dur;
    }

    const velMod = extractSection(ps, 'VelocityModule');
    if (/enabled:\s*1/.test(velMod)) {
      const spdModRaw = readMinMaxScalar(velMod, 'speedModifier', 1);
      const spdMul = Array.isArray(spdModRaw) ? spdModRaw[1] : spdModRaw;
      const mulV = (v) => {
        if (Math.abs(spdMul - 1) <= 0.001) return v;
        return Array.isArray(v)
          ? [Number((v[0] * spdMul).toFixed(3)), Number((v[1] * spdMul).toFixed(3))]
          : Number((v * spdMul).toFixed(3));
      };
      const vx = mulV(readMinMaxScalar(velMod, 'x', 0));
      const vy = mulV(readMinMaxScalar(velMod, 'y', 0));
      const vz = mulV(readMinMaxScalar(velMod, 'z', 0));
      const orbY = mulV(readMinMaxScalar(velMod, 'orbitalY', 0));
      const oox = readMinMaxScalar(velMod, 'orbitalOffsetX', 0);
      const ooy = readMinMaxScalar(velMod, 'orbitalOffsetY', 0);
      const ooz = readMinMaxScalar(velMod, 'orbitalOffsetZ', 0);
      const radV = mulV(readMinMaxScalar(velMod, 'radial', 0));
      const isNonZero = (v) => Array.isArray(v) ? (v[0] !== 0 || v[1] !== 0) : v !== 0;
      const velObj = {};
      if (isNonZero(vx) || isNonZero(vy) || isNonZero(vz)) {
        velObj.linear = [vx, vy, vz];
      }
      if (isNonZero(orbY)) velObj.orbitalY = orbY;
      if (isNonZero(oox) || isNonZero(ooy) || isNonZero(ooz)) {
        velObj.orbitalOffset = [oox, ooy, ooz];
      }
      if (isNonZero(radV)) velObj.radial = radV;
      if (Object.keys(velObj).length > 0) layer.velocity = velObj;
    }

    const rotMod = extractSection(ps, 'RotationModule');
    if (/enabled:\s*1/.test(rotMod)) {
      const av = readMinMaxScalar(rotMod, 'curve', 0);
      if (/separateAxes:\s*1\b/.test(rotMod)) {
        const rx = readMinMaxScalar(rotMod, 'x', 0);
        const ry = readMinMaxScalar(rotMod, 'y', 0);
        layer.spin = [rx, ry, av];
      } else if (av !== 0) {
        layer.angularVel = av;
      }
    }

    const noiseMod = extractSection(ps, 'NoiseModule');
    if (/enabled:\s*1/.test(noiseMod)) {
      const maxAbs = (v) => Array.isArray(v) ? Math.max(Math.abs(v[0]), Math.abs(v[1])) : Math.abs(v);
      const str = readMinMaxScalar(noiseMod, 'strength', 0.5);
      const freq = Number((noiseMod.match(/\bfrequency:\s*([-\d.eE+]+)/) || [])[1] ?? 0.5);
      const noiseObj = { strength: Number(maxAbs(str).toFixed(3)), frequency: freq };
      if (/separateAxes:\s*1\b/.test(noiseMod)) {
        const strY = readMinMaxScalar(noiseMod, 'strengthY', 0);
        noiseObj.strengthY = Number(maxAbs(strY).toFixed(3));
      }
      layer.noise = noiseObj;
    }

    const uvMod = extractSection(ps, 'UVModule');
    if (renderMode !== 'mesh' && /enabled:\s*1/.test(uvMod)) {
      const cols = Number((uvMod.match(/tilesX:\s*(\d+)/) || [])[1] ?? 1);
      const rows = Number((uvMod.match(/tilesY:\s*(\d+)/) || [])[1] ?? 1);
      const cycles = Number((uvMod.match(/cycles:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
      if (cols > 1 || rows > 1) {
        layer.flipbook = {
          region: mainMat?.spriteKey || 'flipbook',
          cols,
          rows,
          cycles,
          blend: mainMat?.flipbookBlend ?? true,
        };
        delete layer.sprite;
      }
    }

    const trailMod = extractSection(ps, 'TrailModule');
    if (/enabled:\s*1/.test(trailMod)) {
      const trailMode = Number((trailMod.match(/mode:\s*(\d+)/) || [])[1] ?? 0);
      const tLife = readMinMaxScalar(trailMod, 'lifetime', 0.2);
      const wScalar = readMinMaxScalar(trailMod, 'widthOverTrail', 1);
      const sizeAffW = !/sizeAffectsWidth:\s*0\b/.test(trailMod);
      const inheritColor = /inheritParticleColor:\s*1/.test(trailMod);
      const colLifeBlock = trailMod.match(/colorOverLifetime:[\s\S]*?(?=widthOverTrail:|colorOverTrail:|$)/)?.[0] || '';
      const colLifeMode = Number((colLifeBlock.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
      let trailAlpha = 1;
      let trailTint;
      const toHex = (c) => '#' + [c[0], c[1], c[2]].map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
      if (colLifeMode === 0 || colLifeMode === 2) {
        const mMin = colLifeBlock.match(/minColor:\s*\{([^}]+)\}/);
        const mMax = colLifeBlock.match(/maxColor:\s*\{([^}]+)\}/);
        const cMax = mMax ? parseColorObject(mMax[1], true) : [1, 1, 1, 1];
        const cMin = mMin ? parseColorObject(mMin[1], true) : cMax;
        const aMax = cMax[3];
        const aMin = cMin[3];
        if (colLifeMode === 2 && Math.abs(aMin - aMax) > 0.01) {
          trailAlpha = [Number(Math.min(aMin, aMax).toFixed(3)), Number(Math.max(aMin, aMax).toFixed(3))];
        } else {
          trailAlpha = Number(aMax.toFixed(3));
        }
        const maxHex = toHex(cMax);
        const minHex = toHex(cMin);
        if (colLifeMode === 2 && minHex !== maxHex) {
          trailTint = [minHex, maxHex];
        } else if (maxHex !== '#ffffff') {
          trailTint = maxHex;
        }
      } else {
        const clStops = parseGradientStops(colLifeBlock);
        if (clStops && clStops.length > 0) {
          const avgA = clStops.reduce((s, k) => s + k[1][3], 0) / clStops.length;
          trailAlpha = Number(avgA.toFixed(3));
        }
      }
      const wBlock = trailMod.match(/widthOverTrail:[\s\S]*?(?=colorOverTrail:|$)/)?.[0] || '';
      const wCurve = parseCurveKeys(wBlock);
      const endWidthScale = wCurve ? Number(wCurve[wCurve.length - 1][1].toFixed(3)) : 0;

      const cotBlock = trailMod.match(/colorOverTrail:[\s\S]*$/)?.[0] || '';
      const cotMode = Number((cotBlock.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 1);
      let startRgb = maxCol;
      let endRgb = maxCol;
      if (cotMode === 0 || cotMode === 2) {
        const mMax = cotBlock.match(/maxColor:\s*\{([^}]+)\}/);
        startRgb = mMax ? parseColorObject(mMax[1], true) : maxCol;
        endRgb = startRgb;
        if (startRgb[3] < 0.99) {
          if (Array.isArray(trailAlpha)) {
            trailAlpha = [Number((trailAlpha[0] * startRgb[3]).toFixed(3)), Number((trailAlpha[1] * startRgb[3]).toFixed(3))];
          } else {
            trailAlpha = Number((trailAlpha * startRgb[3]).toFixed(3));
          }
        }
      } else {
        const maxGrad = cotBlock.match(/maxGradient:[\s\S]*?(?=minGradient:|$)/)?.[0] || cotBlock;
        const numC = Math.min(8, Number((maxGrad.match(/m_NumColorKeys:\s*(\d+)/) || [])[1] ?? 2));
        const keyCols = [];
        for (let i = 0; i < numC; i++) {
          const km = maxGrad.match(new RegExp(`key${i}:\\s*\\{([^}]+)\\}`));
          if (km) keyCols.push(parseColorObject(km[1], true));
        }
        if (keyCols.length >= 3) {
          // Skip leading transparent fade-in key and trailing black fade-out key so body color isn't darkened.
          const firstVisible = keyCols[0][3] < 0.1 ? keyCols[1] : keyCols[0];
          const last = keyCols[keyCols.length - 1];
          const lastVisible = (last[3] < 0.1 && Math.max(last[0], last[1], last[2]) < 0.05)
            ? keyCols[keyCols.length - 2]
            : last;
          startRgb = firstVisible;
          endRgb = lastVisible;
        } else if (keyCols.length > 0) {
          startRgb = keyCols[0];
          endRgb = keyCols[keyCols.length - 1];
        }
      }
      const wMax = typeof wScalar === 'number' ? wScalar : wScalar[1];
      const baseSizeMax = typeof size === 'number' ? size : size[1];
      layer.trail = {
        lifetime: tLife,
        lifetimeMode: trailMode === 1 ? 'seconds' : 'fraction',
        blend: trailMat?.blend || 'alpha',
        ...(trailMat?.spriteKey ? { sprite: trailMat.spriteKey } : {}),
        width: Number((baseSizeMax * wMax).toFixed(3)),
        widthOverTrail: wScalar,
        sizeAffectsWidth: sizeAffW,
        endWidth: 0,
        endWidthScale,
        ...(trailAlpha !== 1 ? { alpha: trailAlpha } : {}),
        ...(trailTint ? { tint: trailTint } : {}),
        inheritColor,
        color: toHex(startRgb),
        endColor: toHex(endRgb),
        hdr: trailMat?.hdr ?? 2.0,
      };
    }

    const colMod = extractSection(ps, 'CollisionModule');
    if (/enabled:\s*1/.test(colMod)) {
      const bounce = readMinMaxScalar(colMod, 'm_Bounce', 0.5);
      const dampen = readMinMaxScalar(colMod, 'm_Dampen', 0.2);
      layer.collision = {
        groundY: 0,
        bounce: typeof bounce === 'number' ? bounce : bounce[1],
        dampen: typeof dampen === 'number' ? dampen : dampen[1],
        maxBounces: 3,
      };
    }

    const subMod = extractSection(ps, 'SubModule');
    if (/^\s*enabled:\s*1\b/m.test(subMod) && subDepth < 2) {
      const subList = [];
      const subMatches = [...subMod.matchAll(/emitter:\s*\{fileID:\s*(\d+)\}[\s\S]*?\n\s*type:\s*(\d+)[\s\S]*?\n\s*emitProbability:\s*([-\d.eE+]+)/g)];
      for (const sm of subMatches) {
        const targetPsId = sm[1];
        if (targetPsId === '0' || !psById.has(targetPsId)) continue;
        const targetPs = psById.get(targetPsId);
        const tGo = goNames.get(targetPs.goId) || { active: true };
        if (!tGo.active) continue;
        const targetLayer = convertParticleLayer(targetPs.goId, trByGo.get(targetPs.goId), true, subDepth + 1);
        if (!targetLayer) continue;
        const tType = Number(sm[2]);
        const trigger = tType === 0 ? 'birth' : (tType === 1 ? 'collision' : 'death');
        const prob = Number(sm[3] ?? 1);
        const subDur = Array.isArray(targetLayer.life) ? targetLayer.life[1] : (Number(targetLayer.life) || 1);
        const subId = `${recipeId}__sub_${++subCounter}`;
        subList.push({
          trigger,
          ...(prob < 0.999 ? { probability: Number(prob.toFixed(3)) } : {}),
          effect: {
            schemaVersion: 1,
            id: subId,
            loop: false,
            duration: Number(Math.max(0.2, subDur).toFixed(2)),
            space: 'local',
            layers: [targetLayer],
          },
        });
      }
      if (subList.length > 0) layer.subEmitters = subList;
    }

    return layer;
  }

  for (const tr of transforms) {
    const goId = (tr.body.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/) || [])[1];
    const go = goNames.get(goId) || { name: 'layer', active: true };
    if (!go.active) continue;

    const fatherId = (tr.body.match(/m_Father:\s*\{fileID:\s*(\d+)\}/) || [])[1] ?? '0';
    const posM = tr.body.match(/m_LocalPosition:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
    const offset = (fatherId !== '0' && posM) ? [Number(posM[1]), Number(posM[2]), Number(posM[3])] : [0, 0, 0];

    const lt = lightByGo.get(goId);
    if (lt && !lightPulse) {
      const cM = lt.match(/m_Color:\s*\{([^}]+)\}/);
      const col = cM ? parseColorObject(cM[1], false) : [1, 1, 1, 1];
      const intensity = Number((lt.match(/^\s*m_Intensity:\s*([-\d.eE+]+)/m) || [])[1] ?? 2);
      const range = Number((lt.match(/^\s*m_Range:\s*([-\d.eE+]+)/m) || [])[1] ?? 8);
      const hex = '#' + [col[0], col[1], col[2]].map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
      lightPulse = { color: hex, intensity, range, duration: 0.45, offset };
    }

    const psEntry = [...psById.values()].find((p) => p.goId === goId);
    if (!psEntry || subEmitterPsIds.has(psEntry.fid)) continue;
    const layer = convertParticleLayer(goId, tr.body, false, 0);
    if (layer) layers.push(layer);
  }

  const recipe = {
    schemaVersion: 1,
    id: recipeId,
    loop: recipeLoop,
    duration: Number(maxDuration.toFixed(2)),
    space: 'local',
    ...(lightPulse ? { juice: { lightPulse } } : {}),
    layers,
  };

  return {
    recipe,
    dependencies: {
      textures: [...deps.textures.values()],
      meshes: [...deps.meshes.values()],
    },
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('import-unity-vfx.mjs')) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.unityRoot || !opts.prefab) {
    console.log('Usage: node scripts/import-unity-vfx.mjs --unity-root <AssetsDir> --prefab <Effect.prefab> [--out <out.vfx.json>] [--manifest <manifest.json>] [--id <id>]');
    process.exit(opts.help ? 0 : 1);
  }
  const result = convertUnityPrefab({
    unityRoot: path.resolve(opts.unityRoot),
    prefabPath: path.resolve(opts.prefab),
    id: opts.id,
  });
  const jsonText = JSON.stringify(result.recipe, null, 2) + '\n';
  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(path.resolve(opts.out), jsonText, 'utf8');
  } else {
    process.stdout.write(jsonText);
  }
  if (opts.manifestOut) {
    fs.mkdirSync(path.dirname(path.resolve(opts.manifestOut)), { recursive: true });
    fs.writeFileSync(path.resolve(opts.manifestOut), JSON.stringify(result.dependencies, null, 2) + '\n', 'utf8');
  }
}
