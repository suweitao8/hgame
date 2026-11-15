#!/usr/bin/env python3
"""Headless Blender helper for HGame 3D asset inspection, pose normalization, and QA rendering."""

import argparse
import json
import math
import os
import sys

import bpy
import mathutils


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_model(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=filepath)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=filepath)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=filepath)
    else:
        raise ValueError(f"Unsupported 3D model extension: {ext}")


def get_mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def get_root_objects():
    return [o for o in bpy.context.scene.objects if o.parent is None and o.type in ("MESH", "EMPTY", "ARMATURE")]


def compute_bounds(mesh_objs):
    mins = mathutils.Vector((1e18, 1e18, 1e18))
    maxs = mathutils.Vector((-1e18, -1e18, -1e18))
    has_verts = False
    for o in mesh_objs:
        mw = o.matrix_world
        for v in o.data.vertices:
            has_verts = True
            w = mw @ v.co
            if w.x < mins.x:
                mins.x = w.x
            if w.y < mins.y:
                mins.y = w.y
            if w.z < mins.z:
                mins.z = w.z
            if w.x > maxs.x:
                maxs.x = w.x
            if w.y > maxs.y:
                maxs.y = w.y
            if w.z > maxs.z:
                maxs.z = w.z
    if not has_verts:
        mins = mathutils.Vector((0.0, 0.0, 0.0))
        maxs = mathutils.Vector((0.0, 0.0, 0.0))
    size = maxs - mins
    center = (mins + maxs) * 0.5
    radius = max(size.length * 0.5, 0.001)
    return {
        "min": [round(mins.x, 5), round(mins.y, 5), round(mins.z, 5)],
        "max": [round(maxs.x, 5), round(maxs.y, 5), round(maxs.z, 5)],
        "size": [round(size.x, 5), round(size.y, 5), round(size.z, 5)],
        "center": [round(center.x, 5), round(center.y, 5), round(center.z, 5)],
        "radius": round(radius, 5),
    }


def collect_stats(mesh_objs):
    meshes = []
    total_tris = 0
    total_verts = 0
    all_textures = []
    seen_tex = set()
    any_uv = False
    for o in mesh_objs:
        me = o.data
        tris = sum(max(0, len(p.vertices) - 2) for p in me.polygons)
        verts = len(me.vertices)
        has_uv = bool(me.uv_layers and len(me.uv_layers) > 0)
        if has_uv:
            any_uv = True
        total_tris += tris
        total_verts += verts
        mats = []
        for m in me.materials:
            if not m:
                continue
            mats.append(m.name)
            if m.use_nodes and m.node_tree:
                for n in m.node_tree.nodes:
                    if n.type == "TEX_IMAGE" and n.image:
                        img = n.image
                        key = (img.name, img.size[0], img.size[1])
                        if key not in seen_tex:
                            seen_tex.add(key)
                            all_textures.append({
                                "name": img.name,
                                "width": int(img.size[0]),
                                "height": int(img.size[1]),
                            })
        meshes.append({
            "name": o.name,
            "triangles": tris,
            "vertices": verts,
            "hasUv": has_uv,
            "materials": mats,
        })
    return {
        "meshCount": len(mesh_objs),
        "triangles": total_tris,
        "vertices": total_verts,
        "hasUv": any_uv,
        "textures": all_textures,
        "meshes": meshes,
        "bounds": compute_bounds(mesh_objs),
    }


def apply_all_transforms(objs):
    bpy.ops.object.select_all(action="DESELECT")
    valid = [o for o in objs if o.name in bpy.data.objects]
    if not valid:
        return
    for o in valid:
        o.select_set(True)
    bpy.context.view_layer.objects.active = valid[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def look_at_euler(cam_pos, target, world_up=(0.0, 0.0, 1.0)):
    forward = (target - cam_pos).normalized()
    up_ref = mathutils.Vector(world_up).normalized()
    if abs(forward.dot(up_ref)) > 0.999:
        up_ref = mathutils.Vector((0.0, 1.0, 0.0))
    right = forward.cross(up_ref).normalized()
    cam_up = right.cross(forward).normalized()
    rot = mathutils.Matrix((
        (right.x, cam_up.x, -forward.x),
        (right.y, cam_up.y, -forward.y),
        (right.z, cam_up.z, -forward.z),
    ))
    return rot.to_euler()


def render_views(mesh_objs, out_dir, view_mode="4", size=512, elev_deg=12.0, engine="BLENDER_EEVEE"):
    os.makedirs(out_dir, exist_ok=True)
    bounds = compute_bounds(mesh_objs)
    center = mathutils.Vector(bounds["center"])
    radius = bounds["radius"]

    world = bpy.data.worlds.new("HGameQAWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.85, 0.88, 0.92, 1.0)
        bg.inputs[1].default_value = 0.9

    sun = bpy.data.objects.new("HGameQASun", bpy.data.lights.new("HGameQASun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (0.7, 0.2, 0.5)
    bpy.context.scene.collection.objects.link(sun)

    scene = bpy.context.scene
    for cand in (engine, "BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        try:
            scene.render.engine = cand
            break
        except Exception:
            continue
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False

    cam_data = bpy.data.cameras.new("HGameQACam")
    cam_data.lens = 55
    cam = bpy.data.objects.new("HGameQACam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    scene.camera = cam

    dist = radius * 2.6
    elev = math.radians(elev_deg)
    views = [
        ("front", (0.0, -dist * math.cos(elev), dist * math.sin(elev)), (0.0, 0.0, 1.0)),
        ("right", (dist * math.cos(elev), 0.0, dist * math.sin(elev)), (0.0, 0.0, 1.0)),
        ("back", (0.0, dist * math.cos(elev), dist * math.sin(elev)), (0.0, 0.0, 1.0)),
        ("left", (-dist * math.cos(elev), 0.0, dist * math.sin(elev)), (0.0, 0.0, 1.0)),
    ]
    if str(view_mode) == "6":
        views.extend([
            ("top", (0.0, 0.0, dist), (0.0, 1.0, 0.0)),
            ("bottom", (0.0, 0.0, -dist), (0.0, -1.0, 0.0)),
        ])

    rendered = []
    for name, off, up_vec in views:
        cam.location = center + mathutils.Vector(off)
        cam.rotation_euler = look_at_euler(cam.location, center, up_vec)
        out_path = os.path.join(out_dir, f"{name}.png")
        scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
        rendered.append(out_path)
    return rendered


def cmd_inspect(args):
    clear_scene()
    import_model(args.input)
    mesh_objs = get_mesh_objects()
    if not mesh_objs:
        raise RuntimeError(f"No mesh objects found in {args.input}")
    stats = collect_stats(mesh_objs)
    stats["input"] = os.path.abspath(args.input)
    if args.out_dir:
        stats["rendered"] = render_views(
            mesh_objs,
            args.out_dir,
            view_mode=args.views,
            size=args.size,
            elev_deg=args.elev,
            engine=args.engine,
        )
    print("HGAME_MODEL3D_JSON:" + json.dumps(stats, ensure_ascii=True))


def cmd_normalize(args):
    clear_scene()
    import_model(args.input)
    mesh_objs = get_mesh_objects()
    if not mesh_objs:
        raise RuntimeError(f"No mesh objects found in {args.input}")

    before = collect_stats(mesh_objs)

    # Rotate root objects in XYZ Euler order, then bake all transforms cleanly.
    if args.rx or args.ry or args.rz:
        rot = (math.radians(args.rx), math.radians(args.ry), math.radians(args.rz))
        for obj in get_root_objects():
            obj.rotation_mode = "XYZ"
            obj.rotation_euler = (
                obj.rotation_euler.x + rot[0],
                obj.rotation_euler.y + rot[1],
                obj.rotation_euler.z + rot[2],
            )
        bpy.context.view_layer.update()
    apply_all_transforms(bpy.context.scene.objects)

    # Optional uniform height scaling.
    if args.target_height and args.target_height > 0:
        bounds = compute_bounds(mesh_objs)
        cur_height = bounds["size"][2]
        if cur_height > 1e-6:
            factor = args.target_height / cur_height
            for obj in get_root_objects():
                obj.scale = (obj.scale.x * factor, obj.scale.y * factor, obj.scale.z * factor)
            bpy.context.view_layer.update()
            apply_all_transforms(bpy.context.scene.objects)

    # Origin alignment: ground (XY centered, min_z=0), center (XYZ centered), or keep.
    if args.origin in ("ground", "center"):
        bounds = compute_bounds(mesh_objs)
        bmin = bounds["min"]
        bmax = bounds["max"]
        dx = -(bmin[0] + bmax[0]) * 0.5
        dy = -(bmin[1] + bmax[1]) * 0.5
        dz = -bmin[2] if args.origin == "ground" else -(bmin[2] + bmax[2]) * 0.5
        for obj in get_root_objects():
            obj.location.x += dx
            obj.location.y += dy
            obj.location.z += dz
        bpy.context.view_layer.update()
        apply_all_transforms(bpy.context.scene.objects)

    # Optional triangle budget decimation while preserving UVs.
    if args.target_faces and args.target_faces > 0:
        cur_tris = sum(sum(max(0, len(p.vertices) - 2) for p in o.data.polygons) for o in mesh_objs)
        if cur_tris > args.target_faces:
            ratio = max(0.001, min(1.0, args.target_faces / float(cur_tris)))
            bpy.ops.object.select_all(action="DESELECT")
            for o in mesh_objs:
                o.select_set(True)
                bpy.context.view_layer.objects.active = o
                mod = o.modifiers.new(name="HGameDecimate", type="DECIMATE")
                mod.decimate_type = "COLLAPSE"
                mod.ratio = ratio
                mod.use_collapse_triangulate = True
                bpy.ops.object.modifier_apply(modifier=mod.name)
                o.select_set(False)

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=args.out, export_format="GLB", export_apply=True)

    after = collect_stats(mesh_objs)
    result = {
        "input": os.path.abspath(args.input),
        "output": os.path.abspath(args.out),
        "rotationDeg": [args.rx, args.ry, args.rz],
        "origin": args.origin,
        "before": before,
        "after": after,
    }
    if args.qa_dir:
        result["rendered"] = render_views(
            mesh_objs,
            args.qa_dir,
            view_mode=args.views,
            size=args.size,
            elev_deg=args.elev,
            engine=args.engine,
        )
    print("HGAME_MODEL3D_JSON:" + json.dumps(result, ensure_ascii=True))


def main():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser(prog="blender-model3d.py")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ins = sub.add_parser("inspect")
    p_ins.add_argument("--input", required=True)
    p_ins.add_argument("--out-dir", default="")
    p_ins.add_argument("--views", default="6", choices=["4", "6"])
    p_ins.add_argument("--size", type=int, default=512)
    p_ins.add_argument("--elev", type=float, default=0.0)
    p_ins.add_argument("--engine", default="BLENDER_EEVEE")

    p_norm = sub.add_parser("normalize")
    p_norm.add_argument("--input", required=True)
    p_norm.add_argument("--out", required=True)
    p_norm.add_argument("--rx", type=float, default=0.0)
    p_norm.add_argument("--ry", type=float, default=0.0)
    p_norm.add_argument("--rz", type=float, default=0.0)
    p_norm.add_argument("--origin", default="ground", choices=["ground", "center", "keep"])
    p_norm.add_argument("--target-height", type=float, default=0.0)
    p_norm.add_argument("--target-faces", type=int, default=0)
    p_norm.add_argument("--qa-dir", default="")
    p_norm.add_argument("--views", default="4", choices=["4", "6"])
    p_norm.add_argument("--size", type=int, default=512)
    p_norm.add_argument("--elev", type=float, default=12.0)
    p_norm.add_argument("--engine", default="BLENDER_EEVEE")

    args = parser.parse_args(argv)
    if args.command == "inspect":
        cmd_inspect(args)
    elif args.command == "normalize":
        cmd_normalize(args)


if __name__ == "__main__":
    main()
