#!/usr/bin/env node
/**
 * Clean-room Unity ParticleSystem YAML (.prefab + .mat + .meta) -> HGame .vfx.json converter.
 * Outputs normalized declarative .vfx.json recipes and an asset dependency manifest
 * without bundling or committing any third-party assets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { VFX_DEPTH_TESTS } from '../assets/runtime/vfx/vfx-depth-state.js';

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
        const wrapU = Number((txt.match(/^\s*wrapU:\s*(-?\d+)/m) || [])[1] ?? 0) === 1;
        const wrapV = Number((txt.match(/^\s*wrapV:\s*(-?\d+)/m) || [])[1] ?? 0) === 1;
        const srgb = Number((txt.match(/^\s*sRGBTexture:\s*(\d+)/m) || [])[1] ?? 1) === 1;
        const globalScale = Number((txt.match(/^\s*globalScale:\s*([-\d.eE+]+)/m) || [])[1] ?? 1);
        map.set(g[1], {
          relPath: path.relative(rootDir, assetPath).replace(/\\/g, '/'),
          fullPath: assetPath,
          fromGrayScale: alphaUsage === 2,
          alphaIsTransparency,
          wrapU,
          wrapV,
          srgb,
          globalScale: Number.isFinite(globalScale) && globalScale > 0 ? globalScale : 1,
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
  const sub = block.match(new RegExp(`(?:^|\\n)( {2,10})${fieldName}:[^\\n]*\\n([\\s\\S]*?)(?=\\n\\1[A-Za-z_]|$)`));
  if (!sub) return fallback;
  const subBody = sub[2];
  const mode = Number((subBody.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
  const numOrInf = (m) => {
    if (!m) return null;
    if (m[1] === 'Infinity') return Infinity;
    if (m[1] === '-Infinity') return -Infinity;
    return Number(m[1]);
  };
  const parsedMax = numOrInf(subBody.match(/\bscalar:\s*(Infinity|-Infinity|[-\d.eE+]+)/));
  const maxVal = parsedMax !== null ? parsedMax : fallback;
  const parsedMin = numOrInf(subBody.match(/\bminScalar:\s*(Infinity|-Infinity|[-\d.eE+]+)/));
  const minVal = parsedMin !== null ? parsedMin : maxVal;
  if (mode === 2) {
    const maxCurveBlk = subBody.match(/maxCurve:[\s\S]*?(?=minCurve:|$)/)?.[0] || '';
    const minCurveBlk = subBody.match(/minCurve:[\s\S]*$/)?.[0] || '';
    const readCurveMean = (blk) => {
      const vals = [...blk.matchAll(/\bvalue:\s*([-\d.eE+]+)/g)].map((m) => Number(m[1]));
      if (vals.length === 0) return null;
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    };
    const meanMax = readCurveMean(maxCurveBlk);
    const meanMin = readCurveMean(minCurveBlk);
    const a = (meanMax !== null ? meanMax : 1) * maxVal;
    const b = (meanMin !== null ? meanMin : (meanMax !== null ? meanMax : 1)) * maxVal;
    if (Math.abs(a - b) > 1e-4) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return [Number(lo.toFixed(4)), Number(hi.toFixed(4))];
    }
    return Number(a.toFixed(4));
  }
  if (mode === 1) {
    const maxCurveBlk = subBody.match(/maxCurve:[\s\S]*?(?=minCurve:|$)/)?.[0] || '';
    const vals = [...maxCurveBlk.matchAll(/\bvalue:\s*([-\d.eE+]+)/g)].map((m) => Number(m[1]));
    if (vals.length > 0) {
      if (Math.max(...vals.map(Math.abs)) < 1e-4) return 0;
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const scaled = maxVal * mean;
      return Number.isFinite(scaled) ? Number(scaled.toFixed(4)) : maxVal;
    }
  }
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

function parseCurveKeys(curveBlock, allowNegative = false) {
  const maxCurveText = curveBlock.split(/\n\s*minCurve:/)[0] || curveBlock;
  const postInf = Number((maxCurveText.match(/m_PostInfinity:\s*(\d+)/) || [])[1] ?? 2);
  const re = /time:\s*([-\d.eE+]+)\s*\r?\n\s*value:\s*([-\d.eE+]+)(?:\s*\r?\n\s*inSlope:\s*([-\d.eE+]+)\s*\r?\n\s*outSlope:\s*([-\d.eE+]+))?/g;
  const raw = [];
  for (const k of maxCurveText.matchAll(re)) {
    const t = Math.max(0, Math.min(1, Number(k[1])));
    const rawVal = Number(k[2]);
    const v = allowNegative ? rawVal : Math.max(0, rawVal);
    const inS = k[3] !== undefined ? Number(k[3]) : null;
    const outS = k[4] !== undefined ? Number(k[4]) : null;
    if (raw.length === 0 || t >= raw[raw.length - 1].t) {
      raw.push({ t, v, inS: Number.isFinite(inS) ? inS : null, outS: Number.isFinite(outS) ? outS : null });
    } else {
      break;
    }
  }
  if (raw.length < 2) return null;
  const roundVal = (val) => Number(val.toFixed(allowNegative ? 4 : 3));
  const roundT = (val) => Number(val.toFixed(allowNegative ? 4 : 3));
  const out = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i];
    const b = raw[i + 1];
    const dt = b.t - a.t;
    out.push([roundT(a.t), roundVal(a.v)]);
    if (dt > 0.015 && a.outS !== null && b.inS !== null) {
      const linearSlope = (b.v - a.v) / dt;
      const maxSlopeDiff = Math.max(Math.abs(a.outS - linearSlope), Math.abs(b.inS - linearSlope));
      if (maxSlopeDiff > 0.15 || (allowNegative && maxSlopeDiff * dt > 0.004)) {
        const sub = 6;
        for (let s = 1; s < sub; s++) {
          const u = s / sub;
          const u2 = u * u;
          const u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1;
          const h10 = u3 - 2 * u2 + u;
          const h01 = -2 * u3 + 3 * u2;
          const h11 = u3 - u2;
          const rawHv = h00 * a.v + h10 * dt * a.outS + h01 * b.v + h11 * dt * b.inS;
          const hv = allowNegative ? rawHv : Math.max(0, rawHv);
          const ht = a.t + dt * u;
          out.push([roundT(ht), roundVal(hv)]);
        }
      }
    }
  }
  const last = raw[raw.length - 1];
  out.push([roundT(last.t), roundVal(last.v)]);

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
  const maxGrad = colorMod.split(/\n\s*minGradient:/)[0] || colorMod;
  const numC = Math.min(8, Number((maxGrad.match(/m_NumColorKeys:\s*(\d+)/) || [])[1] ?? 2));
  const numA = Math.min(8, Number((maxGrad.match(/m_NumAlphaKeys:\s*(\d+)/) || [])[1] ?? 2));
  const isLinearGrad = /m_ColorSpace:\s*1\b/.test(maxGrad);
  const cols = [];
  for (let i = 0; i < numC; i++) {
    const km = maxGrad.match(new RegExp(`key${i}:\\s*\\{([^}]+)\\}`));
    const tm = maxGrad.match(new RegExp(`ctime${i}:\\s*(\\d+)`));
    if (km) {
      // Unity Gamma gradients (m_ColorSpace: 0) interpolate in sRGB before converting to linear.
      const c = parseColorObject(km[1], false);
      const t = tm ? Number(tm[1]) / 65535 : i / Math.max(1, numC - 1);
      cols.push({ t, r: c[0], g: c[1], b: c[2] });
    }
  }
  const alphas = [];
  for (let i = 0; i < numA; i++) {
    const km = maxGrad.match(new RegExp(`key${i}:\\s*\\{([^}]+)\\}`));
    const tm = maxGrad.match(new RegExp(`atime${i}:\\s*(\\d+)`));
    if (km) {
      const c = parseColorObject(km[1], false);
      const t = tm ? Number(tm[1]) / 65535 : i / Math.max(1, numA - 1);
      alphas.push({ t, a: c[3] });
    }
  }
  const timeSet = new Set([
    ...cols.map((c) => Number(c.t.toFixed(3))),
    ...alphas.map((a) => Number(a.t.toFixed(3))),
  ]);
  if (!isLinearGrad) {
    // Subdivide wide sRGB color ramps so linear CurveLUT interpolation matches Unity sRGB->Linear evaluation.
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i], b = cols[i + 1];
      const dt = b.t - a.t;
      const dCol = Math.max(Math.abs(b.r - a.r), Math.abs(b.g - a.g), Math.abs(b.b - a.b));
      if (dt > 0.08 && dCol > 0.08) {
        const sub = Math.min(5, Math.ceil(dt / 0.08));
        for (let k = 1; k < sub; k++) {
          timeSet.add(Number((a.t + (dt * k) / sub).toFixed(3)));
        }
      }
    }
  }
  const times = [...timeSet].sort((a, b) => a - b);
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
  const stops = times.slice(0, 32).map((t) => {
    const [rawR, rawG, rawB] = sampleAt(cols, t, ['r', 'g', 'b']);
    const [a] = sampleAt(alphas, t, ['a']);
    const r = isLinearGrad ? rawR : srgbToLinear(rawR);
    const g = isLinearGrad ? rawG : srgbToLinear(rawG);
    const b = isLinearGrad ? rawB : srgbToLinear(rawB);
    return [t, [Number(r.toFixed(3)), Number(g.toFixed(3)), Number(b.toFixed(3)), Number(a.toFixed(3))]];
  });
  return stops.length > 0 ? stops : null;
}

const UBER_FX_SHADER_GUIDS = new Set([
  '7f11fe28133f1a74594785107b98f2fe', // UberFXSG.shadergraph
  '0d1ef53931a649a4c8cd65c09da7d65d', // Uber Cubemap.shadergraph
  '1a69665fd375c2b4899b86bd341064b1', // Uber Matcap.shadergraph
]);
const PBR_FX_SHADER_GUIDS = new Set([
  'de445866a68ac7049bf65b2cf854d5a5', // PBR FX.shadergraph
  '6b011b97fa17f4143b01151d12039270', // Piloto PBR Simple.shadergraph
  'fcf523d8a34f0cf41b1e42f5a48768ad', // Piloto PBR Gemstones.shadergraph
  '6e4ae4064600d784cac1e41a9e6f2e59', // Piloto URP PBR Bomb ShaderGraph
  '5e579b9670f45f0468f178faaee98c05', // PilotoToon Mobile.shadergraph
]);
const SHADER_GUID_PILOTO_WARP = '0bb9d182cc9c06443a66471771fa7924';

function inspectMaterial(matInfo, guidMap, deps) {
  if (!matInfo || !fs.existsSync(matInfo.fullPath)) return null;
  const txt = fs.readFileSync(matInfo.fullPath, 'utf8').replace(/\r\n/g, '\n');
  const matName = path.basename(matInfo.relPath, path.extname(matInfo.relPath));
  const shaderGuid = txt.match(/m_Shader:\s*\{[^}]*guid:\s*([0-9a-f]{32})/)?.[1] || '';

  const kwMatch = txt.match(/m_ValidKeywords:\s*\n([\s\S]*?)(?=\n {0,4}(?:m_|m_InvalidKeywords:|m_LightmapFlags:)|$)/);
  const keywords = kwMatch
    ? [...kwMatch[1].matchAll(/^\s*-\s*([A-Za-z0-9_]+)/gm)].map((m) => m[1])
    : ((txt.match(/m_ShaderKeywords:\s*([^\n]+)/)?.[1] || '').trim().split(/\s+/).filter(Boolean));
  const kwSet = new Set(keywords);

  const textureBlock = (name) => txt.match(new RegExp(`- ${name}:([\\s\\S]*?)(?=\\n {0,4}(?:- |m_)|$)`))?.[1] || '';
  const textureGuid = (block) => block?.match(/m_Texture:[^\n]*guid:\s*([0-9a-f]{32})/)?.[1] || '';
  const readFloatProp = (name, fallback) => {
    const m = txt.match(new RegExp(`- ${name}:\\s*([-\\d.eE+]+)`));
    return m ? Number(m[1]) : fallback;
  };
  const readVec4Prop = (name, fallback) => {
    const mr = txt.match(new RegExp(`- ${name}:\\s*\\{r:\\s*([-\\d.eE+]+),\\s*g:\\s*([-\\d.eE+]+),\\s*b:\\s*([-\\d.eE+]+),\\s*a:\\s*([-\\d.eE+]+)`));
    if (mr) return [Number(mr[1]), Number(mr[2]), Number(mr[3]), Number(mr[4])];
    const mx = txt.match(new RegExp(`- ${name}:\\s*\\{x:\\s*([-\\d.eE+]+),\\s*y:\\s*([-\\d.eE+]+)(?:,\\s*z:\\s*([-\\d.eE+]+),\\s*w:\\s*([-\\d.eE+]+))?`));
    if (mx) return [Number(mx[1]), Number(mx[2]), Number(mx[3] ?? 0), Number(mx[4] ?? 0)];
    return fallback;
  };
  const readTexSlot = (name) => {
    const blk = textureBlock(name);
    if (!blk) return null;
    const guid = textureGuid(blk);
    const sclM = blk.match(/m_Scale:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+)\}/);
    const offM = blk.match(/m_Offset:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+)\}/);
    const st = [
      sclM ? Number(sclM[1]) : 1,
      sclM ? Number(sclM[2]) : 1,
      offM ? Number(offM[1]) : 0,
      offM ? Number(offM[2]) : 0,
    ];
    let spriteKey = null;
    let clamp = [0, 0];
    let srgb = true;
    if (guid && guidMap.has(guid)) {
      const tex = guidMap.get(guid);
      deps.textures.set(tex.relPath, tex);
      clamp = [tex.wrapU ? 1 : 0, tex.wrapV ? 1 : 0];
      srgb = tex.srgb !== false;
      spriteKey = path.basename(tex.relPath, path.extname(tex.relPath))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    }
    return { guid, spriteKey, st, blk, clamp, srgb };
  };

  let shaderKind = 'legacy';
  if (UBER_FX_SHADER_GUIDS.has(shaderGuid)) {
    shaderKind = 'uber_fx';
  } else if (shaderGuid === SHADER_GUID_PILOTO_WARP) {
    shaderKind = 'piloto_warp';
  } else if (PBR_FX_SHADER_GUIDS.has(shaderGuid)) {
    shaderKind = 'pbr_fx';
  } else if (!shaderGuid) {
    if (/- _MainTextureChannel:/.test(txt)) {
      shaderKind = 'uber_fx';
    } else if (/- _Distortion_Texture:/.test(txt)) {
      shaderKind = 'piloto_warp';
    } else if (/- _OcclusionRoughtMetal:/.test(txt)) {
      shaderKind = 'pbr_fx';
    }
  }

  const isDistortionOnly = shaderKind === 'piloto_warp'
    || /_DistortionEnabled:\s*1\b/.test(txt)
    || (shaderKind === 'legacy' && /distortion/i.test(matName));

  const surfaceMode = txt.match(/- _Surface:\s*([01])\b/)?.[1] ?? txt.match(/- _BUILTIN_Surface:\s*([01])\b/)?.[1];
  const surface = surfaceMode !== undefined ? Number(surfaceMode) : undefined;
  const cullNum = readFloatProp('_Cull', 0);
  const cullMode = cullNum === 1 ? 'front' : cullNum === 2 ? 'back' : undefined;
  const blendIntM = txt.match(/- _Blend:\s*(\d+)/) || txt.match(/- _BUILTIN_Blend:\s*(\d+)/);
  const dstBlendM = txt.match(/- _DstBlend:\s*(\d+)/) || txt.match(/- _BUILTIN_DstBlend:\s*(\d+)/);
  const srcBlendM = txt.match(/- _SrcBlend:\s*(\d+)/) || txt.match(/- _BUILTIN_SrcBlend:\s*(\d+)/);
  const srcBlendRaw = srcBlendM ? Number(srcBlendM[1]) : undefined;
  const dstBlendRaw = dstBlendM ? Number(dstBlendM[1]) : undefined;
  const isStaleUrpTransparentBlend = surfaceMode === '1' && srcBlendRaw === 1 && dstBlendRaw === 0;
  let srcBlend = srcBlendRaw;
  let dstBlend = dstBlendRaw;
  let blend = 'alpha';
  if (isDistortionOnly) {
    blend = 'distortion';
  } else if (blendIntM) {
    const bv = Number(blendIntM[1]);
    blend = bv === 3 ? 'multiply' : bv === 2 ? 'additive' : bv === 1 ? 'premultiply' : 'alpha';
  } else if (/_ADDITIVE/i.test(txt) || (dstBlendM && dstBlendM[1] === '1')) {
    blend = 'additive';
  } else if (srcBlendM && srcBlendM[1] === '2') {
    blend = 'multiply';
  } else if (/_ab$/i.test(matName)) {
    blend = 'alpha';
  }
  if (isStaleUrpTransparentBlend) {
    if (blend === 'additive') { srcBlend = 5; dstBlend = 1; }
    else if (blend === 'premultiply') { srcBlend = 1; dstBlend = 10; }
    else if (blend === 'multiply') { srcBlend = 2; dstBlend = 0; }
    else { srcBlend = 5; dstBlend = 10; }
  }

  const zWriteRaw = txt.match(/- _ZWrite:[ \t]*([^\s]+)/)?.[1] ?? txt.match(/- _BUILTIN_ZWrite:[ \t]*([^\s]+)/)?.[1];
  const zTestRaw = txt.match(/- _ZTest:[ \t]*([^\s]+)/)?.[1] ?? txt.match(/- _BUILTIN_ZTest:[ \t]*([^\s]+)/)?.[1];
  const zWrite = isStaleUrpTransparentBlend ? 0 : Number(zWriteRaw);
  const zTest = Number(zTestRaw);

  if (shaderKind !== 'legacy') {
    if (shaderKind === 'uber_fx') {
      const sMainRaw = readTexSlot('_MainTex');
      const sMainAlt = sMainRaw?.spriteKey ? null : readTexSlot('_MainTexture');
      const sMain = sMainAlt?.spriteKey ? sMainAlt : sMainRaw;
      const sDet = readTexSlot('_DetailNoise');
      const sAlphaOv = readTexSlot('_AlphaOverride');
      const alphaClipThreshold = readFloatProp('_Alpha_Clip_Threshold', 0.5);
      const useSoft = kwSet.has('_USESOFTALPHA');
      const uberOpaque = surfaceMode === '0';
      const uberBlend = uberOpaque ? 'alpha' : blend;
      // UberFXSG compiles with m_AlphaClip: false; stale _ALPHATEST_ON on Transparent+Additive discards low-alpha trails.
      const alphaTest = (uberOpaque || uberBlend !== 'additive') && (kwSet.has('_ALPHATEST_ON') || readFloatProp('_AlphaClip', 0) > 0.5);
      const cleanKeywords = alphaTest ? keywords : keywords.filter((k) => k !== '_ALPHATEST_ON');
      const uberDepthWrite = zWrite === 0 || zWrite === 1 ? zWrite === 1 : uberOpaque;
      const uberMat = {
        key: `${shaderKind}:${matName}`,
        shaderProfile: 'piloto_uber_fx',
        shaderKind,
        surface,
        opaque: uberOpaque,
        blend: uberBlend,
        srcBlend,
        dstBlend,
        cull: cullNum,
        cullMode,
        depthTest: VFX_DEPTH_TESTS[zTest],
        depthWrite: uberDepthWrite,
        keywords: cleanKeywords,
        doubleSided: cullNum === 0,
        mainTexKey: sMain?.spriteKey || null,
        mainClamp: sMain?.clamp || [0, 0],
        mainSrgb: sMain?.srgb ?? true,
        mainTexST: sMain?.st || [1, 1, 0, 0],
        mainTexPanning: readVec4Prop('_MainTexturePanning', [0, 0, 0, 0]).slice(0, 2),
        mainTextureChannel: readVec4Prop('_MainTextureChannel', [1, 1, 1, 0]),
        mainAlphaChannel: readVec4Prop('_MainAlphaChannel', [0, 0, 0, 1]),
        detailNoiseKey: sDet?.spriteKey || null,
        detailClamp: sDet?.clamp || [0, 0],
        detailSrgb: sDet?.srgb ?? true,
        detailNoiseST: sDet?.st || [1, 1, 0, 0],
        detailNoisePanning: readVec4Prop('_DetailNoisePanning', [0, 0, 0, 0]).slice(0, 2),
        detailDistortionChannel: readVec4Prop('_DetailDistortionChannel', [0, 0, 0, 0]),
        detailMultiplyChannel: readVec4Prop('_DetailMultiplyChannel', [0, 0, 0, 0]),
        detailAdditiveChannel: readVec4Prop('_DetailAdditiveChannel', [0, 0, 0, 0]),
        detailDissolveChannel: readVec4Prop('_DetailDisolveChannel', [1, 0, 0, 0]),
        detailVertexOffsetChannel: readVec4Prop('_DetailVertexOffsetChannel', [0, 0, 0, 0]),
        alphaOverrideKey: sAlphaOv?.spriteKey || null,
        alphaOvClamp: sAlphaOv?.clamp || [0, 0],
        alphaOvSrgb: sAlphaOv?.srgb ?? true,
        alphaOverrideST: sAlphaOv?.st || [1, 1, 0, 0],
        alphaOverridePanning: readVec4Prop('_AlphaOverridePanning', [0, 0, 0, 0]).slice(0, 2),
        alphaOverrideChannel: readVec4Prop('_AlphaOverrideChannel', [1, 0, 0, 0]),
        desaturate: readFloatProp('_Desaturate', 0),
        multiplyNoiseDesaturation: readFloatProp('_MultiplyNoiseDesaturation', 1),
        distortionIntensity: readFloatProp('_DistortionIntensity', 0),
        softFadeFactor: readFloatProp('_SoftFadeFactor', 0.1),
        dissolveFadeRange: readVec4Prop('_Disolve_Fade_Range', [-0.25, 1, 0, 0]).slice(0, 2),
        whiteColor: readVec4Prop('_WhiteColor', [1, 1, 1, 1]),
        midColor: readVec4Prop('_MidColor', [1, 1, 1, 1]),
        lastColor: readVec4Prop('_LastColor', [0, 0, 0, 1]),
        middlePointPos: readFloatProp('_MiddlePointPos', 0.5),
        middlePointPos1: readFloatProp('_MiddlePointPos1', 0.0),
        fresnelColor: readVec4Prop('_FresnelColor', [1, 1, 1, 1]),
        fresnelPower: readFloatProp('_FresnelPower', 1),
        fresnelScale: readFloatProp('_FresnelScale', 1),
        invertFresnel: readFloatProp('_Invert_Fresnel', 0) > 0.5,
        tintFresnel: readFloatProp('_Tint_Fresnel', 0) > 0.5,
        alphaClipThreshold,
        alphaTest,
        alphaClip: alphaTest,
        useSoftAlpha: useSoft,
        useAlphaOverride: kwSet.has('_USEALPHAOVERRIDE'),
        useRamp: kwSet.has('_USERAMP'),
        useUvOffset: kwSet.has('_USEUVOFFSET'),
        useFresnel: kwSet.has('_FRESNEL'),
        disableErosion: kwSet.has('_DISABLEEROSION'),
      };
      return {
        matName,
        spriteKey: sMain?.spriteKey || null,
        hdr: 1.0,
        tintRgb: [1, 1, 1],
        tintAlpha: 1.0,
        blend: uberBlend,
        cullMode,
        cutoff: alphaTest ? alphaClipThreshold : undefined,
        opaque: uberOpaque,
        depthTest: VFX_DEPTH_TESTS[zTest],
        depthWrite: uberDepthWrite,
        softParticles: useSoft,
        isDistortionOnly: false,
        flipbookBlend: true,
        uberMat,
        material: uberMat,
      };
    }

    if (shaderKind === 'piloto_warp') {
      const sDist = readTexSlot('_Distortion_Texture');
      const sAlpha = readTexSlot('_Alpha_Texture');
      const useSoft = kwSet.has('_USE_SOFT_ALPHA') || kwSet.has('_USESOFTALPHA') || readFloatProp('_Use_Soft_Alpha', 0) > 0.5;
      const uberMat = {
        key: `${shaderKind}:${matName}`,
        shaderProfile: 'piloto_warp',
        shaderKind,
        surface,
        blend: 'distortion',
        srcBlend,
        dstBlend,
        cull: cullNum,
        cullMode,
        depthTest: VFX_DEPTH_TESTS[zTest],
        depthWrite: zWrite === 0 || zWrite === 1 ? zWrite === 1 : false,
        keywords,
        doubleSided: cullNum === 0,
        distortionTextureKey: sDist?.spriteKey || null,
        mainClamp: sDist?.clamp || [0, 0],
        distortionTextureST: sDist?.st || [1, 1, 0, 0],
        distortionPanning: readVec4Prop('_Distortion_Panning', [0, 0, 0, 0]).slice(0, 2),
        distortionStrength: readFloatProp('_Distortion_Strength', 0.05),
        alphaTextureKey: sAlpha?.spriteKey || null,
        alphaOvClamp: sAlpha?.clamp || [0, 0],
        alphaTextureST: sAlpha?.st || [1, 1, 0, 0],
        alphaPanning: readVec4Prop('_Alpha_Panning', [0, 0, 0, 0]).slice(0, 2),
        alphaChannelPicker: readVec4Prop('_Alpha_Channel_Picker', [1, 0, 0, 0]),
        polarCoordinates: readFloatProp('_Polar_Coordinates', 0) > 0.5,
        unpackNormals: readFloatProp('_Unpack_Normals', 0) > 0.5,
        softFadeFactor: readFloatProp('_SoftFadeFactor', 0.1),
        useSoftAlpha: useSoft,
      };
      return {
        matName,
        spriteKey: sDist?.spriteKey || null,
        hdr: 1.0,
        tintRgb: [1, 1, 1],
        tintAlpha: 1.0,
        blend: 'distortion',
        cullMode,
        depthTest: VFX_DEPTH_TESTS[zTest],
        depthWrite: zWrite === 0 || zWrite === 1 ? zWrite === 1 : false,
        softParticles: useSoft,
        isDistortionOnly: true,
        flipbookBlend: true,
        uberMat,
        material: uberMat,
      };
    }

    // shaderKind === 'pbr_fx'
    const pickFirstTex = (...names) => {
      let first = null;
      for (const n of names) {
        const s = readTexSlot(n);
        if (!first && s) first = s;
        if (s?.spriteKey) return s;
      }
      return first;
    };
    const sBase = pickFirstTex('_BaseColorMap', '_MainTex', '_Diffuse', '_UnlitColorMap');
    const sNorm = pickFirstTex('_Normal', '_NormalMap', '_Normal_Map');
    const sOrm = pickFirstTex('_OcclusionRoughtMetal', '_Occlusion_Rough_Metal', '_MaskMap');
    const sEmis = pickFirstTex('_Emission');
    const sDet = pickFirstTex('_Detail_Map', '_DetailMap');
    const sDiss = pickFirstTex('_Dissolve_Map');
    const pbrColorFallback = txt.includes('- _BaseColorTint:')
      ? readVec4Prop('_BaseColorTint', [1, 1, 1, 1])
      : readVec4Prop('_BaseColor', [1, 1, 1, 1]);
    const alphaClipping = kwSet.has('_ALPHATEST_ON') || readFloatProp('_AlphaClip', 0) > 0.5;
    const alphaClipThreshold = readFloatProp('_Alpha_Clip_Threshold', readFloatProp('_AlphaClipping', 0.5));
    const pbrBlend = surfaceMode === '0' ? 'alpha' : blend;
    const uberMat = {
      key: `${shaderKind}:${matName}`,
      shaderProfile: 'piloto_pbr_fx',
      shaderKind,
      surface,
      opaque: surfaceMode === '0',
      blend: pbrBlend,
      srcBlend,
      dstBlend,
      cull: cullNum,
      cullMode,
      depthTest: VFX_DEPTH_TESTS[zTest],
      depthWrite: zWrite === 0 || zWrite === 1 ? zWrite === 1 : (surfaceMode === '0'),
      keywords,
      doubleSided: cullNum === 0,
      baseColorMapKey: sBase?.spriteKey || null,
      mainClamp: sBase?.clamp || [0, 0],
      mainSrgb: sBase?.srgb ?? true,
      baseColorMapST: sBase?.st || [1, 1, 0, 0],
      baseColorMapPanning: readVec4Prop('_Base_Map_Panning', readVec4Prop('_Base_Color_Panning', [0, 0, 0, 0])).slice(0, 2),
      baseColorTint: pbrColorFallback,
      normalMapKey: sNorm?.spriteKey || null,
      normalMapST: sNorm?.st || [1, 1, 0, 0],
      normalPanning: readVec4Prop('_Normal_Panning', [0, 0, 0, 0]).slice(0, 2),
      normalScale: readFloatProp('_NormalScale', 1),
      ormMapKey: sOrm?.spriteKey || null,
      ormMapST: sOrm?.st || [1, 1, 0, 0],
      pbrMaskPanning: readVec4Prop('_PBR_Mask_Panning', [0, 0, 0, 0]).slice(0, 2),
      occlusionScale: readFloatProp('_OcclusionScale', 1),
      smoothnessScale: readFloatProp('_SmoothnessScale', 0.5),
      metallicScale: readFloatProp('_MetallicScale', 0),
      emissionMapKey: sEmis?.spriteKey || null,
      emissionMapST: sEmis?.st || [1, 1, 0, 0],
      emissionPanning: readVec4Prop('_Emission_Panning', [0, 0, 0, 0]).slice(0, 2),
      emissiveTint: readVec4Prop('_EmissiveTint', [0, 0, 0, 1]),
      intensity: readFloatProp('_Intensity', 1),
      selfIlluminationIntensity: readFloatProp('_Self_Ilumination_Intensity', 0),
      detailMapKey: sDet?.spriteKey || null,
      detailClamp: sDet?.clamp || [0, 0],
      detailSrgb: sDet?.srgb ?? false,
      detailMapST: sDet?.st || [1, 1, 0, 0],
      detailMapPanning: readVec4Prop('_Detail_Map_Panning', [0, 0, 0, 0]).slice(0, 2),
      detailDistortionChannel: readVec4Prop('_Detail_Distortion_Channel', [0, 0, 0, 0]),
      detailDissolveChannel: readVec4Prop('_Detail_Dissolve_Channel', [1, 0, 0, 0]),
      detailVertexOffsetChannel: readVec4Prop('_Detail_Vertex_Offset_Channel', [0, 0, 0, 0]),
      dissolveMapKey: sDiss?.spriteKey || null,
      alphaOvSrgb: sDiss?.srgb ?? true,
      dissolveMapST: sDiss?.st || [1, 1, 0, 0],
      dissolveMapPanning: readVec4Prop('_Dissolve_Map_Panning', [0, 0, 0, 0]).slice(0, 2),
      dissolveFadeRange: readVec4Prop('_Dissolve_Fade_Range', [-0.25, 1, 0, 0]).slice(0, 2),
      dissolveAmount: readFloatProp('_Dissolve_Amount', 0),
      useBaseAsNormal: readFloatProp('_Use_Base_as_Normal', 0) > 0.5,
      baseNormalStrength: readFloatProp('_Base_Normal_Strength', 1),
      distortionBaseIntensity: readFloatProp('_Distortion_Base_Intensity', readFloatProp('_Distortion_Main_Intensity', 0)),
      distortionNormalIntensity: readFloatProp('_Distortion_Normal_Intensity', 0),
      distortionDissolveIntensity: readFloatProp('_Distortion_Dissolve_Intensity', 0),
      vertexOffsetIntensity: readFloatProp('_Vertex_Offset_Intensity', 1),
      fresnelColor: readVec4Prop('_Fresnel_Color', [1, 1, 1, 1]),
      fresnelPower: readFloatProp('_Fresnel_Power', 1),
      fresnelIntensity: readFloatProp('_Fresnel_Intensity', readFloatProp('_Fresnel_Scale', 1)),
      invertFresnel: readFloatProp('_Invert_Fresnel', 0) > 0.5,
      tintFresnel: readFloatProp('_Tint_Fresnel', 0) > 0.5,
      alphaClipping,
      alphaClip: alphaClipping,
      alphaTest: alphaClipping,
      alphaClipThreshold,
      cutoff: alphaClipping ? alphaClipThreshold : undefined,
      isParticle: kwSet.has('_ISPARTICLE'),
      useFresnel: kwSet.has('_FRESNEL'),
      useUvOffset: kwSet.has('_USEUVOFFSET'),
      disableErosion: kwSet.has('_DISABLEEROSION'),
    };
    return {
      matName,
      spriteKey: sBase?.spriteKey || null,
      hdr: 1.0,
      tintRgb: [1, 1, 1],
      tintAlpha: 1.0,
      blend: uberMat.blend,
      cullMode,
      cutoff: alphaClipping ? alphaClipThreshold : undefined,
      lit: true,
      opaque: surfaceMode === '0',
      depthTest: VFX_DEPTH_TESTS[zTest],
      depthWrite: zWrite === 0 || zWrite === 1 ? zWrite === 1 : (surfaceMode === '0'),
      softParticles: false,
      isDistortionOnly: false,
      flipbookBlend: true,
      uberMat,
      material: uberMat,
    };
  }

  const baseBlock = textureBlock('_BaseMap');
  const legacyBlock = textureBlock('_MainTex');
  const baseTexture = surfaceMode !== undefined ? (baseBlock ?? legacyBlock) : (legacyBlock ?? baseBlock);
  const refractionTexture = isDistortionOnly
    ? ['_DistortionTexture', '_NormalMap', '_BumpMap'].map(textureBlock).find(textureGuid)
    : undefined;
  const mainTexBlock = refractionTexture ?? baseTexture ?? '';
  const mainTexGuid = textureGuid(mainTexBlock);
  const baseColor = txt.match(/- _BaseColor:\s*\{([^}]+)\}/);
  const legacyColor = txt.match(/- _TintColor:\s*\{([^}]+)\}/) || txt.match(/- _Color:\s*\{([^}]+)\}/);
  const colorMatch = surfaceMode !== undefined ? (baseColor || legacyColor) : (legacyColor || baseColor);
  const color = colorMatch ? normalizeHdrColor(parseColorObject(colorMatch[1], false)) : { hdr: 1, rgb: [1, 1, 1], a: 1 };

  const alphaClip = /- _AlphaClip:\s*1\b/.test(txt) || /_ALPHATEST_ON/.test(txt);
  const cutoff = alphaClip ? Number((txt.match(/- _Cutoff:\s*([-\d.eE+]+)/) || [])[1] ?? 0.5) : undefined;

  const emOn = /- _EmissionEnabled:\s*1\b/.test(txt) || /_EMISSION(?:_ON)?\b/.test(txt);
  let emission;
  let emissionBoost = 0;
  if (emOn) {
    const emM = txt.match(/- _Emissive?Color:\s*\{([^}]+)\}/) || txt.match(/- _EmissionColor:\s*\{([^}]+)\}/);
    if (emM) {
      const ec = parseColorObject(emM[1], false);
      if (ec[0] > 0.005 || ec[1] > 0.005 || ec[2] > 0.005) {
        emission = [Number(ec[0].toFixed(3)), Number(ec[1].toFixed(3)), Number(ec[2].toFixed(3))];
        emissionBoost = Number(Math.max(ec[0], ec[1], ec[2]).toFixed(3));
      }
    }
  }

  const camFadeOn = /- _CameraFadingEnabled:\s*1\b/.test(txt);
  let cameraFade;
  if (camFadeOn) {
    const nearD = Number((txt.match(/- _CameraNearFadeDistance:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
    const farD = Number((txt.match(/- _CameraFarFadeDistance:\s*([-\d.eE+]+)/) || [])[1] ?? 2);
    if (farD > nearD + 0.01) {
      cameraFade = [Number(nearD.toFixed(3)), Number(farD.toFixed(3))];
    }
  }

  let uvScale;
  let uvOffset;
  const sclM = mainTexBlock.match(/m_Scale:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+)\}/);
  const offM = mainTexBlock.match(/m_Offset:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+)\}/);
  if (sclM) {
    const sx = Number(sclM[1]), sy = Number(sclM[2]);
    if (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01) {
      uvScale = [Number(sx.toFixed(3)), Number(sy.toFixed(3))];
    }
  }
  if (offM) {
    const ox = Number(offM[1]), oy = Number(offM[2]);
    if (Math.abs(ox) > 0.005 || Math.abs(oy) > 0.005) {
      uvOffset = [Number(ox.toFixed(3)), Number(oy.toFixed(3))];
    }
  }

  const isLit = /_NORMALMAP|_METALLIC|_SPECGLOSSMAP|Standard Surface/i.test(txt) || /guid:\s*0406db5a14f94604a8c57ccfbc9f3b46/.test(txt);
  const isOpaque = surfaceMode !== undefined ? surfaceMode === '0' : /- _Mode:\s*[01]\b/.test(txt);
  const softParticles = Number(txt.match(/- _SoftParticlesEnabled:[ \t]*([^\s]+)/)?.[1]);
  const clearedBase = !mainTexBlock || /m_Texture:\s*\{fileID:\s*0\s*[,}]/.test(mainTexBlock);
  const flipbookMode = Number(txt.match(/- _FlipbookBlending:[ \t]*([\d.]+)/)?.[1]
    ?? txt.match(/- _FlipbookMode:[ \t]*([\d.]+)/)?.[1] ?? 0);

  let spriteKey = null;
  if (mainTexGuid && guidMap.has(mainTexGuid)) {
    const tex = guidMap.get(mainTexGuid);
    deps.textures.set(tex.relPath, tex);
    spriteKey = path.basename(tex.relPath, path.extname(tex.relPath))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  const material = {
    shaderProfile: isDistortionOnly ? 'unity_standard' : 'unity_standard',
    surface,
    blend,
    srcBlend,
    dstBlend,
    cull: cullNum,
    cullMode,
    depthTest: VFX_DEPTH_TESTS[zTest],
    depthWrite: zWrite === 0 || zWrite === 1 ? zWrite === 1 : undefined,
    opaque: isOpaque,
    alphaClip,
    alphaTest: alphaClip,
    cutoff,
    alphaClipThreshold: cutoff,
    softParticles: softParticles === 0 || softParticles === 1 ? softParticles === 1 : undefined,
    mainTexKey: spriteKey,
    mainTexST: [uvScale?.[0] ?? 1, uvScale?.[1] ?? 1, uvOffset?.[0] ?? 0, uvOffset?.[1] ?? 0],
    // tintColor is already baked into colorCurve/startColor during conversion; keep shader multiplier neutral.
    tintColor: [1, 1, 1, 1],
    hdr: isDistortionOnly ? 1.0 : color.hdr,
    emission,
    keywords,
  };

  return {
    matName,
    spriteKey,
    hdr: isDistortionOnly ? 1.0 : color.hdr,
    tintRgb: isDistortionOnly ? [1, 1, 1] : color.rgb,
    tintAlpha: color.a,
    blend,
    cullMode,
    cutoff,
    emission,
    emissionBoost,
    cameraFade,
    uvScale,
    uvOffset,
    lit: isLit,
    opaque: isOpaque,
    depthTest: VFX_DEPTH_TESTS[zTest],
    depthWrite: zWrite === 0 || zWrite === 1 ? zWrite === 1 : undefined,
    softParticles: softParticles === 0 || softParticles === 1 ? softParticles === 1 : undefined,
    useTexture: isOpaque && !isDistortionOnly && clearedBase ? false : undefined,
    isDistortionOnly,
    flipbookBlend: flipbookMode >= 1,
    material,
  };
}

function normAssetKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const metaSubmeshCache = new Map();
const artifactDbCache = new Map();

function findArtifactDbPath(assetFullPath) {
  let dir = path.dirname(assetFullPath);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'Library', 'ArtifactDB');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveFbxSubmeshName(assetFullPath, fileId) {
  if (!fileId || fileId === '0' || fileId === '4300000' || fileId === '4300002' || fileId === '4300004') {
    return null;
  }
  let metaMap = metaSubmeshCache.get(assetFullPath);
  if (!metaMap) {
    metaMap = new Map();
    metaSubmeshCache.set(assetFullPath, metaMap);
    const metaPath = `${assetFullPath}.meta`;
    if (fs.existsSync(metaPath)) {
      const txt = fs.readFileSync(metaPath, 'utf8');
      const recBlk = txt.match(/fileIDToRecycleName:\n((?:\s+[^\n]+\n)*)/)?.[1] || '';
      for (const m of recBlk.matchAll(/^\s+(-?\d+):\s*([^\r\n]+)/gm)) {
        metaMap.set(m[1], m[2].trim());
      }
      const tblBlk = txt.match(/internalIDToNameTable:\n((?:\s+[^\n]+\n)*)/)?.[1] || '';
      for (const m of tblBlk.matchAll(/43:\s*(-?\d+)\s*\n\s*second:\s*([^\r\n]+)/g)) {
        metaMap.set(m[1], m[2].trim());
      }
    }
  }
  if (metaMap.has(fileId)) {
    const meshNamesCount = metaMap.size;
    return { name: metaMap.get(fileId), multi: meshNamesCount > 1 };
  }
  const dbPath = findArtifactDbPath(assetFullPath);
  if (!dbPath) return null;
  let db = artifactDbCache.get(dbPath);
  if (!db) {
    db = { buf: fs.readFileSync(dbPath), fids: new Map() };
    artifactDbCache.set(dbPath, db);
  }
  if (db.fids.has(fileId)) return db.fids.get(fileId);
  let resolved = null;
  try {
    const pat = Buffer.allocUnsafe(8);
    pat.writeBigInt64LE(BigInt(fileId));
    const buf = db.buf;
    let idx = 0;
    while ((idx = buf.indexOf(pat, idx)) !== -1) {
      if (idx >= 80 && buf.readInt32LE(idx - 8) === -1) {
        const rowStart = idx - 80;
        const tid = buf.readUInt32LE(rowStart + 28);
        const rel = buf.readUInt32LE(rowStart);
        if (tid === 43 && rel > 0 && rel < 8192 && rowStart + rel < buf.length) {
          const sOff = rowStart + rel;
          const end = Math.min(buf.length, sOff + 128);
          let nul = -1;
          for (let k = sOff; k < end; k++) {
            if (buf[k] === 0) {
              nul = k;
              break;
            }
          }
          if (nul > sOff) {
            const name = buf.subarray(sOff, nul).toString('utf8');
            if (/^[A-Za-z0-9_.\- ]+$/.test(name)) {
              const pTid = rowStart >= 88 ? buf.readUInt32LE(rowStart - 88 + 28) : 0;
              const nTid = rowStart + 88 + 32 <= buf.length ? buf.readUInt32LE(rowStart + 88 + 28) : 0;
              resolved = { name, multi: (pTid === 43 || nTid === 43) };
              break;
            }
          }
        }
      }
      idx += 8;
    }
  } catch {
    resolved = null;
  }
  db.fids.set(fileId, resolved);
  return resolved;
}

function resolveMeshKey(fbxRelPath, matName, submeshName = null) {
  const fbxBase = path.basename(fbxRelPath, path.extname(fbxRelPath));
  const fbxKey = normAssetKey(fbxBase.replace(/\([^)]*\)/g, ''));
  const rawFbxKey = normAssetKey(fbxBase);
  let baseKey = rawFbxKey;
  if (matName) {
    const matKey = normAssetKey(matName);
    if (matKey !== fbxKey && matKey !== rawFbxKey) {
      baseKey = matKey.startsWith(fbxKey + '_') ? matKey : `${rawFbxKey}__${matKey}`;
    }
  }
  if (submeshName) {
    const subNorm = normAssetKey(submeshName);
    if (subNorm) return `${baseKey}__sub_${subNorm}`;
  }
  return baseKey;
}

function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function quatRotateVec(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

function quatToMat3(q) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
}

function mat3Mul(a, b) {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

function mat3Diag(x, y, z) {
  return [x, 0, 0, 0, y, 0, 0, 0, z];
}

function mat3Scale(m, k) {
  return [
    m[0] * k, m[1] * k, m[2] * k,
    m[3] * k, m[4] * k, m[5] * k,
    m[6] * k, m[7] * k, m[8] * k,
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

function toRhsZ(v) {
  return v === 0 ? 0 : -v;
}

function toRhsQuat(q) {
  return [
    q[0] === 0 ? 0 : -q[0],
    q[1] === 0 ? 0 : -q[1],
    q[2],
    q[3],
  ];
}

function negateValueOrRange(v) {
  if (Array.isArray(v)) {
    const a = v[0] === 0 ? 0 : -v[0];
    const b = v[1] === 0 ? 0 : -v[1];
    return [Math.min(a, b), Math.max(a, b)];
  }
  if (typeof v === 'number') return v === 0 ? 0 : -v;
  return v;
}

function parseVertexStreams(psr) {
  const m = psr.match(/^\s*m_VertexStreams:\s*([0-9a-fA-F]+)/m);
  if (!m) return null;
  const hex = m[1].trim().toLowerCase();
  const out = {};
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = hex.slice(i, i + 2);
    if (code === '05') out.uv2 = true;
    else if (code === '21') out.agePercent = true;
    else if (code === '22') out.custom1 = true;
    else if (code === '23') out.custom2 = true;
    else if (code === '26') out.stableRandom = true;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseMinMaxCurveData(block, allowNegative = false) {
  if (!block) return null;
  const mode = Number((block.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
  const scalar = Number((block.match(/\bscalar:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
  const minScalar = Number((block.match(/\bminScalar:\s*([-\d.eE+]+)/) || [])[1] ?? scalar);
  if (mode === 0) return Number(scalar.toFixed(4));
  if (mode === 3) {
    const lo = Math.min(minScalar, scalar);
    const hi = Math.max(minScalar, scalar);
    return [Number(lo.toFixed(4)), Number(hi.toFixed(4))];
  }
  if (mode === 1) {
    const curve = parseCurveKeys(block, allowNegative);
    return curve ? { mode: 'curve', scalar: Number(scalar.toFixed(4)), curve } : Number(scalar.toFixed(4));
  }
  if (mode === 2) {
    const maxBlk = block.split(/\n\s*minCurve:/)[0] || block;
    const minBlk = block.split(/\n\s*minCurve:/)[1] || '';
    const curve = parseCurveKeys(maxBlk, allowNegative);
    const minCurve = minBlk ? parseCurveKeys(minBlk, allowNegative) : null;
    if (curve && minCurve) {
      return {
        mode: 'twoCurves',
        scalar: Number(scalar.toFixed(4)),
        minScalar: Number(minScalar.toFixed(4)),
        curve,
        minCurve,
      };
    }
    if (curve) return { mode: 'curve', scalar: Number(scalar.toFixed(4)), curve };
    return [Number(Math.min(minScalar, scalar).toFixed(4)), Number(Math.max(minScalar, scalar).toFixed(4))];
  }
  return Number(scalar.toFixed(4));
}

function quatToXyzEuler([x, y, z, w]) {
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - z * w);
  const r02 = 2 * (x * z + y * w);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - x * w);
  const r21 = 2 * (y * z + x * w);
  const r22 = 1 - 2 * (x * x + y * y);
  const ry = Math.asin(Math.max(-1, Math.min(1, r02)));
  let rx = 0;
  let rz = 0;
  if (Math.abs(r02) < 0.9995) {
    rx = Math.atan2(-r12, r22);
    rz = Math.atan2(-r01, r00);
  } else {
    rx = Math.atan2(r21, r11);
    rz = 0;
  }
  return [Number(rx.toFixed(4)), Number(ry.toFixed(4)), Number(rz.toFixed(4))];
}

function quatToYxzEuler([x, y, z, w]) {
  const r00 = 1 - 2 * (y * y + z * z);
  const r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w);
  const r22 = 1 - 2 * (x * x + y * y);
  const rx = Math.asin(Math.max(-1, Math.min(1, -r12)));
  let ry = 0;
  let rz = 0;
  if (Math.abs(r12) < 0.9995) {
    ry = Math.atan2(r02, r22);
    rz = Math.atan2(r10, r11);
  } else {
    ry = Math.atan2(-r20, r00);
    rz = 0;
  }
  return [Number(rx.toFixed(4)), Number(ry.toFixed(4)), Number(rz.toFixed(4))];
}

function computeShapeRotation(trQuat, sRotMatch, mappedType) {
  if (mappedType === 'point') return null;
  const rawTr = Array.isArray(trQuat)
    ? trQuat
    : trQuat
      ? [Number(trQuat[1]), Number(trQuat[2]), Number(trQuat[3]), Number(trQuat[4])]
      : [0, 0, 0, 1];
  const rawSh = sRotMatch
    ? unityEulerToQuat(Number(sRotMatch[1]), Number(sRotMatch[2]), Number(sRotMatch[3]))
    : [0, 0, 0, 1];
  // Convert LHS Unity transform & shape quaternions to RHS Three.js quaternions at import time.
  const qTr = toRhsQuat(rawTr);
  const qSh = toRhsQuat(rawSh);
  // Canonical Unity shapes point +Z_lhs (-Z_rhs); HGame cone/circle/hemisphere/donut/rectangle use +Y / XZ (-90 deg X offset from +Y to -Z),
  // whereas box/edge/mesh already use direct (X, Y, Z) coordinates.
  const s45 = Math.SQRT1_2;
  const needsYToMinusZBasis = mappedType === 'cone'
    || mappedType === 'hemisphere'
    || mappedType === 'circle'
    || mappedType === 'donut'
    || mappedType === 'rectangle';
  const qOff = needsYToMinusZBasis
    ? quatMul(quatMul(qTr, qSh), [-s45, 0, 0, s45])
    : quatMul(qTr, qSh);
  const euler = quatToXyzEuler(qOff);
  const [x, y, z, w] = qOff;
  const r11 = 1 - 2 * (x * x + z * z);
  const isFlat = mappedType === 'circle' || mappedType === 'donut' || mappedType === 'rectangle';
  const hasYawOrRoll = Math.abs(euler[1]) >= 0.005 || Math.abs(euler[2]) >= 0.005;
  if (Math.abs(euler[0]) < 0.005 && !hasYawOrRoll) return null;
  if (isFlat && r11 < -0.985 && !hasYawOrRoll) return null;
  return euler;
}

function mapShapeType(unityType) {
  switch (Number(unityType)) {
    case 0:
    case 1: return 'sphere';
    case 2:
    case 3: return 'hemisphere';
    case 4:
    case 7:
    case 8:
    case 9: return 'cone';
    case 5:
    case 15:
    case 16: return 'box';
    case 6:
    case 13:
    case 14: return 'mesh';
    case 10:
    case 11:
    case 19:
    case 20: return 'circle';
    case 12: return 'edge';
    case 17: return 'donut';
    case 18: return 'rectangle';
    default: return 'sphere';
  }
}

export function convertUnityPrefab({ unityRoot, prefabPath, id, meshManifest = null, guidMap: sharedGuidMap = null }) {
  const guidMap = sharedGuidMap || buildGuidIndex(unityRoot, unityRoot);
  const raw = fs.readFileSync(prefabPath, 'utf8').replace(/\r\n/g, '\n');
  const docs = raw.split(/^--- !u!/m).slice(1);
  const goNames = new Map();
  const transforms = [];
  const trById = new Map();
  const trByGo = new Map();
  const psByGo = new Map();
  const psById = new Map();
  const psrByGo = new Map();
  const lightByGo = new Map();
  const lightById = new Map();

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
      lightById.set(fid, body);
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
  let maxDuration = 0.5;
  let lightPulse = null;
  let subCounter = 0;

  function computeHierarchyTransform(trBody) {
    const ident = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (!trBody) return { pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1], ownScale: [1, 1, 1], linear: ident };
    const chain = [];
    let cur = trBody;
    let guard = 0;
    while (cur && guard++ < 8) {
      const fId = (cur.match(/m_Father:\s*\{fileID:\s*(\d+)\}/) || [])[1] ?? '0';
      const posM = cur.match(/m_LocalPosition:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
      const rotM = cur.match(/m_LocalRotation:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+),\s*w:\s*([-\d.eE+]+)\}/);
      const sclM = cur.match(/m_LocalScale:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
      chain.push({
        isRoot: fId === '0',
        pos: posM ? [Number(posM[1]), Number(posM[2]), Number(posM[3])] : [0, 0, 0],
        rot: rotM ? [Number(rotM[1]), Number(rotM[2]), Number(rotM[3]), Number(rotM[4])] : [0, 0, 0, 1],
        scale: sclM ? [Number(sclM[1]), Number(sclM[2]), Number(sclM[3])] : [1, 1, 1],
      });
      if (fId === '0') break;
      cur = trById.get(fId);
    }
    let pos = [0, 0, 0];
    let rot = [0, 0, 0, 1];
    let scale = [1, 1, 1];
    let linear = ident;
    for (let i = chain.length - 1; i >= 0; i--) {
      const node = chain[i];
      if (!node.isRoot) {
        const scaled = [node.pos[0] * scale[0], node.pos[1] * scale[1], node.pos[2] * scale[2]];
        const rPos = quatRotateVec(rot, scaled);
        pos = [pos[0] + rPos[0], pos[1] + rPos[1], pos[2] + rPos[2]];
      }
      rot = quatMul(rot, node.rot);
      scale = [scale[0] * node.scale[0], scale[1] * node.scale[1], scale[2] * node.scale[2]];
      linear = mat3Mul(linear, mat3Mul(quatToMat3(node.rot), mat3Diag(node.scale[0], node.scale[1], node.scale[2])));
    }
    return {
      pos: [Number(pos[0].toFixed(4)), Number(pos[1].toFixed(4)), toRhsZ(Number(pos[2].toFixed(4)))],
      rot,
      scale,
      ownScale: chain[0]?.scale || [1, 1, 1],
      linear,
    };
  }

  function computeUnityPath(trBody) {
    if (!trBody) return '';
    const parts = [];
    let cur = trBody;
    const seen = new Set();
    while (cur) {
      const fId = (cur.match(/m_Father:\s*\{fileID:\s*(\d+)\}/) || [])[1] ?? '0';
      if (fId === '0') break;
      const gId = (cur.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/) || [])[1];
      const gName = (gId && goNames.get(gId)?.name) || 'layer';
      parts.push(gName);
      if (seen.has(fId)) break;
      seen.add(fId);
      cur = trById.get(fId);
    }
    parts.reverse();
    return parts.join('/');
  }

  function convertParticleLayer(goId, trBody, isSubChild, subDepth) {
    const go = goNames.get(goId) || { name: 'layer', active: true };
    const unityPath = computeUnityPath(trBody);
    const ps = psByGo.get(goId);
    const psr = psrByGo.get(goId);
    if (!ps || !psr) return null;
    const psrDisabled = /^\s*m_Enabled:\s*0\b/m.test(psr);
    if (psrDisabled) {
      const tmCheck = extractSection(ps, 'TrailModule');
      const smCheck = extractSection(ps, 'SubModule');
      if (!/^\s*enabled:\s*1\b/m.test(tmCheck) && !/^\s*enabled:\s*1\b/m.test(smCheck)) return null;
    }

    const worldTr = isSubChild
      ? { pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1], ownScale: [1, 1, 1], linear: [1, 0, 0, 0, 1, 0, 0, 0, 1] }
      : computeHierarchyTransform(trBody);
    const subTr = isSubChild ? computeHierarchyTransform(trBody) : null;
    const offset = worldTr.pos;
    const psScalingMode = Number((ps.match(/^\s*scalingMode:\s*(\d+)/m) || [])[1] ?? 0);
    const shapeScaleVec = psScalingMode === 1 ? worldTr.ownScale : worldTr.scale;
    const partScaleVec = psScalingMode === 0 ? worldTr.scale : (psScalingMode === 1 ? worldTr.ownScale : [1, 1, 1]);
    const shSx = Math.abs(shapeScaleVec[0]);
    const shSy = Math.abs(shapeScaleVec[1]);
    const shSz = Math.abs(shapeScaleVec[2]);
    const shScaleScalar = Number(((shSx + shSy + shSz) / 3).toFixed(4));
    const trSx = Math.abs(partScaleVec[0]);
    const trSy = Math.abs(partScaleVec[1]);
    const trSz = Math.abs(partScaleVec[2]);
    const trScaleScalar = Number(((trSx + trSy + trSz) / 3).toFixed(4));
    const hasNonUniformTrScale = Math.abs(trSx - trSy) > 0.02 || Math.abs(trSx - trSz) > 0.02;

    const isLoop = /^\s*looping:\s*1\b/m.test(ps);
    const isPrewarm = /^\s*prewarm:\s*1\b/m.test(ps);
    const dur = Number((ps.match(/^\s*lengthInSec:\s*([-\d.eE+]+)/m) || [])[1] ?? 2);
    const simSpeed = Number((ps.match(/^\s*simulationSpeed:\s*([-\d.eE+]+)/m) || [])[1] ?? 1);
    const isLocalSpace = /^\s*moveWithTransform:\s*1\b/m.test(ps);
    const rawDelay = readMinMaxScalar(ps, 'startDelay', 0);
    const delay = Array.isArray(rawDelay) ? Number(((rawDelay[0] + rawDelay[1]) * 0.5).toFixed(4)) : Number(rawDelay || 0);
    const maxDelay = Array.isArray(rawDelay) ? rawDelay[1] : delay;

    const initMod = extractSection(ps, 'InitialModule');
    const maxParticles = Number((initMod.match(/^\s*maxNumParticles:\s*(\d+)/m) || [])[1] ?? 1000);
    const size3D = /^\s*size3D:\s*1\b/m.test(initMod);
    const rot3D = /^\s*rotation3D:\s*1\b/m.test(initMod);
    const rawLife = readMinMaxScalar(initMod, 'startLifetime', 1);
    const isInf = (v) => typeof v === 'number' && !Number.isFinite(v);
    const hasInfiniteLife = Array.isArray(rawLife) ? (isInf(rawLife[0]) || isInf(rawLife[1])) : isInf(rawLife);
    const fixInf = (v) => (isInf(v) ? dur : v);
    const life = Array.isArray(rawLife) ? [fixInf(rawLife[0]), fixInf(rawLife[1])] : fixInf(rawLife);
    const speed = readMinMaxScalar(initMod, 'startSpeed', 0);
    const size = readMinMaxScalar(initMod, 'startSize', 1);
    const sizeY = size3D ? readMinMaxScalar(initMod, 'startSizeY', 1) : size;
    const sizeZ = size3D ? readMinMaxScalar(initMod, 'startSizeZ', 1) : size;
    const rot = readMinMaxScalar(initMod, 'startRotation', 0);
    const rotX = rot3D ? readMinMaxScalar(initMod, 'startRotationX', 0) : 0;
    const rotY = rot3D ? readMinMaxScalar(initMod, 'startRotationY', 0) : 0;
    const gravScalar = readMinMaxScalar(initMod, 'gravityModifier', 0);

    const maxLife = Array.isArray(life) ? life[1] : life;
    maxDuration = Math.max(maxDuration, isLoop ? dur : ((maxDelay + maxLife) / Math.max(0.05, simSpeed)));

    const extractModSubBlock = (mod, fieldName) => mod.match(new RegExp(`(?:^|\\n) {4}${fieldName}:[^\\n]*\\n([\\s\\S]*?)(?=\\n {4}[A-Za-z_]|$)`))?.[1] || '';

    const scBlock = initMod.match(/(?:^|\n) {4}startColor:[^\n]*\n[\s\S]*?(?=\n {4}[a-zA-Z]|$)/)?.[0] || '';
    const scMode = Number((scBlock.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
    const maxColM = scBlock.match(/maxColor:\s*\{([^}]+)\}/);
    const minColM = scBlock.match(/minColor:\s*\{([^}]+)\}/);
    const maxCol = maxColM ? parseColorObject(maxColM[1]) : [1, 1, 1, 1];
    const minCol = minColM ? parseColorObject(minColM[1]) : maxCol;
    const scGradStops = scMode === 1 ? parseGradientStops(scBlock) : null;
    const scRandomStops = scMode === 4 ? parseGradientStops(scBlock) : null;

    const emMod = extractSection(ps, 'EmissionModule');
    const emDisabled = /^\s*enabled:\s*0\b/m.test(emMod);
    if (emDisabled) return null;
    const rate = readMinMaxScalar(emMod, 'rateOverTime', 0);
    const rateBlk = extractModSubBlock(emMod, 'rateOverTime');
    const rateState = Number((rateBlk.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
    const rateCurve = rateState === 1 ? parseCurveKeys(rateBlk) : null;
    const rateDist = readMinMaxScalar(emMod, 'rateOverDistance', 0);
    const bursts = [];
    const burstCount = Number((emMod.match(/m_BurstCount:\s*(\d+)/) || [])[1] ?? 0);
    const burstsPart = emMod.split('m_Bursts:')[1] || '';
    if (burstCount > 0 && burstsPart) {
      const burstEntries = burstsPart.split(/\n\s*-\s*serializedVersion:\s*\d+/).slice(1);
      for (let bi = 0; bi < Math.min(burstCount, burstEntries.length); bi++) {
        const be = burstEntries[bi];
        const bTime = Number((be.match(/\btime:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
        const bMode = Number((be.match(/\bminMaxState:\s*(\d+)/) || [])[1] ?? 0);
        const bMax = Math.max(0, Math.round(Number((be.match(/\bscalar:\s*([-\d.eE+]+)/) || [])[1] ?? 1)));
        const bMin = Math.max(0, Math.round(Number((be.match(/\bminScalar:\s*([-\d.eE+]+)/) || [])[1] ?? bMax)));
        const bCyc = Number((be.match(/\bcycleCount:\s*(\d+)/) || [])[1] ?? 1);
        const bInt = Number((be.match(/\brepeatInterval:\s*([-\d.eE+]+)/) || [])[1] ?? 0.01);
        const bProb = Number((be.match(/\bprobability:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
        if (bMax === 0 && (bMode !== 3 || bMin === 0)) continue;
        bursts.push({
          time: bTime,
          count: bMode === 3 && bMin !== bMax ? [Math.min(bMin, bMax), Math.max(bMin, bMax)] : bMax,
          cycles: bCyc === 0 ? 0 : Math.max(1, bCyc),
          interval: bInt,
          ...(bProb < 0.999 ? { probability: Number(bProb.toFixed(3)) } : {}),
        });
      }
    }
    const effectiveBursts = bursts;
    const effectiveRate = rate;
    const hasPositiveRate = Array.isArray(effectiveRate) ? effectiveRate[1] > 0 : effectiveRate > 0;
    const hasPositiveRateDist = Array.isArray(rateDist) ? rateDist[1] > 0 : rateDist > 0;

    const matsBlock = (psr.match(/m_Materials:\s*\n([\s\S]*?)(?:\n  m_|$)/) || ['', ''])[1];
    const matGuids = [...matsBlock.matchAll(/guid:\s*([0-9a-f]{32})/g)].map((m) => m[1]);
    const mainMat = inspectMaterial(guidMap.get(matGuids[0]), guidMap, deps);
    const trailMat = matGuids[1] ? inspectMaterial(guidMap.get(matGuids[1]), guidMap, deps) : null;

    const rmNum = Number((psr.match(/^\s*m_RenderMode:\s*(\d+)/m) || [])[1] ?? 0);
    const renderAlign = Number((psr.match(/^\s*m_RenderAlignment:\s*(\d+)/m) || [])[1] ?? 0);
    const sortingOrder = Number((psr.match(/^\s*m_SortingOrder:\s*(-?\d+)/m) || [])[1] ?? 0);
    const flipM = psr.match(/m_Flip:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
    const psrFlip = flipM
      ? [Number(flipM[1]) || 0, Number(flipM[2]) || 0, Number(flipM[3]) || 0]
      : [0, 0, 0];
    const alignRot = isSubChild ? computeHierarchyTransform(trBody).rot : worldTr.rot;
    const rxScalar = Array.isArray(rotX) ? (rotX[0] + rotX[1]) * 0.5 : (typeof rotX === 'number' ? rotX : 0);
    const ryScalar = Array.isArray(rotY) ? (rotY[0] + rotY[1]) * 0.5 : (typeof rotY === 'number' ? rotY : 0);
    const rotScalar = Array.isArray(rot) ? (rot[0] + rot[1]) * 0.5 : (typeof rot === 'number' ? rot : 0);
    let renderMode = psrDisabled
      ? 'none'
      : (rmNum === 5 ? 'none' : rmNum === 4 ? 'mesh' : rmNum === 3 ? 'vertical' : rmNum === 2 ? 'horizontal' : rmNum === 1 ? 'stretched' : 'billboard');
    const sizeXMax = (Array.isArray(size) ? size[1] : size) * (hasNonUniformTrScale && renderMode === 'mesh' ? trSx : 1);
    const sizeYMax = (Array.isArray(sizeY) ? sizeY[1] : sizeY) * (hasNonUniformTrScale && renderMode === 'mesh' ? trSy : 1);
    const sizeZMax = (Array.isArray(sizeZ) ? sizeZ[1] : sizeZ) * (hasNonUniformTrScale && renderMode === 'mesh' ? trSz : 1);
    const nonUniformRatioY = sizeXMax > 0.0001 && Math.abs(sizeYMax / sizeXMax - 1) > 0.05;
    const nonUniformRatioZ = sizeXMax > 0.0001 && Math.abs(sizeZMax / sizeXMax - 1) > 0.05;
    const aspectY = (size3D || (hasNonUniformTrScale && renderMode === 'mesh')) && nonUniformRatioY
      ? Number((sizeYMax / sizeXMax).toFixed(3))
      : undefined;
    const aspectZ = (size3D || (hasNonUniformTrScale && renderMode === 'mesh')) && nonUniformRatioZ
      ? Number((sizeZMax / sizeXMax).toFixed(3))
      : undefined;
    let effectiveRot = rot;
    let effectiveRotX = rotX;
    let effectiveRotY = rotY;
    let meshTransformRot = null;
    const isWorldOrLocalBillboard = rmNum === 0 && (renderAlign === 1 || renderAlign === 2) && !psrDisabled;
    if (isWorldOrLocalBillboard) {
      // Proven by Unity BakeMesh probe: Billboard alignment=World/Local uses qParentRhs * Euler(+rx, +ry, -rz, 'YXZ')
      const rad2deg = 180 / Math.PI;
      const qTrRhs = renderAlign === 2 ? toRhsQuat(alignRot) : [0, 0, 0, 1];
      const qPartRhs = toRhsQuat(unityEulerToQuat(-rxScalar * rad2deg, -ryScalar * rad2deg, -rotScalar * rad2deg));
      const qCombined = renderAlign === 2 ? quatMul(qTrRhs, qPartRhs) : qPartRhs;
      const [ex, ey, ez] = quatToYxzEuler(qCombined);
      renderMode = 'vertical';
      effectiveRotX = Math.abs(ex) > 0.002 || Math.abs(ey) > 0.002 ? ex : 0.002;
      effectiveRotY = ey;
      effectiveRot = Array.isArray(rot)
        ? [Number((ez - (rot[1] - rotScalar)).toFixed(4)), Number((ez - (rot[0] - rotScalar)).toFixed(4))]
        : ez;
    }
    if (renderMode === 'mesh' && renderAlign === 2 && Math.abs(alignRot[3]) < 0.9999) {
      meshTransformRot = toRhsQuat(alignRot).map((v) => Number(v.toFixed(5)));
    }
    const pivM = psr.match(/m_Pivot:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
    const pivot = pivM && (Math.abs(Number(pivM[1])) > 0.005 || Math.abs(Number(pivM[2])) > 0.005 || Math.abs(Number(pivM[3])) > 0.005)
      ? [Number(Number(pivM[1]).toFixed(3)), Number(Number(pivM[2]).toFixed(3)), toRhsZ(Number(Number(pivM[3]).toFixed(3)))]
      : undefined;
    const vertexStreams = parseVertexStreams(psr);
    const velScale = renderMode === 'stretched'
      ? Number((psr.match(/^\s*m_VelocityScale:\s*([-\d.eE+]+)/m) || [])[1] ?? 0)
      : 0;
    const lenScale = renderMode === 'stretched'
      ? Number((psr.match(/^\s*m_LengthScale:\s*([-\d.eE+]+)/m) || [])[1] ?? 1)
      : 0;

    const forceMod = extractSection(ps, 'ForceModule');
    const scaleGrav = (g) => Number((Number(g) * 9.81).toFixed(3));
    const netGravity = Array.isArray(gravScalar)
      ? [scaleGrav(gravScalar[0]), scaleGrav(gravScalar[1])]
      : scaleGrav(gravScalar);
    const hasNetGravity = Array.isArray(netGravity)
      ? (Math.abs(netGravity[0]) > 0.001 || Math.abs(netGravity[1]) > 0.001)
      : Math.abs(netGravity) > 0.001;
    let forceVec = null;
    if (/enabled:\s*1/.test(forceMod)) {
      const fx = readMinMaxScalar(forceMod, 'x', 0);
      const fy = readMinMaxScalar(forceMod, 'y', 0);
      const fz = negateValueOrRange(readMinMaxScalar(forceMod, 'z', 0));
      const nz = (v) => Array.isArray(v) ? (Math.abs(v[0]) > 0.001 || Math.abs(v[1]) > 0.001) : Math.abs(v) > 0.001;
      if (nz(fx) || nz(fy) || nz(fz)) {
        forceVec = [fx, fy, fz];
      }
    }
    const extMod = extractSection(ps, 'ExternalForcesModule');
    let windMul = 0;
    if (/enabled:\s*1/.test(extMod)) {
      windMul = Number((extMod.match(/\bmultiplier:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
    }

    const resolveSingleMeshSlot = (slotName) => {
      const refRe = new RegExp(`${slotName}:\\s*\\{fileID:\\s*(-?\\d+)(?:,\\s*guid:\\s*([0-9a-f]{32}))?`);
      const mRef = psr.match(refRe);
      if (!mRef) return null;
      const fid = mRef[1] || '0';
      const guid = mRef[2];
      if (guid && guidMap.has(guid)) {
        const mInfo = guidMap.get(guid);
        deps.meshes.set(mInfo.relPath, mInfo);
        const manifestEntry = meshManifest?.[`${guid}:${fid}`] || null;
        const sub = manifestEntry
          ? { name: manifestEntry.subMeshName, multi: Boolean(manifestEntry.multi) }
          : resolveFbxSubmeshName(mInfo.fullPath, fid);
        const subName = sub?.multi ? sub.name : null;
        return {
          key: resolveMeshKey(mInfo.relPath, mainMat?.matName, subName),
          globalScale: manifestEntry ? 1 : (mInfo.globalScale ?? 1),
        };
      }
      if (fid === '10210') return { key: 'quad', globalScale: 1 };
      if (fid === '10202') return { key: 'cube', globalScale: 1 };
      if (fid === '10207') return { key: 'sphere', globalScale: 1 };
      if (fid === '10206') return { key: 'cylinder', globalScale: 1 };
      return null;
    };

    const primaryMeshSlot = resolveSingleMeshSlot('m_Mesh');
    // Unified LHS->RHS mesh rotation: qPartRhs = toRhsQuat(Euler(rx, ry, rz, 'YXZ')) = Euler(-rx, -ry, +rz, 'YXZ').
    const MESH_ALIGN_NAMES = ['view', 'world', 'local', 'facing', 'velocity'];
    const meshAlign = MESH_ALIGN_NAMES[renderAlign] || 'world';
    const negateAngleUnlessFullSpin = (v) => {
      if (Array.isArray(v) && Math.abs(v[0]) < 1e-3 && Math.abs(v[1] - Math.PI * 2) < 0.01) return v;
      return negateValueOrRange(v);
    };
    if (renderMode === 'mesh') {
      effectiveRotX = negateAngleUnlessFullSpin(effectiveRotX);
      effectiveRotY = negateAngleUnlessFullSpin(effectiveRotY);
    }
    let meshKey = primaryMeshSlot?.key || 'crystal';
    let meshGlobalScale = primaryMeshSlot?.globalScale ?? 1;
    const meshVariants = [];
    for (const [mField, wField] of [
      ['m_Mesh', 'm_MeshWeighting'],
      ['m_Mesh1', 'm_MeshWeighting1'],
      ['m_Mesh2', 'm_MeshWeighting2'],
      ['m_Mesh3', 'm_MeshWeighting3'],
    ]) {
      const resolvedSlot = mField === 'm_Mesh' ? primaryMeshSlot : resolveSingleMeshSlot(mField);
      if (!resolvedSlot) continue;
      const wM = psr.match(new RegExp(`^\\s*${wField}:\\s*([\\d.eE+-]+)`, 'm'));
      const weight = Math.max(0, wM ? Number(wM[1]) : 1);
      if (weight <= 0) continue;
      const prev = meshVariants.find((v) => v.mesh === resolvedSlot.key);
      if (prev) prev.weight = Number((prev.weight + weight).toFixed(4));
      else meshVariants.push({ mesh: resolvedSlot.key, weight: Number(weight.toFixed(4)) });
    }

    const isNonZeroVal = (v) => Array.isArray(v) ? (Math.abs(v[0]) > 1e-4 || Math.abs(v[1]) > 1e-4) : Math.abs(v) > 1e-4;
    const scaleRangeBy = (v, s) => {
      if (Math.abs(s - 1) <= 0.005) return v;
      return Array.isArray(v) ? [Number((v[0] * s).toFixed(4)), Number((v[1] * s).toFixed(4))] : Number((v * s).toFixed(4));
    };
    const splitMeshScale = hasNonUniformTrScale && renderMode === 'mesh';
    const scaledSize = scaleRangeBy(size, splitMeshScale ? trSx : trScaleScalar);
    const layer = {
      name: go.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
      unityPath,
      kind: renderMode === 'mesh' ? 'mesh' : 'particle',
      renderMode,
      blend: mainMat?.blend || 'alpha',
      hdr: mainMat?.hdr ?? 1.0,
      ...(mainMat?.spriteKey ? { sprite: mainMat.spriteKey } : {}),
      ...(mainMat?.cullMode ? { cullMode: mainMat.cullMode } : {}),
      ...(mainMat?.cutoff !== undefined ? { alphaCutoff: Number(mainMat.cutoff.toFixed(3)) } : {}),
      ...(mainMat?.opaque && !mainMat.isDistortionOnly ? { opaque: true } : {}),
      ...(mainMat?.depthTest !== undefined ? { depthTest: mainMat.depthTest } : {}),
      ...(mainMat?.depthWrite !== undefined ? { depthWrite: mainMat.depthWrite } : {}),
      ...(sortingOrder !== 0 ? { sortingOrder } : {}),
      ...(mainMat?.softParticles !== undefined ? { softParticles: mainMat.softParticles } : {}),
      ...(mainMat?.useTexture === false ? { useTexture: false } : {}),
      ...(mainMat?.emission ? { emission: mainMat.emission, emissionBoost: mainMat.emissionBoost } : {}),
      ...(mainMat?.cameraFade ? { cameraFade: mainMat.cameraFade } : {}),
      ...(mainMat?.uvScale ? { uvScale: mainMat.uvScale } : {}),
      ...(mainMat?.uvOffset ? { uvOffset: mainMat.uvOffset } : {}),
      ...(mainMat?.uberMat ? { uberMat: mainMat.uberMat } : {}),
      ...(mainMat?.material ? { material: mainMat.material } : {}),
      ...(vertexStreams ? { vertexStreams } : {}),
      ...(aspectZ !== undefined ? { aspectZ } : {}),
      ...((size3D || splitMeshScale) ? { sizeY: scaleRangeBy(sizeY, splitMeshScale ? trSy : trScaleScalar), sizeZ: scaleRangeBy(sizeZ, splitMeshScale ? trSz : trScaleScalar) } : {}),
      ...(pivot ? { pivot } : {}),
      ...(renderMode === 'stretched'
        ? { velocityScale: Number(velScale.toFixed(3)), lengthScale: Number(lenScale.toFixed(3)) }
        : {}),
      ...(Math.abs(simSpeed - 1) > 0.01 ? { simulationSpeed: Number(simSpeed.toFixed(3)) } : {}),
      ...(isLocalSpace ? { space: 'local' } : {}),
      ...(maxParticles > 0 && maxParticles < 1000 ? { maxParticles } : {}),
      ...(isPrewarm && !isSubChild ? { prewarm: true } : {}),
      ...(dur > 0 ? { duration: Number(dur.toFixed(4)) } : {}),
      ...(isLoop && !isSubChild ? { loop: true } : { loop: false }),
      ...(typeof delay === 'number' && delay > 0 ? { delay } : {}),
      ...(effectiveBursts.length > 0 ? { bursts: effectiveBursts } : {}),
      ...(hasPositiveRate ? { rate: effectiveRate } : {}),
      ...(rateCurve ? { rateCurve } : {}),
      ...(hasPositiveRateDist ? { rateOverDistance: rateDist } : {}),
      ...(hasInfiniteLife ? { persistent: true } : {}),
      life,
      speed,
      size: scaledSize,
      ...(aspectY !== undefined ? { aspectY } : {}),
      rotation: effectiveRot,
      ...(isNonZeroVal(effectiveRotX) ? { rotX: effectiveRotX } : {}),
      ...(isNonZeroVal(effectiveRotY) ? { rotY: effectiveRotY } : {}),
      ...(meshTransformRot ? { transformRot: meshTransformRot } : {}),
      ...(hasNetGravity ? { gravity: netGravity } : {}),
      ...(forceVec ? { force: forceVec } : {}),
      ...(windMul > 0.001 ? { windMul: Number(windMul.toFixed(3)) } : {}),
    };

    if (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0) {
      layer.offset = offset;
    }

    if (renderMode === 'mesh') {
      layer.mesh = meshKey;
      if (meshVariants.length > 1) layer.meshes = meshVariants;
      if (Math.abs(meshGlobalScale - 1) > 0.005) layer.meshGlobalScale = Number(meshGlobalScale.toFixed(4));
      layer.unityMeshRot = true;
      layer.meshAlign = meshAlign;
      layer.forwardAxis = renderAlign === 4 ? '-z' : 'y';
      if (mainMat?.lit) layer.lit = true;
      if (renderAlign === 4) {
        layer.alignToVelocity = true;
      }
    }

    if (scMode === 2) {
      layer.startColor = [minCol.slice(0, 3), maxCol.slice(0, 3)];
    } else if (scMode === 4 && scRandomStops?.length) {
      layer.startColor = scRandomStops;
    }

    let shapePosOffset = null;
    const shapeMod = extractSection(ps, 'ShapeModule');
    const hasEnabledShape = /enabled:\s*1/.test(shapeMod);
    if (hasEnabledShape) {
      const st = (shapeMod.match(/type:\s*(\d+)/) || [])[1] ?? 0;
      const mappedType = mapShapeType(st);
      const rad = Number((shapeMod.match(/radius:[\s\S]*?value:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
      const donutRad = Number((shapeMod.match(/donutRadius:\s*([-\d.eE+]+)/) || [])[1] ?? 0.25);
      const ang = Number((shapeMod.match(/\bangle:\s*([-\d.eE+]+)/) || [])[1] ?? 25);
      const radThick = Number((shapeMod.match(/\bradiusThickness:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
      const randPos = Number((shapeMod.match(/\brandomPositionAmount:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
      const randDir = Number((shapeMod.match(/\brandomDirectionAmount:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
      const sphDir = Number((shapeMod.match(/\bsphericalDirectionAmount:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
      const alignDir = /alignToDirection:\s*1\b/.test(shapeMod);
      const sPosM = shapeMod.match(/m_Position:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
      if (sPosM) {
        const spx = Number(sPosM[1]) * shapeScaleVec[0];
        const spy = Number(sPosM[2]) * shapeScaleVec[1];
        const spz = Number(sPosM[3]) * shapeScaleVec[2];
        if (Math.abs(spx) > 1e-4 || Math.abs(spy) > 1e-4 || Math.abs(spz) > 1e-4) {
          const rSp = quatRotateVec(worldTr.rot, [spx, spy, spz]);
          shapePosOffset = [
            Number(rSp[0].toFixed(4)),
            Number(rSp[1].toFixed(4)),
            Number(toRhsZ(rSp[2]).toFixed(4)),
          ];
        }
      }
      const sRotM = shapeMod.match(/m_Rotation:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
      const sSclM = shapeMod.match(/m_Scale:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
      const shSignSx = sSclM ? Number(sSclM[1]) : 1;
      const shSignSy = sSclM ? Number(sSclM[2]) : 1;
      const shSignSz = sSclM ? Number(sSclM[3]) : 1;
      const rawShSx = Math.abs(shSignSx);
      const rawShSy = Math.abs(shSignSy);
      const rawShSz = Math.abs(shSignSz);
      const qShLocal = sRotM ? unityEulerToQuat(Number(sRotM[1]), Number(sRotM[2]), Number(sRotM[3])) : [0, 0, 0, 1];
      const axX = quatRotateVec(qShLocal, [1, 0, 0]);
      const axY = quatRotateVec(qShLocal, [0, 1, 0]);
      const axZ = quatRotateVec(qShLocal, [0, 0, 1]);
      const effTrX = Math.hypot(shSx * axX[0], shSy * axX[1], shSz * axX[2]);
      const effTrY = Math.hypot(shSx * axY[0], shSy * axY[1], shSz * axY[2]);
      const effTrZ = Math.hypot(shSx * axZ[0], shSy * axZ[1], shSz * axZ[2]);

      const shapeObj = {
        type: mappedType,
        radius: rad > 0 && rad < 0.001 ? Number((rad * shScaleScalar).toFixed(4)) : Number((rad * shScaleScalar).toFixed(3)),
        angle: Number(ang.toFixed(1)),
      };
      if (shapePosOffset) {
        shapeObj.offset = shapePosOffset;
      }
      if (Number(st) === 8 || Number(st) === 9) {
        const coneLen = Number((shapeMod.match(/\blength:\s*([-\d.eE+]+)/) || [])[1] ?? 5);
        if (coneLen > 0) shapeObj.length = Number((coneLen * shScaleScalar).toFixed(3));
      }
      if (mappedType === 'donut') {
        shapeObj.donutRadius = Number((donutRad * shScaleScalar).toFixed(3));
      }
      if (mappedType === 'rectangle') {
        shapeObj.size = [
          Number((rawShSx * effTrX).toFixed(3)),
          Number((rawShSy * effTrY).toFixed(3)),
          Number((rawShSz * effTrZ).toFixed(3)),
        ];
      }
      if (mappedType === 'box') {
        const boxSize = [
          Number((rawShSx * effTrX).toFixed(3)),
          Number((rawShSy * effTrY).toFixed(3)),
          Number((rawShSz * effTrZ).toFixed(3)),
        ];
        if (Math.abs(boxSize[0] - 1) > 0.001 || Math.abs(boxSize[1] - 1) > 0.001 || Math.abs(boxSize[2] - 1) > 0.001) {
          shapeObj.size = boxSize;
        }
      }
      if (mappedType === 'mesh') {
        const shapeMeshM = shapeMod.match(/m_Mesh:\s*\{fileID:\s*(-?\d+)(?:,\s*guid:\s*([0-9a-f]{32}))?/);
        const smFid = shapeMeshM?.[1] || '0';
        const smGuid = shapeMeshM?.[2];
        if (smGuid && guidMap.has(smGuid)) {
          const smInfo = guidMap.get(smGuid);
          deps.meshes.set(smInfo.relPath, smInfo);
          const smMan = meshManifest?.[`${smGuid}:${smFid}`] || null;
          const smSub = smMan ? (smMan.multi ? smMan.subMeshName : null) : null;
          shapeObj.mesh = resolveMeshKey(smInfo.relPath, null, smSub);
        }
        const meshNormalOff = Number((shapeMod.match(/\bm_MeshNormalOffset:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
        if (Math.abs(meshNormalOff) > 1e-4) {
          shapeObj.normalOffset = Number(meshNormalOff.toFixed(4));
        }
      }
      if (mappedType === 'box') {
        if (Number(st) === 15) shapeObj.shell = true;
        else if (Number(st) === 16) shapeObj.boxEdge = true;
      } else {
        if (radThick < 0.05 || [1, 3, 7, 9, 11].includes(Number(st))) shapeObj.shell = true;
        else if (radThick < 0.99) shapeObj.radiusThickness = Number(radThick.toFixed(3));
      }
      if (randPos > 0.001) shapeObj.randomPos = Number(randPos.toFixed(3));
      if (randDir > 0.001) shapeObj.randomDirectionAmount = Number(randDir.toFixed(3));
      if (sphDir > 0.001) shapeObj.sphericalDirectionAmount = Number(sphDir.toFixed(3));
      if (alignDir) shapeObj.alignToDirection = true;
      const arcBlk = extractModSubBlock(shapeMod, 'arc');
      if (arcBlk) {
        const arcDeg = Number((arcBlk.match(/\bvalue:\s*([-\d.eE+]+)/) || [])[1] ?? 360);
        const arcModeNum = Number((arcBlk.match(/\bmode:\s*(\d+)/) || [])[1] ?? 0);
        const arcSpread = Number((arcBlk.match(/\bspread:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
        const arcSpeed = readMinMaxScalar(arcBlk, 'speed', 1);
        if (arcDeg < 359.5) shapeObj.arc = Number(arcDeg.toFixed(1));
        if (arcModeNum === 1 || arcModeNum === 2 || arcModeNum === 3) {
          shapeObj.arcMode = arcModeNum === 1 ? 'loop' : arcModeNum === 2 ? 'pingpong' : 'burst-spread';
          if (arcSpread > 0.001) shapeObj.arcSpread = Number(arcSpread.toFixed(3));
          if (arcModeNum !== 3) {
            const spdScalar = Array.isArray(arcSpeed) ? arcSpeed[0] : arcSpeed;
            if (Math.abs(spdScalar - 1) > 0.001) shapeObj.arcSpeed = Number(spdScalar.toFixed(3));
          }
        }
      }

      let useShapeMatrix = false;
      if (mappedType !== 'mesh') {
        const Lw = isSubChild
          ? quatToMat3(alignRot)
          : (psScalingMode === 1
            ? mat3Mul(quatToMat3(worldTr.rot), mat3Diag(worldTr.ownScale[0], worldTr.ownScale[1], worldTr.ownScale[2]))
            : worldTr.linear);
        const Rsh = quatToMat3(qShLocal);
        const Ssh = mat3Diag(shSignSx, shSignSy, shSignSz);
        let M = mat3Mul(Lw, mat3Mul(Rsh, Ssh));
        const F = mat3Diag(1, 1, -1);
        M = mat3Mul(F, mat3Mul(M, F));
        const needsBasisSwap = mappedType === 'cone'
          || mappedType === 'hemisphere'
          || mappedType === 'circle'
          || mappedType === 'donut'
          || mappedType === 'rectangle';
        if (needsBasisSwap) {
          M = mat3Mul(M, [1, 0, 0, 0, 0, 1, 0, -1, 0]);
        }
        const s = Math.max(1e-6, shScaleScalar);
        const Mn = mat3Scale(M, 1 / s);
        let maxDiff = 0;
        for (let mi = 0; mi < 9; mi++) {
          const idVal = (mi % 4 === 0) ? 1 : 0;
          const d = Math.abs(Mn[mi] - idVal);
          if (d > maxDiff) maxDiff = d;
        }
        if (maxDiff > 1e-3) {
          useShapeMatrix = true;
          shapeObj.matrix = Mn.map((v) => Number(v.toFixed(5)));
          if (mappedType === 'box' || mappedType === 'rectangle') {
            const sRound = Number(s.toFixed(3));
            shapeObj.size = [sRound, sRound, sRound];
          }
        }
      }

      if (!useShapeMatrix) {
        if (mappedType !== 'rectangle' && mappedType !== 'box') {
          const invScalar = 1 / Math.max(1e-6, shScaleScalar);
          const isMeshShape = mappedType === 'mesh';
          const ux = isMeshShape ? (rawShSx * effTrX) : (rawShSx * effTrX * invScalar);
          const uy = isMeshShape ? (rawShSy * effTrY) : (rawShSy * effTrY * invScalar);
          const uz = isMeshShape ? (rawShSz * effTrZ) : (rawShSz * effTrZ * invScalar);
          const usesBasisSwap = mappedType === 'cone' || mappedType === 'hemisphere' || mappedType === 'circle' || mappedType === 'donut';
          // HGame shapes with Y-to--Z basis apply shape.scale before Rx(-90): (lx, ly, lz) -> Unity (X, -Z, Y).
          const hx = Number(ux.toFixed(3));
          const hy = Number((usesBasisSwap ? uz : uy).toFixed(3));
          const hz = Number((usesBasisSwap ? uy : uz).toFixed(3));
          if (Math.abs(hx - 1) > 0.002 || Math.abs(hy - 1) > 0.002 || Math.abs(hz - 1) > 0.002) {
            shapeObj.scale = [hx, hy, hz];
          }
        }
        const needsSphereRot = mappedType !== 'sphere' || Boolean(shapeObj.scale) || shapeObj.arc !== undefined;
        const shapeRot = needsSphereRot ? computeShapeRotation(alignRot, sRotM, mappedType) : null;
        if (shapeRot) shapeObj.rotation = shapeRot;
      }
      layer.shape = shapeObj;
    }

    const mulRangeOrVal = (baseVal, factor) => {
      const mulScalar = (v, m) => (Array.isArray(v)
        ? [Number((v[0] * m).toFixed(4)), Number((v[1] * m).toFixed(4))]
        : Number((v * m).toFixed(4)));
      if (Array.isArray(factor)) {
        const bLo = Array.isArray(baseVal) ? baseVal[0] : baseVal;
        const bHi = Array.isArray(baseVal) ? baseVal[1] : baseVal;
        const fLo = Math.min(factor[0], factor[1]);
        const fHi = Math.max(factor[0], factor[1]);
        const p = [bLo * fLo, bLo * fHi, bHi * fLo, bHi * fHi];
        return [Number(Math.min(...p).toFixed(4)), Number(Math.max(...p).toFixed(4))];
      }
      return Math.abs(factor - 1) <= 0.001 ? baseVal : mulScalar(baseVal, factor);
    };
    const applySizeAxis = (curve, data, baseSize) => {
      if (data !== null && typeof data === 'number') {
        return { size: mulRangeOrVal(baseSize, data), curve: null };
      }
      if (Array.isArray(data)) {
        return { size: mulRangeOrVal(baseSize, data), curve: null };
      }
      if (!curve) return { size: baseSize, curve: null };
      const sMul = (data && typeof data === 'object' && typeof data.scalar === 'number') ? data.scalar : 1;
      const rawScaled = Math.abs(sMul - 1) <= 0.001
        ? curve
        : curve.map(([t, v]) => [t, Number((v * sMul).toFixed(4))]);
      const peak = Math.max(...rawScaled.map((k) => k[1]), 0);
      if (peak > 7.8) {
        const fold = peak / 7.5;
        return {
          size: mulRangeOrVal(baseSize, fold),
          curve: rawScaled.map(([t, v]) => [t, Number((v / fold).toFixed(4))]),
        };
      }
      return { size: baseSize, curve: rawScaled };
    };

    const sizeMod = extractSection(ps, 'SizeModule');
    if (/enabled:\s*1/.test(sizeMod)) {
      const sizeSep = /separateAxes:\s*1\b/.test(sizeMod);
      const origLayerSize = layer.size;
      const xBlk = extractModSubBlock(sizeMod, sizeSep ? 'x' : 'curve') || sizeMod;
      const scXData = parseMinMaxCurveData(xBlk);
      const scX = parseCurveKeys(xBlk);
      const resX = applySizeAxis(scX, scXData, layer.size);
      layer.size = resX.size;
      if (resX.curve) layer.sizeCurve = resX.curve;
      let scYData = null;
      let scZData = null;
      if (sizeSep) {
        const yBlk = extractModSubBlock(sizeMod, 'y');
        const scY = yBlk ? parseCurveKeys(yBlk) : null;
        if (yBlk) scYData = parseMinMaxCurveData(yBlk);
        const resY = applySizeAxis(scY, scYData, layer.sizeY ?? origLayerSize);
        if (resY.curve) layer.sizeYCurve = resY.curve;
        if (resY.size !== origLayerSize || layer.sizeY !== undefined) layer.sizeY = resY.size;
        const zBlk = extractModSubBlock(sizeMod, 'z');
        const scZ = zBlk ? parseCurveKeys(zBlk) : null;
        if (zBlk) scZData = parseMinMaxCurveData(zBlk);
        const resZ = applySizeAxis(scZ, scZData, layer.sizeZ ?? origLayerSize);
        if (resZ.curve) layer.sizeZCurve = resZ.curve;
        if (resZ.size !== origLayerSize || layer.sizeZ !== undefined) layer.sizeZ = resZ.size;
      } else {
        if (layer.sizeY !== undefined && scXData !== null && (typeof scXData === 'number' || Array.isArray(scXData) || Math.abs((scXData.scalar ?? 1) - 1) > 0.001)) {
          layer.sizeY = applySizeAxis(scX, scXData, layer.sizeY).size;
        }
        if (layer.sizeZ !== undefined && scXData !== null && (typeof scXData === 'number' || Array.isArray(scXData) || Math.abs((scXData.scalar ?? 1) - 1) > 0.001)) {
          layer.sizeZ = applySizeAxis(scX, scXData, layer.sizeZ).size;
        }
      }
      const needsSize3D = (d) => d && typeof d === 'object' && !Array.isArray(d) && (d.mode === 'twoCurves' || Math.abs((d.scalar ?? 1) - 1) > 0.001);
      if (needsSize3D(scXData) || needsSize3D(scYData) || needsSize3D(scZData)) {
        layer.size3D = {
          ...(scXData !== null ? { x: scXData } : {}),
          ...(scYData !== null ? { y: scYData } : {}),
          ...(scZData !== null ? { z: scZData } : {}),
        };
      }
    }

    const startMul = scMode === 2
      ? [1, 1, 1, Number(((minCol[3] + maxCol[3]) * 0.5).toFixed(4))]
      : (scMode === 4 && scRandomStops?.length)
        ? [1, 1, 1, Number((scRandomStops.reduce((s, st) => s + st[1][3], 0) / scRandomStops.length).toFixed(4))]
        : maxCol;
    const tintAlpha = mainMat?.tintAlpha ?? 1;
    const colorMod = extractSection(ps, 'ColorModule');
    const colCurve = /enabled:\s*1/.test(colorMod) ? parseGradientStops(colorMod) : null;
    const evalGradAt = (stops, t) => {
      if (!stops || stops.length === 0) return [1, 1, 1, 1];
      if (t <= stops[0][0]) return stops[0][1];
      if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
      for (let i = 0; i < stops.length - 1; i++) {
        if (t <= stops[i + 1][0]) {
          const f = (t - stops[i][0]) / Math.max(1e-6, stops[i + 1][0] - stops[i][0]);
          const a = stops[i][1], b = stops[i + 1][1];
          return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
        }
      }
      return stops[stops.length - 1][1];
    };
    const effectiveGrad = colCurve || scGradStops;
    if (effectiveGrad) {
      const mergedTimes = colCurve && scGradStops
        ? [...new Set([...colCurve.map((s) => s[0]), ...scGradStops.map((s) => s[0])])].sort((a, b) => a - b)
        : effectiveGrad.map((s) => s[0]);
      layer.colorCurve = mergedTimes.slice(0, 12).map((t) => {
        const cm = colCurve ? evalGradAt(colCurve, t) : [1, 1, 1, 1];
        const sm = scGradStops ? evalGradAt(scGradStops, t) : startMul;
        return [
          t,
          [
            Number((cm[0] * sm[0] * (mainMat?.tintRgb?.[0] ?? 1)).toFixed(3)),
            Number((cm[1] * sm[1] * (mainMat?.tintRgb?.[1] ?? 1)).toFixed(3)),
            Number((cm[2] * sm[2] * (mainMat?.tintRgb?.[2] ?? 1)).toFixed(3)),
            Number((cm[3] * sm[3] * tintAlpha).toFixed(3)),
          ],
        ];
      });
    } else {
      const constRgba = [
        Number((startMul[0] * (mainMat?.tintRgb?.[0] ?? 1)).toFixed(3)),
        Number((startMul[1] * (mainMat?.tintRgb?.[1] ?? 1)).toFixed(3)),
        Number((startMul[2] * (mainMat?.tintRgb?.[2] ?? 1)).toFixed(3)),
        Number((startMul[3] * tintAlpha).toFixed(3)),
      ];
      layer.colorCurve = [
        [0, constRgba],
        [1, constRgba],
      ];
    }
    let peakColorRgb = 1;
    for (let i = 0; i < layer.colorCurve.length; i++) {
      const c = layer.colorCurve[i][1];
      peakColorRgb = Math.max(peakColorRgb, c[0], c[1], c[2]);
    }
    if (peakColorRgb > 1.001) {
      layer.hdr = Number(((layer.hdr ?? 1.0) * peakColorRgb).toFixed(3));
      layer.colorCurve = layer.colorCurve.map(([t, c]) => [
        t,
        [
          Number((c[0] / peakColorRgb).toFixed(4)),
          Number((c[1] / peakColorRgb).toFixed(4)),
          Number((c[2] / peakColorRgb).toFixed(4)),
          c[3],
        ],
      ]);
    }
    if (hasInfiniteLife && (effectiveGrad || layer.sizeCurve || layer.sizeYCurve)) {
      layer.curveCycle = dur;
    }

    const extractSubBlock = extractModSubBlock;
    const velMod = extractSection(ps, 'VelocityModule');
    if (/enabled:\s*1/.test(velMod)) {
      const spdModBlock = extractSubBlock(velMod, 'speedModifier');
      const spdModState = Number((spdModBlock.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
      const spdModCurve = spdModState === 1 ? parseCurveKeys(spdModBlock, true) : null;
      const spdModRawScalar = Number((spdModBlock.match(/\bscalar:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
      const spdModRaw = spdModCurve ? spdModRawScalar : readMinMaxScalar(velMod, 'speedModifier', 1);
      const spdMul = Array.isArray(spdModRaw) ? spdModRaw[1] : spdModRaw;
      const mulV = (v) => {
        if (Math.abs(spdMul - 1) <= 0.001) return v;
        return Array.isArray(v)
          ? [Number((v[0] * spdMul).toFixed(3)), Number((v[1] * spdMul).toFixed(3))]
          : Number((v * spdMul).toFixed(3));
      };
      const evalKeyCurve = (keys, u) => {
        if (u <= keys[0][0]) return keys[0][1];
        if (u >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
        for (let i = 0; i < keys.length - 1; i++) {
          if (u <= keys[i + 1][0]) {
            const f = (u - keys[i][0]) / Math.max(1e-6, keys[i + 1][0] - keys[i][0]);
            return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * f;
          }
        }
        return keys[keys.length - 1][1];
      };
      const readAxisOrCurve = (axisName) => {
        const blk = extractSubBlock(velMod, axisName);
        const st = Number((blk.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
        if (st !== 1) return { val: mulV(readMinMaxScalar(velMod, axisName, 0)), curve: null };
        const ck = parseCurveKeys(blk, true);
        const rawAxisScalar = Number((blk.match(/\bscalar:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
        const sc = mulV(ck ? rawAxisScalar : readMinMaxScalar(velMod, axisName, 0));
        if (!ck) return { val: sc, curve: null };
        const scale = Array.isArray(sc) ? sc[1] : sc;
        let effKeys = ck.map(([t, kv]) => [t, kv * scale]);
        if (spdModCurve) {
          const mergedT = [...new Set([...ck.map((k) => k[0]), ...spdModCurve.map((k) => k[0])])].sort((a, b) => a - b);
          effKeys = mergedT.map((t) => [t, evalKeyCurve(ck, t) * scale * evalKeyCurve(spdModCurve, t)]);
        }
        let peak = 0;
        for (const [, kv] of effKeys) peak = Math.max(peak, Math.abs(kv));
        if (peak <= 0.001) return { val: 0, curve: null };
        return {
          val: Number(peak.toFixed(3)),
          curve: effKeys.map(([t, kv]) => [t, Number((kv / peak).toFixed(3))]),
        };
      };
      const isWorldVel = /inWorldSpace:\s*1\b/.test(velMod);
      const rx = readAxisOrCurve('x');
      const ry = readAxisOrCurve('y');
      const rz = readAxisOrCurve('z');
      const rRad = readAxisOrCurve('radial');
      const rotateRangeVecByQuat = (q, ax, ay, az) => {
        if (Math.abs(q[3]) >= 0.9999) return [ax, ay, az];
        const loOf = (v) => (Array.isArray(v) ? v[0] : v);
        const hiOf = (v) => (Array.isArray(v) ? v[1] : v);
        const [lx, ly, lz] = quatRotateVec(q, [loOf(ax), loOf(ay), loOf(az)]);
        const [hx, hy, hz] = quatRotateVec(q, [hiOf(ax), hiOf(ay), hiOf(az)]);
        const packAxis = (a, b) => {
          const ra = Number(a.toFixed(4));
          const rb = Number(b.toFixed(4));
          return Math.abs(ra - rb) > 1e-4 ? [Math.min(ra, rb), Math.max(ra, rb)] : ra;
        };
        return [packAxis(lx, hx), packAxis(ly, hy), packAxis(lz, hz)];
      };
      let vx = rx.val;
      let vy = ry.val;
      let vzRaw = rz.val;
      if (!isWorldVel) {
        vx = scaleRangeBy(vx, partScaleVec[0]);
        vy = scaleRangeBy(vy, partScaleVec[1]);
        vzRaw = scaleRangeBy(vzRaw, partScaleVec[2]);
        [vx, vy, vzRaw] = rotateRangeVecByQuat(alignRot, vx, vy, vzRaw);
      }
      const vz = negateValueOrRange(vzRaw);
      const readOrbAxis = (axisName) => {
        const blk = extractSubBlock(velMod, axisName);
        const st = Number((blk.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
        if (st === 1) {
          const ck = parseCurveKeys(blk, true);
          if (ck && ck.length > 0 && Math.abs(ck[ck.length - 1][1]) < 0.02 && ck[ck.length - 1][0] < 0.7) {
            return 0;
          }
        }
        return mulV(readMinMaxScalar(velMod, axisName, 0));
      };
      let orbX = readOrbAxis('orbitalX');
      let orbY = readOrbAxis('orbitalY');
      let orbZ = readOrbAxis('orbitalZ');
      if (!isWorldVel) {
        [orbX, orbY, orbZ] = rotateRangeVecByQuat(alignRot, orbX, orbY, orbZ);
      }
      let oox = readMinMaxScalar(velMod, 'orbitalOffsetX', 0);
      let ooy = readMinMaxScalar(velMod, 'orbitalOffsetY', 0);
      let oozRaw = readMinMaxScalar(velMod, 'orbitalOffsetZ', 0);
      if (!isWorldVel) {
        oox = scaleRangeBy(oox, partScaleVec[0]);
        ooy = scaleRangeBy(ooy, partScaleVec[1]);
        oozRaw = scaleRangeBy(oozRaw, partScaleVec[2]);
        [oox, ooy, oozRaw] = rotateRangeVecByQuat(alignRot, oox, ooy, oozRaw);
      }
      const ooz = negateValueOrRange(oozRaw);
      const radV = rRad.val;
      const isNonZero = (v) => Array.isArray(v) ? (v[0] !== 0 || v[1] !== 0) : v !== 0;
      const velObj = {};
      if (isNonZero(vx) || isNonZero(vy) || isNonZero(vz)) {
        velObj.linear = [vx, vy, vz];
      }
      if (isNonZero(orbX)) velObj.orbitalX = orbX;
      if (isNonZero(orbY)) velObj.orbitalY = orbY;
      if (isNonZero(orbZ)) velObj.orbitalZ = orbZ;
      if (isNonZero(oox) || isNonZero(ooy) || isNonZero(ooz)) {
        velObj.orbitalOffset = [oox, ooy, ooz];
      }
      if (isNonZero(radV)) {
        velObj.radial = radV;
        if (isSubChild && !hasEnabledShape && !isWorldVel) {
          velObj.radialSpace = 'root';
          if (subTr && (Math.abs(subTr.pos[0]) > 1e-4 || Math.abs(subTr.pos[1]) > 1e-4 || Math.abs(subTr.pos[2]) > 1e-4)) {
            velObj.radialOffset = subTr.pos;
          }
        }
      }
      if (Object.keys(velObj).length > 0) layer.velocity = velObj;
      const velCurveAxes = [];
      if (rx.curve) velCurveAxes.push('x');
      if (ry.curve) velCurveAxes.push('y');
      if (rz.curve) velCurveAxes.push('z');
      if (rRad.curve) velCurveAxes.push('radial');
      if (spdModCurve) velCurveAxes.push('speedModifier');
      const velCurveSource = rx.curve
        ? 'x'
        : ry.curve
          ? 'y'
          : rz.curve
            ? 'z'
            : rRad.curve
              ? 'radial'
              : spdModCurve
                ? 'speedModifier'
                : null;
      const chosenVelCurve = rx.curve || ry.curve || rz.curve || rRad.curve || spdModCurve;
      if (chosenVelCurve) {
        const maxAbsOf = (v) => {
          if (typeof v === 'number') return Math.abs(v);
          if (Array.isArray(v)) return Math.max(Math.abs(Number(v[0]) || 0), Math.abs(Number(v[1]) || 0));
          if (v && typeof v === 'object') {
            return Math.max(Math.abs(Number(v.scalar) || 0), Math.abs(Number(v.minScalar) || 0));
          }
          return 0;
        };
        const baseSpeedMax = maxAbsOf(layer.speed);
        const isAxisOrRadialSource = velCurveSource === 'x' || velCurveSource === 'y' || velCurveSource === 'z' || velCurveSource === 'radial';
        const isCartesianAxisSource = velCurveSource === 'x' || velCurveSource === 'y' || velCurveSource === 'z';
        const moduleMag = maxAbsOf(vx) + maxAbsOf(vy) + maxAbsOf(vz) + maxAbsOf(radV);
        if (isAxisOrRadialSource && !spdModCurve && baseSpeedMax > 0.01 && moduleMag < baseSpeedMax) {
          layer.velCurveDropped = 'baseSpeedDominant';
        } else if (
          isCartesianAxisSource
          && !spdModCurve
          && baseSpeedMax > 0.01
          && baseSpeedMax >= moduleMag * 0.5
          && Math.abs(chosenVelCurve[0]?.[1] ?? 1) < 0.1
        ) {
          layer.velCurveDropped = 'singleAxisStartZero';
        } else {
          layer.velCurve = chosenVelCurve;
        }
        layer.velCurveSource = velCurveSource;
        layer.velCurveAxes = velCurveAxes;
      }
    }

    const rotMod = extractSection(ps, 'RotationModule');
    if (/enabled:\s*1/.test(rotMod)) {
      const av = readMinMaxScalar(rotMod, 'curve', 0);
      const sepRot = /separateAxes:\s*1\b/.test(rotMod);
      const zCurveDataRaw = parseMinMaxCurveData((sepRot ? extractModSubBlock(rotMod, 'z') : '') || extractModSubBlock(rotMod, 'curve'), true);
      const xCurveDataRaw = sepRot ? parseMinMaxCurveData(extractModSubBlock(rotMod, 'x'), true) : null;
      const yCurveDataRaw = sepRot ? parseMinMaxCurveData(extractModSubBlock(rotMod, 'y'), true) : null;
      const isRotCurveObj = (d) => Boolean(d && typeof d === 'object' && !Array.isArray(d));
      const negateRotCurveData = (d) => {
        if (d === null || d === undefined) return d;
        if (typeof d === 'number' || Array.isArray(d)) return negateValueOrRange(d);
        if (typeof d === 'object') {
          return {
            ...d,
            scalar: -(d.scalar ?? 0),
            ...(d.minScalar !== undefined ? { minScalar: -d.minScalar } : {}),
          };
        }
        return d;
      };
      const xCurveData = renderMode === 'mesh' ? negateRotCurveData(xCurveDataRaw) : xCurveDataRaw;
      const yCurveData = renderMode === 'mesh' ? negateRotCurveData(yCurveDataRaw) : yCurveDataRaw;
      const zCurveData = isWorldOrLocalBillboard ? negateRotCurveData(zCurveDataRaw) : zCurveDataRaw;
      const hasXCurve = isRotCurveObj(xCurveData);
      const hasYCurve = isRotCurveObj(yCurveData);
      const hasZCurve = isRotCurveObj(zCurveData);
      if (sepRot) {
        const rx = readMinMaxScalar(rotMod, 'x', 0);
        const ry = readMinMaxScalar(rotMod, 'y', 0);
        if (renderMode === 'mesh') {
          const sx = hasXCurve ? 0 : negateValueOrRange(rx);
          const sy = hasYCurve ? 0 : negateValueOrRange(ry);
          const sz = hasZCurve ? 0 : av;
          if (sx !== 0 || sy !== 0 || sz !== 0) layer.spin = [sx, sy, sz];
        } else {
          layer.spin = isWorldOrLocalBillboard ? [rx, ry, negateValueOrRange(av)] : [rx, ry, av];
        }
      } else if (av !== 0 && !(renderMode === 'mesh' && hasZCurve)) {
        layer.angularVel = isWorldOrLocalBillboard ? negateValueOrRange(av) : av;
      }
      if (hasZCurve || hasXCurve || hasYCurve) {
        layer.rotationOverLifetime = {
          ...(hasXCurve ? { x: xCurveData } : {}),
          ...(hasYCurve ? { y: yCurveData } : {}),
          ...(hasZCurve ? { z: zCurveData } : {}),
        };
      }
    }

    const noiseMod = extractSection(ps, 'NoiseModule');
    if (/enabled:\s*1/.test(noiseMod)) {
      const maxAbs = (v) => Array.isArray(v) ? Math.max(Math.abs(v[0]), Math.abs(v[1])) : Math.abs(v);
      const str = readMinMaxScalar(noiseMod, 'strength', 0.5);
      const freq = Number((noiseMod.match(/\bfrequency:\s*([-\d.eE+]+)/) || [])[1] ?? 0.5);
      const scrollSpd = readMinMaxScalar(noiseMod, 'scrollSpeed', 0);
      const scrollVal = Array.isArray(scrollSpd) ? (scrollSpd[0] + scrollSpd[1]) * 0.5 : scrollSpd;
      const damping = /damping:\s*1\b/.test(noiseMod);
      const noiseObj = { strength: Number(maxAbs(str).toFixed(3)), frequency: freq };
      if (/separateAxes:\s*1\b/.test(noiseMod)) {
        const strY = readMinMaxScalar(noiseMod, 'strengthY', 0);
        noiseObj.strengthY = Number(maxAbs(strY).toFixed(3));
      }
      if (Math.abs(scrollVal) > 0.001) noiseObj.scrollSpeed = Number(Math.abs(scrollVal).toFixed(3));
      if (damping) noiseObj.damping = true;
      layer.noise = noiseObj;
    }

    const uvMod = extractSection(ps, 'UVModule');
    const sheetMode = Number(uvMod.match(/\n {4}mode:\s*(\d+)/)?.[1] ?? 0);
    let uvFlipU = 0;
    let uvFlipV = 0;
    if (/enabled:\s*1/.test(uvMod)) {
      uvFlipU = Number((uvMod.match(/\bflipU:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
      uvFlipV = Number((uvMod.match(/\bflipV:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
    }
    const combFlipX = psrFlip[0] + uvFlipU - 2 * psrFlip[0] * uvFlipU;
    const combFlipY = psrFlip[1] + uvFlipV - 2 * psrFlip[1] * uvFlipV;
    const combFlipZ = psrFlip[2];
    if (combFlipX > 0.001 || combFlipY > 0.001 || combFlipZ > 0.001) {
      layer.flip = [
        Number(Math.min(1, Math.max(0, combFlipX)).toFixed(3)),
        Number(Math.min(1, Math.max(0, combFlipY)).toFixed(3)),
        Number(Math.min(1, Math.max(0, combFlipZ)).toFixed(3)),
      ];
    }
    if (sheetMode === 0 && /enabled:\s*1/.test(uvMod)) {
      const cols = Number((uvMod.match(/tilesX:\s*(\d+)/) || [])[1] ?? 1);
      const rows = Number((uvMod.match(/tilesY:\s*(\d+)/) || [])[1] ?? 1);
      const rawCycles = Number((uvMod.match(/cycles:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
      const timeMode = Number((uvMod.match(/\btimeMode:\s*(\d+)/) || [])[1] ?? 0);
      const fpsVal = Number((uvMod.match(/\bfps:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
      const fotBlock = extractModSubBlock(uvMod, 'frameOverTime');
      const fotState = Number((fotBlock.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 1);
      const fotScalar = readMinMaxScalar(uvMod, 'frameOverTime', 1);
      const fotKeys = (fotState === 1 || fotState === 2) ? parseCurveKeys(fotBlock) : null;
      const isConstantFot = timeMode !== 2 && fotState === 0 && typeof fotScalar === 'number';
      const isFlatZeroFot = (fotState === 0 || fotState === 3) && (Array.isArray(fotScalar) ? Math.abs(fotScalar[1]) < 1e-4 : Math.abs(fotScalar) < 1e-4)
        || (fotKeys && Math.max(...fotKeys.map((k) => k[1])) < 1e-4);
      const isStaticFrame = isConstantFot || (timeMode !== 2 && isFlatZeroFot);
      const cycles = isStaticFrame ? 0 : rawCycles;
      const rawStartFrame = readMinMaxScalar(uvMod, 'startFrame', 0);
      const startFrame = isConstantFot && Math.abs(fotScalar) > 1e-4
        ? (Array.isArray(rawStartFrame)
          ? [Number((rawStartFrame[0] + fotScalar).toFixed(4)), Number((rawStartFrame[1] + fotScalar).toFixed(4))]
          : Number((rawStartFrame + fotScalar).toFixed(4)))
        : rawStartFrame;
      const hasStartFrame = Array.isArray(startFrame) ? (Math.abs(startFrame[0]) > 1e-4 || Math.abs(startFrame[1]) > 1e-4) : Math.abs(startFrame) > 1e-4;
      const legacyRandomRow = /\brandomRow:\s*1\b/.test(uvMod);
      const rowModeNum = Number(uvMod.match(/\browMode:\s*(\d+)/)?.[1] ?? Number(legacyRandomRow));
      const rowIndexNum = Number((uvMod.match(/rowIndex:\s*(\d+)/) || [])[1] ?? 0);
      const animationType = Number(uvMod.match(/\banimationType:\s*(\d+)/)?.[1] ?? (rowModeNum ? 1 : 0));
      const row = animationType === 1
        ? (rowModeNum === 1
            ? { rowMode: 'random' }
            : { rowMode: rowModeNum === 2 ? 'mesh' : 'custom', rowIndex: rowModeNum === 2 ? 0 : rowIndexNum })
        : {};
      if (cols > 1 || rows > 1) {
        layer.flipbook = {
          region: mainMat?.spriteKey || 'flipbook',
          cols,
          rows,
          cycles,
          ...(timeMode === 2 && !isStaticFrame && fpsVal > 0 ? { fps: Number(fpsVal.toFixed(2)) } : {}),
          ...(hasStartFrame ? { startFrame } : {}),
          blend: mainMat?.flipbookBlend ?? true,
          ...row,
        };
        delete layer.sprite;
      }
    }

    const clampVelMod = extractSection(ps, 'ClampVelocityModule');
    if (/^\s*enabled:\s*1\b/m.test(clampVelMod)) {
      const sepAx = /separateAxis:\s*1\b/.test(clampVelMod);
      const dampenVal = Number((clampVelMod.match(/\bdampen:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
      const dragData = parseMinMaxCurveData(extractModSubBlock(clampVelMod, 'drag'), false);
      if (sepAx) {
        const xData = parseMinMaxCurveData(extractModSubBlock(clampVelMod, 'x'), false) ?? 1000;
        const yData = parseMinMaxCurveData(extractModSubBlock(clampVelMod, 'y'), false) ?? 1000;
        const zData = parseMinMaxCurveData(extractModSubBlock(clampVelMod, 'z'), false) ?? 1000;
        const mx = (v) => typeof v === 'number' ? Math.abs(v) : Array.isArray(v) ? Math.max(Math.abs(v[0]), Math.abs(v[1])) : Math.abs(v?.scalar ?? 1000);
        const limitVal = Math.hypot(mx(xData), mx(yData), mx(zData));
        layer.clampVelocity = {
          separateAxis: true,
          limit: Number(limitVal.toFixed(4)),
          x: xData,
          y: yData,
          z: zData,
          ...(dragData ? { drag: dragData } : {}),
          dampen: Number(Math.max(0, Math.min(1, dampenVal)).toFixed(4)),
        };
      } else {
        const magData = parseMinMaxCurveData(extractModSubBlock(clampVelMod, 'magnitude'), false) ?? 1;
        const limitVal = typeof magData === 'number' ? magData : Array.isArray(magData) ? magData[1] : (magData?.scalar ?? 1);
        if (limitVal > 0.0001 || (dragData && dragData !== 0)) {
          layer.clampVelocity = {
            separateAxis: false,
            limit: Number(limitVal.toFixed(4)),
            magnitude: magData,
            ...(dragData ? { drag: dragData } : {}),
            dampen: Number(Math.max(0, Math.min(1, dampenVal)).toFixed(4)),
          };
        }
      }
    }

    const rotBySpdMod = extractSection(ps, 'RotationBySpeedModule');
    if (/^\s*enabled:\s*1\b/m.test(rotBySpdMod)) {
      const rngM = rotBySpdMod.match(/\brange:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+)/);
      const minSpeed = rngM ? Number(rngM[1]) : 0;
      const maxSpeed = rngM ? Number(rngM[2]) : 1;
      const sepRotSpd = /separateAxes:\s*1\b/.test(rotBySpdMod);
      const cBlk = extractSubBlock(rotBySpdMod, 'curve');
      const zCurveData = parseMinMaxCurveData(cBlk, true);
      const xCurveData = sepRotSpd ? parseMinMaxCurveData(extractSubBlock(rotBySpdMod, 'x'), true) : null;
      const yCurveData = sepRotSpd ? parseMinMaxCurveData(extractSubBlock(rotBySpdMod, 'y'), true) : null;
      const st = Number((cBlk.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
      const sc = Number((cBlk.match(/\bscalar:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
      let minAngularVel = sc;
      let maxAngularVel = sc;
      if (st === 1 || st === 2) {
        const ck = parseCurveKeys(cBlk, true);
        if (ck && ck.length > 0) {
          minAngularVel = ck[0][1] * sc;
          maxAngularVel = ck[ck.length - 1][1] * sc;
        }
      }
      layer.rotationBySpeed = {
        enabled: true,
        separateAxes: sepRotSpd,
        range: [Number(minSpeed.toFixed(4)), Number(maxSpeed.toFixed(4))],
        minSpeed: Number(minSpeed.toFixed(4)),
        maxSpeed: Number(maxSpeed.toFixed(4)),
        minAngularVel: Number(minAngularVel.toFixed(4)),
        maxAngularVel: Number(maxAngularVel.toFixed(4)),
        curve: zCurveData ?? 0,
        ...(xCurveData !== null ? { x: xCurveData } : {}),
        ...(yCurveData !== null ? { y: yCurveData } : {}),
        z: zCurveData ?? 0,
      };
    }

    const inhVelMod = extractSection(ps, 'InheritVelocityModule');
    if (/^\s*enabled:\s*1\b/m.test(inhVelMod)) {
      const ivModeNum = Number((inhVelMod.match(/\bm_Mode:\s*(\d+)/) || [])[1] ?? 0);
      const ivCurve = parseMinMaxCurveData(extractModSubBlock(inhVelMod, 'm_Curve'), true);
      const iv = readMinMaxScalar(inhVelMod, 'm_Curve', 0);
      const ivVal = Array.isArray(iv) ? iv[1] : iv;
      if (Math.abs(ivVal) > 0.001 || (ivCurve && typeof ivCurve === 'object')) {
        layer.inheritVelocity = {
          mode: ivModeNum === 1 ? 'current' : 'initial',
          multiplier: ivCurve ?? Number(ivVal.toFixed(4)),
        };
      }
    }

    const customMod = extractSection(ps, 'CustomDataModule');
    if (/^\s*enabled:\s*1\b/m.test(customMod)) {
      const parseVecComp = (fieldName) => {
        const blk = extractSubBlock(customMod, fieldName);
        if (!blk) return 0;
        const parsed = parseMinMaxCurveData(blk, true);
        return parsed !== null ? parsed : 0;
      };
      const mode0 = Number((customMod.match(/^\s*mode0:\s*(\d+)/m) || [])[1] ?? 0);
      const mode1 = Number((customMod.match(/^\s*mode1:\s*(\d+)/m) || [])[1] ?? 0);
      const customData = {};
      if (mode0 === 1) {
        customData.custom1 = {
          mode: 'vector',
          x: parseVecComp('vector0_0'),
          y: parseVecComp('vector0_1'),
          z: parseVecComp('vector0_2'),
          w: parseVecComp('vector0_3'),
        };
      } else if (mode0 === 2) {
        const cBlk = extractSubBlock(customMod, 'color0');
        const cStops = cBlk ? parseGradientStops(cBlk) : null;
        customData.custom1 = { mode: 'color', color: cStops || [1, 1, 1, 1] };
      }
      if (mode1 === 1) {
        customData.custom2 = {
          mode: 'vector',
          x: parseVecComp('vector1_0'),
          y: parseVecComp('vector1_1'),
          z: parseVecComp('vector1_2'),
          w: parseVecComp('vector1_3'),
        };
      } else if (mode1 === 2) {
        const cBlk = extractSubBlock(customMod, 'color1');
        const cStops = cBlk ? parseGradientStops(cBlk) : null;
        customData.custom2 = { mode: 'color', color: cStops || [1, 1, 1, 1] };
      }
      if (customData.custom1 || customData.custom2) {
        layer.customData = customData;
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
      let lifeColorCurve;
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
          if (clStops.length >= 2) {
            lifeColorCurve = clStops;
          } else {
            const avgA = clStops.reduce((s, k) => s + k[1][3], 0) / clStops.length;
            trailAlpha = Number(avgA.toFixed(3));
          }
        }
      }
      const wBlock = trailMod.match(/widthOverTrail:[\s\S]*?(?=colorOverTrail:|$)/)?.[0] || '';
      const wCurve = parseCurveKeys(wBlock);
      const endWidthScale = wCurve ? Number(wCurve[wCurve.length - 1][1].toFixed(3)) : 0;

      const cotBlock = trailMod.match(/colorOverTrail:[\s\S]*$/)?.[0] || '';
      const cotMode = Number((cotBlock.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 1);
      let startRgb = maxCol;
      let endRgb = maxCol;
      let trailColorCurve;
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
        const cotStops = parseGradientStops(cotBlock);
        if (cotStops && cotStops.length >= 2) {
          trailColorCurve = cotStops;
        }
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
      const texScaleM = trailMod.match(/textureScale:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+)\}/);
      const texScaleX = texScaleM ? Number(texScaleM[1]) : 1;
      const texScaleY = texScaleM ? Number(texScaleM[2]) : 1;
      const hasTexScale = Math.abs(texScaleX - 1) > 1e-4 || Math.abs(texScaleY - 1) > 1e-4;
      layer.trail = {
        mode: trailMode === 1 ? 'ribbon' : 'particles',
        lifetime: tLife,
        lifetimeMode: trailMode === 1 ? 'seconds' : 'fraction',
        blend: trailMat?.blend || 'alpha',
        ...(trailMat?.spriteKey ? { sprite: trailMat.spriteKey } : {}),
        ...(trailMat?.uberMat ? { uberMat: trailMat.uberMat } : {}),
        ...(hasTexScale ? { textureScale: [Number(texScaleX.toFixed(4)), Number(texScaleY.toFixed(4))] } : {}),
        ...(function () {
          const trailWorldSpace = /worldSpace:\s*1\b/.test(trailMod);
          const trailWScale = (!trailWorldSpace && psScalingMode !== 2 && !sizeAffW && Math.abs(trScaleScalar - 1) > 0.005)
            ? trScaleScalar
            : 1;
          return {
            width: Number(((sizeAffW ? baseSizeMax : 1) * wMax * trailWScale).toFixed(3)),
            widthOverTrail: scaleRangeBy(wScalar, trailWScale),
          };
        })(),
        sizeAffectsWidth: sizeAffW,
        endWidth: 0,
        endWidthScale,
        ...(wCurve && wCurve.length >= 2 ? { widthCurve: wCurve } : {}),
        ...(trailColorCurve ? { colorCurve: trailColorCurve } : {}),
        ...(lifeColorCurve ? { lifeColorCurve } : {}),
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
      const colType = Number((colMod.match(/\btype:\s*(\d+)/) || [])[1] ?? 0);
      const planesBlock = colMod.match(/m_Planes:[\s\S]*?(?=\n\s*m_[A-Z]|$)/)?.[0] || '';
      const hasValidPlane = [...planesBlock.matchAll(/fileID:\s*(-?\d+)/g)].some((m) => m[1] !== '0');
      if (colType !== 0 || hasValidPlane) {
        const bounce = readMinMaxScalar(colMod, 'm_Bounce', 0.5);
        const dampen = readMinMaxScalar(colMod, 'm_Dampen', 0.2);
        const lifeLoss = readMinMaxScalar(colMod, 'm_EnergyLossOnCollision', 0);
        const lifeLossVal = Array.isArray(lifeLoss) ? lifeLoss[1] : lifeLoss;
        layer.collision = {
          groundY: 0,
          bounce: typeof bounce === 'number' ? bounce : bounce[1],
          dampen: typeof dampen === 'number' ? dampen : dampen[1],
          maxBounces: 3,
          ...(lifeLossVal > 0.001 ? { lifetimeLoss: Number(lifeLossVal.toFixed(3)) } : {}),
        };
      }
    }

    const lightMod = extractSection(ps, 'LightsModule');
    if (/^\s*enabled:\s*1\b/m.test(lightMod)) {
      const lFid = (lightMod.match(/light:\s*\{fileID:\s*(\d+)\}/) || [])[1];
      const lDoc = lFid && lFid !== '0' ? lightById.get(lFid) : null;
      if (lDoc) {
        const lcM = lDoc.match(/m_Color:\s*\{([^}]+)\}/);
        const lCol = lcM ? parseColorObject(lcM[1], false) : [1, 1, 1, 1];
        const lInt = Number((lDoc.match(/^\s*m_Intensity:\s*([-\d.eE+]+)/m) || [])[1] ?? 2);
        const lRange = Number((lDoc.match(/^\s*m_Range:\s*([-\d.eE+]+)/m) || [])[1] ?? 8);
        const intMul = readMinMaxScalar(lightMod, 'intensity', 1);
        const rngMul = readMinMaxScalar(lightMod, 'range', 1);
        const lRatio = Number((lightMod.match(/\bratio:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
        const maxLights = Number((lightMod.match(/\bmaximumLights:\s*(\d+)/) || [])[1] ?? 6);
        const usePCol = !/useParticleColor:\s*0\b/.test(lightMod);
        const intVal = Array.isArray(intMul) ? intMul[1] : intMul;
        const rngVal = Array.isArray(rngMul) ? rngMul[1] : rngMul;
        const lHex = '#' + [lCol[0], lCol[1], lCol[2]].map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
        layer.particleLight = {
          color: lHex,
          intensity: Number((lInt * intVal).toFixed(3)),
          range: Number((lRange * rngVal).toFixed(3)),
          ratio: Number(lRatio.toFixed(3)),
          maxLights: Math.max(1, maxLights),
          useParticleColor: usePCol,
        };
      }
    }

    const subMod = extractSection(ps, 'SubModule');
    if (/^\s*enabled:\s*1\b/m.test(subMod) && subDepth < 2) {
      const subList = [];
      const subMatches = [...subMod.matchAll(/emitter:\s*\{fileID:\s*(\d+)\}[\s\S]*?\n\s*type:\s*(\d+)[\s\S]*?\n\s*properties:\s*(\d+)[\s\S]*?\n\s*emitProbability:\s*([-\d.eE+]+)/g)];
      const fallbackMatches = subMatches.length > 0
        ? subMatches
        : [...subMod.matchAll(/emitter:\s*\{fileID:\s*(\d+)\}[\s\S]*?\n\s*type:\s*(\d+)[\s\S]*?\n\s*emitProbability:\s*([-\d.eE+]+)/g)];
      for (const sm of fallbackMatches) {
        const hasProps = subMatches.length > 0;
        const targetPsId = sm[1];
        if (targetPsId === '0' || !psById.has(targetPsId)) continue;
        const targetPs = psById.get(targetPsId);
        const tGo = goNames.get(targetPs.goId) || { active: true };
        if (!tGo.active) continue;
        const targetLayer = convertParticleLayer(targetPs.goId, trByGo.get(targetPs.goId), true, subDepth + 1);
        if (!targetLayer) continue;
        const tType = Number(sm[2]);
        const propMask = hasProps ? Number(sm[3] ?? 0) : 0;
        const prob = Number((hasProps ? sm[4] : sm[3]) ?? 1);
        const trigger = tType === 0 ? 'birth' : (tType === 1 ? 'collision' : 'death');
        // Unity SubEmitters fire via Emit()/Bursts on collision/death; birth sub-emitters attached to moving particles also drive rateOverDistance/rate.
        if ((!Array.isArray(targetLayer.bursts) || targetLayer.bursts.length === 0)
          && (!Array.isArray(targetLayer.subEmitters) || targetLayer.subEmitters.length === 0)
          && !(trigger === 'birth' && ((targetLayer.rateOverDistance ?? 0) > 0 || (targetLayer.rate ?? 0) > 0))) {
          continue;
        }
        const subSimSpd = Math.max(0.05, Number(targetLayer.simulationSpeed ?? 1));
        const subDelay = Number(targetLayer.delay ?? 0);
        const subLayerDur = Number(targetLayer.duration ?? 0);
        const subLife = Array.isArray(targetLayer.life) ? targetLayer.life[1] : (Number(targetLayer.life) || 1);
        const maxBurstT = Array.isArray(targetLayer.bursts) && targetLayer.bursts.length > 0
          ? Math.max(...targetLayer.bursts.map((b) => Number(b.time ?? 0) + (b.cycles > 1 ? (b.cycles - 1) * (b.interval ?? 0.01) : 0)))
          : 0;
        const emitSpan = (targetLayer.rate || targetLayer.rateOverDistance) ? Math.max(subLayerDur, maxBurstT) : maxBurstT;
        const subDur = (subDelay + emitSpan + subLife) / subSimSpd;
        const childMax = Array.isArray(targetLayer.subEmitters) && targetLayer.subEmitters.length > 0
          ? Math.max(...targetLayer.subEmitters.map((se) => Number(se.effect?.duration ?? 0)))
          : 0;
        const totalSubDur = Math.max(subDur, (subDelay + emitSpan) / subSimSpd + childMax);
        maxDuration = Math.max(maxDuration, maxDelay / Math.max(0.05, simSpeed) + totalSubDur);
        const subId = `${recipeId}__sub_${++subCounter}`;
        subList.push({
          trigger,
          ...(prob < 0.999 ? { probability: Number(prob.toFixed(3)) } : {}),
          ...((propMask & 1) !== 0 ? { inheritColor: true } : {}),
          ...((propMask & 16) !== 0 ? { inheritVelocity: 0.5 } : {}),
          effect: {
            schemaVersion: 1,
            id: subId,
            loop: false,
            duration: Number(Math.max(0.2, totalSubDur).toFixed(2)),
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
    const offset = (fatherId !== '0' && posM) ? [Number(posM[1]), Number(posM[2]), toRhsZ(Number(posM[3]))] : [0, 0, 0];

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
    loop: layers.some((l) => Boolean(l.loop)),
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

if (process.argv[1] && (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('import-unity-vfx.mjs'))) {
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
