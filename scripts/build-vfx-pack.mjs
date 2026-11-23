#!/usr/bin/env node
/**
 * One-command incremental Unity ParticleSystem -> HGame VFX Pack builder.
 *
 * Converts one or more `.prefab` files (`--prefab` / `--dir`), packs deduplicated
 * textures into `atlas.png` + `atlas_regions.json` (via Pillow), converts referenced
 * `.asset` (pure JS) and `.fbx` (via headless Blender preserving submeshes) into
 * `meshes/*.glb`, and emits `vfx-pack.manifest.json` compatible with `loadVfxPack()`.
 *
 * Usage:
 *   node scripts/build-vfx-pack.mjs --unity-root <dir> --prefab <p1> --out <outDir>
 *   npm run vfx:pack -- --unity-root D:/UnityWorkspace/AssetTest/Assets/PilotoStudio --dir Fire --out ./vfx-pack
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { convertUnityPrefab } from './import-unity-vfx.mjs';
import { buildGlbBuffer, parseUnityAssetMesh } from './export-unity-vfx-bench.mjs';
import { validateVfxRecipe } from '../assets/runtime/vfx/vfx-recipes.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const BUILTIN_MESH_PRIMITIVES = new Set(['quad', 'cube', 'sphere', 'cylinder', 'crystal']);

function normKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function loadLocalConfig() {
  const localCfg = path.join(REPO_ROOT, '.hgame.local.json');
  if (!fs.existsSync(localCfg)) return {};
  try {
    return JSON.parse(fs.readFileSync(localCfg, 'utf8'));
  } catch {
    return {};
  }
}

function resolveBlenderPath(localCfg) {
  if (localCfg?.blenderPath && fs.existsSync(localCfg.blenderPath)) return localCfg.blenderPath;
  if (process.env.HGAME_BLENDER_PATH && fs.existsSync(process.env.HGAME_BLENDER_PATH)) {
    return process.env.HGAME_BLENDER_PATH;
  }
  return 'blender';
}

function collectPrefabsRecursive(dirPath, out = []) {
  if (!fs.existsSync(dirPath)) return out;
  for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, ent.name);
    if (ent.isDirectory()) collectPrefabsRecursive(full, out);
    else if (ent.isFile() && ent.name.endsWith('.prefab')) out.push(full);
  }
  return out;
}

function collectLayerDeps(layers, meshAliases, flipbookKeys) {
  for (const l of layers) {
    if (l.flipbook?.region) flipbookKeys.add(l.flipbook.region);
    if (l.uberMat?.mainTexKey && l.flipbook) flipbookKeys.add(l.uberMat.mainTexKey);

    const regMesh = (mk) => {
      if (!mk || BUILTIN_MESH_PRIMITIVES.has(mk)) return;
      const base = mk.split('__')[0];
      if (!meshAliases.has(mk)) meshAliases.set(mk, base);
    };

    if (l.renderMode === 'mesh') regMesh(l.mesh);
    if (Array.isArray(l.meshes)) {
      for (const entry of l.meshes) {
        regMesh(typeof entry === 'string' ? entry : entry?.mesh);
      }
    }
    if (l.shape?.mesh) regMesh(l.shape.mesh);

    if (Array.isArray(l.subEmitters)) {
      for (const s of l.subEmitters) {
        if (s?.effect?.layers) collectLayerDeps(s.effect.layers, meshAliases, flipbookKeys);
      }
    }
  }
}

export function parseVfxPackArgs(argv) {
  const args = {
    unityRoot: process.env.HGAME_PILOTO_ROOT || '',
    prefabs: [],
    dirs: [],
    outDir: '',
    force: false,
    skipAtlas: false,
    skipMeshes: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--force') args.force = true;
    else if (a === '--skip-atlas') args.skipAtlas = true;
    else if (a === '--skip-meshes') args.skipMeshes = true;
    else if (a === '--unity-root' && i + 1 < argv.length) args.unityRoot = argv[++i];
    else if (a === '--prefab' && i + 1 < argv.length) args.prefabs.push(argv[++i]);
    else if (a === '--dir' && i + 1 < argv.length) args.dirs.push(argv[++i]);
    else if ((a === '--out' || a === '-o') && i + 1 < argv.length) args.outDir = argv[++i];
  }
  return args;
}

const ATLAS_PACKER_PY = `
import json, os, re, sys
from PIL import Image

cfg = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
flip_keys = set(cfg['flipbookKeys'])

def to_sprite_key(rel_path):
    base = os.path.splitext(os.path.basename(rel_path))[0].lower()
    return re.sub(r'[^a-z0-9]+', '_', base).strip('_')

items = {}
for t in cfg['textures']:
    sk = to_sprite_key(t['relPath'])
    if sk not in items and os.path.exists(t['fullPath']):
        items[sk] = (t['fullPath'], bool(t.get('fromGrayScale', False)))

def load_resized(path, max_dim, from_grayscale=False):
    im = Image.open(path)
    if im.mode.startswith('I;16') or im.mode == 'I':
        im = im.point(lambda p: p / 257.0).convert('L')
    im = im.convert('RGBA')
    if from_grayscale:
        im.putalpha(im.convert('L'))
    w, h = im.size
    scale = min(1.0, max_dim / max(1, w, h))
    nw = max(4, int(round(w * scale)))
    nh = max(4, int(round(h * scale)))
    if (nw, nh) != (w, h):
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    return im

def pack(flip_cap, reg_cap, atlas_size=4096, pad=4):
    loaded = []
    for sk, (fp, from_gray) in items.items():
        if sk in flip_keys:
            cap = flip_cap
        elif 'runes' in sk or 'decal' in sk:
            cap = max(reg_cap, 512)
        else:
            cap = reg_cap
        loaded.append((sk, load_resized(fp, cap, from_grayscale=from_gray)))
    loaded.sort(key=lambda x: (-x[1].size[1], -x[1].size[0], x[0]))

    x, y, row_h = pad, pad, 0
    placements = []
    for sk, im in loaded:
        w, h = im.size
        if x + w + pad > atlas_size:
            x = pad
            y += row_h + pad * 2
            row_h = 0
        if y + h + pad > atlas_size:
            return None
        placements.append((sk, im, x, y, w, h))
        x += w + pad * 2
        if h > row_h:
            row_h = h
    used_h = y + row_h + pad
    return placements, used_h

if not items:
    Image.new('RGBA', (64, 64), (255, 255, 255, 255)).save(cfg['outAtlasPng'])
    with open(cfg['outAtlasJson'], 'w', encoding='utf-8') as f:
        json.dump({'width': 64, 'height': 64, 'regions': {}}, f, indent=2)
    sys.exit(0)

res = pack(512, 256) or pack(384, 192) or pack(256, 128)
if res is None:
    raise RuntimeError('Atlas overflowed 4096x4096')

placements, used_h = res
ATLAS_W = 4096
ATLAS_H = 1
while ATLAS_H < used_h:
    ATLAS_H *= 2
ATLAS_H = min(4096, max(256, ATLAS_H))

canvas = Image.new('RGBA', (ATLAS_W, ATLAS_H), (0, 0, 0, 0))
regions = {}
pad = 4

for sk, im, x, y, w, h in placements:
    canvas.paste(im, (x, y))
    top_strip = im.crop((0, 0, w, 1))
    bot_strip = im.crop((0, h - 1, w, h))
    left_strip = im.crop((0, 0, 1, h))
    right_strip = im.crop((w - 1, 0, w, h))
    for k in range(1, pad + 1):
        canvas.paste(top_strip, (x, y - k))
        canvas.paste(bot_strip, (x, y + h - 1 + k))
        canvas.paste(left_strip, (x - k, y))
        canvas.paste(right_strip, (x + w - 1 + k, y))
    canvas.paste(Image.new('RGBA', (pad, pad), im.getpixel((0, 0))), (x - pad, y - pad))
    canvas.paste(Image.new('RGBA', (pad, pad), im.getpixel((w - 1, 0))), (x + w, y - pad))
    canvas.paste(Image.new('RGBA', (pad, pad), im.getpixel((0, h - 1))), (x - pad, y + h))
    canvas.paste(Image.new('RGBA', (pad, pad), im.getpixel((w - 1, h - 1))), (x + w, y + h))

    regions[sk] = [
        round(x / ATLAS_W, 6),
        round(y / ATLAS_H, 6),
        round((x + w) / ATLAS_W, 6),
        round((y + h) / ATLAS_H, 6),
    ]

canvas.save(cfg['outAtlasPng'], optimize=True)
with open(cfg['outAtlasJson'], 'w', encoding='utf-8') as f:
    json.dump({'width': ATLAS_W, 'height': ATLAS_H, 'regions': regions}, f, indent=2)
print(f"Packed {len(regions)} regions into {ATLAS_W}x{ATLAS_H}")
`;

const BLENDER_FBX_EXPORTER_PY = `
import bpy, json, math, os, re, struct, sys

argv = sys.argv[sys.argv.index('--') + 1:]
cfg = json.load(open(argv[0], 'r', encoding='utf-8'))

def read_fbx_unit_scale(path):
    data = open(path, 'rb').read()
    idx = data.find(b'UnitScaleFactor')
    if idx != -1:
        chunk = data[idx:idx+64]
        dpos = chunk.find(b'D')
        if dpos != -1 and dpos + 9 <= len(chunk):
            val = struct.unpack('<d', chunk[dpos+1:dpos+9])[0]
            if 0.0001 < val < 100000:
                return val * 0.01
    return 0.01

def decode_ascii_fbx(path):
    txt = open(path, 'r', encoding='utf-8', errors='ignore').read()
    v_m = re.search(r'Vertices:\\s*\\*\\d+\\s*\\{\\s*a:\\s*([^}]+)', txt)
    i_m = re.search(r'PolygonVertexIndex:\\s*\\*\\d+\\s*\\{\\s*a:\\s*([^}]+)', txt)
    if not v_m or not i_m:
        return None
    raw_v = [float(x) for x in v_m.group(1).split(',') if x.strip()]
    positions = [(raw_v[i], raw_v[i+1], raw_v[i+2]) for i in range(0, len(raw_v) - 2, 3)]
    raw_idx = [int(x) for x in i_m.group(1).split(',') if x.strip()]
    uv_m = re.search(r'UV:\\s*\\*\\d+\\s*\\{\\s*a:\\s*([^}]+)', txt)
    uvi_m = re.search(r'UVIndex:\\s*\\*\\d+\\s*\\{\\s*a:\\s*([^}]+)', txt)
    uv_vals = [(float(raw_uv[i]), float(raw_uv[i+1])) for raw_uv in [[float(x) for x in uv_m.group(1).split(',') if x.strip()]] for i in range(0, len(raw_uv) - 1, 2)] if uv_m else None
    uv_idx = [int(x) for x in uvi_m.group(1).split(',') if x.strip()] if uvi_m else None

    bpy_verts = [(-p[0], -p[2], p[1]) for p in positions]
    faces = []
    poly = []
    face_uv_loops = []
    cur_uv_poly = []
    for loop_k, idx in enumerate(raw_idx):
        v_i = (-idx - 1) if idx < 0 else idx
        poly.append(v_i)
        if uv_vals:
            ui = uv_idx[loop_k] if (uv_idx and loop_k < len(uv_idx)) else v_i
            cur_uv_poly.append(uv_vals[ui] if 0 <= ui < len(uv_vals) else (0.0, 0.0))
        if idx < 0:
            if len(poly) >= 3:
                for t in range(1, len(poly) - 1):
                    a, b, c = poly[0], poly[t], poly[t+1]
                    if a != b and b != c and a != c:
                        faces.append((a, c, b))
                        if uv_vals:
                            face_uv_loops.append((cur_uv_poly[0], cur_uv_poly[t+1], cur_uv_poly[t]))
            poly = []
            cur_uv_poly = []

    me = bpy.data.meshes.new(os.path.splitext(os.path.basename(path))[0])
    me.from_pydata(bpy_verts, [], faces)
    if uv_vals and face_uv_loops:
        uv_layer = me.uv_layers.new(name='UVMap')
        for fi, poly_obj in enumerate(me.polygons):
            t_uvs = face_uv_loops[fi] if fi < len(face_uv_loops) else ((0,0),(0,0),(0,0))
            for k, li in enumerate(poly_obj.loop_indices):
                uv_layer.data[li].uv = t_uvs[k] if k < 3 else (0.0, 0.0)
    me.update()
    obj = bpy.data.objects.new(me.name, me)
    bpy.context.collection.objects.link(obj)
    return obj

for item in cfg['fbxMeshes']:
    p = item['fullPath']
    out_glb = item['outGlb']
    mkey = item['key']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    unit_scale = read_fbx_unit_scale(p)
    try:
        bpy.ops.import_scene.fbx(filepath=p, use_manual_orientation=False, global_scale=1.0)
    except Exception as err:
        if 'ASCII' in str(err):
            obj = decode_ascii_fbx(p)
            if obj is None:
                continue
        else:
            raise
    else:
        bpy.ops.object.select_all(action='DESELECT')
        for o in [obj for obj in bpy.data.objects if obj.type == 'MESH']:
            rot_world = o.matrix_world.to_quaternion()
            euler_world = rot_world.to_euler()
            vs = o.data.vertices
            is_flat_xy = False
            if len(vs) > 0:
                wvs = [o.matrix_world @ v.co for v in vs]
                x_span = max(v.x for v in wvs) - min(v.x for v in wvs)
                y_span = max(v.y for v in wvs) - min(v.y for v in wvs)
                z_span = max(v.z for v in wvs) - min(v.z for v in wvs)
                is_flat_xy = abs(euler_world.x) < 0.1 and z_span < 0.05 * max(x_span, y_span, 1e-4) and y_span > 0.2
            o.parent = None
            o.location = (0.0, 0.0, 0.0)
            o.rotation_mode = 'XYZ'
            e_apply = rot_world.to_euler('XYZ')
            if is_flat_xy or mkey == 'tear_drop_tube':
                e_apply.x += math.pi / 2.0
            o.rotation_euler = e_apply
            o.scale = (unit_scale, unit_scale, unit_scale)
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.select_set(True)
            if o.data.materials:
                o.data.materials.clear()

    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='NONE',
    )
    print(f'Exported FBX -> {out_glb}')
`;

export function buildVfxPack({
  unityRoot,
  prefabs = [],
  dirs = [],
  outDir,
  force = false,
  skipAtlas = false,
  skipMeshes = false,
}) {
  if (!unityRoot) throw new Error('--unity-root (or HGAME_PILOTO_ROOT) is required');
  if (!outDir) throw new Error('--out directory is required');

  const resolvedUnityRoot = path.resolve(unityRoot);
  const resolvedOut = path.resolve(outDir);
  const recipesDir = path.join(resolvedOut, 'recipes');
  const meshesDir = path.join(resolvedOut, 'meshes');
  fs.mkdirSync(recipesDir, { recursive: true });
  fs.mkdirSync(meshesDir, { recursive: true });

  const prefabFiles = [];
  for (const p of prefabs) {
    const abs = path.isAbsolute(p) ? p : path.join(resolvedUnityRoot, p);
    if (!fs.existsSync(abs)) throw new Error(`Prefab not found: ${abs}`);
    prefabFiles.push(abs);
  }
  for (const d of dirs) {
    const abs = path.isAbsolute(d) ? d : path.join(resolvedUnityRoot, d);
    collectPrefabsRecursive(abs, prefabFiles);
  }
  const uniquePrefabs = Array.from(new Set(prefabFiles)).sort();
  if (uniquePrefabs.length === 0) {
    throw new Error('No .prefab inputs found (specify --prefab or --dir)');
  }

  const manifestPath = path.join(resolvedOut, 'vfx-pack.manifest.json');
  let prevCache = {};
  if (!force && fs.existsSync(manifestPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      prevCache = prev.cache || {};
    } catch {
      prevCache = {};
    }
  }

  const allTextures = new Map();
  const allMeshes = new Map();
  const flipbookKeys = new Set();
  const meshAliases = new Map();
  const recipeEntries = [];

  for (const prefabPath of uniquePrefabs) {
    const id = normKey(path.basename(prefabPath, '.prefab'));
    const { recipe, dependencies } = convertUnityPrefab({
      unityRoot: resolvedUnityRoot,
      prefabPath,
      id,
    });
    const check = validateVfxRecipe(recipe);
    if (!check.ok) {
      throw new Error(`Invalid converted recipe ${id}: ${check.errors.join('; ')}`);
    }
    collectLayerDeps(recipe.layers, meshAliases, flipbookKeys);
    for (const t of dependencies.textures) allTextures.set(t.relPath, t);
    for (const m of dependencies.meshes) allMeshes.set(m.relPath, m);

    const relRecipe = `recipes/${id}.vfx.json`;
    fs.writeFileSync(path.join(resolvedOut, relRecipe), JSON.stringify(recipe, null, 2), 'utf8');
    recipeEntries.push({
      id,
      name: path.basename(prefabPath, '.prefab'),
      file: relRecipe,
      duration: recipe.duration,
      loop: recipe.loop,
      layerCount: recipe.layers.length,
    });
  }

  const outAtlasPng = path.join(resolvedOut, 'atlas.png');
  const outAtlasJson = path.join(resolvedOut, 'atlas_regions.json');
  const texList = Array.from(allTextures.values());
  const texSignature = texList
    .map((t) => `${t.relPath}:${fs.existsSync(t.fullPath) ? fs.statSync(t.fullPath).mtimeMs : 0}:${t.fromGrayScale ? 1 : 0}`)
    .sort()
    .join('|');

  if (!skipAtlas) {
    const atlasUpToDate = !force
      && prevCache.texSignature === texSignature
      && fs.existsSync(outAtlasPng)
      && fs.existsSync(outAtlasJson);
    if (!atlasUpToDate) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-pack-'));
      const cfgPath = path.join(tmpDir, 'atlas_cfg.json');
      const pyPath = path.join(tmpDir, 'pack_atlas.py');
      fs.writeFileSync(cfgPath, JSON.stringify({
        outAtlasPng,
        outAtlasJson,
        textures: texList,
        flipbookKeys: Array.from(flipbookKeys),
      }), 'utf8');
      fs.writeFileSync(pyPath, ATLAS_PACKER_PY, 'utf8');
      try {
        execFileSync('python', [pyPath, cfgPath], { stdio: 'inherit' });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }

  const localCfg = loadLocalConfig();
  const blenderBin = resolveBlenderPath(localCfg);
  const fbxQueue = [];
  const meshFiles = [];
  const nextMeshMtimes = {};
  const prevMeshMtimes = prevCache.meshMtimes || {};

  if (!skipMeshes) {
    for (const m of allMeshes.values()) {
      const baseName = path.basename(m.relPath, path.extname(m.relPath));
      const mkey = normKey(baseName);
      const outGlb = path.join(meshesDir, `${mkey}.glb`);
      const relGlb = `meshes/${mkey}.glb`;
      if (!meshFiles.includes(relGlb)) meshFiles.push(relGlb);
      if (!fs.existsSync(m.fullPath)) continue;

      const mtime = fs.statSync(m.fullPath).mtimeMs;
      nextMeshMtimes[mkey] = mtime;
      const isUpToDate = !force && prevMeshMtimes[mkey] === mtime && fs.existsSync(outGlb);
      if (isUpToDate) continue;

      const ext = path.extname(m.fullPath).toLowerCase();
      if (ext === '.asset') {
        const parsed = parseUnityAssetMesh(fs.readFileSync(m.fullPath, 'utf8'));
        fs.writeFileSync(outGlb, buildGlbBuffer(parsed));
      } else {
        fbxQueue.push({ key: mkey, fullPath: m.fullPath, outGlb });
      }
    }

    if (fbxQueue.length > 0) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-vfx-fbx-'));
      const cfgPath = path.join(tmpDir, 'fbx_cfg.json');
      const pyPath = path.join(tmpDir, 'export_fbx.py');
      fs.writeFileSync(cfgPath, JSON.stringify({ fbxMeshes: fbxQueue }), 'utf8');
      fs.writeFileSync(pyPath, BLENDER_FBX_EXPORTER_PY, 'utf8');
      try {
        execFileSync(blenderBin, ['--background', '--python', pyPath, '--', cfgPath], { stdio: 'inherit' });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }

  const aliasesObj = {};
  for (const [alias, baseKey] of meshAliases.entries()) {
    const cleanBase = normKey(baseKey);
    const rel = `meshes/${cleanBase}.glb`;
    if (fs.existsSync(path.join(resolvedOut, rel)) || meshFiles.includes(rel)) {
      aliasesObj[alias] = rel;
    }
  }

  const manifest = {
    schemaVersion: 1,
    atlas: 'atlas.png',
    regions: 'atlas_regions.json',
    meshes: meshFiles.sort(),
    aliases: aliasesObj,
    recipes: recipeEntries,
    cache: {
      texSignature,
      meshMtimes: nextMeshMtimes,
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const args = parseVfxPackArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/build-vfx-pack.mjs --unity-root <dir> [--prefab <file>] [--dir <subDir>] --out <outDir> [--force] [--skip-atlas] [--skip-meshes]');
    process.exit(0);
  }
  const manifest = buildVfxPack(args);
  console.log(`Built VFX pack: ${manifest.recipes.length} recipes, ${manifest.meshes.length} meshes, ${Object.keys(manifest.aliases).length} aliases -> ${path.resolve(args.outDir)}`);
}
