"""
Read-only Unreal Engine 5.8 Python extractor for Milestone 4 (Tracks A & B):
  - Tier 1 packs:
      VFXNoiseTexPack, Realistic_Starter_VFX_Pack, Realistic_Starter_VFX_Pack_Vol2 (Cascade),
      Realistic_Starter_VFX_Pack_Niagara_Vol2, RealisticBlood, Vefects/Water,
      _Effects/UltimateFirePackVol1, _Effects/NiagaraExplosion01, _Effects/TrailMaster,
      _Effects/ARPGVFXPack02, _Effects/Shield_FX_Niagara, _Effects/InteractFx,
      _Effects/Lightning_Element_VFX
  - Strictly skips TransformationVFX (replaced by dissolve shader) and SplashPack VAT meshes.
  - Track A: Exports Texture2D (deduplicated by objectPath + source hash) & extracts emitter metadata skeletons.
  - Track B: Exports VFX specialized StaticMeshes as .glb (scale 0.01, normal adjusted, skipping demo/wall/mannequin meshes).

Strict Redline: NEVER modifies Anim58/Content. Outputs only to Saved/WebAssetExport/vfx_staging.
"""

import hashlib
import json
import os
import re
import unreal

STAGING_ROOT = os.environ.get(
    "HGAME_VFX_STAGING",
    r"D:\UnrealWorkspace\Anim58\Saved\WebAssetExport\vfx_staging",
)
TIER_MODE = os.environ.get("HGAME_VFX_TIER", "1").strip()
os.makedirs(STAGING_ROOT, exist_ok=True)

ar = unreal.AssetRegistryHelpers.get_asset_registry()

TIER1_PREFIXES = {
    "VFXNoiseTexPack": "/Game/VFXNoiseTexPack",
    "Realistic_Starter_VFX_Pack": "/Game/Realistic_Starter_VFX_Pack",
    "Realistic_Starter_VFX_Pack_Vol2": "/Game/Realistic_Starter_VFX_Pack_Vol2",
    "Realistic_Starter_VFX_Pack_Niagara_Vol2": "/Game/Realistic_Starter_VFX_Pack_Niagara_Vol2",
    "RealisticBlood": "/Game/RealisticBlood",
    "Vefects_Water": "/Game/Vefects/Water",
    "UltimateFirePackVol1": "/Game/_Effects/UltimateFirePackVol1",
    "NiagaraExplosion01": "/Game/_Effects/NiagaraExplosion01",
    "TrailMaster": "/Game/_Effects/TrailMaster",
    "ARPGVFXPack02": "/Game/_Effects/ARPGVFXPack02",
    "Shield_FX_Niagara": "/Game/_Effects/Shield_FX_Niagara",
    "InteractFx": "/Game/_Effects/InteractFx",
    "Lightning_Element_VFX": "/Game/_Effects/Lightning_Element_VFX",
}

DEMO_SKIP_RE = re.compile(
    r"(?:DemoRoom|DemoDivider|BaseRoom|Base_FlatWall|SM_Base\b|SM_Base2\b|SM_Wall|SM_Floor_Previewer|SM_URoom|"
    r"SM_NoiseTex_Walls|SM_Wall_Previewer|SM_Gallery|SM_NamePlate|Mannequin|SM_Kwang|SM_Ramp|SM_Cube|"
    r"SM_ChamferCube|SM_DecalBox|SM_Splash_|"
    r"Manny_|UE4_Mannequin|Metrics_Grid|DefaultText|Previewer|ToolHatchet|WeaponKnife|"
    r"T_RoomTiles|T_ML_Aluminum|T_ML_Rubber|T_UnrealEngineDecal|T_Stencil|T_GridMask|T_Concrete_)",
    re.IGNORECASE,
)


def md5_file(fp):
    h = hashlib.md5()
    with open(fp, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def export_tex(tex_obj, out_png_abs):
    os.makedirs(os.path.dirname(out_png_abs), exist_ok=True)
    if os.path.isfile(out_png_abs) and os.path.getsize(out_png_abs) > 64:
        return True, out_png_abs
    tga = os.path.splitext(out_png_abs)[0] + ".tga"
    if os.path.isfile(tga) and os.path.getsize(tga) > 64:
        return True, tga
    task = unreal.AssetExportTask()
    task.object = tex_obj
    task.filename = out_png_abs
    task.automated = True
    task.replace_identical = True
    task.prompt = False
    ok = unreal.Exporter.run_asset_export_task(task)
    if ok and os.path.isfile(out_png_abs) and os.path.getsize(out_png_abs) > 64:
        return True, out_png_abs
    task2 = unreal.AssetExportTask()
    task2.object = tex_obj
    task2.filename = tga
    task2.automated = True
    task2.replace_identical = True
    task2.prompt = False
    ok2 = unreal.Exporter.run_asset_export_task(task2)
    if ok2 and os.path.isfile(tga) and os.path.getsize(tga) > 64:
        return True, tga
    return False, ""


gltf_opts = unreal.GLTFExportOptions()
gltf_opts.export_uniform_scale = 0.01
gltf_opts.export_vertex_colors = True
gltf_opts.adjust_normalmaps = True
gltf_opts.export_material_variants = unreal.GLTFMaterialVariantMode.NONE

tex_records = []
mesh_records = []
vfx_skeletons = []
seen_tex_hashes = {}
dedup_tex_count = 0
skipped_demo_assets = 0

for pack_name, prefix in TIER1_PREFIXES.items():
    assets = ar.get_assets_by_path(prefix, recursive=True)
    print(f"VFX_SCAN pack={pack_name} count={len(assets)}")
    for ad in assets:
        cls = str(ad.asset_class_path.asset_name)
        pkg = str(ad.package_name)
        name = str(ad.asset_name)
        obj_path = f"{pkg}.{name}"
        if "/TransformationVFX/" in pkg or "/SplashPack/" in pkg:
            continue

        rel_pkg = pkg[len(prefix):].lstrip("/")
        if DEMO_SKIP_RE.search(name) or "/Demo/" in pkg or "/Maps/" in pkg or "/Overview" in pkg:
            if cls in ("Texture2D", "StaticMesh"):
                skipped_demo_assets += 1
                continue

        if cls == "Texture2D":
            tex = unreal.load_asset(obj_path)
            if not tex:
                continue
            sx = int(tex.blueprint_get_size_x())
            sy = int(tex.blueprint_get_size_y())
            out_png = os.path.join(STAGING_ROOT, "textures", pack_name, f"{rel_pkg.replace('/', '__')}.png")
            ok, actual_path = export_tex(tex, out_png)
            if not ok:
                continue
            digest = md5_file(actual_path)
            duplicate_of = seen_tex_hashes.get(digest)
            if duplicate_of:
                dedup_tex_count += 1
            else:
                seen_tex_hashes[digest] = obj_path
            tex_records.append({
                "id": f"{pack_name}__{name}",
                "pack": pack_name,
                "name": name,
                "relPkg": rel_pkg,
                "objectPath": obj_path,
                "fileRel": os.path.relpath(actual_path, STAGING_ROOT).replace(os.sep, "/"),
                "width": sx,
                "height": sy,
                "md5": digest,
                "duplicateOf": duplicate_of,
                "srgb": str(tex.get_editor_property("srgb")),
            })

        elif cls == "StaticMesh":
            # Filter out large architectural planes / rooms / characters
            sm = unreal.load_asset(obj_path)
            if not sm:
                continue
            # Check triangle count on LOD0 if possible or bounds; export clean VFX meshes
            out_glb = os.path.join(STAGING_ROOT, "meshes", pack_name, f"{name}.glb")
            os.makedirs(os.path.dirname(out_glb), exist_ok=True)
            if not (os.path.isfile(out_glb) and os.path.getsize(out_glb) > 256):
                ok = bool(unreal.GLTFExporter.export_to_gltf(sm, out_glb, gltf_opts, set()))
                if not ok:
                    continue
            if os.path.isfile(out_glb) and os.path.getsize(out_glb) > 256:
                mesh_records.append({
                    "id": f"{pack_name}__{name}",
                    "pack": pack_name,
                    "name": name,
                    "relPkg": rel_pkg,
                    "objectPath": obj_path,
                    "fileRel": os.path.relpath(out_glb, STAGING_ROOT).replace(os.sep, "/"),
                    "bytes": os.path.getsize(out_glb),
                })

        elif cls in ("NiagaraSystem", "ParticleSystem"):
            sys_obj = unreal.load_asset(obj_path)
            if not sys_obj:
                continue
            # Extract top-level system metadata (Track A / Track B draft skeleton)
            try:
                dep_opts = unreal.AssetRegistryDependencyOptions()
                deps = ar.get_dependencies(pkg, dep_opts)
            except Exception:
                deps = []
            dep_tex = []
            dep_mesh = []
            for d in deps or []:
                ds = str(d)
                d_base = ds.split("/")[-1]
                if d_base.startswith(("T_", "Tex_")) or "Texture" in ds or "Flipbook" in ds or "Noise" in ds or "SubUV" in ds:
                    dep_tex.append(ds)
                elif d_base.startswith("SM_") or "Mesh" in ds:
                    dep_mesh.append(ds)
            skel = {
                "id": f"{pack_name}__{name}",
                "pack": pack_name,
                "name": name,
                "kind": cls,
                "objectPath": obj_path,
                "textureDeps": dep_tex[:24],
                "meshDeps": dep_mesh[:12],
            }
            if cls == "ParticleSystem":
                try:
                    emitters = sys_obj.get_editor_property("emitters") or []
                    skel["emitterCount"] = len(emitters)
                    em_infos = []
                    for em in emitters:
                        em_name = str(em.get_editor_property("emitter_name")) if hasattr(em, "get_editor_property") else str(em)
                        lods = em.get_editor_property("lod_levels") or []
                        req = lods[0].get_editor_property("required_module") if lods else None
                        sub_x, sub_y = 1, 1
                        if req:
                            try:
                                sub_x = int(req.get_editor_property("sub_images_horizontal"))
                                sub_y = int(req.get_editor_property("sub_images_vertical"))
                            except Exception:
                                pass
                        em_infos.append({"name": em_name, "subImages": [sub_x, sub_y]})
                    skel["emitters"] = em_infos
                except Exception:
                    pass
            elif cls == "NiagaraSystem":
                try:
                    handles = sys_obj.get_editor_property("emitter_handles") or []
                    skel["emitterCount"] = len(handles)
                    skel["emitters"] = [str(h.get_editor_property("name")) for h in handles if hasattr(h, "get_editor_property")]
                except Exception:
                    pass
            vfx_skeletons.append(skel)

manifest = {
    "version": "1.0.0",
    "stagingRoot": STAGING_ROOT,
    "tierMode": TIER_MODE,
    "texturesCount": len(tex_records),
    "uniqueTexturesByMd5": len(seen_tex_hashes),
    "dedupTexCount": dedup_tex_count,
    "meshesCount": len(mesh_records),
    "vfxSkeletonsCount": len(vfx_skeletons),
    "skippedDemoAssets": skipped_demo_assets,
    "textures": tex_records,
    "meshes": mesh_records,
    "vfxSkeletons": vfx_skeletons,
}
manifest_path = os.path.join(STAGING_ROOT, "vfx_extract_manifest.json")
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print(
    f"VFX_EXTRACT_DONE textures={len(tex_records)} uniqueMd5={len(seen_tex_hashes)} "
    f"dedup={dedup_tex_count} meshes={len(mesh_records)} skeletons={len(vfx_skeletons)}"
)
