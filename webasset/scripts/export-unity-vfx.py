import json
import math
import os
import re
import shutil
import subprocess
import sys

UNITY_ASSETS_ROOT = r"D:\UnityWorkspace\AssetTest\Assets\Epic Toon FX"
OUT_ROOT = r"D:\UnityWorkspace\AssetTest\Saved\WebAssetExport"
BLENDER_EXE = r"D:\Apps\Blender\blender.exe"

TARGET_PREFABS = [
    {
        "rel": r"Prefabs\Combat\Explosions\NovaExplosion\ExplosionNovaFire.prefab",
        "name": "火焰新星爆炸 · ExplosionNovaFire",
        "category": "火焰爆破",
    },
    {
        "rel": r"Prefabs\Combat\Sword\Slash\SwordSlashThick\SwordSlashThickBlue.prefab",
        "name": "重剑蓝光斩 · SwordSlashThickBlue",
        "category": "刀光轨迹",
    },
    {
        "rel": r"Prefabs\Combat\Magic\Circle\MagicCircleBlue.prefab",
        "name": "苍蓝魔法阵 · MagicCircleBlue",
        "category": "法阵光环",
    },
]


def clean_id(s):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", s)


def build_guid_index(root):
    guids = {}
    for dp, _, files in os.walk(root):
        for fn in files:
            if not fn.endswith(".meta"):
                continue
            p = os.path.join(dp, fn)
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                txt = f.read()
            m = re.search(r"guid:\s*([a-f0-9]{32})", txt)
            if m:
                guids[m.group(1)] = os.path.join(dp, fn[:-5])
    return guids


def parse_inline_dict(s):
    out = {}
    for km in re.finditer(r"(\w+):\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)", s):
        out[km.group(1)] = float(km.group(2))
    return out


def extract_indented_block(text, key_prefix):
    """Extract lines belonging to an indented YAML block (including same-indent `- ` sequence items)."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith(key_prefix):
            base_indent = len(line) - len(line.lstrip(" "))
            block = [line]
            for j in range(i + 1, len(lines)):
                nxt = lines[j]
                if not nxt.strip():
                    continue
                stripped = nxt.lstrip(" ")
                ind = len(nxt) - len(stripped)
                if ind < base_indent or (ind == base_indent and not stripped.startswith("- ")):
                    break
                block.append(nxt)
            return "\n".join(block)
    return ""


def parse_minmax_curve(block):
    if not block:
        return {"min": 0.0, "max": 0.0, "mode": 0, "keys": [[0.0, 1.0], [1.0, 1.0]]}
    mm = re.search(r"minMaxState:\s*(\d+)", block)
    mode = int(mm.group(1)) if mm else 0
    sc = re.search(r"^\s+scalar:\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)", block, re.M)
    msc = re.search(r"^\s+minScalar:\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)", block, re.M)
    scalar = float(sc.group(1)) if sc else 0.0
    min_scalar = float(msc.group(1)) if msc else scalar

    # Extract maxCurve keyframes
    max_curve_blk = ""
    mc_m = re.search(r"maxCurve:[\s\S]*?(?=^\s+minCurve:|\Z)", block, re.M)
    if mc_m:
        max_curve_blk = mc_m.group(0)
    else:
        max_curve_blk = block

    keys = []
    for km in re.finditer(r"time:\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*\n\s*value:\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)", max_curve_blk):
        keys.append([round(float(km.group(1)), 4), round(float(km.group(2)), 4)])
    if not keys:
        keys = [[0.0, 1.0], [1.0, 1.0]]

    if mode == 0:  # Constant
        lo, hi = scalar, scalar
        keys = [[0.0, 1.0], [1.0, 1.0]]
    elif mode == 3:  # Random Between Two Constants
        lo, hi = min(scalar, min_scalar), max(scalar, min_scalar)
        keys = [[0.0, 1.0], [1.0, 1.0]]
    elif mode == 1:  # Curve
        lo, hi = scalar, scalar
    else:  # Random Between Two Curves (approximate with maxCurve * [minScalar, scalar] or keys)
        lo, hi = min(scalar, min_scalar), max(scalar, min_scalar)

    return {"mode": mode, "min": round(lo, 4), "max": round(hi, 4), "keys": keys}


def parse_gradient_block(block):
    if not block:
        return {
            "colorKeys": [[0.0, [1.0, 1.0, 1.0]], [1.0, [1.0, 1.0, 1.0]]],
            "alphaKeys": [[0.0, 1.0], [1.0, 1.0]],
        }
    n_col_m = re.search(r"m_NumColorKeys:\s*(\d+)", block)
    n_alp_m = re.search(r"m_NumAlphaKeys:\s*(\d+)", block)
    n_col = int(n_col_m.group(1)) if n_col_m else 2
    n_alp = int(n_alp_m.group(1)) if n_alp_m else 2

    keys = {}
    for i in range(8):
        km = re.search(rf"\bkey{i}:\s*\{{([^}}]+)\}}", block)
        if km:
            keys[i] = parse_inline_dict(km.group(1))

    ctimes = {}
    atimes = {}
    for i in range(8):
        cm = re.search(rf"\bctime{i}:\s*(\d+)", block)
        am = re.search(rf"\batime{i}:\s*(\d+)", block)
        if cm:
            ctimes[i] = int(cm.group(1)) / 65535.0
        if am:
            atimes[i] = int(am.group(1)) / 65535.0

    color_keys = []
    for i in range(n_col):
        k = keys.get(i, {"r": 1, "g": 1, "b": 1})
        color_keys.append([
            round(ctimes.get(i, i / max(1, n_col - 1)), 4),
            [round(k.get("r", 1.0), 4), round(k.get("g", 1.0), 4), round(k.get("b", 1.0), 4)],
        ])

    alpha_keys = []
    for i in range(n_alp):
        k = keys.get(i, {"a": 1})
        alpha_keys.append([
            round(atimes.get(i, i / max(1, n_alp - 1)), 4),
            round(k.get("a", 1.0), 4),
        ])

    return {"colorKeys": color_keys, "alphaKeys": alpha_keys}


def parse_minmax_gradient(block):
    if not block:
        return {
            "mode": 0,
            "colorMin": [1.0, 1.0, 1.0, 1.0],
            "colorMax": [1.0, 1.0, 1.0, 1.0],
            "gradient": parse_gradient_block(""),
        }
    mm = re.search(r"minMaxState:\s*(\d+)", block)
    mode = int(mm.group(1)) if mm else 0
    max_col_m = re.search(r"maxColor:\s*\{([^}]+)\}", block)
    min_col_m = re.search(r"minColor:\s*\{([^}]+)\}", block)
    max_col = parse_inline_dict(max_col_m.group(1)) if max_col_m else {"r": 1, "g": 1, "b": 1, "a": 1}
    min_col = parse_inline_dict(min_col_m.group(1)) if min_col_m else max_col

    max_grad_m = re.search(r"maxGradient:[\s\S]*?(?=^\s+minGradient:|\Z)", block, re.M)
    grad = parse_gradient_block(max_grad_m.group(0) if max_grad_m else block)
    return {
        "mode": mode,
        "colorMin": [round(min_col.get("r", 1), 4), round(min_col.get("g", 1), 4), round(min_col.get("b", 1), 4), round(min_col.get("a", 1), 4)],
        "colorMax": [round(max_col.get("r", 1), 4), round(max_col.get("g", 1), 4), round(max_col.get("b", 1), 4), round(max_col.get("a", 1), 4)],
        "gradient": grad,
    }


def parse_material(mat_path, guid_map, tex_out_dir):
    if not mat_path or not os.path.isfile(mat_path):
        return {"blend": "additive", "tint": [1.0, 1.0, 1.0, 1.0], "textureUrl": None, "textureName": None}
    txt = open(mat_path, "r", encoding="utf-8", errors="ignore").read()
    # URP Particles/Unlit uses _Blend: 0 (Alpha), 1 (Premultiply), 2 (Additive), 3 (Multiply)
    # Legacy Particles/Additive vs Alpha Blended uses shader GUID or filename suffix (_ADD vs _AB)
    blend = "additive"
    bm = re.search(r"- _Blend:\s*(\d+)", txt)
    if bm:
        bval = int(bm.group(1))
        blend = "normal" if bval in (0, 1) else "additive"
    elif mat_path.lower().endswith("_ab.mat"):
        blend = "normal"

    tint = [1.0, 1.0, 1.0, 1.0]
    cm = re.search(r"- (?:_TintColor|_BaseColor|_Color):\s*\{([^}]+)\}", txt)
    if cm:
        cd = parse_inline_dict(cm.group(1))
        tint = [round(cd.get("r", 1.0), 4), round(cd.get("g", 1.0), 4), round(cd.get("b", 1.0), 4), round(cd.get("a", 1.0), 4)]

    tex_url = None
    tex_name = None
    tm = re.search(r"- (?:_MainTex|_BaseMap):\s*\n\s*m_Texture:\s*\{[^}]*guid:\s*([a-f0-9]{32})", txt)
    if tm:
        src_tex = guid_map.get(tm.group(1))
        if src_tex and os.path.isfile(src_tex):
            tex_name = os.path.basename(src_tex)
            safe_fn = clean_id(tex_name)
            dst = os.path.join(tex_out_dir, safe_fn)
            os.makedirs(tex_out_dir, exist_ok=True)
            shutil.copy2(src_tex, dst)
            tex_url = f"/files/hgame-unity/textures/{safe_fn}"

    return {"blend": blend, "tint": tint, "textureUrl": tex_url, "textureName": tex_name}


def convert_fbx_to_glb(fbx_path, mesh_out_dir):
    if not fbx_path or not os.path.isfile(fbx_path):
        return None
    meta_path = fbx_path + ".meta"
    global_scale = 1.0
    if os.path.isfile(meta_path):
        mtxt = open(meta_path, "r", encoding="utf-8", errors="ignore").read()
        gm = re.search(r"globalScale:\s*([-+]?[0-9]*\.?[0-9]+)", mtxt)
        if gm:
            global_scale = float(gm.group(1))

    base = os.path.splitext(os.path.basename(fbx_path))[0]
    safe_name = clean_id(base) + ".glb"
    out_glb = os.path.join(mesh_out_dir, safe_name)
    os.makedirs(mesh_out_dir, exist_ok=True)

    py_expr = (
        "import bpy, sys\n"
        "bpy.ops.wm.read_factory_settings(use_empty=True)\n"
        f"bpy.ops.import_scene.fbx(filepath=r'{fbx_path}')\n"
        "bpy.ops.export_scene.gltf(filepath=r'" + out_glb + "', export_format='GLB', export_yup=False, export_materials='NONE')\n"
    )
    res = subprocess.run([BLENDER_EXE, "-b", "--python-expr", py_expr], capture_output=True, text=True)
    if res.returncode != 0 or not os.path.isfile(out_glb):
        raise RuntimeError(f"Blender export failed for {fbx_path}: {res.stderr[-400:]}")
    return {
        "id": clean_id(base),
        "name": f"3D {base}",
        "assetName": base,
        "globalScale": round(global_scale, 4),
        "bytes": os.path.getsize(out_glb),
        "url": f"/files/hgame-unity/meshes/{safe_name}",
    }


def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]


def quat_rotate_vec(q, v):
    qx, qy, qz, qw = q
    vx, vy, vz = v
    ix = qw * vx + qy * vz - qz * vy
    iy = qw * vy + qz * vx - qx * vz
    iz = qw * vz + qx * vy - qy * vx
    iw = -qx * vx - qy * vy - qz * vz
    return [
        ix * qw + iw * -qx + iy * -qz - iz * -qy,
        iy * qw + iw * -qy + iz * -qx - ix * -qz,
        iz * qw + iw * -qz + ix * -qy - iy * -qx,
    ]


def parse_prefab(prefab_spec, guid_map, tex_out_dir, mesh_out_dir, exported_meshes):
    full_path = os.path.join(UNITY_ASSETS_ROOT, prefab_spec["rel"])
    txt = open(full_path, "r", encoding="utf-8").read()
    docs = txt.split("\n--- !u!")
    if docs[0].lstrip().startswith("%YAML"):
        # First doc starts after header
        first_idx = txt.find("--- !u!")
        docs = txt[first_idx:].split("\n--- !u!")
        docs[0] = docs[0][len("--- !u!"):]
    else:
        docs[0] = docs[0].lstrip("- !u")

    transforms = {}
    game_objects = {}
    particle_systems = {}
    renderers = {}

    for raw in docs:
        raw = raw.strip()
        if not raw:
            continue
        first_line, _, rest = raw.partition("\n")
        hm = re.match(r"(\d+)\s+&(-?\d+)", first_line)
        if not hm:
            continue
        tid, fid = hm.group(1), hm.group(2)
        if tid == "1":
            nm = re.search(r"m_Name:\s*(.+)", rest)
            act = re.search(r"m_IsActive:\s*(\d+)", rest)
            game_objects[fid] = {
                "name": nm.group(1).strip() if nm else fid,
                "active": (act.group(1) != "0") if act else True,
            }
        elif tid == "4":
            go_id = re.search(r"m_GameObject:\s*\{fileID:\s*(-?\d+)\}", rest).group(1)
            fat_id = re.search(r"m_Father:\s*\{fileID:\s*(-?\d+)\}", rest).group(1)
            pos = parse_inline_dict(re.search(r"m_LocalPosition:\s*\{([^}]+)\}", rest).group(1))
            rot = parse_inline_dict(re.search(r"m_LocalRotation:\s*\{([^}]+)\}", rest).group(1))
            scl = parse_inline_dict(re.search(r"m_LocalScale:\s*\{([^}]+)\}", rest).group(1))
            transforms[fid] = {
                "goId": go_id,
                "fatherId": fat_id,
                "pos": [pos.get("x", 0.0), pos.get("y", 0.0), pos.get("z", 0.0)],
                "rot": [rot.get("x", 0.0), rot.get("y", 0.0), rot.get("z", 0.0), rot.get("w", 1.0)],
                "scale": [scl.get("x", 1.0), scl.get("y", 1.0), scl.get("z", 1.0)],
            }
        elif tid == "198":
            go_id = re.search(r"m_GameObject:\s*\{fileID:\s*(-?\d+)\}", rest).group(1)
            particle_systems[go_id] = rest
        elif tid == "199":
            go_id = re.search(r"m_GameObject:\s*\{fileID:\s*(-?\d+)\}", rest).group(1)
            renderers[go_id] = rest

    # Map goId -> transformId
    go_to_tr = {tr["goId"]: trid for trid, tr in transforms.items()}

    def compute_world_unity(trid):
        tr = transforms[trid]
        if tr["fatherId"] == "0" or tr["fatherId"] not in transforms:
            return list(tr["pos"]), list(tr["rot"]), list(tr["scale"])
        ppos, prot, pscl = compute_world_unity(tr["fatherId"])
        scaled = [tr["pos"][i] * pscl[i] for i in range(3)]
        rpos = quat_rotate_vec(prot, scaled)
        wpos = [ppos[i] + rpos[i] for i in range(3)]
        wrot = quat_mul(prot, tr["rot"])
        wscl = [pscl[i] * tr["scale"][i] for i in range(3)]
        return wpos, wrot, wscl

    emitters = []
    # Preserve hierarchy order: root transform first, then children
    ordered_trids = sorted(transforms.keys(), key=lambda k: (0 if transforms[k]["fatherId"] == "0" else 1))
    for trid in ordered_trids:
        tr = transforms[trid]
        go_id = tr["goId"]
        go = game_objects.get(go_id, {"name": go_id, "active": True})
        if not go["active"]:
            continue
        ps_txt = particle_systems.get(go_id)
        rd_txt = renderers.get(go_id)
        if not ps_txt or not rd_txt:
            continue
        en_m = re.search(r"^\s+m_Enabled:\s*(\d+)", rd_txt, re.M)
        if en_m and en_m.group(1) == "0":
            continue

        # Unity world transform -> Three.js RH (negate Z for positions, (-qx, -qy, qz, qw) for rotations)
        upos, urot, uscl = compute_world_unity(trid)
        three_pos = [round(upos[0], 4), round(upos[1], 4), round(-upos[2], 4)]
        three_quat = [round(-urot[0], 5), round(-urot[1], 5), round(urot[2], 5), round(urot[3], 5)]
        three_scale = [round(uscl[0], 4), round(uscl[1], 4), round(uscl[2], 4)]

        # Core ParticleSystem scalars
        length_sec = float(re.search(r"^\s+lengthInSec:\s*([-+]?[0-9.]+)", ps_txt, re.M).group(1))
        sim_speed = float(re.search(r"^\s+simulationSpeed:\s*([-+]?[0-9.]+)", ps_txt, re.M).group(1))
        looping = re.search(r"^\s+looping:\s*(\d+)", ps_txt, re.M).group(1) == "1"
        prewarm = re.search(r"^\s+prewarm:\s*(\d+)", ps_txt, re.M).group(1) == "1"
        delay_blk = extract_indented_block(ps_txt, "  startDelay:")
        start_delay = parse_minmax_curve(delay_blk)

        # Modules
        init_blk = extract_indented_block(ps_txt, "  InitialModule:")
        shape_blk = extract_indented_block(ps_txt, "  ShapeModule:")
        emis_blk = extract_indented_block(ps_txt, "  EmissionModule:")
        size_blk = extract_indented_block(ps_txt, "  SizeModule:")
        rot_blk = extract_indented_block(ps_txt, "  RotationModule:")
        col_blk = extract_indented_block(ps_txt, "  ColorModule:")
        uv_blk = extract_indented_block(ps_txt, "  UVModule:")
        vel_blk = extract_indented_block(ps_txt, "  VelocityModule:")
        frc_blk = extract_indented_block(ps_txt, "  ForceModule:")

        # InitialModule
        lt = parse_minmax_curve(extract_indented_block(init_blk, "    startLifetime:"))
        spd = parse_minmax_curve(extract_indented_block(init_blk, "    startSpeed:"))
        sz = parse_minmax_curve(extract_indented_block(init_blk, "    startSize:"))
        sz_y = parse_minmax_curve(extract_indented_block(init_blk, "    startSizeY:"))
        sz_z = parse_minmax_curve(extract_indented_block(init_blk, "    startSizeZ:"))
        size3d = "size3D: 1" in init_blk
        rot3d = "rotation3D: 1" in init_blk
        sr_x = parse_minmax_curve(extract_indented_block(init_blk, "    startRotationX:"))
        sr_y = parse_minmax_curve(extract_indented_block(init_blk, "    startRotationY:"))
        sr_z = parse_minmax_curve(extract_indented_block(init_blk, "    startRotation:"))
        grav = parse_minmax_curve(extract_indented_block(init_blk, "    gravityModifier:"))
        scol = parse_minmax_gradient(extract_indented_block(init_blk, "    startColor:"))

        # EmissionModule
        rate_m = parse_minmax_curve(extract_indented_block(emis_blk, "    rateOverTime:"))
        bursts = []
        bursts_blk = extract_indented_block(emis_blk, "    m_Bursts:")
        if bursts_blk:
            for bm in re.finditer(r"time:\s*([-+]?[0-9.]+)[\s\S]*?countCurve:([\s\S]*?)(?=^\s+cycleCount:|\Z)", bursts_blk, re.M):
                cc = parse_minmax_curve(bm.group(2))
                cyc_m = re.search(r"cycleCount:\s*(\d+)", bursts_blk[bm.end():bm.end() + 120])
                rep_m = re.search(r"repeatInterval:\s*([-+]?[0-9.]+)", bursts_blk[bm.end():bm.end() + 160])
                bursts.append({
                    "time": round(float(bm.group(1)), 4),
                    "minCount": max(0, int(round(cc["min"]))),
                    "maxCount": max(0, int(round(cc["max"]))),
                    "cycles": int(cyc_m.group(1)) if cyc_m else 1,
                    "interval": float(rep_m.group(1)) if rep_m else 0.0,
                })

        # ShapeModule
        shape_enabled = "enabled: 1" in shape_blk
        stype = int(re.search(r"^\s+type:\s*(\d+)", shape_blk, re.M).group(1)) if re.search(r"^\s+type:\s*(\d+)", shape_blk, re.M) else 4
        s_angle = float(re.search(r"^\s+angle:\s*([-+]?[0-9.]+)", shape_blk, re.M).group(1)) if re.search(r"^\s+angle:\s*([-+]?[0-9.]+)", shape_blk, re.M) else 25.0
        s_rad_m = re.search(r"radius:\s*\n\s*value:\s*([-+]?[0-9.]+)", shape_blk)
        s_rad = float(s_rad_m.group(1)) if s_rad_m else 1.0
        s_arc_m = re.search(r"arc:\s*\n\s*value:\s*([-+]?[0-9.]+)", shape_blk)
        s_arc = float(s_arc_m.group(1)) if s_arc_m else 360.0
        s_scl_m = re.search(r"m_Scale:\s*\{([^}]+)\}", shape_blk)
        s_scl = parse_inline_dict(s_scl_m.group(1)) if s_scl_m else {"x": 1, "y": 1, "z": 1}
        s_rand_dir_m = re.search(r"randomDirectionAmount:\s*([-+]?[0-9.]+)", shape_blk)
        s_sph_dir_m = re.search(r"sphericalDirectionAmount:\s*([-+]?[0-9.]+)", shape_blk)

        # SizeOverLifetime
        size_over_life = None
        if "enabled: 1" in size_blk:
            sep = "separateAxes: 1" in size_blk
            sx = parse_minmax_curve(extract_indented_block(size_blk, "    curve:"))
            sy = parse_minmax_curve(extract_indented_block(size_blk, "    y:")) if sep else sx
            sz_c = parse_minmax_curve(extract_indented_block(size_blk, "    z:")) if sep else sx
            size_over_life = {"separateAxes": sep, "x": sx, "y": sy, "z": sz_c}

        # RotationOverLifetime
        rot_over_life = None
        if "enabled: 1" in rot_blk:
            sep_r = "separateAxes: 1" in rot_blk
            rx = parse_minmax_curve(extract_indented_block(rot_blk, "    x:")) if sep_r else None
            ry = parse_minmax_curve(extract_indented_block(rot_blk, "    y:")) if sep_r else None
            rz = parse_minmax_curve(extract_indented_block(rot_blk, "    curve:"))
            rot_over_life = {"separateAxes": sep_r, "x": rx, "y": ry, "z": rz}

        # ColorOverLifetime
        color_over_life = None
        if "enabled: 1" in col_blk:
            color_over_life = parse_minmax_gradient(extract_indented_block(col_blk, "    gradient:"))

        # UVModule (TextureSheetAnimation)
        uv_anim = None
        if "enabled: 1" in uv_blk:
            tx = int(re.search(r"tilesX:\s*(\d+)", uv_blk).group(1))
            ty = int(re.search(r"tilesY:\s*(\d+)", uv_blk).group(1))
            cyc = int(re.search(r"cycles:\s*(\d+)", uv_blk).group(1)) if re.search(r"cycles:\s*(\d+)", uv_blk) else 1
            fot = parse_minmax_curve(extract_indented_block(uv_blk, "    frameOverTime:"))
            uv_anim = {"tilesX": tx, "tilesY": ty, "cycles": cyc, "frameOverTime": fot}

        # Velocity & Force
        vel_over_life = None
        if "enabled: 1" in vel_blk:
            vel_over_life = {
                "x": parse_minmax_curve(extract_indented_block(vel_blk, "    x:")),
                "y": parse_minmax_curve(extract_indented_block(vel_blk, "    y:")),
                "z": parse_minmax_curve(extract_indented_block(vel_blk, "    z:")),
                "worldSpace": "inWorldSpace: 1" in vel_blk,
            }
        force_over_life = None
        if "enabled: 1" in frc_blk:
            force_over_life = {
                "x": parse_minmax_curve(extract_indented_block(frc_blk, "    x:")),
                "y": parse_minmax_curve(extract_indented_block(frc_blk, "    y:")),
                "z": parse_minmax_curve(extract_indented_block(frc_blk, "    z:")),
                "worldSpace": "inWorldSpace: 1" in frc_blk,
            }

        # Renderer
        rmode = int(re.search(r"m_RenderMode:\s*(\d+)", rd_txt).group(1))
        ralign = int(re.search(r"m_RenderAlignment:\s*(\d+)", rd_txt).group(1)) if re.search(r"m_RenderAlignment:\s*(\d+)", rd_txt) else 0
        vscale = float(re.search(r"m_VelocityScale:\s*([-+]?[0-9.]+)", rd_txt).group(1))
        lscale = float(re.search(r"m_LengthScale:\s*([-+]?[0-9.]+)", rd_txt).group(1))
        pv_m = re.search(r"m_Pivot:\s*\{([^}]+)\}", rd_txt)
        pivot = parse_inline_dict(pv_m.group(1)) if pv_m else {"x": 0, "y": 0, "z": 0}

        mat_m = re.search(r"m_Materials:\s*\n\s*-\s*\{[^}]*guid:\s*([a-f0-9]{32})", rd_txt)
        mat_path = guid_map.get(mat_m.group(1)) if mat_m else None
        mat_info = parse_material(mat_path, guid_map, tex_out_dir)

        mesh_kind = None
        mesh_url = None
        mesh_global_scale = 1.0
        if rmode == 4:
            mesh_m = re.search(r"m_Mesh:\s*\{fileID:\s*(-?\d+)(?:,\s*guid:\s*([a-f0-9]{32}))?", rd_txt)
            if mesh_m:
                mfid = mesh_m.group(1)
                mguid = mesh_m.group(2)
                if mfid == "10210":
                    mesh_kind = "quad"
                elif mguid and mguid in guid_map:
                    fbx_path = guid_map[mguid]
                    if fbx_path not in exported_meshes:
                        exported_meshes[fbx_path] = convert_fbx_to_glb(fbx_path, mesh_out_dir)
                    mrec = exported_meshes[fbx_path]
                    if mrec:
                        mesh_kind = "glb"
                        mesh_url = mrec["url"]
                        mesh_global_scale = mrec["globalScale"]

        emitters.append({
            "name": go["name"],
            "transform": {
                "position": three_pos,
                "quaternion": three_quat,
                "scale": three_scale,
            },
            "duration": round(length_sec, 4),
            "simulationSpeed": round(sim_speed, 4),
            "looping": looping,
            "prewarm": prewarm,
            "startDelay": start_delay,
            "lifetime": lt,
            "startSpeed": spd,
            "startSize": sz,
            "startSize3D": size3d,
            "startSizeY": sz_y,
            "startSizeZ": sz_z,
            "startRotation3D": rot3d,
            "startRotationX": sr_x,
            "startRotationY": sr_y,
            "startRotation": sr_z,
            "gravityModifier": grav,
            "startColor": scol,
            "rateOverTime": rate_m,
            "bursts": bursts,
            "shape": {
                "enabled": shape_enabled,
                "type": stype,
                "angle": round(s_angle, 3),
                "radius": round(s_rad, 4),
                "arc": round(s_arc, 3),
                "scale": [s_scl.get("x", 1.0), s_scl.get("y", 1.0), s_scl.get("z", 1.0)],
                "randomDirectionAmount": float(s_rand_dir_m.group(1)) if s_rand_dir_m else 0.0,
                "sphericalDirectionAmount": float(s_sph_dir_m.group(1)) if s_sph_dir_m else 0.0,
            },
            "sizeOverLifetime": size_over_life,
            "rotationOverLifetime": rot_over_life,
            "colorOverLifetime": color_over_life,
            "uvAnimation": uv_anim,
            "velocityOverLifetime": vel_over_life,
            "forceOverLifetime": force_over_life,
            "renderer": {
                "mode": rmode,  # 0:Billboard, 1:Stretched, 2:Horizontal, 3:Vertical, 4:Mesh
                "alignment": ralign,  # 0:View, 1:World, 2:Local, 3:Facing, 4:Velocity
                "velocityScale": round(vscale, 4),
                "lengthScale": round(lscale, 4),
                "pivot": [pivot.get("x", 0.0), pivot.get("y", 0.0), pivot.get("z", 0.0)],
                "meshKind": mesh_kind,
                "meshUrl": mesh_url,
                "meshGlobalScale": mesh_global_scale,
                "blend": mat_info["blend"],
                "tint": mat_info["tint"],
                "textureUrl": mat_info["textureUrl"],
            },
        })

    # Build HGame native createVfxSystem preset mapping
    primary = emitters[0] if emitters else {}
    sc_rgb = primary.get("startColor", {}).get("colorMax", [1, 1, 1])
    if primary.get("colorOverLifetime"):
        cks = primary["colorOverLifetime"]["gradient"]["colorKeys"]
        if len(cks) > 1:
            sc_rgb = cks[1][1]
        elif cks:
            sc_rgb = cks[0][1]
    hex_col = "#{:02x}{:02x}{:02x}".format(
        max(0, min(255, int(round(sc_rgb[0] * 255)))),
        max(0, min(255, int(round(sc_rgb[1] * 255)))),
        max(0, min(255, int(round(sc_rgb[2] * 255)))),
    )
    cat = prefab_spec["category"]
    recipe = "slash" if cat == "刀光轨迹" else ("telegraph" if cat == "法阵光环" else "burst")
    element = "fire" if cat == "火焰爆破" else ("ice" if "Blue" in prefab_spec["rel"] else "physical")
    shape_id = 3 if recipe == "telegraph" else (4 if recipe == "slash" else 1)

    asset_name = os.path.splitext(os.path.basename(prefab_spec["rel"]))[0]
    return {
        "id": clean_id(f"EpicToonFX__{asset_name}"),
        "name": prefab_spec["name"],
        "assetName": asset_name,
        "pack": "Epic Toon FX",
        "sourceType": "unity",
        "kind": "system",
        "category": cat,
        "loop": any(e["looping"] for e in emitters),
        "duration": round(max((e["duration"] for e in emitters), default=1.0), 2),
        "emitterCount": len(emitters),
        "emitters": emitters,
        "hgamePreset": {
            "recipe": recipe,
            "element": element,
            "color": hex_col,
            "colorInt": int(hex_col[1:], 16),
            "shapeId": shape_id,
            "count": 22,
            "speedMin": 2.5,
            "speedMax": 7.5,
            "sizeStart": round(max(0.15, min(1.0, primary.get("startSize", {}).get("max", 0.4) * 0.25)), 2),
            "sizeEnd": 0.05,
            "durationMin": 0.25,
            "durationMax": round(max(0.35, min(1.4, primary.get("lifetime", {}).get("max", 0.6))), 2),
            "gravity": 3.0 if recipe == "burst" else 0.0,
            "drag": 2.2,
            "additive": True,
            "meshUrl": next((e["renderer"]["meshUrl"] for e in emitters if e["renderer"]["meshUrl"]), None),
        },
    }


def main():
    if os.path.isdir(OUT_ROOT):
        shutil.rmtree(OUT_ROOT)
    tex_out_dir = os.path.join(OUT_ROOT, "textures")
    mesh_out_dir = os.path.join(OUT_ROOT, "meshes")
    os.makedirs(tex_out_dir, exist_ok=True)
    os.makedirs(mesh_out_dir, exist_ok=True)

    guid_map = build_guid_index(UNITY_ASSETS_ROOT)
    exported_meshes = {}
    systems = []
    for spec in TARGET_PREFABS:
        sys_rec = parse_prefab(spec, guid_map, tex_out_dir, mesh_out_dir, exported_meshes)
        systems.append(sys_rec)

    vfx_meshes = [
        {
            "id": m["id"],
            "name": m["name"],
            "assetName": m["assetName"],
            "pack": "Epic Toon FX",
            "kind": "mesh",
            "category": "3D 特效网格",
            "meshCount": 1,
            "bytes": m["bytes"],
            "url": m["url"],
        }
        for m in exported_meshes.values()
        if m
    ]

    vfx_textures = []
    for fn in sorted(os.listdir(tex_out_dir)):
        abs_p = os.path.join(tex_out_dir, fn)
        m_uv = re.search(r"(\d+)x(\d+)", fn.lower())
        cols = int(m_uv.group(1)) if m_uv else 1
        rows = int(m_uv.group(2)) if m_uv else 1
        vfx_textures.append({
            "id": clean_id(f"EpicToonFX__{os.path.splitext(fn)[0]}"),
            "name": os.path.splitext(fn)[0],
            "assetName": os.path.splitext(fn)[0],
            "pack": "Epic Toon FX",
            "kind": "flipbook" if (cols > 1 or rows > 1) else "sprite",
            "category": "粒子与序列帧贴图",
            "columns": cols,
            "rows": rows,
            "fps": 16 if (cols > 1 or rows > 1) else 8,
            "bytes": os.path.getsize(abs_p),
            "url": f"/files/hgame-unity/textures/{fn}",
        })

    catalog = {
        "version": 1,
        "sourceEngine": "unity",
        "sourceProject": UNITY_ASSETS_ROOT,
        "vfxSystems": systems,
        "vfxMeshes": vfx_meshes,
        "vfxTextures": vfx_textures,
    }
    out_catalog = os.path.join(OUT_ROOT, "catalog.json")
    with open(out_catalog, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    print(json.dumps({
        "vfxSystems": len(systems),
        "vfxMeshes": len(vfx_meshes),
        "vfxTextures": len(vfx_textures),
        "out": out_catalog,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
