# blender/gen_l1_roads.py
# 批量生成现代城乡路网 (17) + 远景天际线背景壳 (6) = 23 GLBs
import json
import math
import os
import sys
import bpy
import bmesh
from mathutils import Matrix

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from lib_bmesh_utils import (
    reset_scene,
    get_or_create_slot_material,
    add_box_to_bmesh,
    finalize_bmesh_to_object,
    apply_planar_panel_uv,
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
        if g["group"] in ("l1_road", "l1_backdrop"):
            for item in g["items"]:
                items[item["id"]] = (g["group"], item)
    return items


def mats_from_slots(item, order, is_backdrop=False):
    slots = item.get("materialSlots", {})
    return [get_or_create_slot_material(slots[k], is_backdrop=is_backdrop) for k in order if k in slots]


def build_road_item(item_id, item):
    bm = bmesh.new()
    bevel = 0.008

    if item_id in ("road_urban_2lane_straight", "road_urban_2lane_crosswalk"):
        order = ["slot_road", "slot_sidewalk", "slot_tactile" if "slot_tactile" in item["materialSlots"] else "slot_curb"]
        mats = mats_from_slots(item, order)
        # 10m x 10m block: 7.0m asphalt center, 1.5m sidewalks each side with 0.15m curb height and 0.6m tactile strip
        add_box_to_bmesh(bm, (7.0, 10.0, 0.1), (0.0, 0.0, 0.05), 0)
        for sx in (-1, 1):
            add_box_to_bmesh(bm, (0.9, 10.0, 0.25), (sx * 4.55, 0.0, 0.125), 1)
            add_box_to_bmesh(bm, (0.6, 10.0, 0.255), (sx * 3.8, 0.0, 0.1275), 2)
    elif item_id == "road_urban_2lane_turn":
        mats = mats_from_slots(item, ["slot_road", "slot_sidewalk", "slot_tactile"])
        add_box_to_bmesh(bm, (10.0, 10.0, 0.1), (0.0, 0.0, 0.05), 0)
        add_box_to_bmesh(bm, (1.5, 10.0, 0.25), (-4.25, 0.0, 0.125), 1)
        add_box_to_bmesh(bm, (8.5, 1.5, 0.25), (0.75, 4.25, 0.125), 1)
        add_box_to_bmesh(bm, (1.5, 1.5, 0.25), (4.25, -4.25, 0.125), 2)
    elif item_id == "road_urban_2lane_t":
        mats = mats_from_slots(item, ["slot_road", "slot_sidewalk", "slot_tactile"])
        add_box_to_bmesh(bm, (10.0, 10.0, 0.1), (0.0, 0.0, 0.05), 0)
        add_box_to_bmesh(bm, (1.5, 10.0, 0.25), (-4.25, 0.0, 0.125), 1)
        add_box_to_bmesh(bm, (1.5, 1.5, 0.25), (4.25, 4.25, 0.125), 2)
        add_box_to_bmesh(bm, (1.5, 1.5, 0.25), (4.25, -4.25, 0.125), 2)
    elif item_id == "road_urban_2lane_cross":
        mats = mats_from_slots(item, ["slot_road", "slot_sidewalk", "slot_tactile"])
        add_box_to_bmesh(bm, (10.0, 10.0, 0.1), (0.0, 0.0, 0.05), 0)
        for sx in (-1, 1):
            for sy in (-1, 1):
                add_box_to_bmesh(bm, (1.5, 1.5, 0.25), (sx * 4.25, sy * 4.25, 0.125), 1)
                add_box_to_bmesh(bm, (0.4, 1.5, 0.255), (sx * 3.7, sy * 4.25, 0.1275), 2)
    elif item_id == "road_urban_2lane_ramp":
        mats = mats_from_slots(item, ["slot_road", "slot_sidewalk"])
        ang = math.atan2(1.5, 10.0)
        length = math.hypot(10.0, 1.5)
        z_base = 0.5 * length * math.sin(ang) + 0.5 * 0.16 * math.cos(ang)
        mat = Matrix.Translation((0.0, 0.0, z_base)) @ Matrix.Rotation(-ang, 4, "X") @ Matrix.Diagonal((7.0, length, 0.16, 1.0))
        ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
        for sx in (-3.65, 3.65):
            cmat = Matrix.Translation((sx, 0.0, z_base + 0.1)) @ Matrix.Rotation(-ang, 4, "X") @ Matrix.Diagonal((0.3, length, 0.36, 1.0))
            cret = bmesh.ops.create_cube(bm, size=1.0, matrix=cmat)
            vset = set(cret["verts"])
            for f in bm.faces:
                if all(v in vset for v in f.verts):
                    f.material_index = 1
    elif item_id == "road_urban_2lane_deadend":
        mats = mats_from_slots(item, ["slot_road", "slot_sidewalk", "slot_curb"])
        add_box_to_bmesh(bm, (7.0, 8.5, 0.1), (0.0, -0.75, 0.05), 0)
        add_box_to_bmesh(bm, (10.0, 1.5, 0.25), (0.0, 4.25, 0.125), 1)
        add_box_to_bmesh(bm, (1.5, 8.5, 0.25), (-4.25, -0.75, 0.125), 1)
        add_box_to_bmesh(bm, (1.5, 8.5, 0.25), (4.25, -0.75, 0.125), 1)
        add_box_to_bmesh(bm, (7.2, 0.22, 0.55), (0.0, 3.45, 0.275), 2)
    elif item_id == "road_urban_roundabout":
        mats = mats_from_slots(item, ["slot_road", "slot_sidewalk", "slot_curb"])
        add_box_to_bmesh(bm, (12.0, 12.0, 0.1), (0.0, 0.0, 0.05), 0)
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=16, radius1=2.6, radius2=2.5, depth=0.3, matrix=Matrix.Translation((0.0, 0.0, 0.15)))
        for f in bm.faces:
            if f.calc_center_median().z > 0.16:
                f.material_index = 1
    elif item_id == "road_urban_4lane_straight":
        mats = mats_from_slots(item, ["slot_road", "slot_sidewalk", "slot_tactile"])
        add_box_to_bmesh(bm, (14.0, 10.0, 0.1), (0.0, 0.0, 0.05), 0)
        for sx in (-1, 1):
            add_box_to_bmesh(bm, (1.0, 10.0, 0.25), (sx * 8.1, 0.0, 0.125), 1)
            add_box_to_bmesh(bm, (0.6, 10.0, 0.255), (sx * 7.3, 0.0, 0.1275), 2)
    elif item_id == "road_viaduct_deck_10m":
        mats = mats_from_slots(item, ["slot_road", "slot_trim"])
        add_box_to_bmesh(bm, (9.0, 10.0, 0.55), (0.0, 0.0, 0.275), 0)
        for sx in (-4.75, 4.75):
            add_box_to_bmesh(bm, (0.5, 10.0, 1.35), (sx, 0.0, 0.675), 1)
    elif item_id == "road_viaduct_pier":
        mats = mats_from_slots(item, ["slot_main"])
        add_box_to_bmesh(bm, (1.6, 1.6, 5.2), (0.0, 0.0, 2.6), 0)
        add_box_to_bmesh(bm, (8.6, 1.8, 1.1), (0.0, 0.0, 5.75), 0)
    elif item_id == "road_garage_ramp":
        mats = mats_from_slots(item, ["slot_road", "slot_trim"])
        ang = math.atan2(3.0, 12.0)
        length = math.hypot(12.0, 3.0)
        z_base = 0.5 * length * math.sin(ang) + 0.5 * 0.18 * math.cos(ang)
        mat = Matrix.Translation((0.0, 0.0, z_base)) @ Matrix.Rotation(-ang, 4, "X") @ Matrix.Diagonal((5.4, length, 0.18, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
        for sx in (-2.85, 2.85):
            wmat = Matrix.Translation((sx, 0.0, z_base + 0.35)) @ Matrix.Rotation(-ang, 4, "X") @ Matrix.Diagonal((0.3, length, 0.85, 1.0))
            wret = bmesh.ops.create_cube(bm, size=1.0, matrix=wmat)
            vset = set(wret["verts"])
            for f in bm.faces:
                if all(v in vset for v in f.verts):
                    f.material_index = 1
    elif item_id == "road_rural_concrete_straight":
        mats = mats_from_slots(item, ["slot_road", "slot_shoulder"])
        add_box_to_bmesh(bm, (4.0, 10.0, 0.12), (0.0, 0.0, 0.06), 0)
        for sx in (-2.5, 2.5):
            add_box_to_bmesh(bm, (1.0, 10.0, 0.08), (sx, 0.0, 0.04), 1)
    elif item_id == "road_rural_concrete_turn":
        mats = mats_from_slots(item, ["slot_road", "slot_shoulder"])
        add_box_to_bmesh(bm, (6.0, 6.0, 0.08), (0.0, 0.0, 0.04), 1)
        add_box_to_bmesh(bm, (4.0, 5.0, 0.12), (0.0, -0.5, 0.06), 0)
        add_box_to_bmesh(bm, (5.0, 4.0, 0.12), (0.5, 0.0, 0.06), 0)
    elif item_id == "road_rural_concrete_cross":
        mats = mats_from_slots(item, ["slot_road", "slot_shoulder"])
        add_box_to_bmesh(bm, (8.0, 8.0, 0.08), (0.0, 0.0, 0.04), 1)
        add_box_to_bmesh(bm, (4.0, 8.0, 0.12), (0.0, 0.0, 0.06), 0)
        add_box_to_bmesh(bm, (8.0, 4.0, 0.12), (0.0, 0.0, 0.06), 0)
    elif item_id == "road_rural_dirt_transition":
        mats = mats_from_slots(item, ["slot_road", "slot_shoulder"])
        add_box_to_bmesh(bm, (4.0, 5.0, 0.12), (0.0, -2.5, 0.06), 0)
        add_box_to_bmesh(bm, (4.4, 5.0, 0.09), (0.0, 2.5, 0.045), 1)
    elif item_id == "road_rural_bridge":
        mats = mats_from_slots(item, ["slot_road", "slot_trim"])
        add_box_to_bmesh(bm, (4.2, 8.0, 0.24), (0.0, 0.0, 0.88), 0)
        for sx in (-2.05, 2.05):
            add_box_to_bmesh(bm, (0.2, 8.0, 0.72), (sx, 0.0, 1.36), 1)
        for sy in (-3.6, 3.6):
            add_box_to_bmesh(bm, (4.4, 0.5, 0.8), (0.0, sy, 0.4), 1)

    obj, lod1_obj = finalize_bmesh_to_object(bm, "mesh_lod0", mats, uv_scale=1.0, micro_bevel=bevel, create_lod1=True)
    return [obj, lod1_obj] if lod1_obj else [obj]


def build_backdrop_item(item_id, item):
    bm = bmesh.new()
    mats = mats_from_slots(item, ["slot_main"], is_backdrop=True)
    is_modern = "cbd" in item_id

    if item_id == "backdrop_cbd_tower_a":
        add_box_to_bmesh(bm, (26.0, 22.0, 95.0), (0.0, 0.0, 47.5), 0)
        add_box_to_bmesh(bm, (18.0, 16.0, 118.0), (22.0, 6.0, 59.0), 0)
        w, h = 26.0, 118.0
    elif item_id == "backdrop_cbd_tower_b":
        add_box_to_bmesh(bm, (30.0, 24.0, 82.0), (-16.0, 0.0, 41.0), 0)
        add_box_to_bmesh(bm, (22.0, 20.0, 136.0), (14.0, -4.0, 68.0), 0)
        w, h = 30.0, 136.0
    elif item_id == "backdrop_cbd_tower_c":
        add_box_to_bmesh(bm, (24.0, 24.0, 74.0), (0.0, 0.0, 37.0), 0)
        add_box_to_bmesh(bm, (14.0, 14.0, 18.0), (0.0, 0.0, 83.0), 0)
        w, h = 24.0, 92.0
    elif item_id == "backdrop_oldtown_block_a":
        add_box_to_bmesh(bm, (32.0, 12.0, 21.0), (0.0, 0.0, 10.5), 0)
        w, h = 32.0, 21.0
    elif item_id == "backdrop_oldtown_block_b":
        add_box_to_bmesh(bm, (24.0, 12.0, 18.0), (-14.0, 0.0, 9.0), 0)
        add_box_to_bmesh(bm, (20.0, 12.0, 24.0), (12.0, 4.0, 12.0), 0)
        w, h = 24.0, 24.0
    else:
        # backdrop_rural_hills_ring: 16-segment undulating mountain horizon ring (radius 180m)
        segs = 16
        r_in, r_out = 170.0, 210.0
        for i in range(segs):
            a0 = (2.0 * math.pi * i) / segs
            a1 = (2.0 * math.pi * (i + 1)) / segs
            h0 = 14.0 + 10.0 * math.sin(i * 1.3)
            h1 = 14.0 + 10.0 * math.sin((i + 1) * 1.3)
            v0 = bm.verts.new((math.cos(a0) * r_in, math.sin(a0) * r_in, 0.0))
            v1 = bm.verts.new((math.cos(a1) * r_in, math.sin(a1) * r_in, 0.0))
            v2 = bm.verts.new((math.cos(a1) * r_out, math.sin(a1) * r_out, h1))
            v3 = bm.verts.new((math.cos(a0) * r_out, math.sin(a0) * r_out, h0))
            bm.faces.new((v0, v1, v2, v3))
        obj, _ = finalize_bmesh_to_object(bm, "mesh_lod0", mats, uv_scale=0.05, micro_bevel=0.0)
        return [obj]

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    v_off = 0.5 if is_modern else 0.0
    apply_planar_panel_uv(bm, w, h, u_offset=0.0, v_offset=v_off, u_scale=1.0, v_scale=0.5)
    obj, _ = finalize_bmesh_to_object(bm, "mesh_lod0", mats, micro_bevel=0.0, auto_uv=False)
    return [obj]


def main():
    items = load_manifest_items()
    count = 0
    for item_id, (group_name, item) in items.items():
        reset_scene()
        objs = build_backdrop_item(item_id, item) if group_name == "l1_backdrop" else build_road_item(item_id, item)
        out_path = os.path.join(RAW_OUT, group_name, f"{item_id}.glb")
        extras = {
            "assetId": item_id,
            "tier": item.get("tier", "T0"),
            "textureMode": "backdrop_atlas" if group_name == "l1_backdrop" else "array_override",
        }
        meta = {
            "id": item_id,
            "group": group_name,
            "tier": item.get("tier", "T0"),
            "quadrants": item.get("quadrants", []),
            "tags": item.get("tags", []),
            "materialSlots": item.get("materialSlots", {}),
            "pivots": [],
            "sockets": [],
        }
        export_glb(out_path, objs, extras=extras, meta=meta)
        count += 1
    print(f"[gen_l1_roads] Exported {count} GLBs to {RAW_OUT}")


if __name__ == "__main__":
    main()
