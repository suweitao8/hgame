"""
Read-only Unreal Engine 5.8 Python batch exporter for HGame Milestone 2 assets:
  1. AmplifyLUTPack (all Texture2D LUTs + metadata)
  2. AdvancedGlassPack (curated glass masks/normals + SM_GlassPieces_Single_01..09 GLBs)
  3. UWC_Bullet_Holes (curated non-POM bullet & melee decal MIs + referenced textures)
  4. RealisticBloodDecals (all MI_BloodSplatter_* + T_Blood_Splatter_* textures + metadata)

Source content under D:/UnrealWorkspace/Anim58/Content is NEVER modified.
All outputs go to D:/UnrealWorkspace/Anim58/Saved/WebAssetExport/milestone2_staging.
"""

import json
import os
import unreal

STAGING_ROOT = os.environ.get(
    "HGAME_M2_STAGING",
    r"D:\UnrealWorkspace\Anim58\Saved\WebAssetExport\milestone2_staging",
)
os.makedirs(STAGING_ROOT, exist_ok=True)

ar = unreal.AssetRegistryHelpers.get_asset_registry()


def ensure_dir(path_str):
    os.makedirs(path_str, exist_ok=True)


def export_texture_png(asset_obj, out_png_abs):
    ensure_dir(os.path.dirname(out_png_abs))
    if os.path.isfile(out_png_abs) and os.path.getsize(out_png_abs) > 64:
        return True, out_png_abs
    task = unreal.AssetExportTask()
    task.object = asset_obj
    task.filename = out_png_abs
    task.automated = True
    task.replace_identical = True
    task.prompt = False
    ok = unreal.Exporter.run_asset_export_task(task)
    if ok and os.path.isfile(out_png_abs) and os.path.getsize(out_png_abs) > 64:
        return True, out_png_abs
    # Fallback to TGA if PNG exporter declines
    out_tga = os.path.splitext(out_png_abs)[0] + ".tga"
    task2 = unreal.AssetExportTask()
    task2.object = asset_obj
    task2.filename = out_tga
    task2.automated = True
    task2.replace_identical = True
    task2.prompt = False
    ok2 = unreal.Exporter.run_asset_export_task(task2)
    if ok2 and os.path.isfile(out_tga) and os.path.getsize(out_tga) > 64:
        return True, out_tga
    return False, ""


def texture_meta(tex):
    info = {}
    try:
        info["sizeX"] = int(tex.blueprint_get_size_x())
        info["sizeY"] = int(tex.blueprint_get_size_y())
    except Exception:
        pass
    for prop in ("srgb", "compression_settings", "lod_group", "mip_gen_settings"):
        try:
            info[prop] = str(tex.get_editor_property(prop))
        except Exception:
            pass
    return info


def inspect_material_instance(mi_asset):
    tex_params = {}
    scalar_params = {}
    vec_params = {}
    parent_path = ""
    try:
        parent = mi_asset.get_editor_property("parent")
        if parent:
            parent_path = parent.get_path_name()
    except Exception:
        pass
    try:
        for tp in mi_asset.get_editor_property("texture_parameter_values") or []:
            p_info = tp.get_editor_property("parameter_info")
            p_val = tp.get_editor_property("parameter_value")
            if p_info and p_val:
                tex_params[str(p_info.get_editor_property("name"))] = {
                    "objectPath": p_val.get_path_name(),
                    "name": p_val.get_name(),
                    "asset": p_val,
                }
    except Exception:
        pass
    try:
        for sp in mi_asset.get_editor_property("scalar_parameter_values") or []:
            p_info = sp.get_editor_property("parameter_info")
            p_val = sp.get_editor_property("parameter_value")
            if p_info:
                scalar_params[str(p_info.get_editor_property("name"))] = float(p_val)
    except Exception:
        pass
    try:
        for vp in mi_asset.get_editor_property("vector_parameter_values") or []:
            p_info = vp.get_editor_property("parameter_info")
            p_val = vp.get_editor_property("parameter_value")
            if p_info and p_val:
                vec_params[str(p_info.get_editor_property("name"))] = [
                    float(p_val.r),
                    float(p_val.g),
                    float(p_val.b),
                    float(p_val.a),
                ]
    except Exception:
        pass
    return parent_path, tex_params, scalar_params, vec_params


# ---------------------------------------------------------------------------
# 1. AmplifyLUTPack (all Texture2D under /Game/AmplifyLUTPack)
# ---------------------------------------------------------------------------
lut_out_dir = os.path.join(STAGING_ROOT, "luts")
ensure_dir(lut_out_dir)
lut_assets = ar.get_assets_by_path("/Game/AmplifyLUTPack", recursive=True)
lut_records = []
lut_ok = 0
lut_fail = []

for ad in lut_assets:
    cls = str(ad.asset_class_path.asset_name)
    if cls != "Texture2D":
        continue
    pkg = str(ad.package_name)
    name = str(ad.asset_name)
    obj_path = f"{pkg}.{name}"
    rel = pkg[len("/Game/AmplifyLUTPack/"):]
    parts = rel.split("/")
    category = parts[0] if len(parts) > 1 else "Base"
    tex = unreal.load_asset(obj_path)
    if not tex:
        lut_fail.append(obj_path)
        continue
    out_png = os.path.join(lut_out_dir, category, f"{name}.png")
    ok, actual_path = export_texture_png(tex, out_png)
    if not ok:
        lut_fail.append(obj_path)
        continue
    lut_ok += 1
    meta = texture_meta(tex)
    lut_records.append({
        "name": name,
        "category": category,
        "objectPath": obj_path,
        "fileRel": os.path.relpath(actual_path, STAGING_ROOT).replace(os.sep, "/"),
        **meta,
    })

print(f"M2_LUTS_DONE ok={lut_ok} fail={len(lut_fail)}")


# ---------------------------------------------------------------------------
# 2. AdvancedGlassPack (candidate textures + 9 SM_GlassPieces_Single_*.glb)
# ---------------------------------------------------------------------------
glass_assets = ar.get_assets_by_path("/Game/AdvancedGlassPack", recursive=True)
glass_tex_records = []
glass_mesh_records = []

GLASS_TEX_KEEP = {
    "T_DirtMask_01", "T_DirtMask_02", "T_DirtMask_05", "T_DirtMask_07", "T_DirtMask_10",
    "T_RainDroplets_M", "T_RainDroplets2_M", "T_RainDroplets",
    "T_Pattern_01_N", "T_Pattern_03a_N", "T_Pattern_05_N",
    "T_Scrachted_01_N", "T_Scrachted_02_N",
    "T_Frost_01", "T_Frost_01_N", "T_Frost_02", "T_Frost_02_N",
    "T_Glass_Shattered_01_M", "T_Glass_Shattered_01_N",
    "T_Glass_Shattered_02_M", "T_Glass_Shattered_02_N",
    "T_Glass_Shattered_04_M", "T_Glass_Shattered_04_N",
}

gltf_opts = unreal.GLTFExportOptions()
gltf_opts.export_uniform_scale = 0.01
gltf_opts.export_vertex_colors = True
gltf_opts.adjust_normalmaps = True
gltf_opts.export_material_variants = unreal.GLTFMaterialVariantMode.NONE

for ad in glass_assets:
    cls = str(ad.asset_class_path.asset_name)
    pkg = str(ad.package_name)
    name = str(ad.asset_name)
    obj_path = f"{pkg}.{name}"
    if cls == "Texture2D" and name in GLASS_TEX_KEEP:
        tex = unreal.load_asset(obj_path)
        if not tex:
            continue
        out_png = os.path.join(STAGING_ROOT, "glass_textures", f"{name}.png")
        ok, actual_path = export_texture_png(tex, out_png)
        if ok:
            glass_tex_records.append({
                "name": name,
                "objectPath": obj_path,
                "fileRel": os.path.relpath(actual_path, STAGING_ROOT).replace(os.sep, "/"),
                **texture_meta(tex),
            })
    elif cls == "StaticMesh" and name.startswith("SM_GlassPieces_Single_"):
        sm = unreal.load_asset(obj_path)
        if not sm:
            continue
        out_glb = os.path.join(STAGING_ROOT, "glass_meshes", f"{name}.glb")
        ensure_dir(os.path.dirname(out_glb))
        ok = bool(unreal.GLTFExporter.export_to_gltf(sm, out_glb, gltf_opts, set()))
        glass_mesh_records.append({
            "name": name,
            "objectPath": obj_path,
            "ok": ok and os.path.isfile(out_glb),
            "fileRel": os.path.relpath(out_glb, STAGING_ROOT).replace(os.sep, "/"),
            "bytes": os.path.getsize(out_glb) if os.path.isfile(out_glb) else 0,
        })

print(f"M2_GLASS_DONE textures={len(glass_tex_records)} meshes={len(glass_mesh_records)}")


# ---------------------------------------------------------------------------
# 3. UWC_Bullet_Holes (exclude POM Blasted_Mesh_Decals) + referenced textures
# ---------------------------------------------------------------------------
uwc_assets = ar.get_assets_by_path("/Game/UWC_Bullet_Holes", recursive=True)
exported_tex_cache = {}
uwc_mi_records = []

def ensure_exported_tex(tex_obj):
    if not tex_obj:
        return None
    obj_path = tex_obj.get_path_name()
    if obj_path in exported_tex_cache:
        return exported_tex_cache[obj_path]
    safe_name = obj_path.split(".")[0].replace("/Game/", "").replace("/", "__")
    out_png = os.path.join(STAGING_ROOT, "uwc_textures", f"{safe_name}.png")
    ok, actual_path = export_texture_png(tex_obj, out_png)
    rec = None
    if ok:
        rec = {
            "objectPath": obj_path,
            "name": tex_obj.get_name(),
            "fileRel": os.path.relpath(actual_path, STAGING_ROOT).replace(os.sep, "/"),
            **texture_meta(tex_obj),
        }
    exported_tex_cache[obj_path] = rec
    return rec

for ad in uwc_assets:
    cls = str(ad.asset_class_path.asset_name)
    pkg = str(ad.package_name)
    name = str(ad.asset_name)
    if cls != "MaterialInstanceConstant":
        continue
    if "Blasted_Mesh_Decals" in pkg or "Mesh_For_POM" in pkg:
        continue
    obj_path = f"{pkg}.{name}"
    mi = unreal.load_asset(obj_path)
    if not mi:
        continue
    parent_path, tex_params, scalar_params, vec_params = inspect_material_instance(mi)
    resolved_tex = {}
    for k, info in tex_params.items():
        rec = ensure_exported_tex(info["asset"])
        if rec:
            resolved_tex[k] = rec
    uwc_mi_records.append({
        "name": name,
        "packageName": pkg,
        "objectPath": obj_path,
        "parent": parent_path,
        "textures": resolved_tex,
        "scalars": scalar_params,
        "vectors": vec_params,
    })

print(f"M2_UWC_DONE mi={len(uwc_mi_records)} uniqueTextures={len(exported_tex_cache)}")


# ---------------------------------------------------------------------------
# 4. RealisticBloodDecals (MI_BloodSplatter_* + T_Blood_Splatter_*)
# ---------------------------------------------------------------------------
rb_assets = ar.get_assets_by_path("/Game/RealisticBloodDecals", recursive=True)
rb_mi_records = []
rb_tex_records = []

for ad in rb_assets:
    cls = str(ad.asset_class_path.asset_name)
    pkg = str(ad.package_name)
    name = str(ad.asset_name)
    obj_path = f"{pkg}.{name}"
    if cls == "Texture2D":
        tex = unreal.load_asset(obj_path)
        if not tex:
            continue
        out_png = os.path.join(STAGING_ROOT, "realistic_blood_textures", f"{name}.png")
        ok, actual_path = export_texture_png(tex, out_png)
        if ok:
            rb_tex_records.append({
                "name": name,
                "objectPath": obj_path,
                "fileRel": os.path.relpath(actual_path, STAGING_ROOT).replace(os.sep, "/"),
                **texture_meta(tex),
            })
    elif cls == "MaterialInstanceConstant":
        mi = unreal.load_asset(obj_path)
        if not mi:
            continue
        parent_path, tex_params, scalar_params, vec_params = inspect_material_instance(mi)
        rb_mi_records.append({
            "name": name,
            "packageName": pkg,
            "objectPath": obj_path,
            "parent": parent_path,
            "textures": {k: {"name": v["name"], "objectPath": v["objectPath"]} for k, v in tex_params.items()},
            "scalars": scalar_params,
            "vectors": vec_params,
        })

print(f"M2_BLOOD_DONE mi={len(rb_mi_records)} tex={len(rb_tex_records)}")

manifest = {
    "stagingRoot": STAGING_ROOT,
    "luts": lut_records,
    "lutFail": lut_fail,
    "glassTextures": glass_tex_records,
    "glassMeshes": glass_mesh_records,
    "uwcDecals": uwc_mi_records,
    "realisticBloodMIs": rb_mi_records,
    "realisticBloodTextures": rb_tex_records,
}
manifest_path = os.path.join(STAGING_ROOT, "milestone2_export_manifest.json")
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print("M2_EXPORT_COMPLETE", manifest_path)
