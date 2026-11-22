"""Headless Blender builder: MPFB2 recipe -> culled/recolored/atlas-baked/23-bone rigged LOD0~3 GLBs."""

import argparse
import importlib.util
import json
import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
import numpy as np


HGAME_CORE_BONES = [
    "root",
    "pelvis",
    "spine_01",
    "spine_02",
    "spine_03",
    "neck_01",
    "head",
    "clavicle_l",
    "upperarm_l",
    "lowerarm_l",
    "hand_l",
    "clavicle_r",
    "upperarm_r",
    "lowerarm_r",
    "hand_r",
    "thigh_l",
    "calf_l",
    "foot_l",
    "ball_l",
    "thigh_r",
    "calf_r",
    "foot_r",
    "ball_r",
]

FINGER_PREFIXES = ("thumb_", "index_", "middle_", "ring_", "pinky_")


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser(description="Build MPFB2 game-ready character LOD0~3")
    parser.add_argument("--recipe-resolved", required=True, help="Resolved character build payload JSON")
    parser.add_argument("--out-dir", required=True, help="Output directory for character LODs and meta.json")
    parser.add_argument("--user-data", required=True, help="vendor/mpfb2/user_data path")
    parser.add_argument("--anim-run", default="", help="Optional Run anim GLB for LOD3 impostor frames")
    return parser.parse_args(argv)


def load_blender_model3d():
    script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    bm_path = os.path.join(script_dir, "blender-model3d.py")
    spec = importlib.util.spec_from_file_location("blender_model3d", bm_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


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


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def configure_second_root(services, user_data_dir):
    abs_dir = os.path.abspath(user_data_dir)
    prefs_addon = bpy.context.preferences.addons.get("bl_ext.user_default.mpfb")
    if prefs_addon and hasattr(prefs_addon.preferences, "mpfb_second_root"):
        prefs_addon.preferences.mpfb_second_root = abs_dir
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


def hex_to_srgb_rgb(hex_str):
    s = str(hex_str or "#ffffff").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) < 6:
        return (1.0, 1.0, 1.0)
    r = int(s[0:2], 16) / 255.0
    g = int(s[2:4], 16) / 255.0
    b = int(s[4:6], 16) / 255.0
    return (r, g, b)


def srgb_to_linear_channel(c):
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hex_str):
    r, g, b = hex_to_srgb_rgb(hex_str)
    return (srgb_to_linear_channel(r), srgb_to_linear_channel(g), srgb_to_linear_channel(b), 1.0)


def apply_face_tweaks(services, basemesh, face_tweaks):
    if not face_tweaks or not isinstance(face_tweaks, dict):
        return
    TargetService = services["TargetService"]
    LocationService = services["LocationService"]
    targets_root = LocationService.get_mpfb_data("targets")
    if not targets_root or not os.path.isdir(targets_root):
        return

    all_targets = []
    for root, _, files in os.walk(targets_root):
        for fn in files:
            if fn.endswith(".target") or fn.endswith(".target.gz"):
                stem = fn.replace(".target.gz", "").replace(".target", "").lower()
                all_targets.append((stem, os.path.join(root, fn)))

    for key, val in face_tweaks.items():
        try:
            weight = float(val)
        except Exception:
            continue
        if abs(weight) < 1e-4:
            continue
        kl = str(key).strip().lower().replace("_", "-")
        # Support paired +/- morphs cleanly when recipe supplies signed values
        if weight < 0 and ("-incr" not in kl and "-decr" not in kl):
            candidates = [f"{kl}-decr", kl]
            w = abs(weight)
        elif weight > 0 and ("-incr" not in kl and "-decr" not in kl):
            candidates = [f"{kl}-incr", kl]
            w = abs(weight)
        else:
            candidates = [kl]
            w = max(0.0, min(1.0, abs(weight)))
        matched_path = None
        for cand in candidates:
            for stem, full_p in all_targets:
                if stem == cand or stem.endswith(cand):
                    matched_path = full_p
                    break
            if matched_path:
                break
        if matched_path:
            try:
                TargetService.load_target(basemesh, matched_path, weight=min(1.0, w))
            except Exception:
                pass


def bake_shape_keys(obj):
    if not obj or obj.type != "MESH" or not obj.data.shape_keys:
        return
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    except Exception:
        while obj.data.shape_keys and len(obj.data.shape_keys.key_blocks) > 0:
            obj.shape_key_remove(obj.data.shape_keys.key_blocks[-1])


def apply_material_color_tweak(obj, *, tint_hex=None, hsv=None, hair_gradient=None, custom_tex_path=None, roughness=None, is_eye=False):
    if not obj or obj.type != "MESH":
        return
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.node_tree:
            continue
        nt = mat.node_tree
        principled = None
        for n in nt.nodes:
            if n.type == "BSDF_PRINCIPLED":
                principled = n
                break
        if principled is None:
            continue

        if roughness is not None:
            rough_in = principled.inputs.get("Roughness")
            if rough_in is not None:
                for ln in list(nt.links):
                    if ln.to_node == principled and ln.to_socket == rough_in:
                        nt.links.remove(ln)
                rough_in.default_value = max(0.05, min(1.0, float(roughness)))

        base_in = principled.inputs.get("Base Color")
        if base_in is None:
            continue

        if custom_tex_path and os.path.isfile(custom_tex_path):
            img = bpy.data.images.load(custom_tex_path, check_existing=True)
            img.colorspace_settings.name = "sRGB"
            for ln in list(nt.links):
                if ln.to_node == principled and ln.to_socket == base_in:
                    nt.links.remove(ln)
            tex_node = nt.nodes.new("ShaderNodeTexImage")
            tex_node.image = img
            nt.links.new(tex_node.outputs["Color"], base_in)

        # Trace existing source socket feeding Base Color
        src_socket = None
        for ln in list(nt.links):
            if ln.to_node == principled and ln.to_socket == base_in:
                src_socket = ln.from_socket
                nt.links.remove(ln)
                break

        if src_socket is None:
            val_node = nt.nodes.new("ShaderNodeRGB")
            c = base_in.default_value
            val_node.outputs[0].default_value = (c[0], c[1], c[2], 1.0)
            src_socket = val_node.outputs[0]

        if hsv and len(hsv) >= 3:
            hsv_node = nt.nodes.new("ShaderNodeHueSaturation")
            hsv_node.inputs["Hue"].default_value = (0.5 + float(hsv[0])) % 1.0
            hsv_node.inputs["Saturation"].default_value = max(0.0, min(2.0, float(hsv[1])))
            hsv_node.inputs["Value"].default_value = max(0.0, min(2.0, float(hsv[2])))
            nt.links.new(src_socket, hsv_node.inputs["Color"])
            src_socket = hsv_node.outputs["Color"]

        if hair_gradient and len(hair_gradient) >= 2:
            # Root (high Z) -> Tip (low Z) vertical gradient across mesh generated Z
            tc = nt.nodes.new("ShaderNodeTexCoord")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].position = 0.08
            ramp.color_ramp.elements[0].color = hex_to_linear_rgba(hair_gradient[1])  # tip
            ramp.color_ramp.elements[1].position = 0.85
            ramp.color_ramp.elements[1].color = hex_to_linear_rgba(hair_gradient[0])  # root
            nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])

            # Desaturate and lift source so gradient recolors reliably from light to dark tones
            desat = nt.nodes.new("ShaderNodeHueSaturation")
            desat.inputs["Saturation"].default_value = 0.25
            desat.inputs["Value"].default_value = 1.55
            nt.links.new(src_socket, desat.inputs["Color"])

            mix_grad = nt.nodes.new("ShaderNodeMix")
            mix_grad.data_type = "RGBA"
            mix_grad.blend_type = "MIX"
            mix_grad.inputs[0].default_value = 0.78
            nt.links.new(desat.outputs["Color"], mix_grad.inputs[6])
            nt.links.new(ramp.outputs["Color"], mix_grad.inputs[7])
            src_socket = mix_grad.outputs[2]
        elif tint_hex:
            mix_node = nt.nodes.new("ShaderNodeMix")
            mix_node.data_type = "RGBA"
            mix_node.blend_type = "COLOR" if is_eye else "MULTIPLY"
            mix_node.inputs[0].default_value = 0.72 if is_eye else 0.78
            if not is_eye:
                # Lift slightly before multiply so saturated pastel/light tints don't go muddy
                desat = nt.nodes.new("ShaderNodeHueSaturation")
                desat.inputs["Saturation"].default_value = 0.35
                desat.inputs["Value"].default_value = 1.25
                nt.links.new(src_socket, desat.inputs["Color"])
                nt.links.new(desat.outputs["Color"], mix_node.inputs[6])
            else:
                nt.links.new(src_socket, mix_node.inputs[6])
            mix_node.inputs[7].default_value = hex_to_linear_rgba(tint_hex)
            src_socket = mix_node.outputs[2]

        nt.links.new(src_socket, base_in)


def collect_delete_and_helper_verts(basemesh, has_shoes):
    """Collect helper verts, MHCLO Delete.* vertex groups, and protected head/hand/foot sets."""
    mesh = basemesh.data
    vg_by_name = {vg.name: vg.index for vg in basemesh.vertex_groups}

    delete_indices = set()
    helper_indices = set()
    protect_indices = set()

    delete_group_names = [n for n in vg_by_name if n.startswith("Delete.")]
    helper_group_names = [
        n
        for n in vg_by_name
        if any(k in n.lower() for k in ("helper", "joint", "genital", "tongue", "teeth"))
    ]

    # Compute neck & wrist geometric anchors for face/head/hand protection
    zs = [v.co.z for v in mesh.vertices]
    min_z, max_z = (min(zs), max(zs)) if zs else (0.0, 1.7)
    height = max(0.1, max_z - min_z)
    neck_cut_z = min_z + height * 0.80
    ankle_cut_z = min_z + height * 0.08

    # Detect head/face and hand/foot vertex groups if available
    head_groups = {
        vg_by_name[n]
        for n in vg_by_name
        if n in ("head", "neck_01") or "head" in n.lower() or "face" in n.lower()
    }
    hand_groups = {
        vg_by_name[n]
        for n in vg_by_name
        if n in ("hand_l", "hand_r") or any(n.startswith(p) for p in FINGER_PREFIXES)
    }
    foot_groups = {
        vg_by_name[n]
        for n in vg_by_name
        if n in ("foot_l", "foot_r", "ball_l", "ball_r")
    }

    del_g_ids = {vg_by_name[n] for n in delete_group_names}
    help_g_ids = {vg_by_name[n] for n in helper_group_names}

    for v in mesh.vertices:
        g_map = {g.group: g.weight for g in v.groups if g.weight > 0.05}
        if any(gi in help_g_ids for gi in g_map):
            helper_indices.add(v.index)
            continue
        if any(gi in del_g_ids for gi in g_map):
            delete_indices.add(v.index)
        if v.co.z >= neck_cut_z or any(gi in head_groups for gi in g_map):
            if any(gi in head_groups for gi in g_map) and v.co.z >= neck_cut_z - height * 0.03:
                protect_indices.add(v.index)
        if any(gi in hand_groups for gi in g_map):
            protect_indices.add(v.index)
        if (not has_shoes) and (v.co.z <= ankle_cut_z or any(gi in foot_groups for gi in g_map)):
            protect_indices.add(v.index)

    return helper_indices, delete_indices, protect_indices


def bvh_cull_inner_skin(basemesh, cloth_objs, helper_indices, delete_indices, protect_indices):
    """Cull helper geometry, MHCLO Delete verts, and BVH-occluded inner skin with 1-ring boundary protection."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bvhs = []
    for cobj in cloth_objs:
        if not cobj or cobj.type != "MESH" or len(cobj.data.polygons) == 0:
            continue
        try:
            bvhs.append((cobj, BVHTree.FromObject(cobj, depsgraph)))
        except Exception:
            pass

    bm = bmesh.new()
    bm.from_mesh(basemesh.data)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    mw = basemesh.matrix_world
    ray_dirs = [
        Vector((1, 0, 0)),
        Vector((-1, 0, 0)),
        Vector((0, 1, 0)),
        Vector((0, -1, 0)),
        Vector((0, 0, 1)),
        Vector((0, 0, -1)),
    ]

    bvh_occluded = set()
    if bvhs:
        for v in bm.verts:
            idx = v.index
            if idx in helper_indices or idx in delete_indices or idx in protect_indices:
                continue
            wpos = mw @ v.co
            wnorm = (mw.to_3x3() @ v.normal).normalized()
            is_inside = False
            for _, bvh in bvhs:
                loc, norm, _, dist = bvh.find_nearest(wpos, 0.022)
                if loc is not None and dist <= 0.022:
                    to_surf = loc - wpos
                    # Vertex sits tightly beneath outward-facing cloth normal
                    if to_surf.dot(norm) > 0.002 and wnorm.dot(norm) > 0.15:
                        is_inside = True
                        break
                # Secondary containment probe (strictly all 6 cardinal rays must hit enclosing clothing)
                hits_outward = 0
                for d in ray_dirs:
                    hl, hn, _, hd = bvh.ray_cast(wpos + d * 0.002, d, 0.10)
                    if hl is not None and hn is not None and d.dot(hn) > 0.0:
                        hits_outward += 1
                if hits_outward >= 6:
                    is_inside = True
                    break
            if is_inside:
                bvh_occluded.add(idx)

    # 2-ring boundary erosion on BVH-occluded set to prevent sleeve/collar/neckline seams opening
    eroded_bvh = set(bvh_occluded)
    for _ in range(2):
        next_set = set()
        for v in bm.verts:
            if v.index not in eroded_bvh:
                continue
            if all((e.other_vert(v).index in eroded_bvh or e.other_vert(v).index in delete_indices) for e in v.link_edges):
                next_set.add(v.index)
        eroded_bvh = next_set

    to_delete_idx = helper_indices | delete_indices | eroded_bvh
    # Remove any faces whose vertices are all marked for deletion (or any helper vertex)
    del_verts = [v for v in bm.verts if v.index in helper_indices or v.index in to_delete_idx]
    # Keep faces that have at least one non-helper surviving neighbor unless all corners are occluded
    del_faces = []
    for f in bm.faces:
        if any(v.index in helper_indices for v in f.verts):
            del_faces.append(f)
        elif all(v.index in to_delete_idx for v in f.verts):
            del_faces.append(f)

    if del_faces:
        bmesh.ops.delete(bm, geom=del_faces, context="FACES")

    loose_verts = [v for v in bm.verts if not v.link_faces]
    if loose_verts:
        bmesh.ops.delete(bm, geom=loose_verts, context="VERTS")

    bm.normal_update()
    bm.to_mesh(basemesh.data)
    bm.free()
    basemesh.data.update()

    # Drop MPFB helper/delete modifiers so mesh matches baked state
    for mod in list(basemesh.modifiers):
        if mod.type == "MASK":
            basemesh.modifiers.remove(mod)


def mark_face_uv_boost(obj, boost_value):
    """Store per-face uv_boost float attribute before merging objects."""
    if not obj or obj.type != "MESH" or len(obj.data.polygons) == 0:
        return
    attr = obj.data.attributes.get("uv_boost")
    if attr is None:
        attr = obj.data.attributes.new(name="uv_boost", type="FLOAT", domain="FACE")
    attr.data.foreach_set("value", [float(boost_value)] * len(obj.data.polygons))


def mark_face_protect_group(obj, protect_z_min=None):
    """Mark vertices in FaceProtect vertex group so decimation spares face & eye silhouette."""
    if not obj or obj.type != "MESH":
        return
    vg = obj.vertex_groups.get("FaceProtect") or obj.vertex_groups.new(name="FaceProtect")
    idxs = []
    for v in obj.data.vertices:
        if protect_z_min is None or v.co.z >= protect_z_min:
            idxs.append(v.index)
    if idxs:
        vg.add(idxs, 1.0, "REPLACE")


def transfer_weights_if_empty(src_basemesh, dst_obj, fallback_bone="head"):
    """Ensure every vertex in dst_obj has bone deform weights before joining."""
    if not dst_obj or dst_obj.type != "MESH":
        return
    # Check if dst_obj already has valid bone weights
    has_weights = False
    for v in dst_obj.data.vertices[: min(32, len(dst_obj.data.vertices))]:
        if sum(g.weight for g in v.groups) > 0.01:
            has_weights = True
            break

    if not has_weights and src_basemesh and len(src_basemesh.data.polygons) > 0:
        mod = dst_obj.modifiers.new("WeightTransfer", "DATA_TRANSFER")
        mod.object = src_basemesh
        mod.use_vert_data = True
        mod.data_types_verts = {"VGROUP_WEIGHTS"}
        mod.vert_mapping = "POLYINTERP_NEAREST"
        bpy.ops.object.select_all(action="DESELECT")
        dst_obj.select_set(True)
        bpy.context.view_layer.objects.active = dst_obj
        try:
            bpy.ops.object.datalayout_transfer(modifier=mod.name)
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception:
            if mod.name in dst_obj.modifiers:
                dst_obj.modifiers.remove(mod)

    # Fallback assignment for any isolated zero-weight vertex
    fb_vg = dst_obj.vertex_groups.get(fallback_bone) or dst_obj.vertex_groups.new(name=fallback_bone)
    zero_verts = [v.index for v in dst_obj.data.vertices if sum(g.weight for g in v.groups) < 1e-5]
    if zero_verts:
        fb_vg.add(zero_verts, 1.0, "REPLACE")


def count_tris(mesh_obj):
    return sum(max(1, len(p.vertices) - 2) for p in mesh_obj.data.polygons)


def decimate_if_over_budget(mesh_obj, max_tris=10800, target_tris=8800):
    cur = count_tris(mesh_obj)
    if cur <= max_tris:
        return cur
    vg_fp = mesh_obj.vertex_groups.get("FaceProtect")
    prot_verts = set()
    if vg_fp is not None:
        idx = vg_fp.index
        for v in mesh_obj.data.vertices:
            if any(g.group == idx and g.weight > 0.5 for g in v.groups):
                prot_verts.add(v.index)
    prot_tris = 0
    for p in mesh_obj.data.polygons:
        if any(vi in prot_verts for vi in p.vertices):
            prot_tris += max(1, len(p.vertices) - 2)
    non_prot_tris = max(1, cur - prot_tris)

    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj

    if prot_tris < target_tris - 1200 and non_prot_tris > 1200:
        desired_non_prot = max(1200, target_tris - prot_tris)
        ratio = max(0.18, min(0.95, float(desired_non_prot) / float(non_prot_tris)))
        mod = mesh_obj.modifiers.new("GameDecimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        mod.vertex_group = "FaceProtect"
        mod.invert_vertex_group = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        cur = count_tris(mesh_obj)

    for attempt in range(3):
        if cur <= max_tris:
            break
        ratio2 = max(0.32, min(0.92, (float(target_tris) / float(cur)) * (0.90 ** attempt)))
        mod2 = mesh_obj.modifiers.new(f"GameDecimateAll_{attempt}", "DECIMATE")
        mod2.decimate_type = "COLLAPSE"
        mod2.ratio = ratio2
        mod2.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod2.name)
        cur = count_tris(mesh_obj)

    return cur


def unify_object_uv_before_join(obj, target_name="UVMap"):
    """Ensure each mesh has a single UV layer named `target_name` before joining."""
    if not obj or obj.type != "MESH":
        return
    uvs = obj.data.uv_layers
    if len(uvs) == 0:
        uvs.new(name=target_name)
        return
    active = uvs.active or uvs[0]
    active_name = active.name
    for ul in list(uvs):
        if ul.name != active_name:
            uvs.remove(ul)
    uvs[0].name = target_name


def prepare_atlas_uvs(mesh_obj, default_uv_name="UVMap", atlas_uv_name="UVMap_Atlas"):
    """Extract connected UV islands, scale uniformly by world-area * uv_boost (head 1.9x),
    and shelf-pack deterministically into UVMap_Atlas with crisp padding."""
    mesh = mesh_obj.data
    if default_uv_name not in mesh.uv_layers:
        mesh.uv_layers[0].name = default_uv_name

    # Remove stale atlas UV if any, then clone default UVMap -> UVMap_Atlas
    if atlas_uv_name in mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[atlas_uv_name])
    atlas_uv = mesh.uv_layers.new(name=atlas_uv_name)
    src_data = [0.0] * (len(mesh.loops) * 2)
    mesh.uv_layers[default_uv_name].data.foreach_get("uv", src_data)
    atlas_uv.data.foreach_set("uv", src_data)

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    uv_lay = bm.loops.layers.uv.get(atlas_uv_name)
    boost_lay = bm.faces.layers.float.get("uv_boost")

    # Build vertex -> faces adjacency filtered by matching UV coordinate to preserve UV seams
    vert_face_map = {}
    for f in bm.faces:
        for lp in f.loops:
            vert_face_map.setdefault(lp.vert.index, []).append((f.index, lp[uv_lay].uv.copy()))

    face_to_uvs = {}
    for f in bm.faces:
        face_to_uvs[f.index] = {lp.vert.index: lp[uv_lay].uv.copy() for lp in f.loops}

    visited = set()
    islands = []
    for f in bm.faces:
        if f.index in visited:
            continue
        stack = [f.index]
        visited.add(f.index)
        comp = []
        while stack:
            fi = stack.pop()
            comp.append(fi)
            f_uvs = face_to_uvs[fi]
            for vi, uv0 in f_uvs.items():
                for nb_fi, nb_uv in vert_face_map.get(vi, []):
                    if nb_fi in visited:
                        continue
                    if (uv0 - nb_uv).length < 1e-4:
                        visited.add(nb_fi)
                        stack.append(nb_fi)
        islands.append(comp)

    # Compute world area, current UV bounding box, and desired texel area boost per island
    packed_items = []
    for comp in islands:
        min_u, min_v = 1e9, 1e9
        max_u, max_v = -1e9, -1e9
        world_area = 0.0
        uv_area = 0.0
        boost_sum = 0.0
        for fi in comp:
            face = bm.faces[fi]
            wa = max(1e-8, face.calc_area())
            world_area += wa
            bval = face[boost_lay] if boost_lay else 1.0
            boost_sum += bval * wa
            pts = [lp[uv_lay].uv for lp in face.loops]
            for p in pts:
                min_u = min(min_u, p.x)
                min_v = min(min_v, p.y)
                max_u = max(max_u, p.x)
                max_v = max(max_v, p.y)
            if len(pts) >= 3:
                for k in range(1, len(pts) - 1):
                    a = pts[k] - pts[0]
                    b = pts[k + 1] - pts[0]
                    uv_area += 0.5 * abs(a.x * b.y - a.y * b.x)

        w_uv = max(1e-4, max_u - min_u)
        h_uv = max(1e-4, max_v - min_v)
        avg_boost = boost_sum / max(1e-8, world_area)
        # Desired UV scale proportional to sqrt(world_area * boost) / sqrt(uv_area)
        target_area = world_area * avg_boost
        scale_lin = math.sqrt(target_area / max(1e-7, uv_area))
        # Clamp extreme tiny slivers so shelf packing stays balanced
        pw = max(0.01, min(4.0, w_uv * scale_lin))
        ph = max(0.01, min(4.0, h_uv * scale_lin))
        packed_items.append({
            "comp": comp,
            "min_u": min_u,
            "min_v": min_v,
            "w_uv": w_uv,
            "h_uv": h_uv,
            "pw": pw,
            "ph": ph,
            "scale": min(pw / w_uv, ph / h_uv),
        })

    # Binary-search uniform global scale so all islands shelf-pack cleanly into [0, 1]^2 with 0.008 margin
    margin = 0.008
    total_area = sum(it["pw"] * it["ph"] for it in packed_items) or 1.0
    lo, hi = 0.05 / math.sqrt(total_area), 2.5 / math.sqrt(total_area)
    best_placements = None

    def try_pack(g_scale):
        ordered = sorted(packed_items, key=lambda x: -x["ph"] * g_scale)
        cx, cy, row_h = margin, margin, 0.0
        placements = []
        for it in ordered:
            w = it["pw"] * g_scale
            h = it["ph"] * g_scale
            if w > 1.0 - 2 * margin or h > 1.0 - 2 * margin:
                return None
            if cx + w + margin > 1.0:
                cy += row_h + margin
                cx = margin
                row_h = 0.0
            if cy + h + margin > 1.0:
                return None
            placements.append((it, cx, cy, g_scale))
            cx += w + margin
            row_h = max(row_h, h)
        return placements

    for _ in range(18):
        mid = 0.5 * (lo + hi)
        res = try_pack(mid)
        if res is not None:
            best_placements = res
            lo = mid
        else:
            hi = mid

    if best_placements is None:
        best_placements = try_pack(0.25 / math.sqrt(total_area)) or []

    for it, ox, oy, g_scale in best_placements:
        s = it["scale"] * g_scale
        mu, mv = it["min_u"], it["min_v"]
        for fi in it["comp"]:
            for lp in bm.faces[fi].loops:
                uv = lp[uv_lay].uv
                lp[uv_lay].uv = Vector((ox + (uv.x - mu) * s, oy + (uv.y - mv) * s))

    bm.to_mesh(mesh)
    bm.free()
    mesh.uv_layers.active = mesh.uv_layers[atlas_uv_name]
    mesh.uv_layers.active_index = list(mesh.uv_layers).index(mesh.uv_layers[atlas_uv_name])


def pin_material_uv_map(nt, uv_name):
    """Ensure every texture / TexCoord node in source material reads the original `uv_name` explicitly."""
    uv_node = nt.nodes.new("ShaderNodeUVMap")
    uv_node.uv_map = uv_name
    for n in list(nt.nodes):
        if n.type == "TEX_IMAGE":
            vec_in = n.inputs.get("Vector")
            if vec_in is not None and not vec_in.is_linked:
                nt.links.new(uv_node.outputs["UV"], vec_in)
        elif n.type == "TEX_COORD":
            for ln in list(nt.links):
                if ln.from_node == n and ln.from_socket.name == "UV":
                    to_n, to_s = ln.to_node, ln.to_socket
                    nt.links.remove(ln)
                    nt.links.new(uv_node.outputs["UV"], to_s)


def dilate_image_rgba(img, iterations=5):
    """Dilate RGB channels into alpha==0 margins to prevent mipmap border bleeding."""
    w, h = int(img.size[0]), int(img.size[1])
    if w <= 0 or h <= 0:
        return
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    arr = buf.reshape((h, w, 4))
    rgb = arr[:, :, :3].copy()
    alpha = arr[:, :, 3] > 0.02
    for _ in range(iterations):
        missing = ~alpha
        if not np.any(missing):
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros((h, w), dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            sr_y = slice(max(0, dy), h + min(0, dy))
            ds_y = slice(max(0, -dy), h - max(0, dy))
            sr_x = slice(max(0, dx), w + min(0, dx))
            ds_x = slice(max(0, -dx), w - max(0, dx))
            m = alpha[sr_y, sr_x]
            acc[ds_y, ds_x][m] += rgb[sr_y, sr_x][m]
            cnt[ds_y, ds_x][m] += 1.0
        fill = missing & (cnt > 0.0)
        if not np.any(fill):
            break
        rgb[fill] = acc[fill] / cnt[fill, None]
        alpha[fill] = True
    arr[:, :, :3] = rgb
    arr[:, :, 3] = 1.0
    img.pixels.foreach_set(arr.reshape(-1))
    img.update()


def _create_gltf_material_output_node(nt):
    group_name = "glTF Material Output"
    ng = bpy.data.node_groups.get(group_name)
    if ng is None:
        ng = bpy.data.node_groups.new(group_name, "ShaderNodeTree")
        ng.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    gnode = nt.nodes.new("ShaderNodeGroup")
    gnode.node_tree = ng
    return gnode


def bake_pbr_atlas(mesh_obj, char_id, style_preset="stylized_clean"):
    """Bake 1024x1024 sRGB BaseColor + 512x512 ORM + 512x512 Normal onto single Mat_Character."""
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.render.bake.margin = 4
    scn.render.bake.margin_type = "EXTEND"
    scn.render.bake.use_clear = True
    scn.render.bake.use_selected_to_active = False

    # Build target images
    base_img = bpy.data.images.new(f"{char_id}_BaseColor", width=1024, height=1024, alpha=True)
    base_img.colorspace_settings.name = "sRGB"

    ao_img = bpy.data.images.new(f"{char_id}_AO_tmp", width=512, height=512, alpha=True)
    ao_img.colorspace_settings.name = "Non-Color"

    rough_img = bpy.data.images.new(f"{char_id}_Rough_tmp", width=512, height=512, alpha=True)
    rough_img.colorspace_settings.name = "Non-Color"

    metal_img = bpy.data.images.new(f"{char_id}_Metal_tmp", width=512, height=512, alpha=True)
    metal_img.colorspace_settings.name = "Non-Color"

    norm_img = bpy.data.images.new(f"{char_id}_Normal", width=512, height=512, alpha=True)
    norm_img.colorspace_settings.name = "Non-Color"

    # Pin source UVMap and add bake target UV node on every source material
    atlas_uv_targets = []
    saved_links = []
    for slot in mesh_obj.material_slots:
        mat = slot.material
        if not mat or not mat.node_tree:
            continue
        nt = mat.node_tree
        pin_material_uv_map(nt, "UVMap")
        principled = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        out_node = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if not principled or not out_node:
            continue

        # Snapshot Surface, Base Color, Roughness, Metallic feeds
        surf_in = out_node.inputs.get("Surface")
        orig_surf = next((ln.from_socket for ln in nt.links if ln.to_node == out_node and ln.to_socket == surf_in), None)

        uv_atlas_node = nt.nodes.new("ShaderNodeUVMap")
        uv_atlas_node.uv_map = "UVMap_Atlas"
        bake_tex = nt.nodes.new("ShaderNodeTexImage")
        bake_tex.image = base_img
        nt.links.new(uv_atlas_node.outputs["UV"], bake_tex.inputs["Vector"])
        for n in nt.nodes:
            n.select = False
        bake_tex.select = True
        nt.nodes.active = bake_tex

        emit_node = nt.nodes.new("ShaderNodeEmission")
        emit_node.inputs["Strength"].default_value = 1.0
        atlas_uv_targets.append((nt, out_node, principled, orig_surf, bake_tex, emit_node))

    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    mesh_obj.data.uv_layers.active = mesh_obj.data.uv_layers["UVMap_Atlas"]

    def set_emit_source(socket_name):
        for nt, out_node, principled, orig_surf, bake_tex, emit_node in atlas_uv_targets:
            pin_in = principled.inputs.get(socket_name)
            surf_in = out_node.inputs.get("Surface")
            for ln in list(nt.links):
                if ln.to_node == out_node and ln.to_socket == surf_in:
                    nt.links.remove(ln)
                elif ln.to_node == emit_node and ln.to_socket == emit_node.inputs["Color"]:
                    nt.links.remove(ln)
            src = next((ln.from_socket for ln in nt.links if ln.to_node == principled and ln.to_socket == pin_in), None)
            if src is not None:
                nt.links.new(src, emit_node.inputs["Color"])
            else:
                val = pin_in.default_value if pin_in is not None else 0.5
                if isinstance(val, (float, int)):
                    emit_node.inputs["Color"].default_value = (float(val), float(val), float(val), 1.0)
                else:
                    emit_node.inputs["Color"].default_value = (val[0], val[1], val[2], 1.0)
            nt.links.new(emit_node.outputs["Emission"], surf_in)

    def restore_surface():
        for nt, out_node, principled, orig_surf, bake_tex, emit_node in atlas_uv_targets:
            surf_in = out_node.inputs.get("Surface")
            for ln in list(nt.links):
                if ln.to_node == out_node and ln.to_socket == surf_in:
                    nt.links.remove(ln)
            if orig_surf is not None:
                nt.links.new(orig_surf, surf_in)

    def set_target_image(img):
        for nt, _, _, _, bake_tex, _ in atlas_uv_targets:
            bake_tex.image = img
            for n in nt.nodes:
                n.select = False
            bake_tex.select = True
            nt.nodes.active = bake_tex

    # 1) BaseColor via EMIT (1024x1024 sRGB)
    scn.cycles.samples = 4
    set_target_image(base_img)
    set_emit_source("Base Color")
    bpy.ops.object.bake(type="EMIT")
    luma_lod0 = measure_covered_srgb_luma(base_img)
    dilate_image_rgba(base_img, iterations=6)

    # 2) Roughness via EMIT (512x512 Non-Color)
    set_target_image(rough_img)
    set_emit_source("Roughness")
    bpy.ops.object.bake(type="EMIT")
    dilate_image_rgba(rough_img, iterations=4)

    # 3) Metallic via EMIT (512x512 Non-Color)
    set_target_image(metal_img)
    set_emit_source("Metallic")
    bpy.ops.object.bake(type="EMIT")
    dilate_image_rgba(metal_img, iterations=4)

    # Restore real BSDF surface for AO + Normal bakes
    restore_surface()

    # 4) Ambient Occlusion (512x512 Non-Color)
    scn.cycles.samples = 16
    set_target_image(ao_img)
    bpy.ops.object.bake(type="AO")
    dilate_image_rgba(ao_img, iterations=4)

    # 5) Tangent-space Normal (512x512 Non-Color)
    scn.cycles.samples = 4
    set_target_image(norm_img)
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
    dilate_image_rgba(norm_img, iterations=4)

    # Pack ORM (R=AO, G=Roughness, B=Metallic)
    w, h = 512, 512
    ao_buf = np.empty(w * h * 4, dtype=np.float32)
    ro_buf = np.empty(w * h * 4, dtype=np.float32)
    mt_buf = np.empty(w * h * 4, dtype=np.float32)
    ao_img.pixels.foreach_get(ao_buf)
    rough_img.pixels.foreach_get(ro_buf)
    metal_img.pixels.foreach_get(mt_buf)

    orm_img = bpy.data.images.new(f"{char_id}_ORM", width=w, height=h, alpha=False)
    orm_img.colorspace_settings.name = "Non-Color"
    orm = np.empty((h * w, 4), dtype=np.float32)
    orm[:, 0] = ao_buf.reshape((-1, 4))[:, 0]
    orm[:, 1] = ro_buf.reshape((-1, 4))[:, 1]
    orm[:, 2] = mt_buf.reshape((-1, 4))[:, 2]
    orm[:, 3] = 1.0
    orm_img.pixels.foreach_set(orm.reshape(-1))
    orm_img.update()

    # Pack PNG blobs cleanly into Blender memory for GLB export
    for im in (base_img, orm_img, norm_img):
        im.pack()

    # Drop temp scalar images
    for im in (ao_img, rough_img, metal_img):
        bpy.data.images.remove(im, do_unlink=True)

    # Replace UVMap with clean UVMap_Atlas -> UVMap
    uvs = mesh_obj.data.uv_layers
    if "UVMap" in uvs:
        uvs.remove(uvs["UVMap"])
    uvs["UVMap_Atlas"].name = "UVMap"
    uvs.active = uvs["UVMap"]

    # Build clean single material (DrawCall = 1)
    mat = bpy.data.materials.new(name=f"Mat_{char_id}")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out_n = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out_n.inputs["Surface"])

    tex_base = nt.nodes.new("ShaderNodeTexImage")
    tex_base.image = base_img
    nt.links.new(tex_base.outputs["Color"], bsdf.inputs["Base Color"])

    tex_orm = nt.nodes.new("ShaderNodeTexImage")
    tex_orm.image = orm_img
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex_orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    gltf_occ = _create_gltf_material_output_node(nt)
    nt.links.new(sep.outputs["Red"], gltf_occ.inputs["Occlusion"])

    # Stylized normal softening (0.30 for stylized_clean, 0.85 for realistic_tactical)
    norm_strength = 0.30 if style_preset == "stylized_clean" else 0.85
    tex_norm = nt.nodes.new("ShaderNodeTexImage")
    tex_norm.image = norm_img
    nrm_node = nt.nodes.new("ShaderNodeNormalMap")
    nrm_node.inputs["Strength"].default_value = norm_strength
    nt.links.new(tex_norm.outputs["Color"], nrm_node.inputs["Color"])
    nt.links.new(nrm_node.outputs["Normal"], bsdf.inputs["Normal"])

    # Assign single material cleanly
    old_mats = list(mesh_obj.data.materials)
    mesh_obj.data.materials.clear()
    mesh_obj.data.materials.append(mat)
    for poly in mesh_obj.data.polygons:
        poly.material_index = 0
    for om in old_mats:
        if om and om.users == 0:
            bpy.data.materials.remove(om, do_unlink=True)

    return {
        "baseColorSize": [1024, 1024],
        "ormSize": [512, 512],
        "normalSize": [512, 512],
        "normalStrength": norm_strength,
        "lumaLod0": float(luma_lod0),
        "materials": [mat.name],
    }


def bake_fist_pose_onto_mesh(rig_obj, mesh_obj):
    """Pose all 30 MPFB2 finger bones into a natural clenched fist and bake into mesh_obj
    before finger bones are merged/removed for the 23-bone fingerless HGame rig."""
    if not rig_obj or not mesh_obj:
        return
    bpy.context.view_layer.update()

    # Ensure pose mode transforms start clean
    for pb in rig_obj.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()

    from mathutils import Quaternion

    for side in ("l", "r"):
        hand_pb = rig_obj.pose.bones.get(f"hand_{side}")
        mid_pb = rig_obj.pose.bones.get(f"middle_01_{side}")
        idx_pb = rig_obj.pose.bones.get(f"index_01_{side}")
        if hand_pb is None or mid_pb is None:
            continue

        # Palm center lies slightly inward (body side: -X for left, +X for right) and forward-down relative to hand/knuckles
        inward_sign = -1.0 if side == "l" else 1.0
        hand_dir = (hand_pb.tail - hand_pb.head).normalized()
        mid_knuckle = mid_pb.head.copy()
        palm_inward = (hand_pb.head + hand_dir * 0.04) + Vector((inward_sign * 0.065, -0.005, -0.025))

        # Flex MCP / PIP / DIP joints of the 4 main fingers sequentially using updated world pose matrices
        finger_angles = {
            "index": (math.radians(66), math.radians(82), math.radians(58)),
            "middle": (math.radians(70), math.radians(84), math.radians(60)),
            "ring": (math.radians(72), math.radians(84), math.radians(60)),
            "pinky": (math.radians(74), math.radians(82), math.radians(58)),
        }
        # Stable plane normal for finger flexion from palm frame: vector from mid_knuckle -> pinky_knuckle x (hand->mid)
        pinky_pb = rig_obj.pose.bones.get(f"pinky_01_{side}")
        across = (pinky_pb.head - idx_pb.head).normalized() if (pinky_pb and idx_pb) else Vector((0.0, 1.0, 0.0))

        for fname, angles in finger_angles.items():
            for seg_i, ang in enumerate(angles, start=1):
                pb = rig_obj.pose.bones.get(f"{fname}_0{seg_i}_{side}")
                if pb is None:
                    continue
                bpy.context.view_layer.update()
                bdir = (pb.tail - pb.head).normalized()
                to_palm = (palm_inward - pb.head).normalized()
                # Primary flexion axis perpendicular to both finger ray and palm target
                axis_w = bdir.cross(to_palm)
                if axis_w.length < 1e-4:
                    axis_w = across
                axis_w.normalize()
                # Rotate bone world matrix around axis_w anchored at bone head
                rot_w = Quaternion(axis_w, ang).to_matrix()
                rm_local = pb.matrix.to_3x3()
                local_axis = rm_local.inverted() @ axis_w
                pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion(local_axis.normalized(), ang)
                bpy.context.view_layer.update()

        # Curl thumb cleanly across the curled index/middle proximal phalanges
        bpy.context.view_layer.update()
        idx_02 = rig_obj.pose.bones.get(f"index_02_{side}")
        thumb_target = idx_02.head.copy() if idx_02 else (palm_inward + Vector((0.0, -0.02, 0.0)))
        for seg_i, ang in ((1, math.radians(34)), (2, math.radians(38)), (3, math.radians(42))):
            pb = rig_obj.pose.bones.get(f"thumb_0{seg_i}_{side}")
            if pb is None:
                continue
            bpy.context.view_layer.update()
            bdir = (pb.tail - pb.head).normalized()
            to_t = (thumb_target - pb.head).normalized()
            axis_w = bdir.cross(to_t)
            if axis_w.length < 1e-4:
                continue
            axis_w.normalize()
            local_axis = pb.matrix.to_3x3().inverted() @ axis_w
            pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion(local_axis.normalized(), ang)
            bpy.context.view_layer.update()

    # Bake posed armature deformation into mesh_obj rest geometry, then reset rig to Rest Pose
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    arm_mod = next((m for m in mesh_obj.modifiers if m.type == "ARMATURE"), None)
    if arm_mod is not None:
        bpy.ops.object.modifier_apply(modifier=arm_mod.name)

    for pb in rig_obj.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()

    new_mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    new_mod.object = rig_obj


def clean_to_hgame_23_bones(rig_obj, mesh_obj, enable_appendage_bones=False):
    """Rename Root->root, merge 30 finger bones into hand_l/hand_r, optionally keep <=3 appendage bones,
    limit total=4 weights per vertex, and normalize strictly."""
    # Step 1: Rename Root -> root in armature & vertex groups
    bpy.ops.object.select_all(action="DESELECT")
    rig_obj.select_set(True)
    bpy.context.view_layer.objects.active = rig_obj

    bpy.ops.object.mode_set(mode="EDIT")
    ebones = rig_obj.data.edit_bones
    if "Root" in ebones and "root" not in ebones:
        ebones["Root"].name = "root"
    if "Root" in mesh_obj.vertex_groups and "root" not in mesh_obj.vertex_groups:
        mesh_obj.vertex_groups["Root"].name = "root"

    # Identify finger bones and any extra non-core bones
    allowed = set(HGAME_CORE_BONES)
    extra_candidates = []
    bones_to_remove = []
    for eb in list(ebones):
        bn = eb.name
        if bn in allowed:
            continue
        is_finger = any(bn.startswith(p) for p in FINGER_PREFIXES)
        if is_finger:
            bones_to_remove.append(bn)
        elif enable_appendage_bones and len(extra_candidates) < 3:
            extra_candidates.append(bn)
            allowed.add(bn)
        else:
            bones_to_remove.append(bn)

    # Ensure core hierarchy root -> pelvis intact and deform enabled on allowed bones
    if "pelvis" in ebones and "root" in ebones and ebones["pelvis"].parent is None:
        ebones["pelvis"].parent = ebones["root"]

    for bn in list(bones_to_remove):
        if bn in ebones:
            ebones.remove(ebones[bn])

    for eb in ebones:
        eb.use_deform = eb.name in allowed

    final_bones = [eb.name for eb in ebones]
    bpy.ops.object.mode_set(mode="OBJECT")

    # Step 2: Merge finger vertex groups into hand_l / hand_r on mesh_obj, remove other non-allowed vgroups
    vg_l = mesh_obj.vertex_groups.get("hand_l") or mesh_obj.vertex_groups.new(name="hand_l")
    vg_r = mesh_obj.vertex_groups.get("hand_r") or mesh_obj.vertex_groups.new(name="hand_r")

    finger_groups = []
    drop_groups = []
    for vg in list(mesh_obj.vertex_groups):
        if vg.name in allowed:
            continue
        if any(vg.name.startswith(p) for p in FINGER_PREFIXES):
            finger_groups.append(vg)
        else:
            drop_groups.append(vg)

    if finger_groups:
        idx_map = {vg.index: vg.name for vg in finger_groups}
        add_l = {}
        add_r = {}
        for v in mesh_obj.data.vertices:
            wl = 0.0
            wr = 0.0
            for g in v.groups:
                fn = idx_map.get(g.group)
                if not fn:
                    continue
                if fn.endswith("_l"):
                    wl += g.weight
                elif fn.endswith("_r"):
                    wr += g.weight
            if wl > 0.0:
                add_l[v.index] = wl
            if wr > 0.0:
                add_r[v.index] = wr
        for vi, w in add_l.items():
            vg_l.add([vi], w, "ADD")
        for vi, w in add_r.items():
            vg_r.add([vi], w, "ADD")
        for vg in finger_groups:
            mesh_obj.vertex_groups.remove(vg)

    for vg in drop_groups:
        mesh_obj.vertex_groups.remove(vg)

    # Remove FaceProtect temporary vertex group if present before normalization
    if "FaceProtect" in mesh_obj.vertex_groups:
        mesh_obj.vertex_groups.remove(mesh_obj.vertex_groups["FaceProtect"])

    # Assign any zero-weight vertices cleanly to closest logical bone (head if high Z else pelvis)
    zs = [v.co.z for v in mesh_obj.data.vertices]
    z_head = (min(zs) + (max(zs) - min(zs)) * 0.78) if zs else 1.3
    vg_head = mesh_obj.vertex_groups.get("head") or mesh_obj.vertex_groups.new(name="head")
    vg_pelvis = mesh_obj.vertex_groups.get("pelvis") or mesh_obj.vertex_groups.new(name="pelvis")
    for v in mesh_obj.data.vertices:
        total = sum(g.weight for g in v.groups)
        if total < 1e-5:
            if v.co.z >= z_head:
                vg_head.add([v.index], 1.0, "REPLACE")
            else:
                vg_pelvis.add([v.index], 1.0, "REPLACE")

    # Clamp to max 4 weights & normalize all weights via Blender + exact float check
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

    max_err = 0.0
    max_influences = 0
    for v in mesh_obj.data.vertices:
        wsum = sum(g.weight for g in v.groups)
        max_err = max(max_err, abs(wsum - 1.0))
        max_influences = max(max_influences, len([g for g in v.groups if g.weight > 1e-6]))

    return {
        "bones": final_bones,
        "boneCount": len(final_bones),
        "maxWeightError": float(max_err),
        "maxVertexInfluences": int(max_influences),
        "appendageBones": extra_candidates,
    }


def scale_orient_and_ground(rig_obj, mesh_obj, target_height_m):
    """Orient +Z glTF (-Y Blender), apply uniform scale to target_height_m, and ground minZ == 0.0."""
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = mesh_obj.evaluated_get(depsgraph)
    mw = eval_obj.matrix_world
    zs = [(mw @ v.co).z for v in eval_obj.data.vertices]
    cur_h = max(0.01, max(zs) - min(zs)) if zs else 1.7
    s = float(target_height_m) / cur_h

    rig_obj.scale = (rig_obj.scale.x * s, rig_obj.scale.y * s, rig_obj.scale.z * s)
    bpy.context.view_layer.update()

    bpy.ops.object.select_all(action="DESELECT")
    rig_obj.select_set(True)
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = rig_obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.view_layer.update()

    # Exact vertex minZ grounding to 0.0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = mesh_obj.evaluated_get(depsgraph)
    mw = eval_obj.matrix_world
    zs = [(mw @ v.co).z for v in eval_obj.data.vertices]
    min_z = min(zs) if zs else 0.0
    rig_obj.location.z -= min_z
    bpy.ops.object.select_all(action="DESELECT")
    rig_obj.select_set(True)
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = rig_obj
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    bpy.context.view_layer.update()

    # Read final exact bounds
    mw_final = mesh_obj.matrix_world
    pts = [mw_final @ v.co for v in mesh_obj.data.vertices]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    return {
        "heightM": round(max(zs) - min(zs), 4),
        "minZ": round(min(zs), 5),
        "maxZ": round(max(zs), 4),
        "widthM": round(max(xs) - min(xs), 4),
        "depthM": round(max(ys) - min(ys), 4),
    }


def export_glb(objs, out_path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        if o and o.name in bpy.data.objects:
            o.hide_set(False)
            o.hide_render = False
            o.select_set(True)
            if o.type == "ARMATURE":
                bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_def_bones=True,
        export_extras=True,
        export_tangents=False,
    )


def save_image_as_png(img, out_path):
    old_fmt = bpy.context.scene.render.image_settings.file_format
    bpy.context.scene.render.image_settings.file_format = "PNG"
    try:
        img.save_render(filepath=out_path)
    except Exception:
        img.filepath_raw = out_path
        img.file_format = "PNG"
        img.save()
    bpy.context.scene.render.image_settings.file_format = old_fmt


def linear_to_srgb_arr(arr):
    a = np.clip(arr, 0.0, 1.0)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1.0 / 2.4) - 0.055)


def measure_covered_srgb_luma(img):
    w, h = int(img.size[0]), int(img.size[1])
    if w <= 0 or h <= 0:
        return 0.0
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    rgba = buf.reshape((-1, 4))
    mask = rgba[:, 3] > 0.05
    if not np.any(mask):
        mask = np.ones(rgba.shape[0], dtype=bool)
    rgb = linear_to_srgb_arr(rgba[mask, :3])
    luma = 0.2126 * rgb[:, 0] + 0.7152 * rgb[:, 1] + 0.0722 * rgb[:, 2]
    return float(np.mean(luma))


def apply_procedural_run_pose_frames(rig_obj):
    """Apply clean 8-frame loopable run cycle in world-X sagittal plane for LOD3 impostor atlas."""
    scn = bpy.context.scene
    act = bpy.data.actions.new(name="__tmp_lod3_run")
    rig_obj.animation_data_create()
    rig_obj.animation_data.action = act

    # Precompute rest local orientations to convert world sagittal pitch (around +X) to bone local space
    rest_mat = {}
    for pb in rig_obj.pose.bones:
        rest_mat[pb.name] = pb.bone.matrix_local.to_3x3()

    frames = 8
    for fi in range(frames):
        frame = fi * 2
        scn.frame_set(frame)
        phase = (2.0 * math.pi * fi) / frames
        s = math.sin(phase)

        # World-space sagittal pitch angles (radians around +X: negative pitches forward/up)
        world_pitches = {
            "spine_01": 0.12,
            "thigh_l": -0.55 * s - 0.10,
            "calf_l": 0.65 * max(0.0, s) + 0.22,
            "thigh_r": 0.55 * s - 0.10,
            "calf_r": 0.65 * max(0.0, -s) + 0.22,
            "upperarm_l": 0.45 * s,
            "lowerarm_l": -0.55 - 0.18 * max(0.0, -s),
            "upperarm_r": -0.45 * s,
            "lowerarm_r": -0.55 - 0.18 * max(0.0, s),
        }
        for bname, angle_x in world_pitches.items():
            pb = rig_obj.pose.bones.get(bname)
            if pb is None:
                continue
            rm = rest_mat[bname]
            rot_world = Matrix.Rotation(angle_x, 3, "X")
            rot_local = (rm.inverted() @ rot_world @ rm).to_quaternion()
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = rot_local
            pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    scn.frame_set(0)
    return act, (0, (frames - 1) * 2)


def main():
    args = parse_args()
    with open(args.recipe_resolved, "r", encoding="utf-8") as f:
        payload = json.load(f)

    char_id = payload["charId"]
    style_preset = payload.get("stylePreset", "stylized_clean")
    phenotype = payload.get("phenotype", {}) or {}
    target_height_m = float(phenotype.get("targetHeightM", 1.72))
    lod_cfg = payload.get("lod", {}) or {}
    lod2_color_size = int(lod_cfg.get("lod2ColorSize", 128))
    enable_appendage_bones = bool(lod_cfg.get("enableAppendageBones", False))

    os.makedirs(args.out_dir, exist_ok=True)
    clear_scene()
    _, services = import_mpfb_services()
    configure_second_root(services, args.user_data)

    HumanService = services["HumanService"]
    TargetService = services["TargetService"]

    # 1. Create base human with macro phenotype
    macro = TargetService.get_default_macro_info_dict()
    for k in ("gender", "age", "muscle", "weight", "proportions", "height", "cupsize", "firmness"):
        if k in phenotype:
            macro[k] = float(phenotype[k])
    if isinstance(phenotype.get("race"), dict):
        race = dict(macro.get("race", {}))
        for rk in ("asian", "caucasian", "african"):
            if rk in phenotype["race"]:
                race[rk] = float(phenotype["race"][rk])
        rsum = sum(max(0.0, float(v)) for v in race.values()) or 1.0
        macro["race"] = {rk: max(0.0, float(v)) / rsum for rk, v in race.items()}

    basemesh = HumanService.create_human(
        mask_helpers=True,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
        scale=0.1,
        macro_detail_dict=macro,
    )

    apply_face_tweaks(services, basemesh, payload.get("faceTweaks"))
    if payload.get("faceTweaks"):
        TargetService.reapply_all_details(basemesh)

    # Apply skin material & tone
    skin_cfg = payload.get("skin", {}) or {}
    skin_mhmat = skin_cfg.get("resolvedPath", "")
    if skin_mhmat and os.path.isfile(skin_mhmat):
        HumanService.set_character_skin(skin_mhmat, basemesh, skin_type="MAKESKIN", material_instances=False)
    else:
        # Clean neutral fallback MAKESKIN material so skin never stays untextured white
        default_skin = os.path.join(args.user_data, "skins")
        found_skin = ""
        if os.path.isdir(default_skin):
            for rr, _, fns in os.walk(default_skin):
                for fn in sorted(fns):
                    if fn.endswith(".mhmat") and "young" in fn.lower():
                        found_skin = os.path.join(rr, fn)
                        break
                if found_skin:
                    break
        if found_skin:
            HumanService.set_character_skin(found_skin, basemesh, skin_type="MAKESKIN", material_instances=False)

    apply_material_color_tweak(
        basemesh,
        tint_hex=skin_cfg.get("tone"),
        roughness=skin_cfg.get("roughness", 0.72),
    )

    # Attach game_engine rig onto basemesh BEFORE equipping clothes so add_mhclo_asset interpolates rig weights directly
    rig_obj = HumanService.add_builtin_rig(basemesh, "game_engine", import_weights=True)

    # Bake shape keys into basemesh once rigged & morphed (keep rest shape clean before clothes transfer)
    # Note: basemesh stays fitted while clothes fit to its shape; bake shape keys right after fitting clothes!
    wardrobe_objs = []
    cloth_occluder_objs = []
    eye_obj = None
    has_shoes = False

    # 2. Equip low-poly eyes
    eye_cfg = payload.get("eye", {}) or {}
    eye_path = eye_cfg.get("resolvedPath", "")
    if eye_path and os.path.isfile(eye_path):
        eye_obj = HumanService.add_mhclo_asset(
            eye_path,
            basemesh,
            asset_type="Eyes",
            subdiv_levels=0,
            material_type="MAKESKIN",
            set_up_rigging=True,
            interpolate_weights=True,
            import_subrig=False,
            import_weights=False,
        )
        apply_material_color_tweak(eye_obj, tint_hex=eye_cfg.get("irisColor"), roughness=0.15, is_eye=True)

    # 3. Equip wardrobe slots
    slot_to_mpfb_type = {
        "hair": "Hair",
        "top": "Clothes",
        "bottom": "Clothes",
        "suit": "Clothes",
        "dress": "Clothes",
        "shoes": "Clothes",
        "hat": "Clothes",
        "glasses": "Clothes",
        "gloves": "Clothes",
        "mask": "Clothes",
        "equipment": "Clothes",
        "bodyparts": "Bodypart",
    }
    opaque_occluders = {"top", "bottom", "suit", "dress", "shoes", "gloves", "hat", "mask"}

    for item in payload.get("wardrobeItems", []):
        mhclo_path = item.get("resolvedPath", "")
        if not mhclo_path or not os.path.isfile(mhclo_path):
            continue
        slot = item["slot"]
        if slot == "shoes":
            has_shoes = True
        atype = slot_to_mpfb_type.get(slot, "Clothes")
        wobj = HumanService.add_mhclo_asset(
            mhclo_path,
            basemesh,
            asset_type=atype,
            subdiv_levels=0,
            material_type="MAKESKIN",
            set_up_rigging=True,
            interpolate_weights=True,
            import_subrig=False,
            import_weights=True,
        )
        if not wobj:
            continue
        recolor = item.get("recolor", {}) or {}
        if slot == "hair" and isinstance(recolor.get("color"), list):
            apply_material_color_tweak(
                wobj,
                hair_gradient=recolor["color"],
                hsv=recolor.get("hsv"),
                roughness=recolor.get("rough", 0.58),
            )
        else:
            apply_material_color_tweak(
                wobj,
                tint_hex=recolor.get("tint") or (recolor.get("color") if isinstance(recolor.get("color"), str) else None),
                hsv=recolor.get("hsv"),
                custom_tex_path=recolor.get("resolvedCustomTexture"),
                roughness=recolor.get("rough"),
            )
        wardrobe_objs.append((slot, wobj))
        if slot in opaque_occluders:
            cloth_occluder_objs.append(wobj)

    # Bake shape keys on basemesh + transfer any missing weights before culling basemesh
    bake_shape_keys(basemesh)
    for slot, wobj in wardrobe_objs:
        bake_shape_keys(wobj)
        fb_bone = "head" if slot in ("hair", "hat", "glasses", "mask") else "spine_02"
        transfer_weights_if_empty(basemesh, wobj, fallback_bone=fb_bone)
    if eye_obj:
        bake_shape_keys(eye_obj)
        # Ensure eyes strictly follow head bone
        for vg in list(eye_obj.vertex_groups):
            eye_obj.vertex_groups.remove(vg)
        vg_h = eye_obj.vertex_groups.new(name="head")
        vg_h.add([v.index for v in eye_obj.data.vertices], 1.0, "REPLACE")

    # 4. Delete helpers + MHCLO Delete.* + BVH inner-skin culling (with 1-ring boundary protection)
    helper_idxs, delete_idxs, protect_idxs = collect_delete_and_helper_verts(basemesh, has_shoes)
    bvh_cull_inner_skin(basemesh, cloth_occluder_objs, helper_idxs, delete_idxs, protect_idxs)

    # Tag per-face UV boost & FaceProtect before joining into mesh_lod0
    zs_body = [v.co.z for v in basemesh.data.vertices]
    neck_z = (min(zs_body) + (max(zs_body) - min(zs_body)) * 0.78) if zs_body else 1.3
    # Boost head/face faces inside basemesh by 1.9x, body skin 1.0x
    attr_base = basemesh.data.attributes.new(name="uv_boost", type="FLOAT", domain="FACE")
    boosts = [
        1.9 if (basemesh.data.vertices[p.vertices[0]].co.z >= neck_z) else 1.0
        for p in basemesh.data.polygons
    ]
    attr_base.data.foreach_set("value", boosts)
    mark_face_protect_group(basemesh, protect_z_min=neck_z)

    if eye_obj:
        mark_face_uv_boost(eye_obj, 1.9)
        mark_face_protect_group(eye_obj, protect_z_min=None)
    for slot, wobj in wardrobe_objs:
        mark_face_uv_boost(wobj, 1.25 if slot in ("hair", "hat", "mask", "glasses") else 1.0)
        if slot in ("hair", "glasses", "mask"):
            mark_face_protect_group(wobj, protect_z_min=neck_z)

    # Join all meshes cleanly into mesh_lod0
    join_list = [basemesh]
    if eye_obj:
        join_list.append(eye_obj)
    for _, wobj in wardrobe_objs:
        join_list.append(wobj)

    # Unify active UV layer name BEFORE join so UV coordinates of all parts preserve cleanly
    for obj in join_list:
        unify_object_uv_before_join(obj, "UVMap")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in join_list:
        for mod in list(obj.modifiers):
            if mod.type == "SUBSURF":
                obj.modifiers.remove(mod)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = basemesh
    if len(join_list) > 1:
        bpy.ops.object.join()
    mesh_lod0 = bpy.context.active_object
    mesh_lod0.name = "mesh_lod0"
    mesh_lod0.data.name = "mesh_lod0_data"

    # Keep only single Armature modifier on rig_obj
    for mod in list(mesh_lod0.modifiers):
        mesh_lod0.modifiers.remove(mod)
    arm_mod = mesh_lod0.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = rig_obj
    mesh_lod0.parent = rig_obj

    # Decimate softly only if > 11,000 tris (target ~9,200 tris, FaceProtect spared)
    tris_before_decimate = count_tris(mesh_lod0)
    tris_lod0 = decimate_if_over_budget(mesh_lod0, max_tris=11000, target_tris=9200)

    # Bake clenched fist hand pose onto mesh rest geometry before removing finger bones
    bake_fist_pose_onto_mesh(rig_obj, mesh_lod0)

    # 5. UV pack (1.9x face area boost) + Cycles PBR Atlas Baking
    prepare_atlas_uvs(mesh_lod0)
    bake_info = bake_pbr_atlas(mesh_lod0, char_id, style_preset=style_preset)

    # Remove temporary custom attribute so exported mesh stays spotless
    if "uv_boost" in mesh_lod0.data.attributes:
        mesh_lod0.data.attributes.remove(mesh_lod0.data.attributes["uv_boost"])

    # 6. Strict 23(+3) bone cleanup + weight clamp/normalize + scale/orient/ground
    bone_info = clean_to_hgame_23_bones(rig_obj, mesh_lod0, enable_appendage_bones=enable_appendage_bones)
    bounds_info = scale_orient_and_ground(rig_obj, mesh_lod0, target_height_m)

    # 7. LOD1 / LOD2 / LOD3 reuse from scripts/blender-model3d.py
    blender_model3d = load_blender_model3d()
    lm = blender_model3d.detect_humanoid_landmarks(mesh_lod0)

    lod1_obj = blender_model3d._build_reauthored_lod(
        mesh_lod0, rig_obj, "mesh_lod1", target_tris=2400, max_weights=4, color_size=256, is_lod2=False, lm=lm
    )
    if lod1_obj:
        lod1_obj.data.name = "mesh_lod1_data"
    lod2_obj = blender_model3d._build_reauthored_lod(
        mesh_lod0, rig_obj, "mesh_lod2", target_tris=1200, max_weights=2, color_size=lod2_color_size, is_lod2=True, lm=lm
    )
    if lod2_obj:
        lod2_obj.data.name = "mesh_lod2_data"

    # Apply crisp procedural run keyframes temporarily while rendering LOD3 tight impostor atlas
    lod3_obj = None
    lod3_atlas_img = None
    tmp_action, anim_range = apply_procedural_run_pose_frames(rig_obj)

    lod3_obj = blender_model3d._build_tight_lod3_impostor(
        mesh_lod0, rig_obj, anim_range=anim_range, cols=8, rows=8, cell_px=128, elev_deg=18.0
    )

    # Clear temporary action and restore Rest Pose cleanly before exporting GLBs
    if rig_obj.animation_data:
        rig_obj.animation_data_clear()
    if tmp_action and tmp_action.name in bpy.data.actions:
        bpy.data.actions.remove(tmp_action, do_unlink=True)
    for pb in rig_obj.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.rotation_euler = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()

    # Measure sRGB luma parity between LOD0 BaseColor and LOD3 atlas
    if lod3_obj and lod3_obj.data.materials:
        for n in lod3_obj.data.materials[0].node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None:
                lod3_atlas_img = n.image
                break

    luma_lod0 = float(bake_info.get("lumaLod0", 0.0))
    luma_lod3 = 0.0
    if lod3_atlas_img:
        atlas_path = os.path.join(args.out_dir, "lod3_atlas.png")
        save_image_as_png(lod3_atlas_img, atlas_path)
        try:
            from PIL import Image

            with Image.open(atlas_path) as im:
                rgba = np.asarray(im.convert("RGBA"), dtype=np.float32) / 255.0
                mask = rgba[:, :, 3] > 0.45
                if np.any(mask):
                    rgb = rgba[mask][:, :3]
                    luma_lod3 = float(np.mean(0.2126 * rgb[:, 0] + 0.7152 * rgb[:, 1] + 0.0722 * rgb[:, 2]))
                    if luma_lod0 > 0.02 and abs(luma_lod3 - luma_lod0) > 0.02:
                        # Match LOD3 impostor sRGB brightness to LOD0 albedo within <=5% to avoid distance pop
                        gain = max(0.65, min(1.45, luma_lod0 / max(1e-4, luma_lod3)))
                        rgba[:, :, :3] = np.clip(rgba[:, :, :3] * gain, 0.0, 1.0)
                        out_im = Image.fromarray(np.round(rgba * 255.0).astype(np.uint8), mode="RGBA")
                        out_im.save(atlas_path)
                        # Sync calibrated PNG back into Blender packed image before GLB export
                        reloaded = bpy.data.images.load(atlas_path, check_existing=False)
                        reloaded.colorspace_settings.name = "sRGB"
                        reloaded.pack()
                        for n in lod3_obj.data.materials[0].node_tree.nodes:
                            if n.type == "TEX_IMAGE":
                                n.image = reloaded
                        cal_rgb = rgba[mask][:, :3]
                        luma_lod3 = float(np.mean(0.2126 * cal_rgb[:, 0] + 0.7152 * cal_rgb[:, 1] + 0.0722 * cal_rgb[:, 2]))
        except Exception:
            luma_lod3 = measure_covered_srgb_luma(lod3_atlas_img)
    luma_diff = abs(luma_lod0 - luma_lod3)

    # Add lodLevel extras on mesh nodes so packed showcase switches seamlessly
    mesh_lod0["lodLevel"] = 0
    if lod1_obj:
        lod1_obj["lodLevel"] = 1
    if lod2_obj:
        lod2_obj["lodLevel"] = 2

    # Export individual LODs + single packed GLB
    export_glb([rig_obj, mesh_lod0], os.path.join(args.out_dir, "lod0.glb"))
    if lod1_obj:
        export_glb([rig_obj, lod1_obj], os.path.join(args.out_dir, "lod1.glb"))
    if lod2_obj:
        export_glb([rig_obj, lod2_obj], os.path.join(args.out_dir, "lod2.glb"))
    if lod3_obj:
        export_glb([rig_obj, lod3_obj], os.path.join(args.out_dir, "lod3.glb"))

    packed_name = f"{char_id}_packed.glb"
    export_glb(
        [o for o in (rig_obj, mesh_lod0, lod1_obj, lod2_obj, lod3_obj) if o is not None],
        os.path.join(args.out_dir, packed_name),
    )

    meta = {
        "schemaVersion": 1,
        "charId": char_id,
        "name": payload.get("name", char_id),
        "scope": payload.get("scope", "universal"),
        "stylePreset": style_preset,
        "recipeSha1": payload.get("recipeSha1", ""),
        "targetHeightM": target_height_m,
        "bounds": bounds_info,
        "bones": bone_info,
        "bake": bake_info,
        "lods": {
            "lod0": {"file": "lod0.glb", "tris": tris_lod0, "trisBeforeDecimate": tris_before_decimate, "materials": 1},
            "lod1": {"file": "lod1.glb", "tris": count_tris(lod1_obj) if lod1_obj else 0, "maxWeights": 4, "texSize": 256},
            "lod2": {"file": "lod2.glb", "tris": count_tris(lod2_obj) if lod2_obj else 0, "maxWeights": 2, "texSize": lod2_color_size},
            "lod3": {
                "file": "lod3.glb",
                "atlas": "lod3_atlas.png",
                "tris": count_tris(lod3_obj) if lod3_obj else 0,
                "lumaLod0": round(luma_lod0, 4),
                "lumaLod3": round(luma_lod3, 4),
                "lumaDiff": round(luma_diff, 4),
            },
            "packed": packed_name,
        },
        "assetsUsed": payload.get("assetsUsed", []),
    }

    with open(os.path.join(args.out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(
        f"[build_mpfb_char] {char_id}: lod0={tris_lod0} tris, bones={bone_info['boneCount']}, "
        f"maxWerr={bone_info['maxWeightError']:.2e}, h={bounds_info['heightM']}m, minZ={bounds_info['minZ']}"
    )


if __name__ == "__main__":
    main()
