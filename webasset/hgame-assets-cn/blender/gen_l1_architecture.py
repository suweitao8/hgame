# blender/gen_l1_architecture.py
# 批量生成 L1 建筑主体结构(28) + 无骨骼可动门窗(10) + 悬链电线管线(4) + 静态功能底座(9) = 51 GLBs
import json
import math
import os
import bpy
import bmesh
from mathutils import Vector, Matrix

import sys
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from lib_bmesh_utils import (
    reset_scene,
    get_or_create_slot_material,
    add_box_to_bmesh,
    add_wall_with_opening,
    duplicate_as_lod,
    finalize_bmesh_to_object,
    apply_metric_box_uv,
    create_socket,
    export_glb,
)

ROOT = os.path.dirname(SCRIPT_DIR)
MANIFEST_PATH = os.path.join(ROOT, "manifests", "l1_modular.manifest.json")
RAW_OUT = os.path.join(ROOT, "raw", "models_l1")


def load_manifest_items():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    items = {}
    for g in data["groups"]:
        if g["group"] in ("l1_arch", "l1_wire", "l1_base"):
            for item in g["items"]:
                items[item["id"]] = (g["group"], item)
    return items


def mats_from_slots(item, order):
    slots = item.get("materialSlots", {})
    return [get_or_create_slot_material(slots[k]) for k in order if k in slots]


def build_solid_wall(bm, w, h, t):
    vset = set(add_box_to_bmesh(bm, (w, t, h), (0.0, 0.0, h * 0.5)))
    for f in bm.faces:
        if all(v in vset for v in f.verts):
            f.material_index = 0 if f.normal.y >= 0.0 else 1


def build_bldg_arch(item_id, item):
    bm = bmesh.new()
    mats = []
    children = []
    dado_h = 0.0
    bevel = 0.01

    if item_id == "bldg_wall_2m":
        mats = mats_from_slots(item, ["slot_main", "slot_inner"])
        build_solid_wall(bm, 2.0, 3.0, 0.2)
    elif item_id == "bldg_wall_4m":
        mats = mats_from_slots(item, ["slot_main", "slot_inner"])
        build_solid_wall(bm, 4.0, 3.0, 0.2)
    elif item_id == "bldg_wall_window_2m":
        mats = mats_from_slots(item, ["slot_main", "slot_inner", "slot_trim"])
        add_wall_with_opening(bm, 2.0, 3.0, 0.2, 0.0, 0.9, 1.5, 1.5, 0, 1, 2)
        add_box_to_bmesh(bm, (1.56, 0.24, 0.05), (0.0, 0.0, 0.9), 2)
    elif item_id == "bldg_wall_curtain_4m":
        mats = mats_from_slots(item, ["slot_trim", "slot_glass"])
        for x in (-1.95, -0.65, 0.65, 1.95):
            add_box_to_bmesh(bm, (0.1, 0.14, 3.0), (x, 0.0, 1.5), 0)
        for z in (0.05, 1.5, 2.95):
            add_box_to_bmesh(bm, (4.0, 0.14, 0.1), (0.0, 0.0, z), 0)
        add_box_to_bmesh(bm, (3.88, 0.03, 2.84), (0.0, 0.0, 1.5), 1)
    elif item_id == "bldg_wall_door_2m":
        mats = mats_from_slots(item, ["slot_main", "slot_inner", "slot_trim"])
        add_wall_with_opening(bm, 2.0, 3.0, 0.2, 0.0, 0.0, 1.0, 2.1, 0, 1, 2)
    elif item_id == "bldg_wall_shutter_4m":
        mats = mats_from_slots(item, ["slot_main", "slot_inner", "slot_trim"])
        add_wall_with_opening(bm, 4.0, 3.0, 0.2, 0.0, 0.0, 3.0, 2.4, 0, 1, 2)
        add_box_to_bmesh(bm, (3.1, 0.28, 0.26), (0.0, 0.04, 2.53), 2)
    elif item_id == "bldg_corner_pillar":
        mats = mats_from_slots(item, ["slot_main"])
        add_box_to_bmesh(bm, (0.24, 0.24, 3.0), (0.0, 0.0, 1.5), 0)
    elif item_id == "bldg_floor_belt_2m":
        mats = mats_from_slots(item, ["slot_main"])
        add_box_to_bmesh(bm, (2.0, 0.28, 0.22), (0.0, 0.0, 0.11), 0)
    elif item_id == "bldg_interior_wall_2m":
        mats = mats_from_slots(item, ["slot_main"])
        dado_h = 3.0
        add_box_to_bmesh(bm, (2.0, 0.14, 3.0), (0.0, 0.0, 1.5), 0)
    elif item_id == "bldg_interior_door_2m":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        dado_h = 3.0
        add_wall_with_opening(bm, 2.0, 3.0, 0.14, 0.0, 0.0, 0.96, 2.08, 0, 0, 1)
    elif item_id == "bldg_floor_slab_2x2":
        mats = mats_from_slots(item, ["slot_main", "slot_bottom"])
        vset = set(add_box_to_bmesh(bm, (2.0, 2.0, 0.16), (0.0, 0.0, 0.08)))
        for f in bm.faces:
            if all(v in vset for v in f.verts):
                f.material_index = 1 if f.normal.z < -0.5 else 0
    elif item_id == "bldg_floor_slab_4x4":
        mats = mats_from_slots(item, ["slot_main", "slot_bottom"])
        vset = set(add_box_to_bmesh(bm, (4.0, 4.0, 0.18), (0.0, 0.0, 0.09)))
        for f in bm.faces:
            if all(v in vset for v in f.verts):
                f.material_index = 1 if f.normal.z < -0.5 else 0
    elif item_id == "bldg_ceiling_2x2":
        mats = mats_from_slots(item, ["slot_main"])
        add_box_to_bmesh(bm, (2.0, 2.0, 0.08), (0.0, 0.0, 0.04), 0)
    elif item_id == "bldg_ceiling_4x4":
        mats = mats_from_slots(item, ["slot_main"])
        add_box_to_bmesh(bm, (4.0, 4.0, 0.08), (0.0, 0.0, 0.04), 0)
    elif item_id == "bldg_skirting_2m":
        mats = mats_from_slots(item, ["slot_main"])
        add_box_to_bmesh(bm, (2.0, 0.03, 0.12), (0.0, 0.0, 0.06), 0)
        bevel = 0.004
    elif item_id == "bldg_stairs_double_3m":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        # Lower flight: 8 steps up to 1.5m
        for i in range(8):
            add_box_to_bmesh(bm, (1.1, 0.28, 0.1875), (-0.6, -1.0 + i * 0.28, 0.09375 + i * 0.1875), 0)
        # Landing
        add_box_to_bmesh(bm, (2.3, 1.0, 0.18), (0.0, 1.5, 1.41), 0)
        # Upper flight: 8 steps from 1.5m to 3.0m
        for i in range(8):
            add_box_to_bmesh(bm, (1.1, 0.28, 0.1875), (0.6, 0.86 - i * 0.28, 1.59375 + i * 0.1875), 0)
        # Handrail posts
        add_box_to_bmesh(bm, (0.05, 0.05, 1.0), (-0.04, -1.0, 0.5), 1)
        add_box_to_bmesh(bm, (0.05, 0.05, 1.0), (-0.04, 1.1, 2.0), 1)
        bevel = 0.006
    elif item_id == "bldg_balcony_railing_2m":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (2.0, 0.05, 0.05), (0.0, 0.0, 1.05), 0)
        add_box_to_bmesh(bm, (2.0, 0.04, 0.04), (0.0, 0.0, 0.08), 0)
        for x in (-0.96, 0.0, 0.96):
            add_box_to_bmesh(bm, (0.05, 0.05, 1.05), (x, 0.0, 0.525), 0)
        add_box_to_bmesh(bm, (1.88, 0.02, 0.92), (0.0, 0.0, 0.56), 1)
        bevel = 0.005
    elif item_id == "bldg_roof_flat_4x4":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (4.0, 4.0, 0.18), (0.0, 0.0, 0.09), 0)
        add_box_to_bmesh(bm, (4.0, 0.16, 0.7), (0.0, 1.92, 0.53), 1)
        add_box_to_bmesh(bm, (4.0, 0.16, 0.7), (0.0, -1.92, 0.53), 1)
        add_box_to_bmesh(bm, (0.16, 3.68, 0.7), (-1.92, 0.0, 0.53), 1)
        add_box_to_bmesh(bm, (0.16, 3.68, 0.7), (1.92, 0.0, 0.53), 1)
    elif item_id == "bldg_roof_pitched_ridge_4m":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (4.0, 0.42, 0.12), (0.0, 0.0, 0.06), 0)
        add_box_to_bmesh(bm, (4.0, 0.12, 0.16), (0.0, 0.0, 0.08), 1)
    elif item_id == "bldg_roof_pitched_slope_4m":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        # Sloped roof panel resting on z=0..1.05m
        mat = Matrix.Translation((0.0, 0.0, 0.525)) @ Matrix.Rotation(math.radians(24), 4, "X") @ Matrix.Diagonal((4.0, 2.3, 0.08, 1.0))
        ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
        vset = set(ret["verts"])
        for f in bm.faces:
            if all(v in vset for v in f.verts):
                f.material_index = 0
        add_box_to_bmesh(bm, (4.0, 0.1, 0.12), (0.0, -1.0, 0.06), 1)
        bevel = 0.005
    elif item_id == "bldg_roof_pitched_gable_4m":
        mats = mats_from_slots(item, ["slot_main"])
        # Triangular gable wall sitting on z=0
        v0 = bm.verts.new((-2.0, -0.1, 0.0))
        v1 = bm.verts.new((2.0, -0.1, 0.0))
        v2 = bm.verts.new((0.0, -0.1, 1.1))
        v3 = bm.verts.new((-2.0, 0.1, 0.0))
        v4 = bm.verts.new((2.0, 0.1, 0.0))
        v5 = bm.verts.new((0.0, 0.1, 1.1))
        bm.faces.new((v0, v1, v2))
        bm.faces.new((v5, v4, v3))
        bm.faces.new((v0, v3, v4, v1))
        bm.faces.new((v1, v4, v5, v2))
        bm.faces.new((v2, v5, v3, v0))
    elif item_id == "bldg_rural_brick_fence_2m":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (2.0, 0.24, 1.85), (0.0, 0.0, 0.925), 0)
        add_box_to_bmesh(bm, (2.02, 0.3, 0.1), (0.0, 0.0, 1.9), 1)
    elif item_id == "bldg_rural_fence_pillar":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (0.38, 0.38, 2.0), (0.0, 0.0, 1.0), 0)
        add_box_to_bmesh(bm, (0.46, 0.46, 0.12), (0.0, 0.0, 2.06), 1)
    elif item_id == "bldg_site_hoarding_2m":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (2.0, 0.06, 2.2), (0.0, 0.0, 1.1), 0)
        for x in (-0.95, 0.95):
            add_box_to_bmesh(bm, (0.08, 0.1, 2.25), (x, 0.0, 1.125), 1)
        add_box_to_bmesh(bm, (2.0, 0.1, 0.08), (0.0, 0.0, 2.24), 1)
    elif item_id == "bldg_greenhouse_arch_4m":
        mats = mats_from_slots(item, ["slot_trim", "slot_film"])
        # Semi-cylindrical arch ribs & film shell (span 4m wide, 2m deep, 2.4m high)
        segs = 10
        rx, rz = 2.0, 2.35
        for y_rib in (-0.95, 0.95):
            for i in range(segs):
                a0 = math.pi * (i / segs)
                a1 = math.pi * ((i + 1) / segs)
                xm = (math.cos(a0) + math.cos(a1)) * 0.5 * rx
                zm = (math.sin(a0) + math.sin(a1)) * 0.5 * rz
                dx = (math.cos(a1) - math.cos(a0)) * rx
                dz = (math.sin(a1) - math.sin(a0)) * rz
                seg_len = math.hypot(dx, dz)
                ang = math.atan2(dz, dx)
                mat = Matrix.Translation((xm, y_rib, zm)) @ Matrix.Rotation(-ang, 4, "Y") @ Matrix.Diagonal((seg_len, 0.04, 0.04, 1.0))
                ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
                vset = set(ret["verts"])
                for f in bm.faces:
                    if all(v in vset for v in f.verts):
                        f.material_index = 0
        # Film outer skin
        for i in range(segs):
            a0 = math.pi * (i / segs)
            a1 = math.pi * ((i + 1) / segs)
            xm = (math.cos(a0) + math.cos(a1)) * 0.5 * rx
            zm = (math.sin(a0) + math.sin(a1)) * 0.5 * rz
            dx = (math.cos(a1) - math.cos(a0)) * rx
            dz = (math.sin(a1) - math.sin(a0)) * rz
            seg_len = math.hypot(dx, dz) + 0.02
            ang = math.atan2(dz, dx)
            mat = Matrix.Translation((xm, 0.0, zm)) @ Matrix.Rotation(-ang, 4, "Y") @ Matrix.Diagonal((seg_len, 2.0, 0.02, 1.0))
            ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
            vset = set(ret["verts"])
            for f in bm.faces:
                if all(v in vset for v in f.verts):
                    f.material_index = 1
        bevel = 0.0
    elif item_id == "bldg_greenhouse_end_4m":
        mats = mats_from_slots(item, ["slot_trim", "slot_film"])
        add_box_to_bmesh(bm, (4.0, 0.06, 0.06), (0.0, 0.0, 0.03), 0)
        add_box_to_bmesh(bm, (0.06, 0.06, 2.1), (-0.5, 0.0, 1.05), 0)
        add_box_to_bmesh(bm, (0.06, 0.06, 2.1), (0.5, 0.0, 1.05), 0)
        add_box_to_bmesh(bm, (3.6, 0.02, 1.9), (0.0, 0.0, 0.95), 1)
        bevel = 0.0
    elif item_id == "bldg_sign_bracket_2m":
        mats = mats_from_slots(item, ["slot_main"])
        add_box_to_bmesh(bm, (2.0, 0.04, 0.04), (0.0, 0.25, 0.62), 0)
        add_box_to_bmesh(bm, (2.0, 0.04, 0.04), (0.0, 0.25, 0.02), 0)
        for x in (-0.95, 0.0, 0.95):
            add_box_to_bmesh(bm, (0.04, 0.28, 0.04), (x, 0.12, 0.62), 0)
            add_box_to_bmesh(bm, (0.04, 0.28, 0.04), (x, 0.12, 0.02), 0)
            add_box_to_bmesh(bm, (0.04, 0.04, 0.64), (x, 0.25, 0.32), 0)
        bevel = 0.004
    elif item_id == "bldg_canopy_awning_2m":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        mat = Matrix.Translation((0.0, 0.55, 0.18)) @ Matrix.Rotation(math.radians(-16), 4, "X") @ Matrix.Diagonal((2.0, 1.15, 0.05, 1.0))
        ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
        vset = set(ret["verts"])
        for f in bm.faces:
            if all(v in vset for v in f.verts):
                f.material_index = 0
        for x in (-0.9, 0.9):
            add_box_to_bmesh(bm, (0.05, 0.9, 0.05), (x, 0.45, 0.025), 1)
        bevel = 0.005

    # --- Pivot doors/windows (10) ---
    elif item_id in ("door_cn_security", "door_interior_wood"):
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        # Frame
        add_box_to_bmesh(bm, (0.06, 0.14, 2.08), (-0.48, 0.0, 1.04), 1)
        add_box_to_bmesh(bm, (0.06, 0.14, 2.08), (0.48, 0.0, 1.04), 1)
        add_box_to_bmesh(bm, (1.02, 0.14, 0.06), (0.0, 0.0, 2.05), 1)
        root_obj, lod1_obj = finalize_bmesh_to_object(bm, "mesh_lod0", mats, micro_bevel=0.005, create_lod1=True)
        # Pivot door leaf with origin at left hinge x=-0.44
        bm_leaf = bmesh.new()
        add_box_to_bmesh(bm_leaf, (0.88, 0.05, 2.0), (0.44, 0.0, 1.0), 0)
        add_box_to_bmesh(bm_leaf, (0.14, 0.09, 0.04), (0.78, 0.0, 1.0), 1)
        leaf_obj, _ = finalize_bmesh_to_object(bm_leaf, "pivot_door", mats, micro_bevel=0.004)
        leaf_obj.location = Vector((-0.44, 0.0, 0.0))
        leaf_obj.parent = root_obj
        children.append(leaf_obj)
        if lod1_obj:
            children.append(lod1_obj)
        return root_obj, children

    elif item_id == "door_unit_glass_double":
        mats = mats_from_slots(item, ["slot_trim", "slot_glass"])
        add_box_to_bmesh(bm, (0.08, 0.12, 2.2), (-0.96, 0.0, 1.1), 0)
        add_box_to_bmesh(bm, (0.08, 0.12, 2.2), (0.96, 0.0, 1.1), 0)
        add_box_to_bmesh(bm, (2.0, 0.12, 0.08), (0.0, 0.0, 2.16), 0)
        root_obj, lod1_obj = finalize_bmesh_to_object(bm, "mesh_lod0", mats, micro_bevel=0.005, create_lod1=True)
        for side, pname, sx in ((-1, "pivot_door_left", -0.92), (1, "pivot_door_right", 0.92)):
            bm_l = bmesh.new()
            dx = 0.45 if side == -1 else -0.45
            add_box_to_bmesh(bm_l, (0.88, 0.03, 2.08), (dx, 0.0, 1.04), 1)
            lo, _ = finalize_bmesh_to_object(bm_l, pname, mats, micro_bevel=0.003)
            lo.location = Vector((sx, 0.0, 0.0))
            lo.parent = root_obj
            children.append(lo)
        if lod1_obj:
            children.append(lod1_obj)
        return root_obj, children

    elif item_id == "door_shop_shutter":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (3.1, 0.24, 0.28), (0.0, 0.0, 2.36), 1)
        add_box_to_bmesh(bm, (0.08, 0.1, 2.3), (-1.5, 0.0, 1.15), 1)
        add_box_to_bmesh(bm, (0.08, 0.1, 2.3), (1.5, 0.0, 1.15), 1)
        root_obj, lod1_obj = finalize_bmesh_to_object(bm, "mesh_lod0", mats, micro_bevel=0.004, create_lod1=True)
        bm_s = bmesh.new()
        add_box_to_bmesh(bm_s, (2.92, 0.04, 2.25), (0.0, 0.0, 1.125), 0)
        sh, _ = finalize_bmesh_to_object(bm_s, "pivot_shutter", mats, micro_bevel=0.003)
        sh.parent = root_obj
        children.append(sh)
        if lod1_obj:
            children.append(lod1_obj)
        return root_obj, children

    elif item_id == "window_aluminum_sliding":
        mats = mats_from_slots(item, ["slot_trim", "slot_glass"])
        add_box_to_bmesh(bm, (1.5, 0.1, 0.06), (0.0, 0.0, 0.03), 0)
        add_box_to_bmesh(bm, (1.5, 0.1, 0.06), (0.0, 0.0, 1.47), 0)
        add_box_to_bmesh(bm, (0.06, 0.1, 1.5), (-0.72, 0.0, 0.75), 0)
        add_box_to_bmesh(bm, (0.06, 0.1, 1.5), (0.72, 0.0, 0.75), 0)
        add_box_to_bmesh(bm, (0.04, 0.06, 1.4), (0.0, 0.0, 0.75), 0)
        add_box_to_bmesh(bm, (0.68, 0.02, 1.38), (0.35, -0.015, 0.75), 1)
        root_obj, lod1_obj = finalize_bmesh_to_object(bm, "mesh_lod0", mats, micro_bevel=0.004, create_lod1=True)
        bm_s = bmesh.new()
        add_box_to_bmesh(bm_s, (0.72, 0.03, 1.4), (0.0, 0.015, 0.75), 1)
        sash, _ = finalize_bmesh_to_object(bm_s, "pivot_sash_left", mats, micro_bevel=0.003)
        sash.location = Vector((-0.34, 0.0, 0.0))
        sash.parent = root_obj
        children.append(sash)
        if lod1_obj:
            children.append(lod1_obj)
        return root_obj, children

    elif item_id == "window_casement":
        mats = mats_from_slots(item, ["slot_trim", "slot_glass"])
        add_box_to_bmesh(bm, (0.9, 0.1, 0.06), (0.0, 0.0, 0.03), 0)
        add_box_to_bmesh(bm, (0.9, 0.1, 0.06), (0.0, 0.0, 1.37), 0)
        add_box_to_bmesh(bm, (0.06, 0.1, 1.4), (-0.42, 0.0, 0.7), 0)
        add_box_to_bmesh(bm, (0.06, 0.1, 1.4), (0.42, 0.0, 0.7), 0)
        root_obj, lod1_obj = finalize_bmesh_to_object(bm, "mesh_lod0", mats, micro_bevel=0.004, create_lod1=True)
        bm_c = bmesh.new()
        add_box_to_bmesh(bm_c, (0.78, 0.04, 1.28), (0.39, 0.0, 0.7), 0)
        add_box_to_bmesh(bm_c, (0.68, 0.02, 1.18), (0.39, 0.0, 0.7), 1)
        cas, _ = finalize_bmesh_to_object(bm_c, "pivot_casement", mats, micro_bevel=0.003)
        cas.location = Vector((-0.39, 0.0, 0.0))
        cas.parent = root_obj
        children.append(cas)
        if lod1_obj:
            children.append(lod1_obj)
        return root_obj, children

    elif item_id == "window_security_grille":
        mats = mats_from_slots(item, ["slot_main"])
        # 3D stainless steel security cage projecting outward (+Y in Blender = -Z in glTF)
        add_box_to_bmesh(bm, (1.6, 0.36, 0.03), (0.0, 0.18, 0.015), 0)
        add_box_to_bmesh(bm, (1.6, 0.36, 0.03), (0.0, 0.18, 1.585), 0)
        for x in (-0.78, -0.52, -0.26, 0.0, 0.26, 0.52, 0.78):
            add_box_to_bmesh(bm, (0.025, 0.025, 1.56), (x, 0.35, 0.8), 0)
        for z in (0.4, 0.8, 1.2):
            add_box_to_bmesh(bm, (1.58, 0.025, 0.025), (0.0, 0.35, z), 0)
        bevel = 0.003

    elif item_id == "door_rural_iron_double":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (0.12, 0.12, 2.2), (-1.56, 0.0, 1.1), 1)
        add_box_to_bmesh(bm, (0.12, 0.12, 2.2), (1.56, 0.0, 1.1), 1)
        root_obj, lod1_obj = finalize_bmesh_to_object(bm, "mesh_lod0", mats, micro_bevel=0.005, create_lod1=True)
        for side, pname, sx in ((-1, "pivot_gate_left", -1.48), (1, "pivot_gate_right", 1.48)):
            bm_g = bmesh.new()
            dx = 0.73 if side == -1 else -0.73
            add_box_to_bmesh(bm_g, (1.46, 0.05, 1.2), (dx, 0.0, 0.6), 0)
            for k in range(5):
                bar_x = (0.15 + k * 0.28) * (-side)
                add_box_to_bmesh(bm_g, (0.03, 0.03, 0.85), (bar_x, 0.0, 1.62), 0)
            add_box_to_bmesh(bm_g, (1.46, 0.04, 0.05), (dx, 0.0, 2.02), 0)
            go, _ = finalize_bmesh_to_object(bm_g, pname, mats, micro_bevel=0.004)
            go.location = Vector((sx, 0.0, 0.0))
            go.parent = root_obj
            children.append(go)
        if lod1_obj:
            children.append(lod1_obj)
        return root_obj, children

    elif item_id == "door_elevator_double":
        mats = mats_from_slots(item, ["slot_main"])
        add_box_to_bmesh(bm, (0.14, 0.16, 2.25), (-0.62, 0.0, 1.125), 0)
        add_box_to_bmesh(bm, (0.14, 0.16, 2.25), (0.62, 0.0, 1.125), 0)
        add_box_to_bmesh(bm, (1.38, 0.16, 0.14), (0.0, 0.0, 2.18), 0)
        root_obj, lod1_obj = finalize_bmesh_to_object(bm, "mesh_lod0", mats, micro_bevel=0.005, create_lod1=True)
        for side, pname, cx in ((-1, "pivot_elev_left", -0.275), (1, "pivot_elev_right", 0.275)):
            bm_e = bmesh.new()
            add_box_to_bmesh(bm_e, (0.54, 0.04, 2.1), (0.0, 0.0, 1.05), 0)
            eo, _ = finalize_bmesh_to_object(bm_e, pname, mats, micro_bevel=0.003)
            eo.location = Vector((cx, 0.0, 0.0))
            eo.parent = root_obj
            children.append(eo)
        if lod1_obj:
            children.append(lod1_obj)
        return root_obj, children

    elif item_id == "barrier_garage_boom":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (0.36, 0.34, 1.05), (0.0, 0.0, 0.525), 0)
        add_box_to_bmesh(bm, (0.24, 0.24, 0.06), (0.0, 0.0, 1.08), 1)
        root_obj, lod1_obj = finalize_bmesh_to_object(bm, "mesh_lod0", mats, micro_bevel=0.005, create_lod1=True)
        bm_b = bmesh.new()
        add_box_to_bmesh(bm_b, (3.2, 0.06, 0.08), (1.6, 0.0, 0.0), 0)
        boom, _ = finalize_bmesh_to_object(bm_b, "pivot_boom", mats, micro_bevel=0.003)
        boom.location = Vector((0.0, 0.0, 0.88))
        boom.parent = root_obj
        children.append(boom)
        if lod1_obj:
            children.append(lod1_obj)
        return root_obj, children

    # --- Wires & Pipes (4) ---
    elif item_id.startswith("wire_catenary_"):
        span = float(item_id.split("_")[-1].replace("m", ""))
        mats = mats_from_slots(item, ["slot_main"])
        segs = 10
        sag = span * 0.06
        for strand_y in (-0.12, 0.0, 0.12):
            for i in range(segs):
                t0 = i / segs
                t1 = (i + 1) / segs
                x0 = (t0 - 0.5) * span
                x1 = (t1 - 0.5) * span
                z0 = sag * (1.0 - 4.0 * (t0 - 0.5) ** 2) * -1.0 + sag
                z1 = sag * (1.0 - 4.0 * (t1 - 0.5) ** 2) * -1.0 + sag
                xm, zm = (x0 + x1) * 0.5, (z0 + z1) * 0.5
                ang = math.atan2(z1 - z0, x1 - x0)
                seg_l = math.hypot(x1 - x0, z1 - z0) + 0.01
                mat = Matrix.Translation((xm, strand_y, zm)) @ Matrix.Rotation(-ang, 4, "Y") @ Matrix.Diagonal((seg_l, 0.022, 0.022, 1.0))
                bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
        bevel = 0.0
    elif item_id == "pipe_pvc_downspout_3m":
        mats = mats_from_slots(item, ["slot_main"])
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=0.055, radius2=0.055, depth=3.0, matrix=Matrix.Translation((0.0, 0.0, 1.5)))
        add_box_to_bmesh(bm, (0.14, 0.12, 0.04), (0.0, -0.02, 0.6), 0)
        add_box_to_bmesh(bm, (0.14, 0.12, 0.04), (0.0, -0.02, 2.4), 0)
        bevel = 0.0

    # --- Structured static functional bases (9) ---
    elif item_id == "base_retail_shelf":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        for x in (-0.58, 0.58):
            add_box_to_bmesh(bm, (0.05, 0.44, 1.85), (x, 0.0, 0.925), 0)
        for z in (0.12, 0.56, 1.0, 1.44, 1.84):
            add_box_to_bmesh(bm, (1.2, 0.44, 0.04), (0.0, 0.0, z), 1)
        bevel = 0.005
    elif item_id == "base_shop_counter":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (1.8, 0.68, 0.92), (0.0, 0.0, 0.46), 0)
        add_box_to_bmesh(bm, (1.86, 0.74, 0.06), (0.0, 0.0, 0.95), 1)
    elif item_id == "base_workbench":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        for x in (-0.7, 0.7):
            for y in (-0.32, 0.32):
                add_box_to_bmesh(bm, (0.08, 0.08, 0.84), (x, y, 0.42), 1)
        add_box_to_bmesh(bm, (1.6, 0.8, 0.07), (0.0, 0.0, 0.875), 0)
    elif item_id == "base_rural_stove":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (1.4, 0.86, 0.78), (0.0, 0.0, 0.39), 0)
        add_box_to_bmesh(bm, (0.36, 0.36, 1.5), (-0.48, -0.22, 0.75), 0)
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=12, radius1=0.28, radius2=0.3, depth=0.12, matrix=Matrix.Translation((0.18, 0.02, 0.82)))
        bevel = 0.008
    elif item_id == "base_concrete_planter":
        mats = mats_from_slots(item, ["slot_main", "slot_soil"])
        add_box_to_bmesh(bm, (1.6, 1.6, 0.45), (0.0, 0.0, 0.225), 0)
        add_box_to_bmesh(bm, (1.36, 1.36, 0.08), (0.0, 0.0, 0.44), 1)
    elif item_id == "base_stone_bollard_bench":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (0.28, 0.38, 0.4), (-0.65, 0.0, 0.2), 0)
        add_box_to_bmesh(bm, (0.28, 0.38, 0.4), (0.65, 0.0, 0.2), 0)
        add_box_to_bmesh(bm, (1.65, 0.44, 0.08), (0.0, 0.0, 0.44), 1)
    elif item_id == "base_bus_shelter_frame":
        mats = mats_from_slots(item, ["slot_main", "slot_glass", "slot_sign"])
        add_box_to_bmesh(bm, (0.1, 0.1, 2.5), (-1.6, -0.55, 1.25), 0)
        add_box_to_bmesh(bm, (0.1, 0.1, 2.5), (1.6, -0.55, 1.25), 0)
        add_box_to_bmesh(bm, (3.6, 1.4, 0.1), (0.0, 0.0, 2.55), 0)
        add_box_to_bmesh(bm, (3.1, 0.03, 2.2), (0.0, -0.55, 1.3), 1)
        add_box_to_bmesh(bm, (0.9, 0.16, 1.9), (1.55, 0.0, 1.25), 2)
    elif item_id == "base_parcel_locker":
        mats = mats_from_slots(item, ["slot_main", "slot_trim"])
        add_box_to_bmesh(bm, (2.2, 0.56, 2.05), (0.0, 0.0, 1.025), 0)
        add_box_to_bmesh(bm, (0.34, 0.03, 0.45), (0.0, 0.29, 1.32), 1)
    elif item_id == "base_community_board":
        mats = mats_from_slots(item, ["slot_main", "slot_glass", "slot_trim"])
        add_box_to_bmesh(bm, (0.1, 0.1, 2.1), (-1.15, 0.0, 1.05), 0)
        add_box_to_bmesh(bm, (0.1, 0.1, 2.1), (1.15, 0.0, 1.05), 0)
        add_box_to_bmesh(bm, (2.3, 0.12, 1.2), (0.0, 0.0, 1.45), 0)
        add_box_to_bmesh(bm, (2.1, 0.02, 1.0), (0.0, 0.06, 1.45), 1)
        add_box_to_bmesh(bm, (2.06, 0.04, 0.96), (0.0, 0.03, 1.45), 2)
        add_box_to_bmesh(bm, (2.5, 0.5, 0.08), (0.0, 0.0, 2.14), 0)

    obj, lod1_obj = finalize_bmesh_to_object(bm, "mesh_lod0", mats, uv_scale=1.0, dado_height=dado_h, micro_bevel=bevel, create_lod1=True)
    if lod1_obj:
        children.append(lod1_obj)
    return obj, children


def main():
    items = load_manifest_items()
    count = 0
    for item_id, (group_name, item) in items.items():
        reset_scene()
        root_obj, child_objs = build_bldg_arch(item_id, item)
        sockets = []
        for s in item.get("sockets", []):
            sockets.append(create_socket(s["name"], s["pos"], parent=root_obj))

        all_objs = [root_obj] + child_objs + sockets
        out_path = os.path.join(RAW_OUT, group_name, f"{item_id}.glb")
        extras = {
            "assetId": item_id,
            "tier": item.get("tier", "T0"),
            "textureMode": "array_override",
        }
        meta = {
            "id": item_id,
            "group": group_name,
            "tier": item.get("tier", "T0"),
            "quadrants": item.get("quadrants", []),
            "tags": item.get("tags", []),
            "materialSlots": item.get("materialSlots", {}),
            "pivots": item.get("pivots", []),
            "sockets": item.get("sockets", []),
        }
        export_glb(out_path, all_objs, extras=extras, meta=meta)
        count += 1
    print(f"[gen_l1_architecture] Exported {count} GLBs to {RAW_OUT}")


if __name__ == "__main__":
    main()
