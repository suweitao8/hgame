"""Headless Blender script: probe MPFB2 APIs and index user_data assets into JSON."""

import argparse
import inspect
import json
import os
import re
import sys
from pathlib import Path


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser(description="Index MPFB2 assets for HGame")
    parser.add_argument("--user-data", required=True, help="Path to vendor/mpfb2/user_data")
    parser.add_argument("--out", required=True, help="Output mpfb-assets-index.json path")
    parser.add_argument("--probe-out", default="", help="Optional API probe JSON output path")
    parser.add_argument("--extract-zips", default="", help="Optional JSON list of {zip, pack, license} to extract before indexing")
    return parser.parse_args(argv)


def import_mpfb_services():
    try:
        from bl_ext.user_default.mpfb.services import (
            AssetService,
            ClothesService,
            HumanService,
            LocationService,
            MaterialService,
            ObjectService,
            RigService,
            TargetService,
        )
        ns = "bl_ext.user_default.mpfb"
    except ImportError:
        from mpfb.services import (
            AssetService,
            ClothesService,
            HumanService,
            LocationService,
            MaterialService,
            ObjectService,
            RigService,
            TargetService,
        )
        ns = "mpfb"
    return ns, {
        "AssetService": AssetService,
        "ClothesService": ClothesService,
        "HumanService": HumanService,
        "LocationService": LocationService,
        "MaterialService": MaterialService,
        "ObjectService": ObjectService,
        "RigService": RigService,
        "TargetService": TargetService,
    }


def probe_services(ns, services, user_data_dir):
    import bpy

    api_report = {
        "blenderVersion": list(bpy.app.version),
        "blenderVersionString": bpy.app.version_string,
        "mpfbNamespace": ns,
        "mpfbDataDir": services["LocationService"].get_mpfb_data(),
        "defaultUserDataDir": services["LocationService"].get_user_data(),
        "configuredUserDataDir": os.path.abspath(user_data_dir),
        "services": {},
    }
    for svc_name, cls in services.items():
        methods = {}
        for attr_name in sorted(dir(cls)):
            if attr_name.startswith("_"):
                continue
            attr = getattr(cls, attr_name, None)
            if callable(attr):
                try:
                    sig = str(inspect.signature(attr))
                except Exception:
                    sig = "(...)"
                methods[attr_name] = sig
        api_report["services"][svc_name] = methods
    return api_report


def extract_pack_zips(services, extract_json_path, user_data_dir):
    import shutil
    import tempfile
    import zipfile

    with open(extract_json_path, "r", encoding="utf-8") as f:
        items = json.load(f)

    AssetService = services["AssetService"]
    os.makedirs(user_data_dir, exist_ok=True)
    registry_path = os.path.join(user_data_dir, ".pack_registry.json")
    registry = {}
    if os.path.isfile(registry_path):
        try:
            with open(registry_path, "r", encoding="utf-8") as f:
                registry = json.load(f)
        except Exception:
            registry = {}

    asset_root_names = {
        "clothes",
        "hair",
        "proxymeshes",
        "eyes",
        "skins",
        "teeth",
        "eyebrows",
        "eyelashes",
        "tongue",
        "packs",
        "materials",
        "targets",
        "rigs",
    }

    for entry in items:
        zip_path = entry["zip"]
        pack_name = entry["pack"]
        license_hint = entry.get("license", "CC0")
        if not os.path.isfile(zip_path):
            continue

        # Track files present in the zip to map assets -> pack even if packs/*.json is missing
        pack_files = []
        with zipfile.ZipFile(zip_path, "r") as zf:
            before = []
            for info in zf.infolist():
                if info.is_dir() or info.filename.startswith("__MACOSX"):
                    continue
                before.append(info.filename.replace("\\", "/"))

            err = AssetService.fix_and_extract_asset_pack_zip(zip_path, user_data_dir)
            if err:
                # Fallback extractor for packs without a top-level `packs/` directory
                tmp_dir = tempfile.mkdtemp()
                try:
                    for member in zf.infolist():
                        if member.filename.startswith("__MACOSX"):
                            continue
                        zf.extract(member, tmp_dir)
                    src_root = tmp_dir
                    entries = [e for e in os.listdir(tmp_dir) if not e.startswith(".")]
                    if len(entries) == 1 and os.path.isdir(os.path.join(tmp_dir, entries[0])):
                        inner = os.path.join(tmp_dir, entries[0])
                        inner_entries = set(os.listdir(inner))
                        if inner_entries & asset_root_names:
                            src_root = inner
                    for item in os.listdir(src_root):
                        if item.startswith("."):
                            continue
                        s = os.path.join(src_root, item)
                        d = os.path.join(user_data_dir, item)
                        if os.path.isdir(s):
                            shutil.copytree(s, d, dirs_exist_ok=True)
                        else:
                            shutil.copy2(s, d)
                finally:
                    shutil.rmtree(tmp_dir, ignore_errors=True)

            # Determine normalized relative paths extracted under user_data_dir
            first_segments = {p.split("/", 1)[0] for p in before if "/" in p}
            strip_prefix = ""
            if len(first_segments) == 1:
                only = next(iter(first_segments))
                if only not in asset_root_names:
                    strip_prefix = only + "/"
            for p in before:
                rel = p[len(strip_prefix) :] if strip_prefix and p.startswith(strip_prefix) else p
                pack_files.append(rel)

        registry[pack_name] = {
            "pack": pack_name,
            "license": license_hint,
            "files": sorted(set(pack_files)),
        }

    with open(registry_path, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)


def configure_second_root(services, user_data_dir):
    import bpy

    abs_dir = os.path.abspath(user_data_dir)
    prefs_addon = bpy.context.preferences.addons.get("bl_ext.user_default.mpfb")
    if prefs_addon and hasattr(prefs_addon.preferences, "mpfb_second_root"):
        prefs_addon.preferences.mpfb_second_root = abs_dir
        try:
            bpy.ops.wm.save_userpref()
        except Exception:
            pass
    try:
        from bl_ext.user_default.mpfb.ui.apply_assets.assetlibrary.assetsettingspanel import (
            ASSET_SETTINGS_PROPERTIES,
        )
        ASSET_SETTINGS_PROPERTIES.set_value("second_root", abs_dir, entity_reference=bpy.context.scene)
    except Exception:
        pass
    try:
        services["AssetService"].update_all_asset_lists()
    except Exception:
        pass


def count_obj_geometry(obj_path):
    if not obj_path or not os.path.isfile(obj_path):
        return 0, 0
    verts = 0
    tris = 0
    try:
        with open(obj_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("v "):
                    verts += 1
                elif line.startswith("f "):
                    parts = line.split()
                    n = len(parts) - 1
                    if n >= 3:
                        tris += n - 2
    except Exception:
        return 0, 0
    return tris, verts


def image_has_meaningful_alpha(img_path):
    if not img_path or not os.path.isfile(img_path):
        return False
    try:
        from PIL import Image

        with Image.open(img_path) as im:
            if im.mode in ("RGBA", "LA") or ("transparency" in im.info):
                rgba = im.convert("RGBA")
                alpha = rgba.getchannel("A")
                extrema = alpha.getextrema()
                if extrema and extrema[0] < 200:
                    small = alpha.resize((64, 64))
                    hist = small.histogram()
                    transparent_px = sum(hist[:180])
                    # Real alpha hair cards / lace always have significant cutout (>3% transparent pixels)
                    return transparent_px >= int(64 * 64 * 0.03)
    except Exception:
        return False
    return False


def parse_mhmat(mhmat_path):
    info = {
        "diffuseColor": None,
        "diffuseTexture": "",
        "normalmapTexture": "",
        "roughness": None,
        "transparent": False,
        "alphaToCoverage": False,
        "backfaceCull": True,
        "opacity": 1.0,
        "shader": "",
        "license": "",
        "author": "",
        "hasAlphaCards": False,
    }
    if not mhmat_path or not os.path.isfile(mhmat_path):
        return info
    base_dir = os.path.dirname(mhmat_path)
    try:
        with open(mhmat_path, "r", encoding="utf-8", errors="ignore") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or line.startswith("//"):
                    continue
                parts = line.split(None, 1)
                if len(parts) < 2:
                    continue
                key, val = parts[0].strip(), parts[1].strip()
                kl = key.lower()
                if kl == "diffusecolor":
                    try:
                        info["diffuseColor"] = [float(x) for x in val.split()[:3]]
                    except Exception:
                        pass
                elif kl == "diffusetexture":
                    info["diffuseTexture"] = val
                elif kl == "normalmaptexture":
                    info["normalmapTexture"] = val
                elif kl == "roughness":
                    try:
                        info["roughness"] = float(val)
                    except Exception:
                        pass
                elif kl == "opacity":
                    try:
                        info["opacity"] = float(val)
                    except Exception:
                        pass
                elif kl == "transparent":
                    info["transparent"] = val.lower() in ("true", "1", "yes")
                elif kl == "alphatocoverage":
                    info["alphaToCoverage"] = val.lower() in ("true", "1", "yes")
                elif kl == "backfacecull":
                    info["backfaceCull"] = val.lower() not in ("false", "0", "no")
                elif kl == "shader":
                    info["shader"] = val
                elif kl == "license":
                    info["license"] = val
                elif kl == "author":
                    info["author"] = val
                elif kl == "alphamaptexture" and val:
                    info["hasAlphaCards"] = True
    except Exception:
        return info

    diff_abs = ""
    if info["diffuseTexture"]:
        cand = os.path.join(base_dir, info["diffuseTexture"])
        if os.path.isfile(cand):
            diff_abs = cand
    png_has_alpha = bool(diff_abs and image_has_meaningful_alpha(diff_abs))
    if png_has_alpha or info["transparent"] or info["alphaToCoverage"]:
        info["hasAlphaCards"] = True
    return info


def parse_mh_asset_file(file_path):
    meta = {
        "name": Path(file_path).stem,
        "uuid": "",
        "objFile": "",
        "material": "",
        "author": "",
        "license": "",
        "homepage": "",
        "description": "",
        "tags": [],
        "zDepth": 0,
        "hasDeleteGroup": False,
    }
    in_delete = False
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if line.lower() == "delete_verts":
                    meta["hasDeleteGroup"] = True
                    in_delete = True
                    continue
                if in_delete:
                    if not (line[0].isdigit() or line.startswith("-")):
                        in_delete = False
                    else:
                        continue
                parts = line.split(None, 1)
                if len(parts) < 2:
                    continue
                k, v = parts[0].strip().lower(), parts[1].strip()
                if k == "name":
                    meta["name"] = v
                elif k == "uuid":
                    meta["uuid"] = v
                elif k == "obj_file":
                    meta["objFile"] = v
                elif k == "material":
                    meta["material"] = v
                elif k == "author":
                    meta["author"] = v
                elif k == "license":
                    meta["license"] = v
                elif k == "homepage":
                    meta["homepage"] = v
                elif k == "description":
                    meta["description"] = v
                elif k == "z_depth":
                    try:
                        meta["zDepth"] = int(v)
                    except Exception:
                        pass
                elif k == "tag":
                    for t in re.split(r"[,;\s]+", v):
                        t = t.strip().lower()
                        if t:
                            meta["tags"].append(t)
    except Exception:
        pass
    return meta


def build_pack_lookup(user_data_dir):
    file_to_pack = {}
    pack_meta = {}

    packs_dir = os.path.join(user_data_dir, "packs")
    if os.path.isdir(packs_dir):
        for fn in sorted(os.listdir(packs_dir)):
            if not fn.endswith(".json"):
                continue
            p = os.path.join(packs_dir, fn)
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                pack_name = Path(fn).stem
                lic = str(data.get("license", "")).strip() or (
                    "CC0" if ("01" in pack_name or pack_name in ("suits02", "makehuman_system_assets", "skins02")) else "CC-BY"
                )
                auth = str(data.get("author", "")).strip()
                pack_meta[pack_name] = {"license": lic, "author": auth}
                for rel in data.get("files", []):
                    norm = rel.replace("\\", "/").lstrip("./").lower()
                    file_to_pack[norm] = pack_name
            except Exception:
                pass

    reg_path = os.path.join(user_data_dir, ".pack_registry.json")
    if os.path.isfile(reg_path):
        try:
            with open(reg_path, "r", encoding="utf-8") as f:
                reg = json.load(f)
            for pack_name, entry in reg.items():
                lic = entry.get("license", "CC0")
                if pack_name not in pack_meta:
                    pack_meta[pack_name] = {"license": lic, "author": ""}
                for rel in entry.get("files", []):
                    norm = rel.replace("\\", "/").lstrip("./").lower()
                    file_to_pack.setdefault(norm, pack_name)
        except Exception:
            pass

    return file_to_pack, pack_meta


def infer_slot(top_dir, rel_path, name, tags, pack_name=""):
    top = top_dir.lower()
    raw_hay = f"{rel_path} {name} {' '.join(tags)} {pack_name}".lower()
    hay = re.sub(r"[^a-z0-9]+", " ", raw_hay)
    pl = (pack_name or "").lower()
    if top == "proxymeshes":
        return "proxy"
    if top == "skins":
        return "skin"
    if top in ("eyes", "teeth", "eyebrows", "eyelashes", "tongue"):
        return top
    if top == "hair":
        return "hair"

    # Explicit garment/item keywords first so mixed packs (e.g. suits02 pants) classify cleanly
    if re.search(r"\b(glass|glasses|eyeglass|sunglass|goggle|monocle|visor)\b", hay):
        return "glasses"
    if re.search(r"\b(hat|cap|helmet|beret|crown|hood|beanie|headgear)\b", hay):
        return "hat"
    if re.search(r"\b(glove|gloves|gauntlet|mitten)\b", hay):
        return "gloves"
    if re.search(r"\b(mask|masks|respirator|bandana)\b", hay):
        return "mask"
    if re.search(r"\b(shoe|shoes|boot|boots|sneaker|heel|sandal|slipper|footwear|loafers|saddleshoes)\b", hay):
        return "shoes"
    if re.search(r"\b(ear|ears|tail|wing|wings|horn|horns|bodypart)\b", hay):
        return "bodyparts"
    if re.search(r"\b(sword|shield|bag|backpack|suitcase|holster|belt|scarf|cape|cloak|weapon|equipment|kalistick|hammer|dagger)\b", hay):
        return "equipment"
    if re.search(r"\b(pant|pants|trouser|trousers|jeans|short|shorts|trunks|skirt|pskirt|legging|bottom)\b", hay):
        return "bottom"
    if re.search(r"\b(shirt|tshirt|tee|jacket|coat|hoodie|sweater|vest|blouse|top|bodice|cardigan|blazer|lusekofta|tunic)\b", hay):
        return "top"
    if re.search(r"\b(dress|gown|robe)\b", hay):
        return "dress"
    if re.search(r"\b(suit|suits|tuxedo|uniform|armor|overalls|jumpsuit|outfit|casualsuit)\b", hay):
        return "suit"

    # Pack-level fallback
    if pl.startswith("glasses"): return "glasses"
    if pl.startswith("hats"): return "hat"
    if pl.startswith("gloves"): return "gloves"
    if pl.startswith("masks"): return "mask"
    if pl.startswith("shoes"): return "shoes"
    if pl.startswith("bodyparts"): return "bodyparts"
    if pl.startswith("equipment"): return "equipment"
    if pl.startswith("dress"): return "dress"
    if pl.startswith("suits"): return "suit"
    if pl.startswith("skirts") or pl.startswith("pants"): return "bottom"
    if pl.startswith("shirts"): return "top"
    return "clothes"


def tokenize_tags(rel_path, name, pack, license_str, raw_tags, slot):
    tokens = set()
    tokens.add(slot)
    if pack:
        tokens.add(pack.lower())
    tokens.add(license_str.lower())
    for chunk in [rel_path, name]:
        for t in re.split(r"[^a-zA-Z0-9]+", chunk):
            tl = t.strip().lower()
            if len(tl) >= 2 and tl not in ("mhclo", "proxy", "mhmat", "user", "data"):
                tokens.add(tl)
    for t in raw_tags:
        if len(t) >= 2:
            tokens.add(t.lower())
    return sorted(tokens)


def normalize_license(raw_lic, pack_name, pack_meta):
    s = (raw_lic or "").strip().upper()
    if "CC0" in s or "PUBLIC DOMAIN" in s:
        return "CC0"
    if "CC-BY" in s or "CC BY" in s:
        return "CC-BY"
    if pack_name and pack_name in pack_meta:
        pl = pack_meta[pack_name].get("license", "").upper()
        if "CC0" in pl:
            return "CC0"
        if "CC-BY" in pl or "CC BY" in pl:
            return "CC-BY"
    if pack_name:
        if pack_name.endswith("01") or pack_name in ("suits02", "makehuman_system_assets", "skins02"):
            return "CC0"
        return "CC-BY"
    return "CC0"


def scan_user_data(user_data_dir):
    file_to_pack, pack_meta = build_pack_lookup(user_data_dir)
    scan_dirs = [
        ("clothes", ".mhclo"),
        ("hair", ".mhclo"),
        ("proxymeshes", ".proxy"),
        ("eyes", ".mhclo"),
        ("eyebrows", ".mhclo"),
        ("eyelashes", ".mhclo"),
        ("teeth", ".mhclo"),
        ("tongue", ".mhclo"),
        ("skins", ".mhmat"),
    ]

    assets = []
    seen_ids = set()

    for top_dir, ext in scan_dirs:
        root_dir = os.path.join(user_data_dir, top_dir)
        if not os.path.isdir(root_dir):
            continue
        for cur_root, _, files in os.walk(root_dir):
            for fn in sorted(files):
                if not fn.lower().endswith(ext):
                    continue
                abs_path = os.path.join(cur_root, fn)
                rel_path = os.path.relpath(abs_path, user_data_dir).replace("\\", "/")
                norm_rel = rel_path.lower()
                pack_name = file_to_pack.get(norm_rel, "")

                if ext == ".mhmat":
                    mat_info = parse_mhmat(abs_path)
                    raw_lic = mat_info["license"]
                    author = mat_info["author"] or (pack_meta.get(pack_name, {}).get("author", "") if pack_name else "")
                    lic = normalize_license(raw_lic, pack_name, pack_meta)
                    name = Path(fn).stem
                    slot = infer_slot(top_dir, rel_path, name, [], pack_name)
                    tris, verts = 0, 0
                    has_alpha = False
                    game_ready = True
                    high_poly = False
                    tags = tokenize_tags(rel_path, name, pack_name, lic, [], slot)
                else:
                    meta = parse_mh_asset_file(abs_path)
                    base_dir = os.path.dirname(abs_path)
                    obj_path = os.path.join(base_dir, meta["objFile"]) if meta["objFile"] else ""
                    if not obj_path or not os.path.isfile(obj_path):
                        alt_obj = os.path.splitext(abs_path)[0] + ".obj"
                        if os.path.isfile(alt_obj):
                            obj_path = alt_obj
                    tris, verts = count_obj_geometry(obj_path)

                    mat_path = os.path.join(base_dir, meta["material"]) if meta["material"] else ""
                    if not mat_path or not os.path.isfile(mat_path):
                        alt_mat = os.path.splitext(abs_path)[0] + ".mhmat"
                        if os.path.isfile(alt_mat):
                            mat_path = alt_mat
                    mat_info = parse_mhmat(mat_path)

                    lic = normalize_license(meta["license"] or mat_info["license"], pack_name, pack_meta)
                    author = (
                        meta["author"]
                        or mat_info["author"]
                        or (pack_meta.get(pack_name, {}).get("author", "") if pack_name else "")
                    )
                    slot = infer_slot(top_dir, rel_path, meta["name"], meta["tags"], pack_name)
                    has_alpha = bool(mat_info["hasAlphaCards"])

                    # Detect low-poly / stylized suitability
                    if slot == "hair":
                        high_poly = tris > 8000
                        game_ready = (not has_alpha) and tris > 0 and tris <= 8000
                    elif slot in ("eyes", "eyebrows", "eyelashes", "teeth", "tongue"):
                        high_poly = tris > 4000
                        game_ready = tris > 0 and tris <= 4000
                    elif slot == "proxy":
                        high_poly = tris > 12000
                        game_ready = tris > 0 and tris <= 12000
                    elif slot == "glasses":
                        high_poly = tris > 4500
                        game_ready = tris > 0 and tris <= 4500
                    elif slot in ("hat", "gloves", "mask", "shoes", "equipment", "bodyparts"):
                        high_poly = tris > 4000
                        game_ready = (not has_alpha) and tris > 0 and tris <= 4000
                    else:
                        high_poly = tris > 6500
                        game_ready = (not has_alpha) and tris > 0 and tris <= 6500

                    tags = tokenize_tags(rel_path, meta["name"], pack_name, lic, meta["tags"], slot)

                # Stable assetId: <top_dir>/<folder_or_stem>
                rel_no_ext = os.path.splitext(rel_path)[0]
                parts = rel_no_ext.split("/")
                if len(parts) >= 2 and parts[-1] == parts[-2]:
                    asset_id = "/".join(parts[:-1])
                else:
                    asset_id = rel_no_ext
                asset_id = re.sub(r"[^a-zA-Z0-9/_-]+", "_", asset_id).lower()
                if asset_id in seen_ids:
                    idx = 2
                    while f"{asset_id}_{idx}" in seen_ids:
                        idx += 1
                    asset_id = f"{asset_id}_{idx}"
                seen_ids.add(asset_id)

                assets.append(
                    {
                        "assetId": asset_id,
                        "name": Path(rel_path).stem if ext == ".mhmat" else meta["name"],
                        "slot": slot,
                        "category": top_dir,
                        "ext": ext,
                        "relPath": rel_path,
                        "pack": pack_name or "unknown",
                        "license": lic,
                        "author": author,
                        "tris": tris,
                        "verts": verts,
                        "hasAlphaCards": has_alpha,
                        "gameReady": game_ready,
                        "highPoly": high_poly,
                        "tags": tags,
                    }
                )

    assets.sort(key=lambda a: (a["slot"], 0 if a["gameReady"] else 1, a["tris"], a["assetId"]))

    slot_counts = {}
    license_counts = {}
    game_ready_count = 0
    for a in assets:
        slot_counts[a["slot"]] = slot_counts.get(a["slot"], 0) + 1
        license_counts[a["license"]] = license_counts.get(a["license"], 0) + 1
        if a["gameReady"]:
            game_ready_count += 1

    return {
        "schemaVersion": 1,
        "userDataDir": os.path.abspath(user_data_dir).replace("\\", "/"),
        "totalAssets": len(assets),
        "gameReadyAssets": game_ready_count,
        "slotCounts": slot_counts,
        "licenseCounts": license_counts,
        "assets": assets,
    }


def main():
    args = parse_args()
    ns, services = import_mpfb_services()
    user_data_dir = os.path.abspath(args.user_data)

    if args.extract_zips:
        extract_pack_zips(services, os.path.abspath(args.extract_zips), user_data_dir)

    configure_second_root(services, user_data_dir)

    if args.probe_out:
        probe = probe_services(ns, services, user_data_dir)
        os.makedirs(os.path.dirname(os.path.abspath(args.probe_out)), exist_ok=True)
        with open(args.probe_out, "w", encoding="utf-8") as f:
            json.dump(probe, f, indent=2, ensure_ascii=False)

    index = scan_user_data(user_data_dir)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)

    print(
        f"[index_mpfb_assets] total={index['totalAssets']} gameReady={index['gameReadyAssets']} "
        f"slots={json.dumps(index['slotCounts'], ensure_ascii=False)}"
    )


if __name__ == "__main__":
    main()
