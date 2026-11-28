#!/usr/bin/env node
/**
 * Gate B: Automated mid-playback pixel-level visual parity comparator between
 * Unity 6000.6.9f1 URP BatchMode renders and live WebAsset (`#vfx`) renders.
 *
 * Default target: Epic Toon FX -> 爆炸与爆裂 (all 101 base cards in WebAsset).
 * Stages an isolated Unity URP temp project (safe while AssetTest Editor is open).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DEFAULT_OUT_DIR = path.join(os.tmpdir(), 'hgame-vfx-parity-explosions');
const DEFAULT_UNITY_PROJECT = process.env.HGAME_UNITY_PROJECT || path.join(os.tmpdir(), 'hgame-unity-urp-capture');
const DEFAULT_UNITY_EXE = 'D:/Apps/UnityEditor/6000.6.9f1/Editor/Unity.exe';
const DEFAULT_PYTHON = 'D:/Tools/VoxCPM2/PortablePython/python.exe';

function resolveLocalUnityExe() {
  const localCfg = path.join(REPO_ROOT, '.hgame.local.json');
  if (fs.existsSync(localCfg)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(localCfg, 'utf8'));
      if (parsed?.unityVfx?.unityExe) return parsed.unityVfx.unityExe;
    } catch { /* ignore */ }
  }
  return process.env.HGAME_UNITY_EXE || DEFAULT_UNITY_EXE;
}

const SKIP_DIRS = new Set(['demo', 'demos', 'scripts', 'audio', 'sfx', 'sounds', 'documentation', 'docs']);
const SKIP_EXTS = new Set(['.cs', '.asmdef', '.asmref', '.dll', '.mp3', '.wav', '.ogg', '.txt', '.pdf', '.md']);

function copyDirRecursive(srcDir, dstDir, { filterAssets = false } = {}) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const sp = path.join(srcDir, ent.name);
    const dp = path.join(dstDir, ent.name);
    if (ent.isDirectory()) {
      if (filterAssets && SKIP_DIRS.has(ent.name.toLowerCase())) continue;
      copyDirRecursive(sp, dp, { filterAssets });
    } else {
      if (filterAssets) {
        const ext = path.extname(ent.name).toLowerCase();
        if (SKIP_EXTS.has(ext)) continue;
        if (ext === '.meta') {
          const baseExt = path.extname(ent.name.slice(0, -5)).toLowerCase();
          if (SKIP_EXTS.has(baseExt)) continue;
        }
      }
      const needCopy = !fs.existsSync(dp)
        || fs.statSync(sp).size !== fs.statSync(dp).size
        || fs.statSync(sp).mtimeMs > fs.statSync(dp).mtimeMs + 1000;
      if (needCopy) fs.copyFileSync(sp, dp);
    }
  }
}

function buildUnityCaptureCSharp() {
  return `using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

public static class HGameVfxVisualCapture
{
    [Serializable]
    private class JobItem
    {
        public string id;
        public string name;
        public string prefabPath;
        public float playY = 1.15f;
    }

    [Serializable]
    private class JobConfig
    {
        public string outPngDir;
        public string manifestOutPath;
        public int width = 320;
        public int height = 320;
        public float defaultT = 0.25f;
        public float fallbackT1 = 0.12f;
        public float fallbackT2 = 0.06f;
        public JobItem[] jobs;
    }

    private static string JsonStr(string s)
    {
        if (s == null) return "null";
        var sb = new StringBuilder(s.Length + 4);
        sb.Append('"');
        foreach (char c in s)
        {
            if (c == '\\\\') sb.Append("\\\\\\\\");
            else if (c == '"') sb.Append("\\\\\\"");
            else if (c == '\\n') sb.Append("\\\\n");
            else if (c == '\\r') sb.Append("\\\\r");
            else sb.Append(c);
        }
        sb.Append('"');
        return sb.ToString();
    }

    private static void SimulateAllRoots(List<ParticleSystem> roots, float targetT)
    {
        float dt = 1f / 60f;
        int steps = Mathf.Max(1, Mathf.RoundToInt(targetT / dt));
        foreach (var ps in roots)
        {
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            ps.useAutoRandomSeed = false;
            ps.randomSeed = 1337;
        }
        for (int s = 0; s < steps; s++)
        {
            bool restart = (s == 0);
            foreach (var ps in roots)
            {
                ps.Simulate(dt, true, restart, false);
            }
        }
    }

    private static float MeasureForegroundFrac(Color32[] pixels, Color32 bg, int threshold)
    {
        if (pixels == null || pixels.Length == 0) return 0f;
        int fg = 0;
        for (int i = 0; i < pixels.Length; i++)
        {
            var p = pixels[i];
            int dr = Math.Abs((int)p.r - (int)bg.r);
            int dg = Math.Abs((int)p.g - (int)bg.g);
            int db = Math.Abs((int)p.b - (int)bg.b);
            if (Math.Max(dr, Math.Max(dg, db)) > threshold) fg++;
        }
        return (float)fg / (float)pixels.Length;
    }

    public static void RunBatchCapture()
    {
        string cfgPath = Environment.GetEnvironmentVariable("HGAME_UNITY_CAPTURE_CFG");
        if (string.IsNullOrEmpty(cfgPath) || !File.Exists(cfgPath))
        {
            Debug.LogError("HGAME_UNITY_CAPTURE_CFG missing or not found: " + cfgPath);
            EditorApplication.Exit(2);
            return;
        }
        var cfg = JsonUtility.FromJson<JobConfig>(File.ReadAllText(cfgPath, Encoding.UTF8));
        Directory.CreateDirectory(cfg.outPngDir);
        Directory.CreateDirectory(Path.GetDirectoryName(cfg.manifestOutPath));

        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        // Configure studio lighting & ambient to match WebAsset bench stage
        RenderSettings.ambientMode = AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.55f, 0.55f, 0.55f, 1f);
        var dirGo = new GameObject("CaptureDirLight");
        var dirLight = dirGo.AddComponent<Light>();
        dirLight.type = LightType.Directional;
        dirLight.color = Color.white;
        dirLight.intensity = 0.75f;
        dirLight.transform.position = new Vector3(8f, 16f, -10f);
        dirLight.transform.LookAt(Vector3.zero);

        // Global URP Post-Processing Volume matching SampleSceneProfile
        var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>("Assets/Settings/SampleSceneProfile.asset");
        if (profile != null)
        {
            var volGo = new GameObject("CaptureVolume");
            var vol = volGo.AddComponent<Volume>();
            vol.isGlobal = true;
            vol.sharedProfile = profile;
        }

        // Camera matching WebAsset RHS (0, 2.2, 6.0) -> Unity LHS (0, 2.2, -6.0)
        var camGo = new GameObject("CaptureCam");
        var cam = camGo.AddComponent<Camera>();
        cam.transform.position = new Vector3(0f, 2.2f, -6.0f);
        cam.transform.LookAt(new Vector3(0f, 1.15f, 0f));
        cam.fieldOfView = 42f;
        cam.nearClipPlane = 0.1f;
        cam.farClipPlane = 200f;
        cam.clearFlags = CameraClearFlags.SolidColor;
        // Neutral charcoal studio background so both additive glows and black smoke register cleanly
        cam.backgroundColor = new Color(40f / 255f, 44f / 255f, 52f / 255f, 1f);
        cam.allowHDR = true;

        var camData = camGo.AddComponent<UniversalAdditionalCameraData>();
        camData.renderPostProcessing = true;
        camData.antialiasing = AntialiasingMode.FastApproximateAntialiasing;

        var rt = new RenderTexture(cfg.width, cfg.height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
        rt.Create();
        cam.targetTexture = rt;

        var tex = new Texture2D(cfg.width, cfg.height, TextureFormat.RGBA32, false, false);
        var entries = new List<string>();
        var subSet = new HashSet<ParticleSystem>();
        var roots = new List<ParticleSystem>();
        var candTimes = new float[] { cfg.defaultT, cfg.fallbackT1, cfg.fallbackT2 };

        foreach (var job in cfg.jobs)
        {
            var asset = AssetDatabase.LoadAssetAtPath<GameObject>(job.prefabPath);
            if (asset == null)
            {
                Debug.LogWarning("Missing prefab: " + job.prefabPath);
                continue;
            }
            var inst = UnityEngine.Object.Instantiate(asset, new Vector3(0f, job.playY, 0f), asset.transform.rotation);
            float chosenT = cfg.defaultT;
            float chosenFg = 0f;
            try
            {
                var allPs = inst.GetComponentsInChildren<ParticleSystem>(false);
                subSet.Clear();
                roots.Clear();
                foreach (var ps in allPs)
                {
                    var sub = ps.subEmitters;
                    if (!sub.enabled) continue;
                    for (int si = 0; si < sub.subEmittersCount; si++)
                    {
                        var childPs = sub.GetSubEmitterSystem(si);
                        if (childPs != null) subSet.Add(childPs);
                    }
                }
                foreach (var ps in allPs)
                {
                    if (subSet.Contains(ps)) continue;
                    var parentPs = ps.transform.parent != null ? ps.transform.parent.GetComponentInParent<ParticleSystem>(false) : null;
                    if (parentPs != null) continue;
                    roots.Add(ps);
                }

                Color32 measuredBg = new Color32(40, 44, 52, 255);
                for (int ci = 0; ci < candTimes.Length; ci++)
                {
                    float t = candTimes[ci];
                    SimulateAllRoots(roots, t);
                    RenderTexture.active = rt;
                    cam.Render();
                    tex.ReadPixels(new Rect(0, 0, cfg.width, cfg.height), 0, 0);
                    tex.Apply(false, false);
                    var pixels = tex.GetPixels32();
                    // Sample top-left corner pixel as background baseline (handles linear/ACES shift automatically)
                    measuredBg = pixels[0];
                    float fgFrac = MeasureForegroundFrac(pixels, measuredBg, 10);
                    chosenT = t;
                    chosenFg = fgFrac;
                    if (fgFrac >= 0.0018f || ci == candTimes.Length - 1)
                    {
                        byte[] pngBytes = ImageConversion.EncodeToPNG(tex);
                        File.WriteAllBytes(Path.Combine(cfg.outPngDir, job.id + ".png"), pngBytes);
                        break;
                    }
                }

                entries.Add(
                    "  {\\"id\\":" + JsonStr(job.id)
                    + ",\\"captureT\\":" + chosenT.ToString("R", CultureInfo.InvariantCulture)
                    + ",\\"fgFrac\\":" + chosenFg.ToString("R", CultureInfo.InvariantCulture)
                    + ",\\"bgRgb\\":[" + measuredBg.r + "," + measuredBg.g + "," + measuredBg.b + "]}"
                );
            }
            finally
            {
                RenderTexture.active = null;
                UnityEngine.Object.DestroyImmediate(inst);
            }
        }

        cam.targetTexture = null;
        rt.Release();
        UnityEngine.Object.DestroyImmediate(rt);
        UnityEngine.Object.DestroyImmediate(tex);

        File.WriteAllText(cfg.manifestOutPath, "[\\n" + string.Join(",\\n", entries) + "\\n]\\n", Encoding.UTF8);
        Debug.Log("HGameVfxVisualCapture completed " + entries.Count + " renders.");
    }
}
`;
}

function buildPythonAnalyzeScript() {
  return `
import json, sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

with open(sys.argv[1], 'r', encoding='utf-8') as f:
    cfg = json.load(f)
jobs = cfg['jobs']
unity_dir = cfg['unityDir']
hgame_dir = cfg['hgameDir']
strips_dir = cfg['stripsDir']
os.makedirs(strips_dir, exist_ok=True)

results = []
for j in jobs:
    eid = j['id']
    up = os.path.join(unity_dir, eid + '.png')
    hp = os.path.join(hgame_dir, eid + '.png')
    if not os.path.exists(up) or not os.path.exists(hp):
        results.append({'id': eid, 'name': j['name'], 'missing': True, 'mismatchScore': 999.0})
        continue
    u_img = Image.open(up).convert('RGB')
    h_img = Image.open(hp).convert('RGB')
    if u_img.size != h_img.size:
        h_img = h_img.resize(u_img.size, Image.Resampling.LANCZOS)
    ua = np.asarray(u_img, dtype=np.float32)
    ha = np.asarray(h_img, dtype=np.float32)

    # Background is sampled from corners of each image independently (handles tiny tone-map tint diffs)
    ubg = np.median(np.array([ua[0,0], ua[0,-1], ua[-1,0], ua[-1,-1]]), axis=0)
    hbg = np.median(np.array([ha[0,0], ha[0,-1], ha[-1,0], ha[-1,-1]]), axis=0)

    udiff = np.max(np.abs(ua - ubg), axis=2)
    hdiff = np.max(np.abs(ha - hbg), axis=2)

    umask = udiff > 10.0
    hmask = hdiff > 10.0
    ucnt = int(umask.sum())
    hcnt = int(hmask.sum())

    union_mask = umask | hmask
    inter_mask = umask & hmask
    union_cnt = int(union_mask.sum())
    inter_cnt = int(inter_mask.sum())

    sil_iou = float(inter_cnt / max(1, union_cnt)) if union_cnt > 0 else 1.0

    # Foreground bounding box IoU & centroid drift
    def bbox_and_centroid(mask, w_arr):
        ys, xs = np.nonzero(mask)
        if len(xs) == 0:
            return None, None
        box = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
        weights = w_arr[ys, xs] + 1e-3
        cx = float((xs * weights).sum() / weights.sum()) / ua.shape[1]
        cy = float((ys * weights).sum() / weights.sum()) / ua.shape[0]
        return box, (cx, cy)

    ubox, uc = bbox_and_centroid(umask, udiff)
    hbox, hc = bbox_and_centroid(hmask, hdiff)

    empty_mismatch = (ucnt == 0) != (hcnt == 0) or (min(ucnt, hcnt) < 12 and max(ucnt, hcnt) > 120)

    if ubox and hbox:
        ix0 = max(ubox[0], hbox[0]); iy0 = max(ubox[1], hbox[1])
        ix1 = min(ubox[2], hbox[2]); iy1 = min(ubox[3], hbox[3])
        iarea = max(0, ix1 - ix0 + 1) * max(0, iy1 - iy0 + 1)
        uarea = (ubox[2] - ubox[0] + 1) * (ubox[3] - ubox[1] + 1)
        harea = (hbox[2] - hbox[0] + 1) * (hbox[3] - hbox[1] + 1)
        bbox_iou = float(iarea / max(1, uarea + harea - iarea))
        center_drift = float(np.hypot(uc[0] - hc[0], uc[1] - hc[1]))
    elif not ubox and not hbox:
        bbox_iou = 1.0
        center_drift = 0.0
    else:
        bbox_iou = 0.0
        center_drift = 1.0

    # Color delta & brightness balance inside union (using Delta from background to ignore bg shade diffs)
    if union_cnt > 0:
        ud = (ua - ubg)[union_mask]
        hd = (ha - hbg)[union_mask]
        u_mean_delta = float(np.mean(np.linalg.norm(ud, axis=1)))
        h_mean_delta = float(np.mean(np.linalg.norm(hd, axis=1)))
        luma_ratio = float(h_mean_delta / max(1.0, u_mean_delta))
        # Normalized color similarity (mean per-pixel RGB difference on foreground union, 0..255)
        u_fg_rgb = ua[union_mask]
        h_fg_rgb = ha[union_mask]
        mean_rgb_diff = float(np.mean(np.abs(u_fg_rgb - h_fg_rgb)))
        # Mean normalized hue cosine inside intersection
        u_col = ua[inter_mask]
        h_col = ha[inter_mask]
        if len(u_col) > 0:
            un = np.linalg.norm(u_col, axis=1, keepdims=True) + 1e-4
            hn = np.linalg.norm(h_col, axis=1, keepdims=True) + 1e-4
            hue_cos = float(np.mean(np.sum((u_col / un) * (h_col / hn), axis=1)))
        else:
            hue_cos = 0.0
    else:
        luma_ratio = 1.0
        mean_rgb_diff = 0.0
        hue_cos = 1.0

    # Composite mismatch score (higher = worse parity)
    mismatch = (
        (100.0 if empty_mismatch else 0.0)
        + (1.0 - sil_iou) * 35.0
        + (1.0 - bbox_iou) * 25.0
        + center_drift * 40.0
        + min(1.0, mean_rgb_diff / 80.0) * 20.0
        + (1.0 - max(0.0, hue_cos)) * 20.0
    )

    results.append({
        'id': eid,
        'variantId': j.get('variantId', eid),
        'name': j['name'],
        'relSource': j.get('relSource', ''),
        'captureT': j.get('captureT', 0.25),
        'playY': j.get('playY', 1.15),
        'uFgPixels': ucnt,
        'hFgPixels': hcnt,
        'emptyMismatch': bool(empty_mismatch),
        'silIoU': round(sil_iou, 3),
        'bboxIoU': round(bbox_iou, 3),
        'centerDrift': round(center_drift, 3),
        'lumaRatio': round(luma_ratio, 3),
        'meanRgbDiff': round(mean_rgb_diff, 1),
        'hueCos': round(hue_cos, 3),
        'mismatchScore': round(float(mismatch), 2),
    })

results.sort(key=lambda r: r['mismatchScore'], reverse=True)

# Render side-by-side comparison strips for top worst effects (or explicit list)
strip_count = min(int(cfg.get('stripLimit', 24)), len(results))
for idx, r in enumerate(results[:strip_count]):
    if r.get('missing'):
        continue
    eid = r['id']
    u_img = Image.open(os.path.join(unity_dir, eid + '.png')).convert('RGB')
    h_img = Image.open(os.path.join(hgame_dir, eid + '.png')).convert('RGB')
    w, h = u_img.size
    header_h = 28
    canvas = Image.new('RGB', (w * 2 + 4, h + header_h), (18, 20, 24))
    canvas.paste(u_img, (0, header_h))
    canvas.paste(h_img, (w + 4, header_h))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([w, header_h, w + 3, h + header_h], fill=(90, 96, 108))
    label = f"#{idx+1} {r['name']} (t={r['captureT']}s) score={r['mismatchScore']} | Unity vs HGame | IoU={r['silIoU']} rgbDiff={r['meanRgbDiff']}"
    draw.text((6, 7), label[:115], fill=(230, 236, 244))
    strip_name = f"{idx+1:02d}_{eid}.png"
    canvas.save(os.path.join(strips_dir, strip_name))
    r['stripFile'] = strip_name

report = {
    'totalCompared': len(results),
    'emptyMismatchCount': sum(1 for r in results if r.get('emptyMismatch')),
    'meanSilIoU': round(float(np.mean([r.get('silIoU', 0) for r in results if not r.get('missing')])), 3),
    'meanBboxIoU': round(float(np.mean([r.get('bboxIoU', 0) for r in results if not r.get('missing')])), 3),
    'meanCenterDrift': round(float(np.mean([r.get('centerDrift', 0) for r in results if not r.get('missing')])), 3),
    'meanRgbDiff': round(float(np.mean([r.get('meanRgbDiff', 0) for r in results if not r.get('missing')])), 1),
    'results': results,
}
with open(cfg['reportOut'], 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print(json.dumps({
    'totalCompared': report['totalCompared'],
    'emptyMismatchCount': report['emptyMismatchCount'],
    'meanSilIoU': report['meanSilIoU'],
    'meanBboxIoU': report['meanBboxIoU'],
    'meanCenterDrift': report['meanCenterDrift'],
    'meanRgbDiff': report['meanRgbDiff'],
    'top15': [{k: r[k] for k in ('name', 'id', 'captureT', 'mismatchScore', 'silIoU', 'bboxIoU', 'centerDrift', 'meanRgbDiff', 'hueCos', 'uFgPixels', 'hFgPixels', 'stripFile') if k in r} for r in results[:15]],
}, ensure_ascii=False, indent=2))
`;
}

async function collectTargetJobs({ webassetUrl, bundleId, subCategory, filterIds, allVariants }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(webassetUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#hgame-vfx-list .hgame-list-item');
  const meta = await page.evaluate(async ({ bundleId, subCategory, allVariants }) => {
    const api = window.__WEBASSET_VFX_TEST__;
    await api.selectBundle(bundleId);
    const items = api.getItemsMeta().filter(it => !subCategory || it.subCategory === subCategory);
    return items;
  }, { bundleId, subCategory, allVariants });
  await browser.close();

  let jobs = meta.map((it) => ({
    id: it.id,
    variantId: it.variantId || it.id,
    effectId: it.effectId || it.id,
    name: it.name,
    relSource: it.relSource,
    prefabPath: `Assets/Epic Toon FX/Prefabs/${it.relSource}`.replace(/\\/g, '/'),
  }));
  if (filterIds.length > 0) {
    const fSet = new Set(filterIds.map((s) => s.toLowerCase()));
    jobs = jobs.filter((j) => fSet.has(j.id.toLowerCase()) || fSet.has(j.effectId.toLowerCase()) || fSet.has(j.name.toLowerCase()));
  }
  return jobs;
}

async function runHgameCaptures({ webassetUrl, jobs, hgameDir, pythonExe }) {
  fs.mkdirSync(hgameDir, { recursive: true });
  const rawDir = path.join(hgameDir, '_raw');
  fs.mkdirSync(rawDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(webassetUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#hgame-vfx-list .hgame-list-item');
  await page.evaluate(async () => {
    await window.__WEBASSET_VFX_TEST__.selectBundle('epic_toon_fx');
    window.__WEBASSET_VFX_TEST__.setPlaying(false);
  });

  const stageLoc = page.locator('#hgame-vfx-stage');
  for (const job of jobs) {
    const ok = await page.evaluate(async ({ id, captureT }) => {
      const api = window.__WEBASSET_VFX_TEST__;
      const selected = await api.select(id);
      if (!selected) return null;
      return api.resetAndStepTo(captureT, {
        camPos: [0, 2.2, 6.0],
        camTarget: [0, 1.15, 0],
        fov: 42,
        hideGrid: true,
        bgHex: '#282c34',
      });
    }, { id: job.id, captureT: job.captureT });
    if (!ok) continue;
    await page.waitForTimeout(30);
    await stageLoc.screenshot({ path: path.join(rawDir, `${job.id}.png`) });
  }
  await browser.close();

  // Crop central square from raw HGame screenshots & resize to 320x320 to match Unity 1:1 FOV=42
  const pyCrop = `
import os, sys
from PIL import Image
raw_dir, out_dir = sys.argv[1], sys.argv[2]
for f in os.listdir(raw_dir):
    if not f.endswith('.png'): continue
    im = Image.open(os.path.join(raw_dir, f)).convert('RGB')
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    sq = im.crop((left, top, left + side, top + side)).resize((320, 320), Image.Resampling.LANCZOS)
    sq.save(os.path.join(out_dir, f))
`;
  execFileSync(pythonExe, ['-c', pyCrop, rawDir, hgameDir], { stdio: 'inherit' });
  fs.rmSync(rawDir, { recursive: true, force: true });
  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  let bundleId = 'epic_toon_fx';
  let subCategory = '爆炸与爆裂';
  let webassetUrl = 'http://127.0.0.1:4174/#vfx';
  let unityProjSrc = DEFAULT_UNITY_PROJECT;
  let unityExe = resolveLocalUnityExe();
  let pythonExe = DEFAULT_PYTHON;
  let outDir = DEFAULT_OUT_DIR;
  let skipUnity = false;
  let skipHgame = false;
  let stripLimit = 20;
  let filterIds = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--bundle' && args[i + 1]) bundleId = args[++i];
    else if (a === '--category' && args[i + 1]) subCategory = args[++i];
    else if (a === '--url' && args[i + 1]) webassetUrl = args[++i];
    else if (a === '--unity-project' && args[i + 1]) unityProjSrc = args[++i];
    else if (a === '--unity-exe' && args[i + 1]) unityExe = args[++i];
    else if (a === '--out-dir' && args[i + 1]) outDir = path.resolve(args[++i]);
    else if (a === '--skip-unity') skipUnity = true;
    else if (a === '--skip-hgame') skipHgame = true;
    else if (a === '--strips' && args[i + 1]) stripLimit = Number(args[++i]);
    else if (a === '--only' && args[i + 1]) filterIds = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const unityDir = path.join(outDir, 'unity');
  const hgameDir = path.join(outDir, 'hgame');
  const stripsDir = path.join(outDir, 'strips');
  const unityManifestPath = path.join(outDir, 'unity_captures.json');
  const reportOut = path.join(outDir, 'report.json');

  const jobs = await collectTargetJobs({ webassetUrl, bundleId, subCategory, filterIds, allVariants: false });
  if (jobs.length === 0) throw new Error(`No effects matched bundle=${bundleId}, category=${subCategory}`);

  // Query each effect's playY via WebAsset when running captures
  if (!skipUnity) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto(webassetUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#hgame-vfx-list .hgame-list-item');
    await page.evaluate(async (bId) => {
      await window.__WEBASSET_VFX_TEST__.selectBundle(bId);
      window.__WEBASSET_VFX_TEST__.setPlaying(false);
    }, bundleId);
    for (const job of jobs) {
      const meta = await page.evaluate(async (id) => {
        await window.__WEBASSET_VFX_TEST__.select(id);
        return window.__WEBASSET_VFX_TEST__.getActivePlayMeta();
      }, job.id);
      job.playY = meta?.playY ?? 1.15;
    }
    await browser.close();
  }

  if (!skipUnity) {
    const workProj = path.join(os.tmpdir(), 'hgame-unity-urp-capture');
    const editorDir = path.join(workProj, 'Assets', 'Editor');
    fs.mkdirSync(editorDir, { recursive: true });
    copyDirRecursive(path.join(unityProjSrc, 'ProjectSettings'), path.join(workProj, 'ProjectSettings'));
    fs.mkdirSync(path.join(workProj, 'Packages'), { recursive: true });
    for (const pf of ['manifest.json', 'packages-lock.json']) {
      const sp = path.join(unityProjSrc, 'Packages', pf);
      if (fs.existsSync(sp)) fs.copyFileSync(sp, path.join(workProj, 'Packages', pf));
    }
    copyDirRecursive(path.join(unityProjSrc, 'Assets', 'Settings'), path.join(workProj, 'Assets', 'Settings'));
    const srcSettingsMeta = path.join(unityProjSrc, 'Assets', 'Settings.meta');
    if (fs.existsSync(srcSettingsMeta)) fs.copyFileSync(srcSettingsMeta, path.join(workProj, 'Assets', 'Settings.meta'));
    copyDirRecursive(path.join(unityProjSrc, 'Assets', 'Epic Toon FX'), path.join(workProj, 'Assets', 'Epic Toon FX'), { filterAssets: true });
    const srcBundleMeta = path.join(unityProjSrc, 'Assets', 'Epic Toon FX.meta');
    if (fs.existsSync(srcBundleMeta)) fs.copyFileSync(srcBundleMeta, path.join(workProj, 'Assets', 'Epic Toon FX.meta'));

    fs.writeFileSync(path.join(editorDir, 'HGameVfxVisualCapture.cs'), buildUnityCaptureCSharp(), 'utf8');
    const captureCfgPath = path.join(workProj, 'capture_cfg.json');
    const unityLogPath = path.join(workProj, 'unity-capture.log');
    fs.writeFileSync(captureCfgPath, JSON.stringify({
      outPngDir: unityDir.replace(/\\/g, '/'),
      manifestOutPath: unityManifestPath.replace(/\\/g, '/'),
      width: 320,
      height: 320,
      defaultT: 0.25,
      fallbackT1: 0.12,
      fallbackT2: 0.06,
      jobs: jobs.map((j) => ({ id: j.id, name: j.name, prefabPath: j.prefabPath, playY: j.playY })),
    }, null, 2), 'utf8');

    console.log(`Running Unity 6000.6.9f1 URP BatchMode capture for ${jobs.length} prefabs in ${workProj}...`);
    try {
      execFileSync(
        unityExe,
        [
          '-batchmode',
          '-quit',
          '-projectPath', workProj,
          '-executeMethod', 'HGameVfxVisualCapture.RunBatchCapture',
          '-logFile', unityLogPath,
        ],
        {
          env: { ...process.env, HGAME_UNITY_CAPTURE_CFG: captureCfgPath },
          stdio: 'inherit',
          timeout: 600_000,
        },
      );
    } finally {
      // Remove temporary editor script so staged project stays clean
      try { fs.rmSync(path.join(editorDir, 'HGameVfxVisualCapture.cs'), { force: true }); } catch { /* ignore */ }
    }
  }

  const unityManifest = fs.existsSync(unityManifestPath)
    ? JSON.parse(fs.readFileSync(unityManifestPath, 'utf8').replace(/^\uFEFF/, ''))
    : [];
  const capById = new Map(unityManifest.map((m) => [m.id, m]));
  for (const job of jobs) {
    const cap = capById.get(job.id);
    job.captureT = cap?.captureT ?? 0.25;
  }

  if (!skipHgame) {
    console.log(`Capturing ${jobs.length} effects in live WebAsset (${webassetUrl})...`);
    const browserErrors = await runHgameCaptures({ webassetUrl, jobs, hgameDir, pythonExe });
    if (browserErrors.length > 0) {
      console.warn(`WebAsset console/page errors (${browserErrors.length}):`, browserErrors.slice(0, 10));
    }
  }

  // Clear stale strips before writing new ones
  if (fs.existsSync(stripsDir)) {
    for (const f of fs.readdirSync(stripsDir)) {
      if (f.endsWith('.png')) fs.rmSync(path.join(stripsDir, f), { force: true });
    }
  }
  const analyzeCfgPath = path.join(outDir, 'analyze_cfg.json');
  fs.writeFileSync(analyzeCfgPath, JSON.stringify({
    jobs,
    unityDir,
    hgameDir,
    stripsDir,
    reportOut,
    stripLimit,
  }, null, 2), 'utf8');
  execFileSync(pythonExe, ['-c', buildPythonAnalyzeScript(), analyzeCfgPath], { stdio: 'inherit' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
