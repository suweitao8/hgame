# blender/lib_bmesh_utils.py (Blender 5.x Headless Ready · Final Spec v5.0)
import json
import os
import bpy
import bmesh
from mathutils import Vector, Matrix


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def get_or_create_slot_material(slot_name: str, is_backdrop: bool = False):
    """创建以 slot 命名的占位材质，兼容 Blender 5.0+（不强写已移除的 API）。"""
    mat_name = f"slot::{slot_name}"
    if mat_name in bpy.data.materials:
        return bpy.data.materials[mat_name]
    mat = bpy.data.materials.new(name=mat_name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    mat["pbrSlot"] = slot_name
    if is_backdrop:
        mat["backdropAtlas"] = slot_name
    return mat


def get_or_create_emissive_material(name: str, color=(1.0, 0.9, 0.7), strength: float = 2.0):
    """无贴图纯色自发光材质（车灯/路灯/指示灯，零显存占用）。"""
    mat_name = f"emissive::{name}"
    if mat_name in bpy.data.materials:
        return bpy.data.materials[mat_name]
    mat = bpy.data.materials.new(name=mat_name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    mat["emissivePure"] = True
    mat["emissiveColor"] = list(color)
    mat["emissiveStrength"] = float(strength)
    if getattr(mat, "node_tree", None):
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = (color[0], color[1], color[2], 1.0)
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def apply_metric_box_uv(bm: bmesh.types.BMesh, uv_scale: float = 1.0, dado_height: float = 0.0):
    """确定性米制 Triplanar/Box UV 映射：1.0m = uv_scale UV，拼接零错位。"""
    uv_layer = bm.loops.layers.uv.verify()
    v_scale = (1.0 / dado_height) if dado_height > 0.0 else uv_scale
    for face in bm.faces:
        n = face.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in face.loops:
            co = loop.vert.co
            if az >= ax and az >= ay:
                u, v = co.x * uv_scale, co.y * uv_scale
            elif ax >= ay and ax >= az:
                u, v = co.y * uv_scale, co.z * v_scale
            else:
                u, v = co.x * uv_scale, co.z * v_scale
            loop[uv_layer].uv = (u, v)


def apply_planar_panel_uv(bm: bmesh.types.BMesh, width: float, height: float, u_offset: float = 0.0, v_offset: float = 0.0, u_scale: float = 1.0, v_scale: float = 1.0):
    """用于远景天际线背景壳的归一化窗格 UV 映射。"""
    uv_layer = bm.loops.layers.uv.verify()
    w = max(1e-4, width)
    h = max(1e-4, height)
    for face in bm.faces:
        n = face.normal
        for loop in face.loops:
            co = loop.vert.co
            horiz = co.y if abs(n.x) > abs(n.y) else co.x
            u = u_offset + ((horiz / w) + 0.5) * u_scale
            v = v_offset + (co.z / h) * v_scale
            loop[uv_layer].uv = (u, v)


def add_box_to_bmesh(bm: bmesh.types.BMesh, size, center=(0.0, 0.0, 0.0), mat_index: int = 0):
    sx, sy, sz = size
    cx, cy, cz = center
    mat = Matrix.Translation((cx, cy, cz)) @ Matrix.Diagonal((sx, sy, sz, 1.0))
    ret = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
    verts = set(ret["verts"])
    for f in bm.faces:
        if all(v in verts for v in f.verts):
            f.material_index = mat_index
    return ret["verts"]


def add_wall_with_opening(bm: bmesh.types.BMesh, width: float, height: float, thickness: float, open_x: float, open_y: float, open_w: float, open_h: float, mat_ext: int = 0, mat_int: int = 1, mat_trim: int = 2):
    half_w = width * 0.5
    ox0 = open_x - open_w * 0.5
    ox1 = open_x + open_w * 0.5
    oy0 = open_y
    oy1 = open_y + open_h

    def assign_wall_faces(box_verts):
        vset = set(box_verts)
        for f in bm.faces:
            if all(v in vset for v in f.verts):
                if f.normal.y > 0.5:
                    f.material_index = mat_ext
                elif f.normal.y < -0.5:
                    f.material_index = mat_int
                else:
                    f.material_index = mat_trim

    lw = ox0 - (-half_w)
    if lw > 1e-4:
        assign_wall_faces(add_box_to_bmesh(bm, (lw, thickness, height), (-half_w + lw * 0.5, 0.0, height * 0.5)))
    rw = half_w - ox1
    if rw > 1e-4:
        assign_wall_faces(add_box_to_bmesh(bm, (rw, thickness, height), (ox1 + rw * 0.5, 0.0, height * 0.5)))
    if oy0 > 1e-4:
        assign_wall_faces(add_box_to_bmesh(bm, (open_w, thickness, oy0), (open_x, 0.0, oy0 * 0.5)))
    hh = height - oy1
    if hh > 1e-4:
        assign_wall_faces(add_box_to_bmesh(bm, (open_w, thickness, hh), (open_x, 0.0, oy1 + hh * 0.5)))


def duplicate_as_lod(src_obj, lod_name: str):
    """复制无倒角骨架或模型对象并重命名为 mesh_lod0 / mesh_lod1 / mesh_lod2。"""
    dup = src_obj.copy()
    dup.data = src_obj.data.copy()
    dup.name = lod_name
    bpy.context.collection.objects.link(dup)
    return dup


def add_micro_bevel(obj, width: float = 0.01, segments: int = 1):
    """为建筑/道路硬边添加微倒角与加权法线（Blender 5.x 原生法线流）。"""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()

    bev = obj.modifiers.new(name="MicroBevel", type="BEVEL")
    bev.width = width
    bev.segments = segments
    bev.limit_method = "ANGLE"
    bev.angle_limit = 0.523599  # 30 deg
    bev.harden_normals = False

    wn = obj.modifiers.new(name="WeightedNormal", type="WEIGHTED_NORMAL")
    wn.keep_sharp = False


def finalize_bmesh_to_object(bm: bmesh.types.BMesh, name: str, materials: list, uv_scale: float = 1.0, dado_height: float = 0.0, micro_bevel: float = 0.01, auto_uv: bool = True, create_lod1: bool = False):
    """
    v5.0 规范：若 create_lod1=True 且 micro_bevel>0，先保留无倒角骨架为 mesh_lod1（或 <name>_lod1），
    再对主对象添加微倒角作为 mesh_lod0，确保两级 LOD 外框顶点 100% 重合、无缝拼接。
    """
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if auto_uv:
        apply_metric_box_uv(bm, uv_scale=uv_scale, dado_height=dado_height)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for m in materials:
        obj.data.materials.append(m)

    lod1_obj = None
    if create_lod1 and micro_bevel > 0.0:
        lod1_name = "mesh_lod1" if name == "mesh_lod0" else f"{name}_lod1"
        lod1_obj = duplicate_as_lod(obj, lod1_name)
        lod1_obj["lodLevel"] = 1

    if micro_bevel > 0.0:
        add_micro_bevel(obj, width=micro_bevel, segments=1)
    else:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_smooth()

    obj["lodLevel"] = 0
    return obj, lod1_obj


def create_socket(name: str, location_gltf, rotation=(0.0, 0.0, 0.0), parent=None):
    gx, gy, gz = location_gltf
    empty = bpy.data.objects.new(name=f"socket_{name}", object_data=None)
    empty.location = Vector((gx, -gz, gy))
    empty.rotation_euler = rotation
    empty.empty_display_size = 0.15
    bpy.context.collection.objects.link(empty)
    if parent:
        empty.parent = parent
    return empty


def export_glb(filepath: str, objects: list, extras: dict = None, meta: dict = None):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]
        if extras:
            for k, v in extras.items():
                objects[0][k] = v

    valid_props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kwargs = {
        "filepath": filepath,
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_apply": True,
        "export_extras": True,
        "export_texcoords": True,
        "export_normals": True,
        "export_materials": "EXPORT",
    }
    bpy.ops.export_scene.gltf(**{k: v for k, v in kwargs.items() if k in valid_props})

    if meta is not None:
        meta_path = os.path.splitext(filepath)[0] + ".meta.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
