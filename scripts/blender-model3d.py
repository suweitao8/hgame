#!/usr/bin/env python3
"""Headless Blender helper for HGame 3D asset inspection, pose normalization, and QA rendering."""

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import time
import types

import bpy
import mathutils


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def clear_scene_keep_addons():
    """Reset objects and orphan datablocks without unloading enabled Blender extensions (e.g. Auto-Rig Pro)."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for col in (
        bpy.data.meshes,
        bpy.data.armatures,
        bpy.data.actions,
        bpy.data.materials,
        bpy.data.textures,
        bpy.data.images,
        bpy.data.lights,
        bpy.data.cameras,
    ):
        for item in list(col):
            if item.users == 0:
                col.remove(item, do_unlink=True)


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


def collect_stats(mesh_objs, include_topology=True):
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
    res = {
        "meshCount": len(mesh_objs),
        "triangles": total_tris,
        "vertices": total_verts,
        "hasUv": any_uv,
        "textures": all_textures,
        "meshes": meshes,
        "bounds": compute_bounds(mesh_objs),
    }
    if include_topology:
        res["topologyAudit"] = audit_mesh_topology(mesh_objs)
    return res


def apply_all_transforms(objs):
    bpy.ops.object.select_all(action="DESELECT")
    valid = [o for o in objs if o.name in bpy.data.objects]
    if not valid:
        return
    for o in valid:
        o.select_set(True)
    bpy.context.view_layer.objects.active = valid[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def _compute_face_islands(bm):
    """Return sorted list (largest first) of connected face-sets using shared edges."""
    visited = set()
    islands = []
    for f in bm.faces:
        if f.index in visited:
            continue
        stack = [f]
        visited.add(f.index)
        comp = []
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.edges:
                for nf in e.link_faces:
                    if nf.index not in visited:
                        visited.add(nf.index)
                        stack.append(nf)
        islands.append(comp)
    islands.sort(key=len, reverse=True)
    return islands


def audit_mesh_topology(mesh_objs, spatial_weld=1e-4):
    """Inspect raw & spatially welded topology (holes, loose verts/edges, floating islands)."""
    import bmesh

    totals = {
        "looseVerts": 0,
        "looseEdges": 0,
        "boundaryEdges": 0,
        "holeLoops": 0,
        "nonManifoldEdges": 0,
        "zeroAreaFaces": 0,
        "spatialIslands": 0,
        "tinyIslands": 0,
    }
    for o in mesh_objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        if spatial_weld and spatial_weld > 0:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=spatial_weld)
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.faces.ensure_lookup_table()

        totals["looseVerts"] += sum(1 for v in bm.verts if len(v.link_edges) == 0)
        totals["looseEdges"] += sum(1 for e in bm.edges if len(e.link_faces) == 0)
        totals["boundaryEdges"] += sum(1 for e in bm.edges if len(e.link_faces) == 1)
        totals["nonManifoldEdges"] += sum(1 for e in bm.edges if len(e.link_faces) > 2)
        totals["zeroAreaFaces"] += sum(1 for f in bm.faces if f.calc_area() < 1e-10)

        b_edges = {e.index: e for e in bm.edges if len(e.link_faces) == 1}
        b_seen = set()
        for e_idx, e in b_edges.items():
            if e_idx in b_seen:
                continue
            totals["holeLoops"] += 1
            cur_e, cur_v = e, e.verts[0]
            while True:
                b_seen.add(cur_e.index)
                nxt_v = cur_e.other_vert(cur_v)
                nxt = next((le for le in nxt_v.link_edges if le.index in b_edges and le.index not in b_seen), None)
                if nxt is None:
                    break
                cur_e, cur_v = nxt, nxt_v

        islands = _compute_face_islands(bm)
        totals["spatialIslands"] += len(islands)
        main_len = len(islands[0]) if islands else 0
        cutoff = max(24, int(main_len * 0.01))
        totals["tinyIslands"] += sum(1 for comp in islands[1:] if len(comp) < cutoff)
        bm.free()
    return totals


def repair_mesh_topology(
    obj,
    weld_dist=1e-5,
    fill_holes=True,
    max_hole_sides=128,
    prune_whisker_spikes=False,
    spike_passes=3,
    min_island_faces=24,
    min_island_ratio=0.01,
    keep_largest_only=False,
):
    """Weld cracks, fill open holes, relax thin whisker spikes, and prune loose verts/edges/floating islands."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    stats = {
        "removedLooseVerts": 0,
        "removedLooseEdges": 0,
        "removedZeroFaces": 0,
        "removedIslands": 0,
        "filledHoles": 0,
        "relaxedSpikes": 0,
    }

    def strip_loose_and_degenerate():
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        zfaces = [f for f in bm.faces if f.calc_area() < 1e-10]
        if zfaces:
            stats["removedZeroFaces"] += len(zfaces)
            bmesh.ops.delete(bm, geom=zfaces, context="FACES")
        ledges = [e for e in bm.edges if len(e.link_faces) == 0]
        if ledges:
            stats["removedLooseEdges"] += len(ledges)
            bmesh.ops.delete(bm, geom=ledges, context="EDGES")
        lverts = [v for v in bm.verts if len(v.link_edges) == 0]
        if lverts:
            stats["removedLooseVerts"] += len(lverts)
            bmesh.ops.delete(bm, geom=lverts, context="VERTS")

    strip_loose_and_degenerate()
    if weld_dist and weld_dist > 0 and len(bm.verts) > 0:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld_dist)
        strip_loose_and_degenerate()

    # Relax slender needle spikes (e.g. thin extruded cat whiskers) before decimation/voxelization
    if prune_whisker_spikes and len(bm.verts) > 32:
        for _ in range(spike_passes):
            bm.verts.ensure_lookup_table()
            updates = []
            for v in bm.verts:
                nb = [e.other_vert(v).co for e in v.link_edges]
                if len(nb) < 3:
                    continue
                cent = sum(nb, mathutils.Vector((0.0, 0.0, 0.0))) / float(len(nb))
                avg_edge = sum((c - v.co).length for c in nb) / float(len(nb))
                if avg_edge <= 1e-6:
                    continue
                spread = sum((c - cent).length for c in nb) / float(len(nb))
                disp = (v.co - cent).length
                # Slender protrusion: tip extends sharply far from tightly clustered base ring
                if disp > avg_edge * 0.72 and spread < disp * 1.15:
                    updates.append((v, cent))
            if not updates:
                break
            stats["relaxedSpikes"] += len(updates)
            for v, target_co in updates:
                v.co = v.co.lerp(target_co, 0.85)

    # Close missing faces / open holes AND strip non-manifold fin/pinch faces cleanly
    if fill_holes and len(bm.edges) > 0 and max_hole_sides > 0:
        for _ in range(24):
            bm.edges.ensure_lookup_table()
            bm.faces.ensure_lookup_table()
            nm_edges = [e for e in bm.edges if len(e.link_faces) > 2]
            if nm_edges:
                del_faces = list({f for e in nm_edges for f in e.link_faces})
                bmesh.ops.delete(bm, geom=del_faces, context="FACES")
                strip_loose_and_degenerate()
                continue
            b_edges = [e for e in bm.edges if len(e.link_faces) == 1]
            if not b_edges:
                break
            res = bmesh.ops.holes_fill(bm, edges=b_edges, sides=max_hole_sides)
            new_faces = res.get("faces", []) if isinstance(res, dict) else []
            if new_faces:
                stats["filledHoles"] += len(new_faces)
                ngons = [f for f in new_faces if f.is_valid and len(f.verts) > 4]
                if ngons:
                    bmesh.ops.triangulate(bm, faces=ngons)
                continue
            # Fallback when a boundary loop is blocked by an existing diagonal chord: collapse shortest edge
            short_bd = min(b_edges, key=lambda e: e.calc_length())
            bmesh.ops.collapse(bm, edges=[short_bd])
            strip_loose_and_degenerate()

    # Prune disconnected floating debris (whisker droplets / stray artifacts)
    bm.faces.ensure_lookup_table()
    islands = _compute_face_islands(bm)
    if len(islands) > 1:
        main_count = len(islands[0])
        cutoff = max(min_island_faces, int(main_count * min_island_ratio))
        drop_faces = []
        for idx, comp in enumerate(islands[1:], start=1):
            if keep_largest_only or len(comp) < cutoff:
                stats["removedIslands"] += 1
                drop_faces.extend(comp)
        if drop_faces:
            bmesh.ops.delete(bm, geom=drop_faces, context="FACES")

    strip_loose_and_degenerate()
    if len(bm.faces) > 0:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return stats


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


def normalize_scene_bounds(mesh_objs, target_height=0.0, origin="keep"):
    """Scale uniformly to target_height (if > 0) and align scene origin cleanly."""
    if target_height and target_height > 0:
        bounds = compute_bounds(mesh_objs)
        cur_height = bounds["size"][2]
        if cur_height > 1e-6:
            factor = target_height / cur_height
            for obj in get_root_objects():
                obj.scale = (obj.scale.x * factor, obj.scale.y * factor, obj.scale.z * factor)
            bpy.context.view_layer.update()
            apply_all_transforms(bpy.context.scene.objects)

    if origin in ("ground", "center"):
        bounds = compute_bounds(mesh_objs)
        bmin = bounds["min"]
        bmax = bounds["max"]
        dx = -(bmin[0] + bmax[0]) * 0.5
        dy = -(bmin[1] + bmax[1]) * 0.5
        dz = -bmin[2] if origin == "ground" else -(bmin[2] + bmax[2]) * 0.5
        for obj in get_root_objects():
            obj.location.x += dx
            obj.location.y += dy
            obj.location.z += dz
        bpy.context.view_layer.update()
        apply_all_transforms(bpy.context.scene.objects)


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

    normalize_scene_bounds(mesh_objs, float(args.target_height or 0.0), args.origin)

    pre_repair_logs = []
    if not getattr(args, "no_repair", False):
        for o in mesh_objs:
            pre_repair_logs.append(
                repair_mesh_topology(
                    o,
                    weld_dist=1e-5,
                    fill_holes=True,
                    max_hole_sides=128,
                    prune_whisker_spikes=bool(getattr(args, "prune_whiskers", False)),
                    min_island_faces=24,
                    min_island_ratio=0.005,
                    keep_largest_only=bool(getattr(args, "keep_largest_island", False)),
                )
            )

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

    post_repair_logs = []
    if not getattr(args, "no_repair", False):
        for o in mesh_objs:
            post_repair_logs.append(
                repair_mesh_topology(
                    o,
                    weld_dist=1e-5,
                    fill_holes=True,
                    max_hole_sides=16,
                    prune_whisker_spikes=False,
                    min_island_faces=24,
                    min_island_ratio=0.01,
                    keep_largest_only=bool(getattr(args, "keep_largest_island", False)),
                )
            )

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in mesh_objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=args.out, export_format="GLB", use_selection=True, export_apply=True)

    after = collect_stats(mesh_objs)
    result = {
        "input": os.path.abspath(args.input),
        "output": os.path.abspath(args.out),
        "rotationDeg": [args.rx, args.ry, args.rz],
        "origin": args.origin,
        "preRepair": pre_repair_logs,
        "postRepair": post_repair_logs,
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


def find_xremesh(explicit_path=""):
    """Locate QuadRemesher EngineWin binary (xremesh.exe)."""
    if explicit_path and os.path.isfile(explicit_path):
        return explicit_path
    env_path = os.environ.get("XREMESH_PATH", "")
    if env_path and os.path.isfile(env_path):
        return env_path
    candidates = []
    try:
        ext_root = bpy.utils.extension_path_user("blender_org")
        candidates.append(os.path.join(ext_root, "quadremesher", "EngineWin", "xremesh.exe"))
    except Exception:
        pass
    appdata = os.environ.get("APPDATA", "")
    if appdata:
        ver = f"{bpy.app.version[0]}.{bpy.app.version[1]}"
        candidates.append(os.path.join(appdata, "Blender Foundation", "Blender", ver, "extensions", "blender_org", "quadremesher", "EngineWin", "xremesh.exe"))
    for cand in candidates:
        if os.path.isfile(cand):
            return cand
    raise FileNotFoundError("Cannot find xremesh.exe; install Blender QuadRemesher or pass --xremesh")


def ensure_single_mesh(name="AssetMesh"):
    meshes = get_mesh_objects()
    if not meshes:
        raise RuntimeError("No mesh objects found in scene")
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def attach_dummy_uv_material(obj):
    """Attach a minimal textured material so glTF exporter always writes TEXCOORD_0."""
    mat = bpy.data.materials.new("CleanUVPlaceholder")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out_n = nt.nodes.new("ShaderNodeOutputMaterial")
    p_n = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(p_n.outputs["BSDF"], out_n.inputs["Surface"])
    img = bpy.data.images.new("uv_placeholder_4x4", width=4, height=4)
    img.generated_color = (0.8, 0.8, 0.8, 1.0)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    uv_n = nt.nodes.new("ShaderNodeUVMap")
    if obj.data.uv_layers:
        uv_n.uv_map = obj.data.uv_layers[0].name
    nt.links.new(uv_n.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], p_n.inputs["Base Color"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def wire_clean_pbr_material(obj, bc_path, orm_path="", nm_path="", mat_name="BakedPBR"):
    """Wire BaseColor + ORM + Normal onto obj cleanly without duplicate TexImage references."""
    mat = bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out_n = nt.nodes.new("ShaderNodeOutputMaterial")
    p_n = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(p_n.outputs["BSDF"], out_n.inputs["Surface"])

    uv_node = nt.nodes.new("ShaderNodeUVMap")
    if obj.data.uv_layers:
        uv_node.uv_map = obj.data.uv_layers[0].name

    if bc_path and os.path.isfile(bc_path):
        bc_img = bpy.data.images.load(bc_path)
        bc_img.colorspace_settings.name = "sRGB"
        bc_tex = nt.nodes.new("ShaderNodeTexImage")
        bc_tex.image = bc_img
        nt.links.new(uv_node.outputs["UV"], bc_tex.inputs["Vector"])
        nt.links.new(bc_tex.outputs["Color"], p_n.inputs["Base Color"])

    if orm_path and os.path.isfile(orm_path):
        orm_img = bpy.data.images.load(orm_path)
        orm_img.colorspace_settings.name = "Non-Color"
        orm_tex = nt.nodes.new("ShaderNodeTexImage")
        orm_tex.image = orm_img
        nt.links.new(uv_node.outputs["UV"], orm_tex.inputs["Vector"])
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(orm_tex.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], p_n.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], p_n.inputs["Metallic"])

    if nm_path and os.path.isfile(nm_path):
        nm_img = bpy.data.images.load(nm_path)
        nm_img.colorspace_settings.name = "Non-Color"
        nm_tex = nt.nodes.new("ShaderNodeTexImage")
        nm_tex.image = nm_img
        nt.links.new(uv_node.outputs["UV"], nm_tex.inputs["Vector"])
        nm_node = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nm_tex.outputs["Color"], nm_node.inputs["Color"])
        nt.links.new(nm_node.outputs["Normal"], p_n.inputs["Normal"])

    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return mat


def scale_tangent_normal_file(nm_path, strength_map):
    """Blend tangent-space normal map toward neutral (0.5, 0.5, 1.0) and re-normalize."""
    import numpy as np
    from PIL import Image

    n_arr = np.asarray(Image.open(nm_path).convert("RGB"), dtype=np.float32) / 255.0
    neutral = np.array([0.5, 0.5, 1.0], dtype=np.float32)
    blended = np.clip(neutral + (n_arr - neutral) * strength_map, 0.0, 1.0)
    vec = blended * 2.0 - 1.0
    vec[..., 2] = np.maximum(vec[..., 2], 0.05)
    norm = np.linalg.norm(vec, axis=-1, keepdims=True)
    norm = np.where(norm > 1e-5, norm, 1.0)
    final_nm = np.clip((vec / norm) * 0.5 + 0.5, 0.0, 1.0)
    Image.fromarray((final_nm * 255.0).astype(np.uint8)).save(nm_path)


def run_xremesh(xremesh_exe, in_fbx, out_fbx, work_dir, target_quads=16000, adaptive=50):
    prog = os.path.join(work_dir, "qr-progress.txt")
    cfg = os.path.join(work_dir, "qr-settings.txt")
    for p in (out_fbx, prog, cfg):
        if os.path.exists(p):
            os.remove(p)
    settings = (
        f'HostApp=Blender\n'
        f'FileIn="{in_fbx}"\n'
        f'FileOut="{out_fbx}"\n'
        f'ProgressFile="{prog}"\n'
        f'TargetQuadCount={int(target_quads)}\n'
        f'CurvatureAdaptivness={int(adaptive)}\n'
        f'ExactQuadCount=1\n'
        f'UseVertexColorMap=False\n'
        f'UseMaterialIds=0\n'
        f'UseIndexedNormals=0\n'
        f'AutoDetectHardEdges=0\n'
    )
    with open(cfg, "w", encoding="utf-8") as f:
        f.write(settings)
    proc = subprocess.Popen([xremesh_exe, "-s", cfg])
    deadline = time.time() + 240
    while time.time() < deadline:
        if os.path.exists(prog):
            try:
                txt = open(prog, "r", encoding="utf-8", errors="ignore").read().strip()
                if txt.startswith("2") and os.path.exists(out_fbx) and os.path.getsize(out_fbx) > 0:
                    break
                if txt.startswith("-"):
                    raise RuntimeError(f"xremesh failed with progress {txt}")
            except OSError:
                pass
        if proc.poll() is not None and os.path.exists(out_fbx) and os.path.getsize(out_fbx) > 0:
            break
        time.sleep(0.25)
    if proc.poll() is None:
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
    if not os.path.exists(out_fbx) or os.path.getsize(out_fbx) == 0:
        raise RuntimeError("xremesh did not produce output FBX")


def run_uv_unwrap(obj, solver="organic"):
    """Unwrap remeshed quad object with auto_unwrap (organic/smart) or Blender Smart Project fallback."""
    if solver == "blender":
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
        return

    bpy.ops.preferences.addon_enable(module="auto_unwrap")
    import auto_unwrap as au

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    p = bpy.context.scene.auto_unwrap
    p.parts_count = 12
    p.method = "PLAN"
    p.priority = "BALANCED"
    p.margin = 0.005
    p.symmetry = False
    p.sym_midcut = True
    p.join_islands = 0.0
    p.fast_mode = True
    p.fast_limit = 50000
    p.clean_seams = True
    p.min_tris = 24
    p.workers = 4
    p.udim_tiles = 1
    p.pack = True
    p.final_pack = True
    p.stack_repeats = False
    p.repack_even = True
    p.uv_orient = False

    if solver == "smart":
        res = bpy.ops.autounwrap.smart_uv("EXEC_DEFAULT")
        if res != {"FINISHED"}:
            raise RuntimeError(f"smart_uv failed: {res}")
        return

    class WM:
        def event_timer_add(self, *a, **kw):
            return object()
        def event_timer_remove(self, *a, **kw):
            pass
        def modal_handler_add(self, *a, **kw):
            pass
        def __getattr__(self, key):
            return getattr(bpy.context.window_manager, key)

    class Context:
        window_manager = WM()
        screen = types.SimpleNamespace(areas=[])
        window = None
        def __getattr__(self, key):
            return getattr(bpy.context, key)

    class Driver:
        def __init__(self):
            self.reports = []
        def report(self, level, msg):
            self.reports.append((list(level), msg))
        def __getattr__(self, key):
            item = getattr(au.AUTOUNWRAP_OT_unwrap, key)
            return types.MethodType(item, self) if callable(item) else item

    d = Driver()
    ctx = Context()
    res = d.invoke(ctx, None)
    start = time.time()
    while res in ({"RUNNING_MODAL"}, {"PASS_THROUGH"}):
        if time.time() - start > 300:
            d.modal(ctx, types.SimpleNamespace(type="ESC"))
            raise TimeoutError("auto_unwrap organic timeout")
        time.sleep(0.25)
        res = d.modal(ctx, types.SimpleNamespace(type="TIMER"))
    if res != {"FINISHED"}:
        raise RuntimeError(f"auto_unwrap failed: {res} reports={d.reports}")


def cmd_remesh_bake(args):
    import numpy as np
    from PIL import Image

    xremesh_exe = find_xremesh(args.xremesh)
    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    work_dir = args.work_dir or os.path.join(out_dir, f"{os.path.splitext(os.path.basename(args.out))[0]}_maps")
    os.makedirs(work_dir, exist_ok=True)

    clear_scene_keep_addons()
    import_model(args.input)
    high = ensure_single_mesh("HighPolySrc")
    normalize_scene_bounds([high], float(getattr(args, "target_height", 0.0) or 0.0), getattr(args, "origin", "keep"))

    # Build a clean watertight proxy mesh via Voxel Remesh for xremesh.exe
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    bpy.context.view_layer.objects.active = high
    bpy.ops.object.duplicate()
    qr_in = bpy.context.active_object
    qr_in.name = "QRIn"
    for uv in list(qr_in.data.uv_layers):
        qr_in.data.uv_layers.remove(uv)
    qr_in.data.materials.clear()
    pre_remesh_repair = repair_mesh_topology(
        qr_in,
        weld_dist=1e-4,
        fill_holes=True,
        max_hole_sides=256,
        prune_whisker_spikes=True,
        spike_passes=4,
        min_island_faces=24,
        min_island_ratio=0.01,
        keep_largest_only=False,
    )
    cur_tris = len(qr_in.data.polygons)
    if cur_tris > 120000:
        dec = qr_in.modifiers.new("QRDecimate", "DECIMATE")
        dec.ratio = 120000.0 / float(cur_tris)
        bpy.ops.object.modifier_apply(modifier=dec.name)
    sm = qr_in.modifiers.new("QRSmooth", "SMOOTH")
    sm.factor = 0.4
    sm.iterations = 2
    bpy.ops.object.modifier_apply(modifier=sm.name)

    max_dim = max(qr_in.dimensions.x, qr_in.dimensions.y, qr_in.dimensions.z, 0.1)
    vx = qr_in.modifiers.new("QRVoxel", "REMESH")
    vx.mode = "VOXEL"
    vx.voxel_size = max_dim / float(args.voxel_div)
    vx.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=vx.name)
    sm2 = qr_in.modifiers.new("QRSmoothPost", "SMOOTH")
    sm2.factor = 0.45
    sm2.iterations = 2
    bpy.ops.object.modifier_apply(modifier=sm2.name)
    post_voxel_repair = repair_mesh_topology(
        qr_in,
        weld_dist=0.0,
        fill_holes=True,
        max_hole_sides=64,
        prune_whisker_spikes=False,
        keep_largest_only=True,
    )

    qr_in_fbx = os.path.join(work_dir, "qr-input.fbx")
    qr_out_fbx = os.path.join(work_dir, "qr-output.fbx")
    bpy.ops.object.select_all(action="DESELECT")
    qr_in.select_set(True)
    bpy.ops.export_scene.fbx(filepath=qr_in_fbx, use_selection=True, object_types={"MESH"}, bake_anim=False)
    bpy.data.objects.remove(qr_in, do_unlink=True)

    run_xremesh(xremesh_exe, qr_in_fbx, qr_out_fbx, work_dir, target_quads=args.target_quads, adaptive=args.adaptive)
    bpy.ops.import_scene.fbx(filepath=qr_out_fbx)
    low = next(o for o in get_mesh_objects() if o != high)
    low.name = "RemeshedAsset"
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if any(len(poly.vertices) > 3 for poly in low.data.polygons):
        tri_pre = low.modifiers.new("PreRepairTri", "TRIANGULATE")
        bpy.ops.object.modifier_apply(modifier=tri_pre.name)
    post_low_repair = repair_mesh_topology(
        low,
        weld_dist=1e-4,
        fill_holes=True,
        max_hole_sides=64,
        prune_whisker_spikes=False,
        min_island_faces=24,
        min_island_ratio=0.01,
        keep_largest_only=True,
    )
    max_tris_cap = int(getattr(args, "max_tris", 0) or 0)
    if max_tris_cap > 0:
        cur_low_tris = sum(max(1, len(p.vertices) - 2) for p in low.data.polygons)
        if cur_low_tris > max_tris_cap:
            dec_cap = low.modifiers.new("CapMaxTris", "DECIMATE")
            dec_cap.decimate_type = "COLLAPSE"
            dec_cap.ratio = max(0.25, min(1.0, float(max(max_tris_cap - 60, 100)) / float(cur_low_tris)))
            dec_cap.use_collapse_triangulate = True
            bpy.ops.object.select_all(action="DESELECT")
            low.select_set(True)
            bpy.context.view_layer.objects.active = low
            bpy.ops.object.modifier_apply(modifier=dec_cap.name)
            post_low_repair = repair_mesh_topology(
                low,
                weld_dist=1e-4,
                fill_holes=True,
                max_hole_sides=64,
                prune_whisker_spikes=False,
                min_island_faces=24,
                min_island_ratio=0.01,
                keep_largest_only=True,
            )
    run_uv_unwrap(low, solver=args.uv_solver)
    for p in low.data.polygons:
        p.use_smooth = True

    if args.clean_uv_out:
        attach_dummy_uv_material(low)
        clean_dir = os.path.dirname(os.path.abspath(args.clean_uv_out))
        if clean_dir:
            os.makedirs(clean_dir, exist_ok=True)
        bpy.ops.object.select_all(action="DESELECT")
        low.select_set(True)
        bpy.ops.export_scene.gltf(filepath=args.clean_uv_out, export_format="GLB", use_selection=True, export_apply=True)

    if any(len(poly.vertices) > 3 for poly in low.data.polygons):
        tri = low.modifiers.new("FinalTri", "TRIANGULATE")
        bpy.ops.object.select_all(action="DESELECT")
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        bpy.ops.object.modifier_apply(modifier=tri.name)

    mat = bpy.data.materials.new("BakeTargetTmp")
    mat.use_nodes = True
    low.data.materials.clear()
    low.data.materials.append(mat)
    target = mat.node_tree.nodes.new("ShaderNodeTexImage")
    mat.node_tree.nodes.active = target

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = int(args.samples)
    bake = scene.render.bake
    bake.use_selected_to_active = True
    bake.use_cage = False
    bake.cage_extrusion = float(args.cage_extrusion)
    bake.max_ray_distance = float(args.max_ray_distance)
    bake.margin = 8
    bake.margin_type = "ADJACENT_FACES"
    bake.use_clear = True
    bake.normal_space = "TANGENT"
    bake.normal_r = "POS_X"
    bake.normal_g = "POS_Y"
    bake.normal_b = "POS_Z"

    src_mat = high.data.materials[0] if high.data.materials else None
    if src_mat is None:
        raise RuntimeError("Source mesh has no material to bake")
    nodes = src_mat.node_tree.nodes
    links = src_mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    output = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    em = nodes.new("ShaderNodeEmission")

    paths = {}
    temp_imgs = []
    for ch, sock in [("BaseColor", "Base Color"), ("Metallic", "Metallic"), ("Roughness", "Roughness")]:
        img = bpy.data.images.new(f"rb_{ch}", width=args.texture_size, height=args.texture_size, alpha=False)
        img.colorspace_settings.name = "sRGB" if ch == "BaseColor" else "Non-Color"
        temp_imgs.append(img)
        target.image = img
        for l in list(output.inputs["Surface"].links):
            links.remove(l)
        for l in list(em.inputs["Color"].links):
            links.remove(l)
        src = bsdf.inputs[sock]
        if src.is_linked:
            links.new(src.links[0].from_socket, em.inputs["Color"])
        else:
            v = src.default_value
            em.inputs["Color"].default_value = v if hasattr(v, "__len__") else (v, v, v, 1.0)
        links.new(em.outputs[0], output.inputs["Surface"])

        bpy.ops.object.select_all(action="DESELECT")
        high.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        bpy.ops.object.bake(type="EMIT", margin_type="ADJACENT_FACES")
        out_p = os.path.join(work_dir, f"{ch}.png")
        img.filepath_raw = out_p
        img.file_format = "PNG"
        img.save()
        paths[ch] = out_p

    # Weld split vertices & close open holes on high mesh before Normal bake so tangents don't crack
    if not args.no_weld_high:
        repair_mesh_topology(
            high,
            weld_dist=1e-5,
            fill_holes=True,
            max_hole_sides=128,
            prune_whisker_spikes=False,
            min_island_faces=24,
            min_island_ratio=0.005,
        )
    for p in high.data.polygons:
        p.use_smooth = True

    smooth_z = float(args.smooth_head_z)
    if smooth_z <= 0.0 and getattr(args, "smooth_head_ratio", 0.0) > 0.0:
        zs_h = [v.co.z for v in high.data.vertices]
        if zs_h:
            z_min_h, z_max_h = min(zs_h), max(zs_h)
            smooth_z = z_min_h + float(args.smooth_head_ratio) * (z_max_h - z_min_h)

    if smooth_z > 0.0:
        z_lo = max(0.0, smooth_z - 0.04)
        z_hi = smooth_z + 0.04
        vg = high.vertex_groups.new(name="SmoothUpperZ")
        for v in high.data.vertices:
            if v.co.z >= z_hi:
                vg.add([v.index], 1.0, "REPLACE")
            elif v.co.z > z_lo:
                vg.add([v.index], (v.co.z - z_lo) / (z_hi - z_lo), "REPLACE")
        m_sm = high.modifiers.new("SmoothUpperZMod", "SMOOTH")
        m_sm.vertex_group = vg.name
        m_sm.factor = 0.65
        m_sm.iterations = 20
        bpy.ops.object.select_all(action="DESELECT")
        high.select_set(True)
        bpy.context.view_layer.objects.active = high
        bpy.ops.object.modifier_apply(modifier=m_sm.name)

    nm_img = bpy.data.images.new("rb_Normal", width=args.texture_size, height=args.texture_size, alpha=False)
    nm_img.colorspace_settings.name = "Non-Color"
    nm_img.generated_color = (0.5, 0.5, 1.0, 1.0)
    temp_imgs.append(nm_img)
    target.image = nm_img
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type="NORMAL", margin_type="EXTEND")
    nm_path = os.path.join(work_dir, "Normal.png")
    nm_img.filepath_raw = nm_path
    nm_img.file_format = "PNG"
    nm_img.save()

    if smooth_z > 0.0:
        z_lo = max(0.0, smooth_z - 0.04)
        z_hi = smooth_z + 0.04
        mask_mat = bpy.data.materials.new("MaskUpperZ")
        mask_mat.use_nodes = True
        nt_m = mask_mat.node_tree
        nt_m.nodes.clear()
        out_m = nt_m.nodes.new("ShaderNodeOutputMaterial")
        em_m = nt_m.nodes.new("ShaderNodeEmission")
        nt_m.links.new(em_m.outputs["Emission"], out_m.inputs["Surface"])
        geom_m = nt_m.nodes.new("ShaderNodeNewGeometry")
        sep_m = nt_m.nodes.new("ShaderNodeSeparateXYZ")
        map_m = nt_m.nodes.new("ShaderNodeMapRange")
        map_m.clamp = False
        map_m.inputs["From Min"].default_value = z_lo
        map_m.inputs["From Max"].default_value = z_hi
        map_m.inputs["To Min"].default_value = float(args.normal_strength)
        map_m.inputs["To Max"].default_value = 0.0
        nt_m.links.new(geom_m.outputs["Position"], sep_m.inputs["Vector"])
        nt_m.links.new(sep_m.outputs["Z"], map_m.inputs["Value"])
        nt_m.links.new(map_m.outputs["Result"], em_m.inputs["Color"])
        low.data.materials.clear()
        low.data.materials.append(mask_mat)
        msk_img = bpy.data.images.new("rb_Mask", width=args.texture_size, height=args.texture_size, alpha=False)
        msk_img.colorspace_settings.name = "Non-Color"
        t_msk = nt_m.nodes.new("ShaderNodeTexImage")
        t_msk.image = msk_img
        nt_m.nodes.active = t_msk
        bake.use_selected_to_active = False
        bpy.ops.object.select_all(action="DESELECT")
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        bpy.ops.object.bake(type="EMIT", margin_type="EXTEND")
        msk_path = os.path.join(work_dir, "MaskUpperZ.png")
        msk_img.filepath_raw = msk_path
        msk_img.file_format = "PNG"
        msk_img.save()
        w_arr = np.clip(np.asarray(Image.open(msk_path).convert("L"), dtype=np.float32)[..., None] / 255.0, 0.0, float(args.normal_strength))
        scale_tangent_normal_file(nm_path, w_arr)
        bpy.data.images.remove(msk_img, do_unlink=True)
    elif args.normal_strength != 1.0:
        scale_tangent_normal_file(nm_path, float(args.normal_strength))

    r_arr = np.asarray(Image.open(paths["Roughness"]).convert("L"), dtype=np.uint8)
    m_arr = np.asarray(Image.open(paths["Metallic"]).convert("L"), dtype=np.uint8)
    orm_path = os.path.join(work_dir, "ORM.png")
    Image.fromarray(np.stack([np.full_like(r_arr, 255), r_arr, m_arr], axis=-1)).save(orm_path)

    for im in temp_imgs:
        bpy.data.images.remove(im, do_unlink=True)
    bpy.data.objects.remove(high, do_unlink=True)

    wire_clean_pbr_material(low, paths["BaseColor"], orm_path, nm_path, "BakedPBR")
    # Strip redundant UV layers (>1) and color attributes per HGame 3D Model Spec (no TANGENT / COLOR_0 / TEXCOORD_1)
    while len(low.data.uv_layers) > 1:
        low.data.uv_layers.remove(low.data.uv_layers[-1])
    for ca in list(low.data.color_attributes):
        low.data.color_attributes.remove(ca)

    stats = collect_stats([low])
    rig_info = None
    lod1_stats = None
    lod2_stats = None
    lod3_stats = None
    lod1_tris = int(getattr(args, "lod1_tris", 0) or 0)
    lod2_tris = int(getattr(args, "lod2_tris", 0) or 0)
    if getattr(args, "rig_run", False):
        exp = _export_rigged_with_lods(
            low,
            args.out,
            action_name="Run",
            anim_glb=getattr(args, "anim_glb", ""),
            lod1_tris=lod1_tris,
            lod2_tris=lod2_tris,
            lod3_tight=bool(getattr(args, "lod3_tight", False)),
            rig_engine=getattr(args, "rig_engine", "auto"),
        )
        rig_info = exp["rig_info"]
        lod1_stats = exp["lod1_stats"]
        lod2_stats = exp["lod2_stats"]
        lod3_stats = exp["lod3_stats"]
    else:
        bpy.ops.object.select_all(action="DESELECT")
        low.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=args.out,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_tangents=False,
        )
    result = {
        "input": os.path.abspath(args.input),
        "output": os.path.abspath(args.out),
        "workDir": os.path.abspath(work_dir),
        "rig": rig_info,
        "repair": {
            "preRemesh": pre_remesh_repair,
            "postVoxel": post_voxel_repair,
            "postLow": post_low_repair,
        },
        "stats": stats,
        "lod1Stats": lod1_stats,
        "lod2Stats": lod2_stats,
        "lod3Stats": lod3_stats,
    }
    if args.qa_dir:
        result["rendered"] = render_views(
            [low],
            args.qa_dir,
            view_mode=args.views,
            size=args.size,
            elev_deg=args.elev,
            engine=args.engine,
        )
    print("HGAME_MODEL3D_JSON:" + json.dumps(result, ensure_ascii=True))


def _dilate_tile_rgba(tile_rgba, radius=6):
    """Expand opaque edge RGB outward into transparent texels without touching Alpha (strictly per-tile)."""
    import numpy as np

    out = tile_rgba.copy()
    opaque = out[..., 3] > 0.02
    if not np.any(opaque) or np.all(opaque):
        return out
    h, w = opaque.shape
    for _ in range(max(1, int(radius))):
        if np.all(opaque):
            break
        acc_rgb = np.zeros((h, w, 3), dtype=np.float32)
        acc_cnt = np.zeros((h, w), dtype=np.float32)
        rgb_src = np.where(opaque[..., None], out[..., :3], 0.0)
        msk_src = opaque.astype(np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                sy0 = max(0, -dy)
                sy1 = h - max(0, dy)
                sx0 = max(0, -dx)
                sx1 = w - max(0, dx)
                ty0 = max(0, dy)
                ty1 = h - max(0, -dy)
                tx0 = max(0, dx)
                tx1 = w - max(0, -dx)
                acc_rgb[ty0:ty1, tx0:tx1] += rgb_src[sy0:sy1, sx0:sx1]
                acc_cnt[ty0:ty1, tx0:tx1] += msk_src[sy0:sy1, sx0:sx1]
        frontier = (~opaque) & (acc_cnt > 0.0)
        if not np.any(frontier):
            break
        out[frontier, :3] = acc_rgb[frontier] / acc_cnt[frontier, None]
        opaque[frontier] = True
    return out


def _srgb_hex_to_linear(hex_val):
    r = ((hex_val >> 16) & 0xFF) / 255.0
    g = ((hex_val >> 8) & 0xFF) / 255.0
    b = (hex_val & 0xFF) / 255.0
    def _to_lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (_to_lin(r), _to_lin(g), _to_lin(b), 1.0)


def _extract_src_albedo_socket(src_mat):
    """Find Base Color input socket on a material's Principled BSDF."""
    if not src_mat or not src_mat.use_nodes:
        return None, None
    nt = src_mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    output = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    return bsdf, output


def _build_reauthored_lod(
    src_obj,
    rig_obj,
    lod_name,
    target_tris,
    max_weights,
    color_size=256,
    is_lod2=False,
    lm=None,
):
    """Build a clean low-poly LOD with transferred smooth normals, re-packed large UV blocks,
    strictly clamped bone weights, and a single baked Color x AO texture."""
    import bmesh
    import mathutils
    import numpy as np

    tris_src = sum(max(1, len(p.vertices) - 2) for p in src_obj.data.polygons)
    if target_tris <= 0 or tris_src <= 0:
        return None

    scn = bpy.context.scene
    orig_pose_pos = rig_obj.data.pose_position if rig_obj and rig_obj.data else None
    orig_frame = scn.frame_current
    orig_engine = scn.render.engine
    orig_samples = scn.cycles.samples
    orig_bake_s2a = scn.render.bake.use_selected_to_active
    orig_bake_cage = scn.render.bake.use_cage
    orig_bake_ext = scn.render.bake.cage_extrusion
    orig_bake_ray = scn.render.bake.max_ray_distance
    orig_bake_margin = scn.render.bake.margin
    orig_bake_mtype = scn.render.bake.margin_type
    orig_bake_clear = scn.render.bake.use_clear
    orig_hide_r = {o: o.hide_render for o in bpy.data.objects}

    lod_obj = None
    src_bake = None
    temp_mats = []
    temp_imgs = []

    try:
        if rig_obj and rig_obj.data:
            rig_obj.data.pose_position = "REST"
        scn.frame_set(0)
        bpy.context.view_layer.update()

        zs = [v.co.z for v in src_obj.data.vertices]
        z_min = float(min(zs)) if zs else 0.0
        z_max = float(max(zs)) if zs else 1.0
        H = max(z_max - z_min, 0.1)
        z_neck = float(lm["z_neck"]) if (lm and "z_neck" in lm) else (z_min + 0.72 * H)
        z_head_base = float(lm["z_head_base"]) if (lm and "z_head_base" in lm) else (z_min + 0.80 * H)

        # Duplicate clean geometry copy without Armature modifier for rest-pose decimation & bake
        lod_obj = src_obj.copy()
        lod_obj.data = src_obj.data.copy()
        lod_obj.name = lod_name
        lod_obj.parent = None
        lod_obj.matrix_world = src_obj.matrix_world.copy()
        for m in list(lod_obj.modifiers):
            lod_obj.modifiers.remove(m)
        bpy.context.collection.objects.link(lod_obj)

        # Step 1: Pre-process open edges & weld seams
        bpy.ops.object.select_all(action="DESELECT")
        lod_obj.select_set(True)
        bpy.context.view_layer.objects.active = lod_obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=1e-4)
        bpy.ops.mesh.delete_loose()
        bpy.ops.mesh.dissolve_degenerate(threshold=1e-6)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")

        bm_chk = bmesh.new()
        bm_chk.from_mesh(lod_obj.data)
        boundary_edges = sum(1 for e in bm_chk.edges if e.is_boundary)
        bm_chk.free()
        if boundary_edges > 0:
            sol = lod_obj.modifiers.new("_LodSolidify", "SOLIDIFY")
            sol.thickness = max(0.002, 0.004 * H)
            sol.offset = 0.0
            sol.use_even_offset = True
            bpy.ops.object.modifier_apply(modifier=sol.name)

        # Protect head/face and main limb joints during Collapse Decimate
        for vg in list(lod_obj.vertex_groups):
            lod_obj.vertex_groups.remove(vg)
        prot_name = "_LodProtect"
        vg_prot = lod_obj.vertex_groups.new(name=prot_name)
        z_hip = float(lm["z_hip"]) if (lm and "z_hip" in lm) else (z_min + 0.44 * H)
        z_arm = float(lm["z_arm"]) if (lm and "z_arm" in lm) else (z_min + 0.68 * H)
        for v in lod_obj.data.vertices:
            vz = float(v.co.z)
            if vz >= z_neck:
                w_p = 1.0
            elif abs(vz - z_arm) <= 0.06 * H or abs(vz - z_hip) <= 0.06 * H or vz <= z_min + 0.12 * H:
                w_p = 0.65
            else:
                w_p = 0.25
            vg_prot.add([v.index], w_p, "REPLACE")

        # Step 2: Clean Decimate with seam protection + tiny-island cleanup + smooth normal transfer
        tris_cur = sum(max(1, len(p.vertices) - 2) for p in lod_obj.data.polygons)
        if tris_cur > target_tris:
            dec = lod_obj.modifiers.new(f"{lod_name}_Decimate", "DECIMATE")
            dec.decimate_type = "COLLAPSE"
            dec.ratio = max(0.02, min(1.0, float(target_tris) / float(tris_cur)))
            dec.use_collapse_triangulate = True
            dec.delimit = {"SEAM"}
            dec.vertex_group = prot_name
            dec.vertex_group_factor = 0.45
            bpy.ops.object.modifier_apply(modifier=dec.name)
        if prot_name in lod_obj.vertex_groups:
            lod_obj.vertex_groups.remove(lod_obj.vertex_groups[prot_name])

        # Prune tiny disconnected debris islands (<= 12 faces) while preserving main mesh
        bm_clean = bmesh.new()
        bm_clean.from_mesh(lod_obj.data)
        bm_clean.faces.ensure_lookup_table()
        seen = set()
        islands = []
        for f in bm_clean.faces:
            if f.index in seen:
                continue
            stack = [f]
            comp = []
            seen.add(f.index)
            while stack:
                cf = stack.pop()
                comp.append(cf)
                for e in cf.edges:
                    for nf in e.link_faces:
                        if nf.index not in seen:
                            seen.add(nf.index)
                            stack.append(nf)
            islands.append(comp)
        if len(islands) > 1:
            max_sz = max(len(c) for c in islands)
            drop_faces = [f for c in islands if len(c) <= 12 and len(c) < max_sz for f in c]
            if drop_faces:
                bmesh.ops.delete(bm_clean, geom=drop_faces, context="FACES")
        loose_verts = [v for v in bm_clean.verts if not v.link_faces]
        if loose_verts:
            bmesh.ops.delete(bm_clean, geom=loose_verts, context="VERTS")
        bm_clean.to_mesh(lod_obj.data)
        bm_clean.free()

        # Triangulate cleanly & transfer smooth normals from LOD0
        if any(len(p.vertices) > 3 for p in lod_obj.data.polygons):
            tri_m = lod_obj.modifiers.new("_LodTri", "TRIANGULATE")
            bpy.ops.object.modifier_apply(modifier=tri_m.name)
        for p in lod_obj.data.polygons:
            p.use_smooth = True

        dt_n = lod_obj.modifiers.new("_LodTransferNormals", "DATA_TRANSFER")
        dt_n.object = src_obj
        dt_n.use_loop_data = True
        dt_n.data_types_loops = {"CUSTOM_NORMAL"}
        dt_n.loop_mapping = "POLYINTERP_NEAREST"
        bpy.ops.object.modifier_apply(modifier=dt_n.name)

        # Step 3: Fresh minimal large-block UV unwrap with 1.9x head/face priority
        while len(lod_obj.data.uv_layers) > 0:
            lod_obj.data.uv_layers.remove(lod_obj.data.uv_layers[-1])
        uv_layer = lod_obj.data.uv_layers.new(name="UVMap")
        uv_layer.active = True
        uv_layer.active_render = True

        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.smart_project(
            angle_limit=math.radians(66.0),
            island_margin=(0.025 if color_size >= 256 else 0.04),
            area_weight=0.0,
            correct_aspect=True,
            scale_to_bounds=True,
        )
        bpy.ops.object.mode_set(mode="OBJECT")

        # Scale UV islands belonging to head/face (z >= z_head_base) by 1.9x before packing
        bm_uv = bmesh.new()
        bm_uv.from_mesh(lod_obj.data)
        bm_uv.faces.ensure_lookup_table()
        bm_uv_lay = bm_uv.loops.layers.uv.active
        if bm_uv_lay is not None:
            # Build UV island adjacency by shared quantized UV coordinates + shared verts
            face_uv_islands = []
            visited_f = set()
            vert_to_faces = {}
            for f in bm_uv.faces:
                for v in f.verts:
                    vert_to_faces.setdefault(v.index, []).append(f)
            for f in bm_uv.faces:
                if f.index in visited_f:
                    continue
                stack = [f]
                visited_f.add(f.index)
                comp = []
                while stack:
                    cf = stack.pop()
                    comp.append(cf)
                    uv_by_v = {l.vert.index: (round(l[bm_uv_lay].uv.x, 4), round(l[bm_uv_lay].uv.y, 4)) for l in cf.loops}
                    for v in cf.verts:
                        for nf in vert_to_faces.get(v.index, ()):
                            if nf.index in visited_f:
                                continue
                            shared_uv = any(
                                (round(nl[bm_uv_lay].uv.x, 4), round(nl[bm_uv_lay].uv.y, 4)) == uv_by_v.get(nl.vert.index)
                                for nl in nf.loops
                                if nl.vert.index in uv_by_v
                            )
                            if shared_uv:
                                visited_f.add(nf.index)
                                stack.append(nf)
                face_uv_islands.append(comp)
            for comp in face_uv_islands:
                avg_z = sum(f.calc_center_median().z for f in comp) / max(1, len(comp))
                if avg_z >= z_head_base:
                    loops = [l for f in comp for l in f.loops]
                    cu = sum(l[bm_uv_lay].uv.x for l in loops) / max(1, len(loops))
                    cv = sum(l[bm_uv_lay].uv.y for l in loops) / max(1, len(loops))
                    for l in loops:
                        l[bm_uv_lay].uv.x = cu + (l[bm_uv_lay].uv.x - cu) * 1.9
                        l[bm_uv_lay].uv.y = cv + (l[bm_uv_lay].uv.y - cv) * 1.9
            bm_uv.to_mesh(lod_obj.data)
        bm_uv.free()

        pad_px = 3.0 if color_size >= 256 else 2.5
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.pack_islands(margin=pad_px / float(color_size), rotate=True)
        bpy.ops.object.mode_set(mode="OBJECT")

        # Step 4: Bone weight transfer from LOD0 + strict limit & normalize
        for vg in list(lod_obj.vertex_groups):
            lod_obj.vertex_groups.remove(vg)
        for src_vg in src_obj.vertex_groups:
            lod_obj.vertex_groups.new(name=src_vg.name)

        dt_w = lod_obj.modifiers.new("_LodTransferWeights", "DATA_TRANSFER")
        dt_w.object = src_obj
        dt_w.use_vert_data = True
        dt_w.data_types_verts = {"VGROUP_WEIGHTS"}
        dt_w.vert_mapping = "POLYINTERP_NEAREST"
        dt_w.layers_vgroup_select_src = "ALL"
        dt_w.layers_vgroup_select_dst = "NAME"
        bpy.ops.object.modifier_apply(modifier=dt_w.name)

        bpy.ops.object.vertex_group_limit_total(limit=int(max_weights))
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)

        # Strict per-vertex verification & repair (1 <= non_zero <= max_weights, sum == 1.0)
        vg_by_idx = {vg.index: vg for vg in lod_obj.vertex_groups}
        fallback_vg = (
            lod_obj.vertex_groups.get("pelvis")
            or lod_obj.vertex_groups.get("spine_01")
            or (lod_obj.vertex_groups[0] if len(lod_obj.vertex_groups) > 0 else None)
        )
        weighted_pts = []
        weighted_grps = []
        unweighted_verts = []
        for v in lod_obj.data.vertices:
            entries = [(g.group, float(g.weight)) for g in v.groups if g.weight > 1e-6 and g.group in vg_by_idx]
            entries.sort(key=lambda x: x[1], reverse=True)
            if not entries:
                unweighted_verts.append(v)
                continue
            kept = entries[: int(max_weights)]
            drop = entries[int(max_weights) :]
            for gi, _ in drop:
                vg_by_idx[gi].remove([v.index])
            tot_w = sum(w for _, w in kept)
            if tot_w <= 1e-6:
                unweighted_verts.append(v)
                continue
            for gi, w in kept:
                vg_by_idx[gi].add([v.index], w / tot_w, "REPLACE")
            weighted_pts.append((v.co.x, v.co.y, v.co.z))
            weighted_grps.append([(gi, w / tot_w) for gi, w in kept])
        if unweighted_verts:
            if weighted_pts:
                w_arr = np.asarray(weighted_pts, dtype=np.float64)
                for v in unweighted_verts:
                    d2 = np.sum((w_arr - np.array([v.co.x, v.co.y, v.co.z])) ** 2, axis=1)
                    best_i = int(np.argmin(d2))
                    for gi, w in weighted_grps[best_i]:
                        vg_by_idx[gi].add([v.index], w, "REPLACE")
            elif fallback_vg is not None:
                fallback_vg.add([v.index for v in unweighted_verts], 1.0, "REPLACE")

        # Step 5: High-to-Low Cycles Bake (BaseColor via Emit + AO) -> Color x AO single texture
        src_bake = src_obj.copy()
        src_bake.data = src_obj.data.copy()
        src_bake.name = f"_{lod_name}_BakeSrc"
        src_bake.parent = None
        src_bake.matrix_world = src_obj.matrix_world.copy()
        for m in list(src_bake.modifiers):
            src_bake.modifiers.remove(m)
        bpy.context.collection.objects.link(src_bake)

        for o in bpy.data.objects:
            if o.type in ("MESH", "LIGHT") and o not in (src_bake, lod_obj):
                o.hide_render = True
        src_bake.hide_render = False
        src_bake.hide_viewport = False
        lod_obj.hide_render = False
        lod_obj.hide_viewport = False

        # Clone src_bake materials so original src_obj materials remain untouched
        src_bake_mats = []
        for sm in src_bake.data.materials:
            if sm is None:
                continue
            sm_cp = sm.copy()
            temp_mats.append(sm_cp)
            src_bake_mats.append(sm_cp)
        src_bake.data.materials.clear()
        for sm_cp in src_bake_mats:
            src_bake.data.materials.append(sm_cp)

        bake_mat = bpy.data.materials.new(f"_{lod_name}_BakeDst")
        bake_mat.use_nodes = True
        temp_mats.append(bake_mat)
        tex_node = bake_mat.node_tree.nodes.new("ShaderNodeTexImage")
        bake_mat.node_tree.nodes.active = tex_node
        lod_obj.data.materials.clear()
        lod_obj.data.materials.append(bake_mat)

        scn.render.engine = "CYCLES"
        scn.cycles.samples = 16
        bake = scn.render.bake
        bake.use_selected_to_active = True
        bake.use_cage = False
        bake.cage_extrusion = max(0.03, 0.045 * H)
        bake.max_ray_distance = max(0.08, 0.14 * H)
        bake.margin = max(4, int(round(color_size * 0.03)))
        bake.margin_type = "EXTEND"
        bake.use_clear = True

        # 5a. Rewire src_bake materials temporarily to emit pure BaseColor (metallic-safe albedo)
        albedo_img = bpy.data.images.new(f"_{lod_name}_AlbedoTmp", width=color_size, height=color_size, alpha=False)
        albedo_img.colorspace_settings.name = "sRGB"
        temp_imgs.append(albedo_img)
        for sm_cp in src_bake_mats:
            bsdf_s, out_s = _extract_src_albedo_socket(sm_cp)
            if bsdf_s is not None and out_s is not None:
                nt_s = sm_cp.node_tree
                em_s = nt_s.nodes.new("ShaderNodeEmission")
                for lk in list(out_s.inputs["Surface"].links):
                    nt_s.links.remove(lk)
                bc_inp = bsdf_s.inputs["Base Color"]
                if bc_inp.is_linked:
                    nt_s.links.new(bc_inp.links[0].from_socket, em_s.inputs["Color"])
                else:
                    em_s.inputs["Color"].default_value = bc_inp.default_value
                nt_s.links.new(em_s.outputs["Emission"], out_s.inputs["Surface"])

        tex_node.image = albedo_img
        bpy.ops.object.select_all(action="DESELECT")
        src_bake.select_set(True)
        lod_obj.select_set(True)
        bpy.context.view_layer.objects.active = lod_obj
        bpy.ops.object.bake(type="EMIT", margin_type="EXTEND")

        # 5b. Bake AO from src_bake -> lod_obj
        ao_img = bpy.data.images.new(f"_{lod_name}_AoTmp", width=color_size, height=color_size, alpha=False)
        ao_img.colorspace_settings.name = "Non-Color"
        temp_imgs.append(ao_img)
        tex_node.image = ao_img
        bpy.ops.object.select_all(action="DESELECT")
        src_bake.select_set(True)
        lod_obj.select_set(True)
        bpy.context.view_layer.objects.active = lod_obj
        bpy.ops.object.bake(type="AO", margin_type="EXTEND")

        # 5c. Composite Color x mix(1.0, AO, 0.45) in linear space -> sRGB packed image
        alb_px = np.empty(color_size * color_size * 4, dtype=np.float32)
        albedo_img.pixels.foreach_get(alb_px)
        alb_px = alb_px.reshape((-1, 4))
        ao_px = np.empty(color_size * color_size * 4, dtype=np.float32)
        ao_img.pixels.foreach_get(ao_px)
        ao_px = ao_px.reshape((-1, 4))

        comp_px = np.ones((color_size * color_size, 4), dtype=np.float32)
        comp_px[:, :3] = np.clip(alb_px[:, :3] * (0.55 + 0.45 * ao_px[:, :3]), 0.0, 1.0)

        out_img = bpy.data.images.new(f"{lod_name}_Color", width=color_size, height=color_size, alpha=False)
        out_img.colorspace_settings.name = "sRGB"
        out_img.pixels.foreach_set(comp_px.ravel().tolist())
        out_img.pack()

        # Assign clean single-BaseColor material (zero Normal/ORM/Emissive, metallic=0, roughness=1)
        out_mat = bpy.data.materials.new(f"{lod_name}_ColorOnly")
        out_mat.use_nodes = True
        nt_o = out_mat.node_tree
        nt_o.nodes.clear()
        n_out = nt_o.nodes.new("ShaderNodeOutputMaterial")
        n_bsdf = nt_o.nodes.new("ShaderNodeBsdfPrincipled")
        n_bsdf.inputs["Metallic"].default_value = 0.0
        n_bsdf.inputs["Roughness"].default_value = 1.0
        if "Specular IOR Level" in n_bsdf.inputs:
            n_bsdf.inputs["Specular IOR Level"].default_value = 0.0
        n_uv = nt_o.nodes.new("ShaderNodeUVMap")
        n_uv.uv_map = "UVMap"
        n_tex = nt_o.nodes.new("ShaderNodeTexImage")
        n_tex.image = out_img
        nt_o.links.new(n_uv.outputs["UV"], n_tex.inputs["Vector"])
        nt_o.links.new(n_tex.outputs["Color"], n_bsdf.inputs["Base Color"])
        nt_o.links.new(n_bsdf.outputs["BSDF"], n_out.inputs["Surface"])

        lod_obj.data.materials.clear()
        lod_obj.data.materials.append(out_mat)
        while len(lod_obj.data.uv_layers) > 1:
            lod_obj.data.uv_layers.remove(lod_obj.data.uv_layers[-1])
        for ca in list(lod_obj.data.color_attributes):
            lod_obj.data.color_attributes.remove(ca)

        lod_obj.parent = rig_obj
        if rig_obj is not None:
            am = lod_obj.modifiers.new("Armature", "ARMATURE")
            am.object = rig_obj
            am.use_deform_preserve_volume = False

        lod_obj["lodLevel"] = 2 if is_lod2 else 1
        lod_obj["singleColorOnly"] = True
        lod_obj["colorSize"] = int(color_size)
        lod_obj["maxWeights"] = int(max_weights)
        if is_lod2:
            lod_obj["atlasCompatible"] = True
        return lod_obj
    finally:
        for o, hr in orig_hide_r.items():
            if o.name in bpy.data.objects:
                o.hide_render = hr
        if src_bake is not None and src_bake.name in bpy.data.objects:
            bpy.data.objects.remove(src_bake, do_unlink=True)
        for tm in temp_mats:
            if tm.name in bpy.data.materials and tm.users == 0:
                bpy.data.materials.remove(tm, do_unlink=True)
        for ti in temp_imgs:
            if ti.name in bpy.data.images and ti.users == 0:
                bpy.data.images.remove(ti, do_unlink=True)
        scn.render.engine = orig_engine
        scn.cycles.samples = orig_samples
        scn.render.bake.use_selected_to_active = orig_bake_s2a
        scn.render.bake.use_cage = orig_bake_cage
        scn.render.bake.cage_extrusion = orig_bake_ext
        scn.render.bake.max_ray_distance = orig_bake_ray
        scn.render.bake.margin = orig_bake_margin
        scn.render.bake.margin_type = orig_bake_mtype
        scn.render.bake.use_clear = orig_bake_clear
        if rig_obj and rig_obj.data and orig_pose_pos is not None:
            rig_obj.data.pose_position = orig_pose_pos
        scn.frame_set(orig_frame)
        bpy.context.view_layer.update()


def _build_tight_lod3_impostor(src_obj, rig_obj, anim_range=None, cols=8, rows=8, cell_px=128, elev_deg=18.0):
    import math
    import tempfile
    import bmesh
    import numpy as np
    from mathutils import Vector

    scn = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()

    action = rig_obj.animation_data.action if (rig_obj and rig_obj.animation_data) else None
    if anim_range and len(anim_range) >= 2 and float(anim_range[1]) > float(anim_range[0]):
        f0, f1 = float(anim_range[0]), float(anim_range[1])
    elif action is not None and action.frame_range[1] > action.frame_range[0]:
        f0, f1 = float(action.frame_range[0]), float(action.frame_range[1])
    else:
        f0, f1 = float(scn.frame_current), float(scn.frame_current)

    eff_rows = max(1, int(rows)) if (f1 > f0 + 1e-4) else 1
    eff_cols = max(1, int(cols))
    frames = [f0 + (f1 - f0) * (r / float(eff_rows)) for r in range(eff_rows)] if eff_rows > 1 else [f0]

    # Sample animated world-space bounds across Run cycle so silhouettes never clip
    sample_indices = sorted(set([0, len(frames) // 4, len(frames) // 2, (3 * len(frames)) // 4]))
    all_pts = []
    orig_frame = scn.frame_current
    for si in sample_indices:
        fr = frames[min(len(frames) - 1, si)]
        scn.frame_set(int(fr), subframe=fr - int(fr))
        bpy.context.view_layer.update()
        eval_obj = src_obj.evaluated_get(depsgraph)
        mw = eval_obj.matrix_world
        for v in eval_obj.data.vertices:
            all_pts.append(mw @ v.co)
    scn.frame_set(orig_frame)
    bpy.context.view_layer.update()

    if not all_pts:
        return None
    pts = np.asarray([(p.x, p.y, p.z) for p in all_pts], dtype=np.float64)
    # Anchor billboard pivot on root origin (0, 0) so Y-billboard spins in place on pedestal
    cx = 0.0
    cy = 0.0
    z0 = float(pts[:, 2].min())
    z1 = float(pts[:, 2].max())
    elev_rad = math.radians(float(elev_deg))
    max_proj = 0.18
    max_depth = 0.18
    for c in range(eff_cols):
        a = (c / float(eff_cols)) * (2.0 * math.pi)
        proj = np.abs((pts[:, 0] - cx) * math.cos(a) + (pts[:, 1] - cy) * math.sin(a))
        dep = np.abs((pts[:, 0] - cx) * math.sin(a) - (pts[:, 1] - cy) * math.cos(a))
        max_proj = max(max_proj, float(proj.max()))
        max_depth = max(max_depth, float(dep.max()))
    half_w = max(0.18, max_proj * 1.06)
    z_pad_bot = 0.015
    h_raw = max(0.5, z1 - (z0 - z_pad_bot))
    h = max(0.5, (h_raw * math.cos(elev_rad) + 2.0 * max_depth * math.sin(elev_rad)) * 1.04)
    z0_box = z0 - z_pad_bot

    # Bake 8-azimuth x N-frame RGBA Impostor sprite sheet in EEVEE matching studio lights (no ACES baked in)
    orig_hide_r = {o: o.hide_render for o in bpy.data.objects}
    orig_hide_vp = {o: o.hide_viewport for o in bpy.data.objects}
    orig_engine = scn.render.engine
    orig_transp = scn.render.film_transparent
    orig_rx = scn.render.resolution_x
    orig_ry = scn.render.resolution_y
    orig_pct = scn.render.resolution_percentage
    orig_fmt = scn.render.image_settings.file_format
    orig_cmode = scn.render.image_settings.color_mode
    orig_cdepth = scn.render.image_settings.color_depth
    orig_vt = scn.view_settings.view_transform
    orig_look = scn.view_settings.look
    orig_exp = scn.view_settings.exposure
    orig_gam = scn.view_settings.gamma
    orig_world = scn.world
    orig_cam = scn.camera
    orig_taa = getattr(scn.eevee, "taa_render_samples", None)

    tile_h = int(cell_px)
    tile_w = max(48, min(192, int(round(cell_px * (2.0 * half_w) / h))))
    atlas = np.zeros((eff_rows * cell_px, eff_cols * cell_px, 4), dtype=np.float32)

    # Hemisphere world shader matching Three.js HemisphereLight(0xf4f8ff, 0x3b4837)
    imp_world = bpy.data.worlds.new("_ImpostorWorld")
    imp_world.use_nodes = True
    w_nt = imp_world.node_tree
    w_nt.nodes.clear()
    w_out = w_nt.nodes.new("ShaderNodeOutputWorld")
    w_bg = w_nt.nodes.new("ShaderNodeBackground")
    w_bg.inputs["Strength"].default_value = 1.35
    w_geom = w_nt.nodes.new("ShaderNodeNewGeometry")
    w_sep = w_nt.nodes.new("ShaderNodeSeparateXYZ")
    w_map = w_nt.nodes.new("ShaderNodeMapRange")
    w_map.inputs["From Min"].default_value = -1.0
    w_map.inputs["From Max"].default_value = 1.0
    w_map.inputs["To Min"].default_value = 0.0
    w_map.inputs["To Max"].default_value = 1.0
    w_mix = w_nt.nodes.new("ShaderNodeMix")
    w_mix.data_type = "RGBA"
    w_mix.inputs[6].default_value = _srgb_hex_to_linear(0x3B4837)
    w_mix.inputs[7].default_value = _srgb_hex_to_linear(0xF4F8FF)
    w_nt.links.new(w_geom.outputs["Normal"], w_sep.inputs["Vector"])
    w_nt.links.new(w_sep.outputs["Z"], w_map.inputs["Value"])
    w_nt.links.new(w_map.outputs["Result"], w_mix.inputs[0])
    w_nt.links.new(w_mix.outputs[2], w_bg.inputs["Color"])
    w_nt.links.new(w_bg.outputs["Background"], w_out.inputs["Surface"])

    # Key + Fill Suns matching Three.js studio key (0xfff6e5) + fill (0x9fc2ff) + HDRI sky fill
    imp_key_data = bpy.data.lights.new("_ImpostorKeySun", "SUN")
    imp_key_data.color = _srgb_hex_to_linear(0xFFF6E5)[:3]
    imp_key_data.energy = 2.65
    imp_key_obj = bpy.data.objects.new("_ImpostorKeySun", imp_key_data)
    bpy.context.collection.objects.link(imp_key_obj)

    imp_fill_data = bpy.data.lights.new("_ImpostorFillSun", "SUN")
    imp_fill_data.color = _srgb_hex_to_linear(0x9FC2FF)[:3]
    imp_fill_data.energy = 1.15
    imp_fill_obj = bpy.data.objects.new("_ImpostorFillSun", imp_fill_data)
    bpy.context.collection.objects.link(imp_fill_obj)

    imp_cam_data = bpy.data.cameras.new("_ImpostorCam")
    imp_cam_data.type = "ORTHO"
    imp_cam_data.sensor_fit = "VERTICAL"
    imp_cam_data.ortho_scale = h
    imp_cam_data.clip_start = 0.01
    imp_cam_data.clip_end = 50.0
    imp_cam_obj = bpy.data.objects.new("_ImpostorCam", imp_cam_data)
    bpy.context.collection.objects.link(imp_cam_obj)

    try:
        for o in bpy.data.objects:
            if o.type in ("MESH", "LIGHT") and o not in (src_obj, imp_key_obj, imp_fill_obj):
                o.hide_render = True
        src_obj.hide_render = False
        src_obj.hide_viewport = False

        scn.world = imp_world
        scn.camera = imp_cam_obj
        scn.render.engine = "BLENDER_EEVEE"
        if orig_taa is not None:
            scn.eevee.taa_render_samples = 4
        scn.render.film_transparent = True
        # Standard linear->sRGB only; ACES ToneMapping runs once in Three.js main pass
        scn.view_settings.view_transform = "Standard"
        scn.view_settings.look = "None"
        scn.view_settings.exposure = 0.0
        scn.view_settings.gamma = 1.0
        scn.render.resolution_x = tile_w
        scn.render.resolution_y = tile_h
        scn.render.resolution_percentage = 100
        scn.render.image_settings.file_format = "PNG"
        scn.render.image_settings.color_mode = "RGBA"
        scn.render.image_settings.color_depth = "8"

        target_pt = Vector((cx, cy, z0_box + h_raw * 0.5))
        raw_tiles = [[None for _ in range(eff_cols)] for _ in range(eff_rows)]
        with tempfile.TemporaryDirectory() as tmp_dir:
            cell_png = os.path.join(tmp_dir, "cell.png")
            for r, fr in enumerate(frames):
                scn.frame_set(int(fr), subframe=fr - int(fr))
                bpy.context.view_layer.update()
                for c in range(eff_cols):
                    ang = (c / float(eff_cols)) * (2.0 * math.pi)
                    cam_dir = Vector((
                        math.sin(ang) * math.cos(elev_rad),
                        -math.cos(ang) * math.cos(elev_rad),
                        math.sin(elev_rad),
                    )).normalized()
                    imp_cam_obj.location = target_pt + cam_dir * 6.0
                    imp_cam_obj.rotation_euler = (-cam_dir).to_track_quat("-Z", "Y").to_euler()

                    k_ang = ang + 0.52
                    k_dir = Vector((-math.sin(k_ang), math.cos(k_ang), -0.78)).normalized()
                    imp_key_obj.rotation_euler = k_dir.to_track_quat("-Z", "Y").to_euler()

                    f_ang = ang - 2.35
                    f_dir = Vector((-math.sin(f_ang), math.cos(f_ang), -0.45)).normalized()
                    imp_fill_obj.rotation_euler = f_dir.to_track_quat("-Z", "Y").to_euler()

                    scn.render.filepath = cell_png
                    bpy.ops.render.render(write_still=True)

                    tmp_img = bpy.data.images.load(cell_png, check_existing=False)
                    if tmp_img.size[0] != cell_px or tmp_img.size[1] != cell_px:
                        tmp_img.scale(cell_px, cell_px)
                    tile_px = np.empty(cell_px * cell_px * 4, dtype=np.float32)
                    tmp_img.pixels.foreach_get(tile_px)
                    bpy.data.images.remove(tmp_img, do_unlink=True)
                    raw_tiles[r][c] = tile_px.reshape((cell_px, cell_px, 4))

        # Ground feet flush to bottom of every tile and compute 1:1 billboard height
        y_foot = cell_px - 1
        y_head = 0
        any_opaque = False
        for r in range(eff_rows):
            for c in range(eff_cols):
                rows_hit = np.where(np.any(raw_tiles[r][c][..., 3] > 0.45, axis=1))[0]
                if len(rows_hit) > 0:
                    any_opaque = True
                    y_foot = min(y_foot, int(rows_hit[0]))
                    y_head = max(y_head, int(rows_hit[-1]))
        if not any_opaque:
            y_foot = 0
            y_head = cell_px - 1
        shift = max(0, y_foot - 1)
        if y_head - shift > cell_px - 2:
            shift = max(0, y_head - (cell_px - 2))

        for r in range(eff_rows):
            y_dst = (eff_rows - 1 - r) * cell_px
            for c in range(eff_cols):
                t = raw_tiles[r][c]
                if shift > 0:
                    shifted = np.zeros_like(t)
                    shifted[: cell_px - shift, :, :] = t[shift:, :, :]
                    t = shifted
                dilated = _dilate_tile_rgba(t, radius=6)
                atlas[y_dst : y_dst + cell_px, c * cell_px : (c + 1) * cell_px, :] = dilated

        span_frac = max(0.35, float(max(1, y_head - y_foot + 1)) / float(cell_px))
        h_quad = h_raw / span_frac
    finally:
        for o, hr in orig_hide_r.items():
            if o.name in bpy.data.objects:
                o.hide_render = hr
        for o, hv in orig_hide_vp.items():
            if o.name in bpy.data.objects:
                o.hide_viewport = hv
        scn.frame_set(orig_frame)
        bpy.context.view_layer.update()
        scn.render.engine = orig_engine
        scn.render.film_transparent = orig_transp
        scn.render.resolution_x = orig_rx
        scn.render.resolution_y = orig_ry
        scn.render.resolution_percentage = orig_pct
        scn.render.image_settings.file_format = orig_fmt
        scn.render.image_settings.color_mode = orig_cmode
        scn.render.image_settings.color_depth = orig_cdepth
        scn.view_settings.view_transform = orig_vt
        scn.view_settings.look = orig_look
        scn.view_settings.exposure = orig_exp
        scn.view_settings.gamma = orig_gam
        scn.world = orig_world
        scn.camera = orig_cam
        if orig_taa is not None:
            scn.eevee.taa_render_samples = orig_taa
        for o in (imp_cam_obj, imp_key_obj, imp_fill_obj):
            if o.name in bpy.data.objects:
                bpy.data.objects.remove(o, do_unlink=True)
        if imp_cam_data.name in bpy.data.cameras:
            bpy.data.cameras.remove(imp_cam_data, do_unlink=True)
        for ld in (imp_key_data, imp_fill_data):
            if ld.name in bpy.data.lights:
                bpy.data.lights.remove(ld, do_unlink=True)
        if imp_world.name in bpy.data.worlds:
            bpy.data.worlds.remove(imp_world, do_unlink=True)

    atlas_img = bpy.data.images.new(
        "ImpostorAtlas",
        width=eff_cols * cell_px,
        height=eff_rows * cell_px,
        alpha=True,
    )
    atlas_img.colorspace_settings.name = "sRGB"
    atlas_img.pixels.foreach_set(atlas.ravel().tolist())
    atlas_img.pack()

    mat_imp = bpy.data.materials.new("BakedImpostor")
    mat_imp.use_nodes = True
    mat_imp.use_backface_culling = False
    nt = mat_imp.node_tree
    nt.nodes.clear()
    n_out = nt.nodes.new("ShaderNodeOutputMaterial")
    n_bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    n_bsdf.inputs["Roughness"].default_value = 0.92
    if "Specular IOR Level" in n_bsdf.inputs:
        n_bsdf.inputs["Specular IOR Level"].default_value = 0.0
    n_tex = nt.nodes.new("ShaderNodeTexImage")
    n_tex.image = atlas_img
    n_tex.extension = "CLIP"
    n_gt = nt.nodes.new("ShaderNodeMath")
    n_gt.operation = "GREATER_THAN"
    n_gt.inputs[1].default_value = 0.45
    nt.links.new(n_tex.outputs["Color"], n_bsdf.inputs["Base Color"])
    nt.links.new(n_tex.outputs["Alpha"], n_gt.inputs[0])
    nt.links.new(n_gt.outputs["Value"], n_bsdf.inputs["Alpha"])
    nt.links.new(n_bsdf.outputs["BSDF"], n_out.inputs["Surface"])

    # Clean 4-vertex / 2-triangle quad billboard anchored strictly at ground z=0.0
    quad_pts = [
        (-half_w, 0.0, 0.0),
        (half_w, 0.0, 0.0),
        (half_w, 0.0, h_quad),
        (-half_w, 0.0, h_quad),
    ]
    quad_uvs = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    mesh_d = bpy.data.meshes.new("mesh_lod3_data")
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    verts = [bm.verts.new(Vector(p)) for p in quad_pts]
    face = bm.faces.new(verts)
    for loop, uv in zip(face.loops, quad_uvs):
        loop[uv_layer].uv = uv
    bmesh.ops.triangulate(bm, faces=[face])
    bm.to_mesh(mesh_d)
    bm.free()
    obj3 = bpy.data.objects.new("mesh_lod3", mesh_d)
    bpy.context.collection.objects.link(obj3)
    obj3.parent = rig_obj
    obj3.location = (cx, cy, 0.0)
    obj3.data.materials.append(mat_imp)
    obj3["lodLevel"] = 3
    obj3["impostorCols"] = eff_cols
    obj3["impostorRows"] = eff_rows
    obj3["impostorElevDeg"] = int(round(float(elev_deg)))
    obj3["impostorWidth"] = round(2.0 * half_w, 4)
    obj3["impostorHeight"] = round(h_quad, 4)
    obj3.hide_render = True
    return obj3


def _has_arp_addon():
    try:
        scn = bpy.context.scene
        if not hasattr(scn, "arp_body_name"):
            return False
        from bl_ext.blender_org.auto_rig_pro_master.src import auto_rig_smart, auto_rig_prefs  # noqa: F401
        return True
    except Exception:
        return False


def _view3d_override():
    win = getattr(bpy.context, "window", None)
    screen = getattr(win, "screen", None) if win else None
    area = next((a for a in screen.areas if a.type == "VIEW_3D"), None) if screen else None
    region = next((r for r in area.regions if r.type == "WINDOW"), None) if area else None
    if area and region:
        return bpy.context.temp_override(area=area, region=region)
    if area:
        return bpy.context.temp_override(area=area)
    return bpy.context.temp_override()


def _align_arp_retarget_rest_pose(src_arm, tar_arm):
    """Align A-pose source arms and vertical legs onto ARP T-pose/A-stance target via Redefine Rest Pose (preserve=True)."""
    pairs = (
        ("upperarm_l", "lowerarm_l", "c_arm_fk.l", "c_forearm_fk.l"),
        ("lowerarm_l", "hand_l", "c_forearm_fk.l", "c_hand_fk.l"),
        ("upperarm_r", "lowerarm_r", "c_arm_fk.r", "c_forearm_fk.r"),
        ("lowerarm_r", "hand_r", "c_forearm_fk.r", "c_hand_fk.r"),
        ("thigh_l", "calf_l", "c_thigh_fk.l", "c_leg_fk.l"),
        ("calf_l", "foot_l", "c_leg_fk.l", "c_foot_fk.l"),
        ("thigh_r", "calf_r", "c_thigh_fk.r", "c_leg_fk.r"),
        ("calf_r", "foot_r", "c_leg_fk.r", "c_foot_fk.r"),
    )
    src_act = src_arm.animation_data.action if src_arm.animation_data else None
    src_slot = getattr(src_arm.animation_data, "action_slot", None) if src_arm.animation_data else None
    if src_arm.animation_data:
        src_arm.animation_data.action = None
    for pb in src_arm.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    for pb in tar_arm.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        if pb.rotation_mode == "QUATERNION":
            pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        else:
            pb.rotation_euler = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()

    for src_b, src_ch, dst_b, dst_ch in pairs:
        if src_b not in src_arm.pose.bones or src_ch not in src_arm.pose.bones:
            continue
        if dst_b not in tar_arm.pose.bones or dst_ch not in tar_arm.pose.bones:
            continue
        pb_s = src_arm.pose.bones[src_b]
        pb_sc = src_arm.pose.bones[src_ch]
        pb_d = tar_arm.pose.bones[dst_b]
        pb_dc = tar_arm.pose.bones[dst_ch]
        vs = ((src_arm.matrix_world @ pb_sc.head) - (src_arm.matrix_world @ pb_s.head)).normalized()
        vd = ((tar_arm.matrix_world @ pb_dc.head) - (tar_arm.matrix_world @ pb_d.head)).normalized()
        if vs.length > 0.5 and vd.length > 0.5 and vs.dot(vd) > -0.999:
            q_world = vs.rotation_difference(vd)
            m_orig = src_arm.matrix_world @ pb_s.matrix
            loc_orig = m_orig.to_translation()
            m_w = q_world.to_matrix().to_4x4() @ m_orig
            m_w.translation = loc_orig
            pb_s.matrix = src_arm.matrix_world.inverted() @ m_w
            pb_s.location = (0.0, 0.0, 0.0)
            bpy.context.view_layer.update()

    scn = bpy.context.scene
    mat_basis = {}
    for b in src_arm.pose.bones:
        mat_basis[b.name] = [b.location.copy(), b.rotation_mode, b.rotation_euler.copy(), b.rotation_quaternion.copy()]
    scn["rest_transf_offset"] = mat_basis
    src_arm["remap_redefine_preserve"] = True
    if src_act and src_arm.animation_data:
        src_arm.animation_data.action = src_act
        if src_slot and hasattr(src_arm.animation_data, "action_slot"):
            try:
                src_arm.animation_data.action_slot = src_slot
            except Exception:
                pass


def _rig_and_export_arp(
    low_obj,
    out_path,
    lm,
    action_name="Run",
    anim_glb="",
    lod1_tris=0,
    lod2_tris=0,
    lod3_tight=False,
):
    from bl_ext.blender_org.auto_rig_pro_master.src import auto_rig as _arp_core, auto_rig_smart, auto_rig_prefs

    arp_errors = []
    if bpy.app.background and hasattr(_arp_core, "display_popup_message"):
        def _headless_popup(msg, header="Info", icon_type="INFO"):
            print(f"[ARP headless {icon_type}] {header}: {msg}")
            if str(icon_type).upper() == "ERROR":
                arp_errors.append(f"{header}: {msg}")
        _arp_core.display_popup_message = _headless_popup

    H = lm["height"]
    z0 = lm["z_min"]
    z_arm = lm["z_arm"]
    z_hip = lm["z_hip"]
    z_neck = lm["z_neck"]
    x_sh = lm["x_sh"]
    x_tip = max((b[2].x for b in lm["bones"] if b[0] == "hand_l"), default=0.38 * H)

    scn = bpy.context.scene
    low_obj.name = "mesh_lod0"
    low_obj["lodLevel"] = 0
    bpy.ops.object.select_all(action="DESELECT")
    low_obj.select_set(True)
    bpy.context.view_layer.objects.active = low_obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    scn.arp_body_name = low_obj.name
    scn.arp_smart_type = "BODY"
    scn.arp_smart_sym = True
    scn.arp_fingers_enable = False
    scn.arp_fingers_to_detect = 0
    scn.arp_smart_spine_count = 4
    scn.arp_smart_neck_count = 1
    scn.arp_smart_twist_count = 0
    scn.arp_smart_overwrite = True

    import numpy as np
    co = lm["co_world"]
    hand_x = max(0.84 * x_tip, x_sh + 0.14 * H)
    # Sample bare outer wrist band (+X) to hit actual wrist Z/Y even with wide hanging sleeves
    wrist_pts = co[(co[:, 0] >= 0.72 * x_tip) & (co[:, 0] <= 0.90 * x_tip) & (co[:, 2] >= z_arm - 0.10 * H) & (co[:, 2] <= z_arm + 0.14 * H)]
    if len(wrist_pts) < 3:
        wrist_pts = co[(co[:, 0] >= 0.65 * x_tip) & (co[:, 2] >= z_arm - 0.12 * H) & (co[:, 2] <= z_arm + 0.16 * H)]
    hand_y = float(np.median(wrist_pts[:, 1])) if len(wrist_pts) >= 3 else 0.0
    hand_z = float(np.median(wrist_pts[:, 2])) if len(wrist_pts) >= 3 else z_arm
    if len(wrist_pts) >= 3:
        hand_x = float(np.median(wrist_pts[:, 0]))

    sh_x = min(max(x_sh, 0.12 * H), 0.17 * H)
    sh_pts = co[(np.abs(co[:, 0] - sh_x) <= 0.045 * H) & (co[:, 2] >= z_arm - 0.06 * H) & (co[:, 2] <= z_arm + 0.12 * H)]
    sh_y = float(np.median(sh_pts[:, 1])) if len(sh_pts) >= 3 else hand_y
    sh_z = float(np.percentile(sh_pts[:, 2], 65)) if len(sh_pts) >= 3 else z_arm

    # Measure clean outer-leg Y depth (|x| >= 0.07*H) so large center tails/capes never shift hip/ankle Y
    leg_outer = co[(co[:, 2] >= z0 + 0.12 * H) & (co[:, 2] <= z0 + 0.48 * H) & (np.abs(co[:, 0]) >= 0.07 * H)]
    leg_back_clean = float(np.percentile(leg_outer[:, 1], 88)) if len(leg_outer) >= 6 else (sh_y + 0.06 * H)
    y_hip_clean = float(np.median(leg_outer[:, 1])) if len(leg_outer) >= 6 else sh_y

    # Sample true ankle cluster (+X) directly at ankle height (supports wide A-stance legs without clipping at 0.125*H)
    ankle_band = co[
        (co[:, 2] >= z0 + 0.02 * H)
        & (co[:, 2] <= z0 + 0.09 * H)
        & (co[:, 0] > 0.025 * H)
        & (co[:, 1] <= leg_back_clean + 0.04 * H)
    ]
    lower_mid_gap = co[
        (co[:, 2] >= z0 + 0.04 * H)
        & (co[:, 2] <= z0 + 0.18 * H)
        & (np.abs(co[:, 0]) <= 0.025 * H)
        & (co[:, 1] <= leg_back_clean + 0.03 * H)
    ]
    if len(ankle_band) >= 4 and len(lower_mid_gap) < 4:
        foot_x = float(np.median(ankle_band[:, 0]))
        foot_y = float(np.median(ankle_band[:, 1]))
    else:
        foot_x = max(0.065 * H, lm.get("lx", 0.09 * H))
        foot_pts = co[(np.abs(co[:, 0] - foot_x) <= 0.045 * H) & (co[:, 2] <= z0 + 0.08 * H) & (co[:, 1] <= leg_back_clean + 0.04 * H)]
        foot_y = float(np.median(foot_pts[:, 1])) if len(foot_pts) >= 3 else y_hip_clean

    def _cleanup_arp_state():
        for obj in list(bpy.data.objects):
            if obj == low_obj:
                continue
            bpy.data.objects.remove(obj, do_unlink=True)

    def _run_smart_detect(target_obj, f_x, f_y):
        arp_errors.clear()
        scn.arp_body_name = target_obj.name
        scn.arp_smart_type = "BODY"
        scn.arp_smart_sym = True
        scn.arp_fingers_enable = False
        scn.arp_fingers_to_detect = 0
        scn.arp_smart_spine_count = 4
        scn.arp_smart_neck_count = 1
        scn.arp_smart_twist_count = 0
        scn.arp_smart_overwrite = True

        for mname, loc in (
            ("root", (0.0, sh_y, z_hip)),
            ("neck", (0.0, sh_y, max(z_arm + 0.055 * H, min(z_neck, z0 + 0.85 * H)))),
            ("chin", (0.0, sh_y - 0.05 * H, min(z0 + 0.89 * H, max(z_arm + 0.095 * H, z_neck + 0.035 * H)))),
            ("shoulder", (sh_x, sh_y, sh_z)),
            ("hand", (hand_x, hand_y, hand_z)),
            ("foot", (f_x, f_y, z0 + 0.055 * H)),
        ):
            auto_rig_smart._add_marker(mname, True)
            m_obj = bpy.data.objects.get(f"{mname}_loc")
            if m_obj:
                m_obj.location = loc

        bpy.context.view_layer.update()
        bpy.ops.id.go_detect()
        bpy.ops.object.mode_set(mode="OBJECT")

    with _view3d_override():
        _run_smart_detect(low_obj, foot_x, foot_y)

        # If wide lower gown/coat blocks ARP Smart foot raycasts, detect skeleton on trimmed leg-silhouette proxy first
        if arp_errors and any("feet" in e.lower() or "foot" in e.lower() or "ankle" in e.lower() for e in arp_errors):
            print("Retrying ARP Smart detection using gown-trimmed leg proxy...")
            import bmesh as _bmesh
            _cleanup_arp_state()
            proxy_data = low_obj.data.copy()
            bm_p = _bmesh.new()
            bm_p.from_mesh(proxy_data)
            del_verts = [
                v for v in bm_p.verts
                if v.co.z < z_hip and abs(v.co.x) > 0.14 * H
            ]
            if del_verts:
                _bmesh.ops.delete(bm_p, geom=del_verts, context="VERTS")
            # Ensure solid ankle/foot boxes exist on detect_proxy so floor-length gown gaps never miss foot rays
            for sx in (1.0, -1.0):
                _bmesh.ops.create_cube(
                    bm_p,
                    size=1.0,
                    matrix=mathutils.Matrix.Translation((sx * 0.09 * H, sh_y - 0.02 * H, z0 + 0.04 * H))
                    @ mathutils.Matrix.Diagonal((0.06 * H, 0.16 * H, 0.08 * H, 1.0)),
                )
            bm_p.to_mesh(proxy_data)
            bm_p.free()
            detect_proxy = bpy.data.objects.new("_arp_detect_proxy", proxy_data)
            bpy.context.scene.collection.objects.link(detect_proxy)

            _run_smart_detect(detect_proxy, 0.09 * H, sh_y)
            if detect_proxy.name in bpy.data.objects:
                bpy.data.objects.remove(detect_proxy, do_unlink=True)
            low_obj.hide_viewport = False
            low_obj.hide_select = False
            low_obj.hide_set(False)
            scn.arp_body_name = low_obj.name

        if arp_errors:
            raise RuntimeError("Auto-Rig Pro Smart detection failed: " + "; ".join(arp_errors))

        rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
        if rig is None:
            raise RuntimeError("Auto-Rig Pro did not generate an armature")

        # Clamp reference pelvis/thigh/spine Y if a large rear tail/cape pulled ARP Smart root raycast backward
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.select_all(action="DESELECT")
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="EDIT")
        eb = rig.data.edit_bones
        if "root_ref.x" in eb and eb["root_ref.x"].head.y > y_hip_clean + 0.025 * H:
            neck_y = eb["neck_ref.x"].head.y if "neck_ref.x" in eb else sh_y
            sp_chain = [n for n in ("root_ref.x", "spine_01_ref.x", "spine_02_ref.x", "spine_03_ref.x") if n in eb]
            for idx, sn in enumerate(sp_chain):
                t0 = idx / float(max(1, len(sp_chain)))
                t1 = (idx + 1) / float(max(1, len(sp_chain)))
                eb[sn].head.y = y_hip_clean * (1.0 - t0) + neck_y * t0
                eb[sn].tail.y = y_hip_clean * (1.0 - t1) + neck_y * t1
            for s in ("l", "r"):
                if f"thigh_ref.{s}" in eb:
                    eb[f"thigh_ref.{s}"].head.y = y_hip_clean

        # Enforce coplanar forward-bending knee on (thigh_ref -> leg_ref -> foot_ref) so ARP match_to_rig
        # never tilts the leg plane (which twists thigh/calf roll by 40-50 deg and throws c_leg_pole sideways)
        for s in ("l", "r"):
            if all(f"{b}.{s}" in eb for b in ("thigh_ref", "leg_ref", "foot_ref")):
                th_b = eb[f"thigh_ref.{s}"]
                lg_b = eb[f"leg_ref.{s}"]
                ft_b = eb[f"foot_ref.{s}"]
                z_h = th_b.head.z
                z_k = lg_b.head.z
                z_a = ft_b.head.z
                t_k = (z_h - z_k) / max(1e-4, z_h - z_a)
                x_line = th_b.head.x + t_k * (ft_b.head.x - th_b.head.x)
                y_line = th_b.head.y + t_k * (ft_b.head.y - th_b.head.y)
                th_b.tail.x = x_line
                lg_b.head.x = x_line
                knee_y_clean = min(lg_b.head.y, y_line - 0.025 * H)
                th_b.tail.y = knee_y_clean
                lg_b.head.y = knee_y_clean
                ft_b.tail.x = ft_b.head.x
                if f"toes_ref.{s}" in eb:
                    to_b = eb[f"toes_ref.{s}"]
                    to_b.head.x = ft_b.head.x
                    to_b.tail.x = ft_b.head.x
        bpy.ops.arp.match_to_rig()

        bpy.ops.object.mode_set(mode="OBJECT")
        low_obj.hide_viewport = False
        low_obj.hide_select = False
        low_obj.hide_set(False)
        bpy.ops.object.select_all(action="DESELECT")
        low_obj.select_set(True)
        bpy.context.view_layer.objects.active = low_obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=1e-4)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")

        scn.arp_bind_engine = "PSEUDO_VOXELS"
        scn.arp_bind_scale_fix = True
        prefs = auto_rig_prefs.get_prefs()
        prefs.remove_existing_arm_mods = True
        prefs.remove_existing_vgroups = True
        bpy.ops.object.select_all(action="DESELECT")
        low_obj.select_set(True)
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.arp.bind_to_rig()
        nz = sum(1 for v in low_obj.data.vertices if sum(g.weight for g in v.groups) > 1e-4)
        if nz < max(1, int(len(low_obj.data.vertices) * 0.5)):
            print(f"ARP PSEUDO_VOXELS bind produced {nz}/{len(low_obj.data.vertices)} weighted verts; retrying with VOXEL remesh...")
            for m in list(low_obj.modifiers):
                if m.type == "ARMATURE":
                    low_obj.modifiers.remove(m)
            for vg in list(low_obj.vertex_groups):
                low_obj.vertex_groups.remove(vg)
            scn.arp_bind_engine = "PSEUDO_VOXELS"
            scn.arp_pseudo_voxels_type = "2"
            scn.arp_bind_scale_fix = True
            bpy.ops.object.select_all(action="DESELECT")
            low_obj.select_set(True)
            rig.select_set(True)
            bpy.context.view_layer.objects.active = rig
            bpy.ops.arp.bind_to_rig()
            scn.arp_pseudo_voxels_type = "1"
            nz = sum(1 for v in low_obj.data.vertices if sum(g.weight for g in v.groups) > 1e-4)
        if nz < max(1, int(len(low_obj.data.vertices) * 0.5)):
            print(f"ARP PSEUDO_VOXELS bind still {nz}/{len(low_obj.data.vertices)}; retrying with HEAT_MAP...")
            for m in list(low_obj.modifiers):
                if m.type == "ARMATURE":
                    low_obj.modifiers.remove(m)
            for vg in list(low_obj.vertex_groups):
                low_obj.vertex_groups.remove(vg)
            scn.arp_bind_engine = "HEAT_MAP"
            scn.arp_bind_scale_fix = True
            bpy.ops.object.select_all(action="DESELECT")
            low_obj.select_set(True)
            rig.select_set(True)
            bpy.context.view_layer.objects.active = rig
            bpy.ops.arp.bind_to_rig()
            nz = sum(1 for v in low_obj.data.vertices if sum(g.weight for g in v.groups) > 1e-4)
        if arp_errors:
            raise RuntimeError("Auto-Rig Pro bind failed: " + "; ".join(arp_errors))
        if nz == 0:
            raise RuntimeError("Auto-Rig Pro bind produced zero weighted vertices on mesh_lod0")

        # Strip limb weights leaked onto trailing rear tail/cape protrusions and transfer them cleanly to pelvis/spine_01
        v_co = np.array([low_obj.matrix_world @ v.co for v in low_obj.data.vertices])
        back_y_start = leg_back_clean + 0.025 * H
        back_mask = (
            (v_co[:, 2] <= z_arm - 0.02 * H)
            & (v_co[:, 1] > back_y_start)
            & (np.abs(v_co[:, 0]) <= x_sh * 1.05)
        )
        back_idxs = np.nonzero(back_mask)[0].tolist()
        if back_idxs:
            vg_root = low_obj.vertex_groups.get("root.x") or low_obj.vertex_groups.get("pelvis")
            vg_sp1 = low_obj.vertex_groups.get("spine_01.x") or low_obj.vertex_groups.get("spine_01") or vg_root
            limb_tokens = ("thigh", "leg", "calf", "foot", "toes", "ball", "arm", "forearm", "hand", "shoulder", "clavicle")
            limb_vgs = [vg for vg in low_obj.vertex_groups if any(tok in vg.name for tok in limb_tokens)]
            for vi in back_idxs:
                a = max(0.0, min(1.0, (float(v_co[vi, 1]) - back_y_start) / (0.04 * H)))
                moved = 0.0
                for vg in limb_vgs:
                    try:
                        w_old = vg.weight(vi)
                        drop = w_old * a
                        if drop > 1e-5:
                            if a >= 0.999:
                                vg.remove([vi])
                            else:
                                vg.add([vi], max(0.0, w_old - drop), "REPLACE")
                            moved += drop
                    except RuntimeError:
                        pass
                if moved > 1e-5 and vg_root:
                    t_sp = max(0.0, min(1.0, (float(v_co[vi, 2]) - z_hip) / max(z_arm - z_hip, 0.1 * H)))
                    vg_root.add([vi], moved * (1.0 - 0.5 * t_sp), "ADD")
                    if vg_sp1:
                        vg_sp1.add([vi], moved * (0.5 * t_sp), "ADD")

        resolved_anim_glb = anim_glb
        if resolved_anim_glb == "":
            resolved_anim_glb = DEFAULT_ANIM58_RUN_GLB if os.path.exists(DEFAULT_ANIM58_RUN_GLB) else ""

        ret_frames = [0, 0]
        if resolved_anim_glb and os.path.exists(resolved_anim_glb):
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=resolved_anim_glb)
            new_objs = [o for o in bpy.data.objects if o not in before]
            src_arm = next((o for o in new_objs if o.type == "ARMATURE"), None)
            if src_arm and src_arm.animation_data and src_arm.animation_data.action:
                src_act = src_arm.animation_data.action
                f_end = max(2, int(round(float(src_act.frame_range[1]))))
                ret_frames = [0, f_end]
                scn.source_rig = src_arm.name
                scn.target_rig = rig.name
                scn.source_action = src_act.name
                scn.arp_retarget_in_place = True
                bpy.ops.object.select_all(action="DESELECT")
                rig.select_set(True)
                bpy.context.view_layer.objects.active = rig
                bpy.ops.arp.auto_scale()
                bpy.ops.arp.build_bones_list()
                bpy.ops.arp.import_config_preset(preset_name="unreal_mannequin_remap")
                _align_arp_retarget_rest_pose(src_arm, rig)
                bpy.ops.arp.retarget(frame_start=0, frame_end=f_end)

            for k in ("rest_transf_offset",):
                if k in scn.keys():
                    del scn[k]
            for o in new_objs:
                if o.name in bpy.data.objects:
                    bpy.data.objects.remove(o, do_unlink=True)

            keep_act = rig.animation_data.action if rig.animation_data else None
            for act in list(bpy.data.actions):
                if act != keep_act:
                    bpy.data.actions.remove(act, do_unlink=True)
            if keep_act:
                keep_act.name = action_name

        # Generate re-authored LOD1/LOD2 (clean low-poly + large-block UV + Color*AO) & LOD3 impostor
        lod1_obj = None
        lod2_obj = None
        lod3_obj = None
        export_objs = [rig, low_obj]
        is_tall_char = bool(lm and lm.get("is_tall_humanoid", True))
        if lod1_tris > 0:
            lod1_obj = _build_reauthored_lod(
                low_obj, rig, "mesh_lod1", lod1_tris, 4, color_size=256, is_lod2=False, lm=lm
            )
            if lod1_obj is not None:
                lod1_obj.hide_render = True
                export_objs.append(lod1_obj)
        if lod2_tris > 0:
            eff_lod2_tris = lod2_tris if (is_tall_char or lod2_tris != 1200) else 750
            lod2_color_size = 128 if is_tall_char else 64
            lod2_obj = _build_reauthored_lod(
                low_obj, rig, "mesh_lod2", eff_lod2_tris, 2, color_size=lod2_color_size, is_lod2=True, lm=lm
            )
            if lod2_obj is not None:
                lod2_obj.hide_render = True
                export_objs.append(lod2_obj)
        if lod3_tight:
            lod3_obj = _build_tight_lod3_impostor(low_obj, rig, anim_range=ret_frames)
            if lod3_obj is not None:
                vg_r = lod3_obj.vertex_groups.new(name="root")
                vg_r.add(list(range(len(lod3_obj.data.vertices))), 1.0, "REPLACE")
                am = lod3_obj.modifiers.new("Armature", "ARMATURE")
                am.object = rig
                export_objs.append(lod3_obj)

        scn.arp_export_rig_type = "HUMANOID"
        scn.arp_engine_type = "UNREAL"
        scn.arp_rename_for_ue = True
        scn.arp_mannequin_axes = True
        scn.arp_export_twist = False
        scn.arp_ue_ik = False
        scn.arp_ge_master_traj = True
        scn.arp_units_x100 = False
        scn.arp_bake_anim = bool(rig.animation_data and rig.animation_data.action)
        scn.arp_bake_only_active = True
        scn.arp_export_act_name = "NONE"
        scn.arp_ge_sel_only = True
        scn.arp_ge_gltf_format = "GLB"
        scn.arp_ge_gltf_export_image_format = "AUTO"

        bpy.ops.object.select_all(action="DESELECT")
        for eo in export_objs:
            eo.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.arp.arp_export_gltf_panel(filepath=os.path.abspath(out_path))

    return {
        "rig": rig,
        "rig_info": {
            "engine": "auto_rig_pro",
            "bindEngine": scn.arp_bind_engine,
            "bones": 23,
            "action": action_name,
            "frames": ret_frames,
            "fps": int(scn.render.fps),
        },
        "lod1_stats": collect_stats([lod1_obj]) if lod1_obj is not None else None,
        "lod2_stats": collect_stats([lod2_obj]) if lod2_obj is not None else None,
        "lod3_stats": collect_stats([lod3_obj]) if lod3_obj is not None else None,
    }


def _export_rigged_with_lods(
    low_obj,
    out_path,
    action_name="Run",
    anim_glb="",
    lod1_tris=0,
    lod2_tris=0,
    lod3_tight=False,
    rig_engine="auto",
):
    lm = detect_humanoid_landmarks(low_obj)
    arp_ready = _has_arp_addon()
    if rig_engine == "arp" and not arp_ready:
        raise RuntimeError("Requested --rig-engine arp, but Auto-Rig Pro extension is not loaded in Blender")
    use_arp = (rig_engine == "arp") or (rig_engine == "auto" and lm["is_tall_humanoid"] and arp_ready)
    if use_arp:
        return _rig_and_export_arp(
            low_obj,
            out_path,
            lm,
            action_name=action_name,
            anim_glb=anim_glb,
            lod1_tris=lod1_tris,
            lod2_tris=lod2_tris,
            lod3_tight=lod3_tight,
        )

    rig, rig_info = build_and_bind_run_rig(low_obj, action_name=action_name, anim_glb=anim_glb)
    low_obj.name = "mesh_lod0"
    low_obj["lodLevel"] = 0
    export_objs = [rig, low_obj]
    lod1_obj = None
    lod2_obj = None
    lod3_obj = None
    is_tall_char = bool(lm and lm.get("is_tall_humanoid", True))
    if lod1_tris > 0:
        lod1_obj = _build_reauthored_lod(
            low_obj, rig, "mesh_lod1", lod1_tris, 4, color_size=256, is_lod2=False, lm=lm
        )
        if lod1_obj is not None:
            lod1_obj.hide_render = True
            export_objs.append(lod1_obj)
    if lod2_tris > 0:
        eff_lod2_tris = lod2_tris if (is_tall_char or lod2_tris != 1200) else 750
        lod2_color_size = 128 if is_tall_char else 64
        lod2_obj = _build_reauthored_lod(
            low_obj, rig, "mesh_lod2", eff_lod2_tris, 2, color_size=lod2_color_size, is_lod2=True, lm=lm
        )
        if lod2_obj is not None:
            lod2_obj.hide_render = True
            export_objs.append(lod2_obj)
    if lod3_tight:
        lod3_obj = _build_tight_lod3_impostor(low_obj, rig, anim_range=rig_info.get("frames"))
        if lod3_obj is not None:
            export_objs.append(lod3_obj)

    bpy.ops.object.select_all(action="DESELECT")
    for eo in export_objs:
        eo.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.context.scene.frame_set(0)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_skins=True,
        export_def_bones=True,
        export_extras=True,
        export_tangents=False,
    )
    return {
        "rig": rig,
        "rig_info": rig_info,
        "lod1_stats": collect_stats([lod1_obj]) if lod1_obj is not None else None,
        "lod2_stats": collect_stats([lod2_obj]) if lod2_obj is not None else None,
        "lod3_stats": collect_stats([lod3_obj]) if lod3_obj is not None else None,
    }


def detect_humanoid_landmarks(obj):
    import numpy as np
    from mathutils import Vector

    n = len(obj.data.vertices)
    if n < 16:
        raise RuntimeError(f"Mesh has too few vertices ({n}) for humanoid auto-rig")
    co = np.zeros(n * 3, dtype=np.float64)
    obj.data.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    mw = obj.matrix_world
    m = np.array(mw.to_3x3(), dtype=np.float64).reshape(3, 3)
    t = np.array(mw.translation, dtype=np.float64)
    co = co @ m.T + t

    z_min = float(co[:, 2].min())
    z_max = float(co[:, 2].max())
    H = max(z_max - z_min, 0.1)

    # Scan horizontal span across 42%..86% height to find true T-pose arm band (covers both chibi 50-67% & human 72-80%)
    span_slices = []
    for zt in np.linspace(z_min + 0.42 * H, z_min + 0.86 * H, 45):
        sl = co[np.abs(co[:, 2] - float(zt)) <= 0.018 * H]
        if len(sl) >= 4:
            span_slices.append((float(zt), float(np.percentile(np.abs(sl[:, 0]), 98))))

    z_arm_seed = z_min + 0.56 * H
    if span_slices:
        max_span = max(s for _, s in span_slices)
        thresh = max(0.28 * H, 0.82 * max_span)
        qual = [(zt, sp) for zt, sp in span_slices if sp >= thresh]
        if qual:
            clusters = [[qual[0]]]
            for item in qual[1:]:
                if item[0] - clusters[-1][-1][0] <= 0.045 * H:
                    clusters[-1].append(item)
                else:
                    clusters.append([item])
            best_cluster = max(clusters, key=lambda cl: (max(s for _, s in cl), cl[-1][0]))
            wsum = sum(s for _, s in best_cluster) or 1.0
            z_arm_seed = sum(z * s for z, s in best_cluster) / wsum

    # Detect outer arm span vertices around the main T-pose arm cluster
    arm_cand = co[(np.abs(co[:, 2] - z_arm_seed) <= 0.085 * H) & (np.abs(co[:, 0]) > 0.22 * H)]
    if len(arm_cand) >= 6:
        z_arm_mid = float(np.median(arm_cand[:, 2]))
        x_tip = float(np.percentile(np.abs(arm_cand[:, 0]), 98))
    else:
        z_arm_mid = z_arm_seed
        x_tip = float(np.percentile(np.abs(co[:, 0]), 98))

    z_arm_rel = (z_arm_mid - z_min) / H
    is_tall_humanoid = z_arm_rel >= 0.685

    # Core torso half-width measured below shoulder/arm level (exclude rear cape/tail)
    waist_lo = max(z_min + 0.26 * H, z_arm_mid - 0.26 * H)
    waist_hi = max(waist_lo + 0.06 * H, z_arm_mid - 0.05 * H)
    waist_mask = (co[:, 2] >= waist_lo) & (co[:, 2] <= waist_hi) & (co[:, 1] <= 0.16 * H)
    w_mid = float(np.percentile(np.abs(co[waist_mask, 0]), 85)) if np.any(waist_mask) else 0.15 * H
    w_mid = max(0.095 * H, min(w_mid, 0.175 * H if is_tall_humanoid else 0.23 * H))
    x_tip = max(x_tip, w_mid + 0.15 * H)

    x_sh = min(max(w_mid * 1.04, 0.125 * H), x_tip * 0.50)
    if is_tall_humanoid:
        x_sh = min(x_sh, 0.165 * H)
    if x_tip - x_sh < 0.10 * H:
        x_tip = x_sh + 0.10 * H
    x_elb = x_sh + 0.44 * (x_tip - x_sh)
    x_hand = x_sh + 0.84 * (x_tip - x_sh)

    def arm_pt(abs_x, sign_x):
        band = co[(np.abs(co[:, 0] - sign_x * abs_x) <= 0.05 * H) & (np.abs(co[:, 2] - z_arm_mid) <= 0.085 * H)]
        if len(band) >= 3:
            zb = max(z_arm_mid - 0.055 * H, min(z_arm_mid + 0.055 * H, float(np.median(band[:, 2]))))
            return Vector((sign_x * abs_x, float(np.median(band[:, 1])), zb))
        return Vector((sign_x * abs_x, 0.0, z_arm_mid))

    # Measure crotch & legs from front/mid lower body (exclude trailing cape/tail Y > +0.14*H)
    crotch_top_frac = min(0.54, max(0.32, z_arm_rel - 0.16))
    lower_mid = co[(co[:, 2] >= z_min + 0.10 * H) & (co[:, 2] <= z_arm_mid - 0.06 * H) & (co[:, 1] <= 0.14 * H)]
    z_crotch = z_min + (0.45 if is_tall_humanoid else 0.28) * H
    crotch_found = False
    for frac in np.linspace(crotch_top_frac, 0.14, 28):
        zt = z_min + float(frac) * H
        center_gap = lower_mid[(np.abs(lower_mid[:, 2] - zt) <= 0.02 * H) & (np.abs(lower_mid[:, 0]) <= 0.025 * H)]
        if len(center_gap) == 0:
            z_crotch = zt
            crotch_found = True
            break

    if is_tall_humanoid:
        # Proportional humanoids (even wearing skirts/coats/fused trousers) keep hip pivot at 45-51% stature
        z_hip_est = z_min + min(0.505, max(0.455, 0.625 * z_arm_rel)) * H
        crotch_rel = (z_crotch - z_min) / H
        if crotch_found and 0.41 <= crotch_rel <= 0.52:
            z_hip = min(0.51 * H + z_min, max(0.45 * H + z_min, z_crotch + 0.03 * H))
        else:
            z_hip = z_hip_est
    else:
        z_hip = min(z_crotch + 0.045 * H, z_arm_mid - 0.10 * H)

    z_ankle = z_min + 0.055 * H
    z_knee = z_ankle + 0.52 * max(z_hip - z_ankle, 0.1 * H)

    leg_band_top = min(z_crotch, z_min + 0.36 * H) if is_tall_humanoid else z_crotch
    leg_x_hi = 0.155 * H if is_tall_humanoid else 1e6
    leg_band = co[
        (co[:, 2] >= z_ankle)
        & (co[:, 2] <= leg_band_top)
        & (co[:, 1] <= 0.14 * H)
        & (np.abs(co[:, 0]) >= 0.025 * H)
        & (np.abs(co[:, 0]) <= leg_x_hi)
    ]
    if len(leg_band) >= 6:
        lx = float(np.median(np.abs(leg_band[:, 0])))
        ly = float(np.median(leg_band[:, 1]))
    else:
        lx, ly = 0.095 * H, (float(np.median(lower_mid[:, 1])) if len(lower_mid) >= 4 else 0.0)
    if is_tall_humanoid:
        lx = max(0.065 * H, min(lx, 0.125 * H))
    foot_band = co[(co[:, 2] <= z_ankle + 0.025 * H) & (co[:, 1] <= 0.14 * H)]
    y_toe = float(np.percentile(foot_band[:, 1], 5)) if len(foot_band) >= 4 else ly - 0.10 * H

    torso_y_max = 0.14 * H if is_tall_humanoid else 0.26 * H
    torso_top = co[(np.abs(co[:, 0]) <= w_mid * 0.75) & (co[:, 2] >= z_hip) & (co[:, 2] <= z_arm_mid) & (co[:, 1] <= torso_y_max)]
    if len(torso_top) >= 4:
        if is_tall_humanoid:
            y_torso = float(np.median(torso_top[:, 1]))
        else:
            y_torso = 0.5 * (float(np.percentile(torso_top[:, 1], 15)) + float(np.percentile(torso_top[:, 1], 85)))
            y_torso = max(ly - 0.05 * H, min(ly + 0.05 * H, y_torso))
    else:
        y_torso = 0.0 if is_tall_humanoid else ly

    z_spine = z_hip + 0.24 * max(z_arm_mid - z_hip, 0.1 * H)
    z_spine2 = z_hip + 0.52 * max(z_arm_mid - z_hip, 0.1 * H)
    z_chest = max(z_arm_mid - 0.015 * H, z_spine2 + 0.03 * H)

    # Locate anatomical neck/collar pinch between upper chest and crown (proportional head size adapts to humanoid vs chibi)
    neck_scan_lo = z_arm_mid + 0.025 * H
    neck_scan_hi = min(z_max - (0.095 * H if is_tall_humanoid else 0.16 * H), z_arm_mid + 0.18 * H)
    neck_cand = []
    if neck_scan_hi > neck_scan_lo + 0.01 * H:
        for zt in np.linspace(neck_scan_lo, neck_scan_hi, 18):
            sl = co[
                (np.abs(co[:, 2] - float(zt)) <= 0.016 * H)
                & (np.abs(co[:, 1] - y_torso) <= 0.16 * H)
                & (np.abs(co[:, 0]) <= x_sh * 1.15)
            ]
            if len(sl) >= 4:
                neck_cand.append((float(np.percentile(np.abs(sl[:, 0]), 90)), float(zt)))
    if neck_cand:
        neck_cand.sort(key=lambda item: item[0])
        z_neck = neck_cand[0][1]
    else:
        z_neck = z_arm_mid + (0.08 * H if is_tall_humanoid else 0.065 * H)
    z_neck_min = z_arm_mid + (0.055 * H if is_tall_humanoid else 0.025 * H)
    z_neck_max = z_max - (0.105 * H if is_tall_humanoid else 0.175 * H)
    z_neck = max(z_neck_min, min(z_neck, max(z_neck_min, z_neck_max)))
    z_head_base = min(z_neck + 0.038 * H, z_max - (0.065 * H if is_tall_humanoid else 0.115 * H))
    z_head_end = z_max - 0.035 * H

    # Trailing cape/tail detection for rigid weight locking behind torso
    leg_back_y = float(np.percentile(leg_band[:, 1], 92)) if len(leg_band) >= 6 else y_torso + 0.07 * H
    # Core (cape-free) back surface of the legs: leg centre line + typical leg half-thickness
    leg_core = co[(co[:, 2] >= z_ankle + 0.03 * H) & (co[:, 2] <= z_knee) & (np.abs(np.abs(co[:, 0]) - lx) <= 0.05 * H)]
    if len(leg_core) >= 6:
        leg_r = float(np.percentile(np.abs(leg_core[:, 1] - ly), 60))
        leg_core_back_y = ly + min(max(leg_r, 0.03 * H), 0.09 * H)
    else:
        leg_core_back_y = leg_back_y
    app_back_y = min(leg_back_y, leg_core_back_y)
    torso_pts = co[(co[:, 2] >= z_hip) & (co[:, 2] <= z_arm_mid) & (np.abs(co[:, 0]) <= x_sh * 0.7)]
    torso_pct = 90 if is_tall_humanoid else 75
    torso_back_y = float(np.percentile(torso_pts[:, 1], torso_pct)) if len(torso_pts) >= 8 else app_back_y
    app_back = {
        "legs": app_back_y,
        "torso": max(app_back_y, torso_back_y),
        "z_hip": z_hip,
        "tall": is_tall_humanoid,
        "margin": 0.065 * H if is_tall_humanoid else 0.03 * H,
    }

    # Detect closed skirt/long-coat garment band (distinguished from narrow touching trousers)
    skirt_band = None
    if is_tall_humanoid:
        closed_zs = []
        for zt in np.linspace(z_min + 0.14 * H, z_hip - 0.01 * H, 28):
            sl = co[(np.abs(co[:, 2] - float(zt)) <= 0.014 * H) & (co[:, 1] <= torso_back_y + 0.03 * H)]
            mid_cnt = int(np.sum(np.abs(sl[:, 0]) <= 0.025 * H))
            if len(sl) >= 8 and mid_cnt >= 4:
                half_w = float(np.percentile(np.abs(sl[:, 0]), 92))
                if float(zt) <= z_min + 0.25 * H or half_w >= max(0.145 * H, lx * 1.38):
                    closed_zs.append(float(zt))
        if len(closed_zs) >= 3 and (max(closed_zs) - min(closed_zs)) >= 0.05 * H:
            skirt_band = (min(closed_zs) - 0.015 * H, z_hip + 0.02 * H)

    # UE5 / Anim58-compatible 23-bone Mannequin hierarchy (works natively with Anim58 animations & embedded Run clip)
    # root is strictly anchored at world origin (0, 0, 0) as pelvis's parent regardless of vertex weights.
    bones = [
        ("root", Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, max(0.08 * H, 0.05))), None),
        ("pelvis", Vector((0, y_torso, z_hip)), Vector((0, y_torso, z_spine)), "root"),
        ("spine_01", Vector((0, y_torso, z_spine)), Vector((0, y_torso, z_spine2)), "pelvis"),
        ("spine_02", Vector((0, y_torso, z_spine2)), Vector((0, y_torso, z_chest)), "spine_01"),
        ("spine_03", Vector((0, y_torso, z_chest)), Vector((0, y_torso, z_neck)), "spine_02"),
        ("neck_01", Vector((0, y_torso, z_neck)), Vector((0, y_torso, z_head_base)), "spine_03"),
        ("head", Vector((0, y_torso, z_head_base)), Vector((0, y_torso, z_head_end)), "neck_01"),
    ]
    for ue_s, sx in (("l", 1.0), ("r", -1.0)):
        p_sh = arm_pt(x_sh, sx)
        p_elb = arm_pt(x_elb, sx)
        p_hand = arm_pt(x_hand, sx)
        p_tip = arm_pt(x_tip, sx)
        p_sh_in = Vector((sx * max(0.04 * H, x_sh * 0.42), y_torso, z_chest))
        bones.extend([
            (f"clavicle_{ue_s}", p_sh_in, p_sh, "spine_03"),
            (f"upperarm_{ue_s}", p_sh, p_elb, f"clavicle_{ue_s}"),
            (f"lowerarm_{ue_s}", p_elb, p_hand, f"upperarm_{ue_s}"),
            (f"hand_{ue_s}", p_hand, p_tip, f"lowerarm_{ue_s}"),
            (f"thigh_{ue_s}", Vector((sx * lx, ly, z_hip)), Vector((sx * lx, ly, z_knee)), "pelvis"),
            (f"calf_{ue_s}", Vector((sx * lx, ly, z_knee)), Vector((sx * lx, ly, z_ankle)), f"thigh_{ue_s}"),
            (f"foot_{ue_s}", Vector((sx * lx, ly, z_ankle)), Vector((sx * lx, y_toe * 0.72, z_min + 0.015 * H)), f"calf_{ue_s}"),
            (f"ball_{ue_s}", Vector((sx * lx, y_toe * 0.72, z_min + 0.015 * H)), Vector((sx * lx, y_toe, z_min + 0.01 * H)), f"foot_{ue_s}"),
        ])

    appendage = _detect_back_appendage(co, H, z_hip, z_arm_mid, z_neck, x_sh, app_back)
    if appendage:
        bones.extend(appendage["bone_defs"])

    return {
        "height": H,
        "z_min": z_min,
        "z_arm": z_arm_mid,
        "z_chest": z_chest,
        "z_neck": z_neck,
        "z_head_base": z_head_base,
        "z_hip": z_hip,
        "x_sh": x_sh,
        "w_mid": w_mid,
        "lx": lx,
        "is_tall_humanoid": is_tall_humanoid,
        "skirt_band": skirt_band,
        "leg_back_y": leg_back_y,
        "app_back": app_back,
        "appendage": appendage,
        "co_world": co,
        "bones": bones,
    }


def _appendage_alpha(co, H, z_arm, z_neck, x_sh, back, kind):
    """Per-vertex membership [0..1] of the trailing cape/tail region behind the legs and torso."""
    import numpy as np
    margin = float(back.get("margin", 0.03 * H))
    base = np.where(co[:, 2] < back["z_hip"], back["legs"], back["torso"]) + margin
    alpha = np.clip((co[:, 1] - base) / (0.05 * H), 0.0, 1.0)
    x_gate = np.clip((x_sh * 0.95 - np.abs(co[:, 0])) / max(0.12 * x_sh, 1e-4), 0.0, 1.0)
    lower = co[:, 2] <= z_arm - 0.02 * H
    if kind == "cape":
        upper = (co[:, 2] > z_arm - 0.02 * H) & (co[:, 2] <= z_neck - 0.01 * H)
        return np.where(lower | upper, alpha * x_gate, 0.0)
    # Tails emerge near the pelvis: never pull upper back vertices or arms into the tail chain
    tail_top = back["z_hip"] + 0.4 * (z_arm - back["z_hip"])
    return np.where(lower & (co[:, 2] <= tail_top), alpha * x_gate, 0.0)


def _detect_back_appendage(co, H, z_hip, z_arm, z_neck, x_sh, back, segments=3):
    """Find a trailing cape or tail behind the body and lay a 3-bone chain from attachment to tip."""
    import numpy as np
    from mathutils import Vector

    margin = float(back.get("margin", 0.03 * H))
    if back.get("tall"):
        # Tall humanoids only detect true capes/tails protruding behind torso back or upper back (avoids lower-leg skirts)
        base = max(back["legs"], back["torso"]) + margin
    else:
        base = np.where(co[:, 2] < back["z_hip"], back["legs"], back["torso"]) + margin
    x_gate = np.clip((x_sh * 0.95 - np.abs(co[:, 0])) / max(0.12 * x_sh, 1e-4), 0.0, 1.0)
    z_lo_gate = (co[:, 2] >= back["z_hip"] + 0.02 * H) if back.get("tall") else True
    low_alpha = np.clip((co[:, 1] - base) / (0.05 * H), 0.0, 1.0) * (co[:, 2] <= z_arm - 0.02 * H) * x_gate * z_lo_gate
    low_pts = co[low_alpha >= 0.5]
    if len(low_pts) < 24:
        return None
    # Cape = wide trailing sheet behind the legs; tail = narrow strand. Measure lateral spread below the hips.
    leg_pts = low_pts[low_pts[:, 2] < z_hip + 0.1 * H]
    spread = float(np.percentile(leg_pts[:, 0], 95) - np.percentile(leg_pts[:, 0], 5)) if len(leg_pts) >= 8 else 0.0
    kind = "cape" if spread >= 0.9 * x_sh else "tail"
    if kind == "cape" and not back.get("tall"):
        back = dict(back, torso=back["legs"])
    alpha = _appendage_alpha(co, H, z_arm, z_neck, x_sh, back, kind)
    pts = co[alpha >= 0.5]
    if len(pts) < 24:
        return None

    # Attachment: cape hangs from the shoulder line, tail from the highest 10% of its region (pelvis)
    z_cut = float(np.percentile(pts[:, 2], 90))
    attach = pts[pts[:, 2] >= z_cut].mean(axis=0)
    if kind == "cape":
        attach[0] = 0.0
        attach[2] = max(attach[2], z_arm - 0.03 * H)
    dist = np.linalg.norm(pts - attach, axis=1)
    length = float(np.percentile(dist, 99))
    if length < 0.06 * H:
        return None
    t = np.clip(dist / length, 0.0, 1.0)

    joints = [attach.copy()]
    for i in range(1, segments + 1):
        ti = i / segments
        band = pts[np.abs(t - ti) <= 0.1]
        p = band.mean(axis=0) if len(band) >= 3 else attach + (pts[np.argmax(dist)] - attach) * ti
        if kind == "cape":
            p[0] = 0.0
        if np.linalg.norm(p - joints[-1]) < 0.02 * H:
            p = joints[-1] + (pts[np.argmax(dist)] - attach) / segments
        joints.append(p)

    parent = "spine_03" if kind == "cape" else "pelvis"
    names = [f"{kind}_{i + 1:02d}" for i in range(segments)]
    bone_defs = []
    prev = parent
    for i, bname in enumerate(names):
        bone_defs.append((bname, Vector(joints[i].tolist()), Vector(joints[i + 1].tolist()), prev))
        prev = bname
    return {
        "kind": kind,
        "parent": parent,
        "names": names,
        "attach": attach.tolist(),
        "length": length,
        "back": back,
        "spread": spread,
        "bone_defs": bone_defs,
    }


DEFAULT_ANIM58_RUN_GLB = os.environ.get("HGAME_MODEL3D_RUN_ANIM_GLB", "")

_UE_LIMB_ALIGN_CHAIN = {
    "upperarm_l": "lowerarm_l",
    "lowerarm_l": "hand_l",
    "upperarm_r": "lowerarm_r",
    "lowerarm_r": "hand_r",
    "thigh_l": "calf_l",
    "calf_l": "foot_l",
    "thigh_r": "calf_r",
    "calf_r": "foot_r",
}


def _resolve_src_ue_bone(dst_bname, src_names):
    if dst_bname == "spine_03" and "spine_05" in src_names:
        return "spine_05"
    if dst_bname == "spine_02" and "spine_05" in src_names and "spine_03" in src_names:
        return "spine_03"
    if dst_bname in src_names:
        return dst_bname
    return None


def retarget_anim_glb_to_rig(rig, anim_glb_path, action_name="Run", sample_step=2, lm=None):
    """Retarget an external Anim58/UE GLB animation clip in-place onto rig in rest bind pose."""
    from mathutils import Quaternion, Vector

    before_objs = set(bpy.data.objects)
    before_meshes = set(bpy.data.meshes)
    before_arms = set(bpy.data.armatures)
    before_acts = set(bpy.data.actions)
    before_mats = set(bpy.data.materials)
    before_imgs = set(bpy.data.images)

    bpy.ops.import_scene.gltf(filepath=anim_glb_path)
    new_objs = [o for o in bpy.data.objects if o not in before_objs]
    src_arm = next((o for o in new_objs if o.type == "ARMATURE"), None)
    if not src_arm or not src_arm.animation_data or not src_arm.animation_data.action:
        for o in new_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        raise RuntimeError(f"Animation GLB has no armature/action: {anim_glb_path}")

    src_act = src_arm.animation_data.action
    scene = bpy.context.scene
    scene.render.fps = 24
    f_end = max(2, int(round(float(src_act.frame_range[1]))))
    sample_frames = list(range(0, f_end, max(1, sample_step)))
    if sample_frames[-1] != f_end:
        sample_frames.append(f_end)

    # Capture source rest pose matrices & head positions
    src_mw = src_arm.matrix_world.copy()
    src_rest_wq = {}
    src_rest_wp = {}
    for b in src_arm.data.bones:
        wm = src_mw @ b.matrix_local
        src_rest_wq[b.name] = wm.to_quaternion()
        src_rest_wp[b.name] = src_mw @ b.head_local

    # Sample animated world quaternions + pelvis world height across frames
    sampled = []
    for f in sample_frames:
        scene.frame_set(f)
        bpy.context.view_layer.update()
        f_wq = {}
        for pb_s in src_arm.pose.bones:
            f_wq[pb_s.name] = (src_arm.matrix_world @ pb_s.matrix).to_quaternion()
        pelvis_wp = (src_arm.matrix_world @ src_arm.pose.bones["pelvis"].head) if "pelvis" in src_arm.pose.bones else Vector((0, 0, 0))
        sampled.append((f, f_wq, pelvis_wp))

    # Cleanup all temporary imported source objects/data before mutating rig
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for col, before in (
        (bpy.data.meshes, before_meshes),
        (bpy.data.armatures, before_arms),
        (bpy.data.actions, before_acts),
        (bpy.data.materials, before_mats),
        (bpy.data.images, before_imgs),
    ):
        for item in list(col):
            if item not in before and item.users == 0:
                col.remove(item, do_unlink=True)

    # Traverse target rig bones top-down to align T-pose limbs onto Anim58 rest limbs
    dst_ordered = []
    def _walk(bone):
        dst_ordered.append(bone)
        for ch in bone.children:
            _walk(ch)
    for b in rig.data.bones:
        if not b.parent:
            _walk(b)

    rig_mw = rig.matrix_world.copy()
    dst_rest_wq = {}
    dst_rest_wp = {}
    dst_rest_rel_q = {}
    for b in dst_ordered:
        wm = rig_mw @ b.matrix_local
        dst_rest_wq[b.name] = wm.to_quaternion()
        dst_rest_wp[b.name] = rig_mw @ b.head_local
        if b.parent:
            pm = rig_mw @ b.parent.matrix_local
            dst_rest_rel_q[b.name] = (pm.inverted() @ wm).to_quaternion()
        else:
            dst_rest_rel_q[b.name] = wm.to_quaternion()

    src_names = set(src_rest_wq.keys())
    dst_align_delta = {}
    dst_aligned_wq = {}
    for b in dst_ordered:
        parent_delta = dst_align_delta.get(b.parent.name, Quaternion()) if b.parent else Quaternion()
        cur_delta = parent_delta.copy()
        child_name = _UE_LIMB_ALIGN_CHAIN.get(b.name)
        src_name = _resolve_src_ue_bone(b.name, src_names)
        src_child = _resolve_src_ue_bone(child_name, src_names) if child_name else None
        if src_name and src_child and child_name in dst_rest_wp:
            v_dst = (dst_rest_wp[child_name] - dst_rest_wp[b.name]).normalized()
            v_dst.rotate(parent_delta)
            v_src = (src_rest_wp[src_child] - src_rest_wp[src_name]).normalized()
            if v_dst.length_squared > 0.5 and v_src.length_squared > 0.5 and v_dst.dot(v_src) > -0.999:
                cur_delta = v_dst.rotation_difference(v_src) @ cur_delta
        dst_align_delta[b.name] = cur_delta
        dst_aligned_wq[b.name] = cur_delta @ dst_rest_wq[b.name]

    mapped_pairs = []
    for b in dst_ordered:
        if b.name == "root":
            continue
        src_name = _resolve_src_ue_bone(b.name, src_names)
        if not src_name:
            continue
        offset_q = src_rest_wq[src_name].inverted() @ dst_aligned_wq[b.name]
        mapped_pairs.append((b, src_name, offset_q))

    short_limb = bool(lm and not lm.get("is_tall_humanoid", True))
    H_rig = float(lm.get("height") or 1.0) if lm else 1.0
    w_mid_rig = float(lm.get("w_mid") or (0.16 * H_rig)) if lm else 0.16 * H_rig
    arm_abduct = min(0.26, max(0.0, (w_mid_rig / max(H_rig, 1e-4) - 0.14) * 2.2)) if short_limb else 0.0
    abduct_l_q = Quaternion((0.0, 1.0, 0.0), -arm_abduct) if arm_abduct > 1e-4 else None
    abduct_r_q = Quaternion((0.0, 1.0, 0.0), arm_abduct) if arm_abduct > 1e-4 else None

    src_mean_wq = {}
    if short_limb and sampled:
        boost_src = set()
        for bn in ("upperarm_l", "upperarm_r", "thigh_l", "thigh_r", "calf_l", "calf_r"):
            sn = _resolve_src_ue_bone(bn, src_names)
            if sn:
                boost_src.add(sn)
        for sn in boost_src:
            if sn not in sampled[0][1]:
                continue
            q_ref = sampled[0][1][sn]
            aw, ax, ay, az = 0.0, 0.0, 0.0, 0.0
            for _, f_wq, _ in sampled:
                q = f_wq.get(sn)
                if q is None:
                    continue
                if q.dot(q_ref) < 0.0:
                    aw -= q.w; ax -= q.x; ay -= q.y; az -= q.z
                else:
                    aw += q.w; ax += q.x; ay += q.y; az += q.z
            mag = math.sqrt(aw * aw + ax * ax + ay * ay + az * az)
            src_mean_wq[sn] = Quaternion((aw / mag, ax / mag, ay / mag, az / mag)) if mag > 1e-6 else q_ref.copy()

    src_pelvis_rest_wp = src_rest_wp.get("pelvis", Vector((0, 0, 1)))
    dst_pelvis_rest_wp = dst_rest_wp.get("pelvis", Vector((0, 0, 0.35)))
    pelvis_scale = float(dst_pelvis_rest_wp.z) / max(0.1, float(src_pelvis_rest_wp.z))
    if short_limb:
        pelvis_scale = max(pelvis_scale, 0.36 * (H_rig / 1.75))
    pelvis_rest_r3_inv = (rig_mw @ rig.data.bones["pelvis"].matrix_local).to_3x3().inverted() if "pelvis" in rig.data.bones else None

    scene.frame_start = 0
    scene.frame_end = f_end
    if not rig.animation_data:
        rig.animation_data_create()
    act = bpy.data.actions.new(name=action_name)
    rig.animation_data.action = act

    pb_map = rig.pose.bones
    prev_q = {}
    for f, f_wq, pelvis_wp in sampled:
        target_wq_map = {}
        for b, src_name, offset_q in mapped_pairs:
            src_q = f_wq[src_name]
            if short_limb and src_name in src_mean_wq:
                q_mean = src_mean_wq[src_name]
                dq = src_q @ q_mean.inverted()
                if dq.w < 0.0:
                    dq = -dq
                axis, angle = dq.to_axis_angle()
                if angle > 1e-5:
                    src_q = (Quaternion(axis, min(math.pi * 0.95, angle * 1.18)) @ q_mean).normalized()
            target_wq = src_q @ offset_q
            if abduct_l_q is not None and b.name in ("upperarm_l", "lowerarm_l", "hand_l"):
                target_wq = abduct_l_q @ target_wq
            elif abduct_r_q is not None and b.name in ("upperarm_r", "lowerarm_r", "hand_r"):
                target_wq = abduct_r_q @ target_wq
            target_wq_map[b.name] = target_wq
            if b.parent and b.parent.name in target_wq_map:
                parent_wq = target_wq_map[b.parent.name]
            elif b.parent:
                parent_wq = dst_rest_wq[b.parent.name]
            else:
                parent_wq = rig_mw.to_quaternion()
            pb = pb_map[b.name]
            pb.rotation_mode = "QUATERNION"
            local_q = ((parent_wq @ dst_rest_rel_q[b.name]).inverted() @ target_wq).normalized()
            if b.name in prev_q and local_q.dot(prev_q[b.name]) < 0.0:
                local_q = -local_q
            prev_q[b.name] = local_q.copy()
            pb.rotation_quaternion = local_q
            pb.keyframe_insert(data_path="rotation_quaternion", frame=f)

        if pelvis_rest_r3_inv is not None and "pelvis" in pb_map:
            delta_w = (pelvis_wp - src_pelvis_rest_wp) * pelvis_scale
            # Lock horizontal travel in-place for web viewport preview
            delta_w.x = 0.0
            delta_w.y = 0.0
            pelvis_pb = pb_map["pelvis"]
            pelvis_pb.location = pelvis_rest_r3_inv @ delta_w
            pelvis_pb.keyframe_insert(data_path="location", frame=f)

    return {
        "bones": len(rig.data.bones),
        "action": action_name,
        "sourceClip": os.path.basename(anim_glb_path),
        "frames": [0, f_end],
        "fps": 24,
    }


def _key_appendage_sway(rig, appendage, f_end, step=2):
    """Bake a seamless looping secondary sway onto the cape/tail chain inside the active Run action."""
    from mathutils import Euler
    if not appendage or f_end <= 0:
        return None
    kind = appendage["kind"]
    pbs = [rig.pose.bones[n] for n in appendage["names"] if n in rig.pose.bones]
    frames = list(range(0, f_end, step)) + [f_end]
    for f in frames:
        phase = (f / float(f_end)) * 2.0 * math.pi
        for i, pb in enumerate(pbs):
            lag = 0.7 * i
            if kind == "cape":
                pitch = 0.10 + 0.05 * math.sin(2.0 * phase - lag)
                roll = 0.04 * math.sin(phase - lag)
                rot = Euler((pitch, 0.0, roll), "XYZ").to_matrix()
            else:
                pitch = 0.06 * math.sin(2.0 * phase - lag)
                yaw = 0.18 * math.sin(phase - lag)
                rot = Euler((pitch, 0.0, yaw), "XYZ").to_matrix()
            _pose_world_rot(pb, rot)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=f)
    return {"kind": kind, "bones": [pb.name for pb in pbs], "parent": appendage["parent"]}


def _pose_world_rot(pb, world_rot_mat):
    """Maps a desired world-space 3x3 rotation delta into a PoseBone's local rest frame."""
    from mathutils import Matrix
    r_rest = pb.bone.matrix_local.to_3x3()
    m_local = r_rest.inverted() @ world_rot_mat @ r_rest
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = m_local.to_quaternion()


def build_and_bind_run_rig(obj, action_name="Run", anim_glb=""):
    import numpy as np
    from mathutils import Euler, Vector

    lm = detect_humanoid_landmarks(obj)
    H = lm["height"]
    arm_data = bpy.data.armatures.new("CharacterRig")
    rig = bpy.data.objects.new("CharacterRig", arm_data)
    bpy.context.scene.collection.objects.link(rig)

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb_map = {}
    for bname, head, tail, _ in lm["bones"]:
        eb = arm_data.edit_bones.new(bname)
        eb.head = head
        if (tail - head).length < 1e-4:
            tail = head + Vector((0, 0, 0.02))
        eb.tail = tail
        eb.roll = 0.0
        eb.use_deform = True
        eb_map[bname] = eb
    for bname, _, _, parent in lm["bones"]:
        if parent:
            eb_map[bname].parent = eb_map[parent]
    bpy.ops.object.mode_set(mode="OBJECT")

    # Run ARMATURE_AUTO on a welded watertight proxy so UV-split seams get bit-identical smooth weights
    proxy_data = obj.data.copy()
    proxy = bpy.data.objects.new("_RigWeightProxy", proxy_data)
    bpy.context.scene.collection.objects.link(proxy)
    proxy.matrix_world = obj.matrix_world.copy()
    bpy.ops.object.select_all(action="DESELECT")
    proxy.select_set(True)
    bpy.context.view_layer.objects.active = proxy
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.dissolve_degenerate()
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.object.select_all(action="DESELECT")
    proxy.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    # Fill any unweighted vertices on welded proxy using anatomically gated soft segment-distance weights
    p_co = np.zeros(len(proxy.data.vertices) * 3, dtype=np.float64)
    proxy.data.vertices.foreach_get("co", p_co)
    p_co = p_co.reshape(len(proxy.data.vertices), 3)
    mw_p = proxy.matrix_world
    p_co = p_co @ np.array(mw_p.to_3x3(), dtype=np.float64).reshape(3, 3).T + np.array(mw_p.translation, dtype=np.float64)

    def _point_to_seg_dist(pt, a, b):
        ab = b - a
        l2 = ab.length_squared
        if l2 < 1e-10:
            return (pt - a).length
        t = max(0.0, min(1.0, (pt - a).dot(ab) / l2))
        proj = a + ab * t
        return (pt - proj).length

    appendage = lm.get("appendage")
    chain_names = set(appendage["names"]) if appendage else set()
    bone_segs = [(bname, h, t) for bname, h, t, _ in lm["bones"] if bname != "root" and bname not in chain_names]
    p_vgroups = proxy.vertex_groups
    if "root" in p_vgroups:
        p_vgroups.remove(p_vgroups["root"])
    # Bone heat leaks cape/tail chain weights onto legs/back; strip them and assign the chain region explicitly later
    for cname in chain_names:
        if cname in p_vgroups:
            p_vgroups.remove(p_vgroups[cname])
    sigma = max(0.09 * H, 0.06)
    fallback_count = 0
    for vi, v in enumerate(proxy.data.vertices):
        tot = sum(g.weight for g in v.groups)
        if tot < 1e-4:
            fallback_count += 1
            vp = Vector(p_co[vi])
            scored = []
            for bname, h, t in bone_segs:
                # Gate left/right limb cross-talk cleanly
                if bname.endswith("_l") and vp.x < -0.01 * H:
                    continue
                if bname.endswith("_r") and vp.x > 0.01 * H:
                    continue
                if any(k in bname for k in ("thigh_", "calf_", "foot_", "ball_")) and vp.z > lm["z_hip"] + 0.05 * H:
                    continue
                if any(k in bname for k in ("clavicle_", "upperarm_", "lowerarm_", "hand_")) and vp.z < lm["z_hip"] + 0.02 * H:
                    continue
                d = _point_to_seg_dist(vp, h, t)
                scored.append((d, bname))
            scored.sort(key=lambda x: x[0])
            d0 = scored[0][0]
            top = [(bname, math.exp(-((d - d0) / sigma) ** 2)) for d, bname in scored[:4]]
            wsum = sum(w for _, w in top) or 1.0
            for bname, w in top:
                if w / wsum >= 0.01:
                    vg = p_vgroups.get(bname) or p_vgroups.new(name=bname)
                    vg.add([vi], w / wsum, "REPLACE")

    # Protect inner front chest/belly from opposing upperarm/lowerarm weights so opposite arm swings never pinch the sternum
    vg_chest = p_vgroups.get("spine_03") or p_vgroups.new(name="spine_03")
    vg_spine = p_vgroups.get("spine_01") or p_vgroups.new(name="spine_01")
    vg_head = p_vgroups.get("head") or p_vgroups.new(name="head")
    arm_group_names = {"upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r"}
    chest_x_limit = lm["x_sh"] * 0.72
    chest_fade = max(lm["x_sh"] * 0.28, 0.02 * H)
    torso_mask = (np.abs(p_co[:, 0]) < chest_x_limit) & (p_co[:, 2] >= lm["z_hip"]) & (p_co[:, 2] <= lm["z_neck"]) & (p_co[:, 1] <= lm["leg_back_y"] + 0.02 * H)
    for idx in np.nonzero(torso_mask)[0].tolist():
        alpha = max(0.0, min(1.0, (chest_x_limit - abs(float(p_co[idx, 0]))) / chest_fade))
        moved = 0.0
        for gname in arm_group_names:
            vg = p_vgroups.get(gname)
            if not vg:
                continue
            try:
                w_old = vg.weight(idx)
                drop = w_old * alpha
                if drop > 1e-4:
                    vg.add([idx], max(0.0, w_old - drop), "REPLACE")
                    moved += drop
            except RuntimeError:
                pass
        if moved > 1e-4:
            t_c = max(0.0, min(1.0, (float(p_co[idx, 2]) - lm["z_hip"]) / max(lm["z_neck"] - lm["z_hip"], 0.1)))
            vg_chest.add([idx], moved * t_c, "ADD")
            vg_spine.add([idx], moved * (1.0 - t_c), "ADD")

    # Ramp head/snout/face weights above the neck collar cleanly toward 100% head, strictly gated away from arms/shoulders
    z_neck_lo = lm["z_neck"] - 0.005 * H
    z_neck_span = 0.03 * H
    arm_check_names = arm_group_names | {"clavicle_l", "clavicle_r"}
    arm_check_idxs = {vg.index for vg in p_vgroups if vg.name in arm_check_names}
    arm_w_arr = np.zeros(len(proxy.data.vertices), dtype=np.float64)
    for vi, v in enumerate(proxy.data.vertices):
        arm_w_arr[vi] = sum(g.weight for g in v.groups if g.group in arm_check_idxs)

    head_x_collar = max(lm["x_sh"] * 0.88, 0.11 * H)
    head_x_crown = max(lm["x_sh"] * 1.35, 0.22 * H)
    head_x_cap = np.where(p_co[:, 2] < lm["z_head_base"] + 0.03 * H, head_x_collar, head_x_crown)
    head_mask = (p_co[:, 2] >= z_neck_lo) & (np.abs(p_co[:, 0]) <= head_x_cap) & (arm_w_arr < 0.15)
    head_idx = np.nonzero(head_mask)[0]
    if len(head_idx) > 0:
        for idx in head_idx.tolist():
            alpha = max(0.0, min(1.0, (float(p_co[idx, 2]) - z_neck_lo) / z_neck_span))
            for vg in p_vgroups:
                if vg.name == "head":
                    continue
                try:
                    w_old = vg.weight(idx)
                    if alpha >= 0.99:
                        vg.remove([idx])
                    else:
                        vg.add([idx], w_old * (1.0 - alpha), "REPLACE")
                except RuntimeError:
                    pass
            vg_head.add([idx], alpha, "ADD")

    # Stabilize closed skirt/long-coat garments on tall humanoids so stride swing does not split the midline
    vg_hips = p_vgroups.get("pelvis") or p_vgroups.new(name="pelvis")
    if lm.get("skirt_band") is not None:
        sk_lo, sk_hi = lm["skirt_band"]
        vg_tl = p_vgroups.get("thigh_l")
        vg_tr = p_vgroups.get("thigh_r")
        vg_cl = p_vgroups.get("calf_l")
        vg_cr = p_vgroups.get("calf_r")
        lx_ref = max(lm.get("lx", 0.09 * H) * 1.05, 0.09 * H)
        sk_mask = (p_co[:, 2] >= sk_lo) & (p_co[:, 2] <= sk_hi) & (np.abs(p_co[:, 0]) <= lm["x_sh"] * 1.15)
        for idx in np.nonzero(sk_mask)[0].tolist():
            px = float(p_co[idx, 0])
            pz = float(p_co[idx, 2])
            mid_b = max(0.0, min(1.0, 1.0 - abs(px) / lx_ref))
            top_t = max(0.0, min(1.0, (pz - sk_lo) / max(sk_hi - sk_lo, 0.05 * H)))
            pelvis_target = min(0.80, 0.22 + 0.36 * top_t + 0.24 * mid_b)

            def _get_w(vg):
                if vg is None:
                    return 0.0
                try:
                    return vg.weight(idx)
                except RuntimeError:
                    return 0.0

            w_p = _get_w(vg_hips)
            w_tl, w_tr = _get_w(vg_tl), _get_w(vg_tr)
            w_cl, w_cr = _get_w(vg_cl), _get_w(vg_cr)
            # Soften left/right leg shear across x=0 inside closed skirt/coat band
            if mid_b > 0.02 and (w_tl + w_tr) > 1e-4:
                cross = 0.45 * mid_b
                avg_t = 0.5 * (w_tl + w_tr)
                w_tl = w_tl * (1.0 - cross) + avg_t * cross
                w_tr = w_tr * (1.0 - cross) + avg_t * cross
                if vg_tl:
                    vg_tl.add([idx], w_tl, "REPLACE")
                if vg_tr:
                    vg_tr.add([idx], w_tr, "REPLACE")
            leg_tot = w_tl + w_tr + w_cl + w_cr
            if pelvis_target > w_p and leg_tot > 1e-4:
                give = min(leg_tot, pelvis_target - w_p)
                scale = (leg_tot - give) / leg_tot
                for vg, w in ((vg_tl, w_tl), (vg_tr, w_tr), (vg_cl, w_cl), (vg_cr, w_cr)):
                    if vg and w > 1e-4:
                        vg.add([idx], w * scale, "REPLACE")
                vg_hips.add([idx], give, "ADD")

    # Soft-blend genuine trailing back protrusion toward spine_01/pelvis without clobbering human backs or arms
    back_ref = max(lm["leg_back_y"], lm["app_back"]["torso"]) if lm.get("is_tall_humanoid") else lm["leg_back_y"]
    back_y_start = back_ref + float(lm["app_back"].get("margin", 0.03 * H))
    back_y_span = 0.05 * H
    mask_back = (
        (p_co[:, 2] <= lm["z_arm"] - 0.02 * H)
        & (p_co[:, 1] > back_y_start)
        & (np.abs(p_co[:, 0]) <= lm["x_sh"] * 0.95)
    )
    back_idx = np.nonzero(mask_back)[0]
    if len(back_idx) > 0:
        for idx in back_idx.tolist():
            alpha = max(0.0, min(1.0, (float(p_co[idx, 1]) - back_y_start) / back_y_span))
            for vg in p_vgroups:
                if vg.name in ("spine_01", "pelvis"):
                    continue
                try:
                    w_old = vg.weight(idx)
                    if alpha >= 0.99:
                        vg.remove([idx])
                    else:
                        vg.add([idx], w_old * (1.0 - alpha), "REPLACE")
                except RuntimeError:
                    pass
            t_sp = max(0.0, min(1.0, (float(p_co[idx, 2]) - lm["z_min"]) / max(lm["z_arm"] - lm["z_min"], 0.1)))
            vg_hips.add([idx], alpha * (1.0 - t_sp * 0.65), "ADD")
            vg_spine.add([idx], alpha * (t_sp * 0.65), "ADD")

    # Smooth weights across welded edge graph in NumPy (works headless without WEIGHT_PAINT poll)
    nv = len(proxy.data.vertices)
    ng = len(p_vgroups)
    if ng > 0 and nv > 0:
        wmat = np.zeros((nv, ng), dtype=np.float64)
        for vi, v in enumerate(proxy.data.vertices):
            for g in v.groups:
                if 0 <= g.group < ng:
                    wmat[vi, g.group] = g.weight
        nbrs = [[] for _ in range(nv)]
        for e in proxy.data.edges:
            a, b = e.vertices[0], e.vertices[1]
            nbrs[a].append(b)
            nbrs[b].append(a)
        smooth_iters = 10 if fallback_count > 0 else 7
        for _ in range(smooth_iters):
            nxt = wmat.copy()
            for vi in range(nv):
                nb = nbrs[vi]
                if nb:
                    nxt[vi] = 0.5 * wmat[vi] + 0.5 * wmat[nb].mean(axis=0)
            row_s = nxt.sum(axis=1, keepdims=True)
            row_s[row_s < 1e-8] = 1.0
            wmat = nxt / row_s
        for gi, vg in enumerate(p_vgroups):
            col = wmat[:, gi]
            for vi in np.nonzero(col > 1e-3)[0].tolist():
                vg.add([vi], float(col[vi]), "REPLACE")
            for vi in np.nonzero(col <= 1e-3)[0].tolist():
                try:
                    vg.remove([vi])
                except RuntimeError:
                    pass

    # Re-lock rigid head sphere/muzzle after smoothing so face features stay crisp (arms still excluded)
    strict_head_idx = np.nonzero(head_mask & (p_co[:, 2] >= z_neck_lo + z_neck_span))[0]
    for idx in strict_head_idx.tolist():
        for vg in p_vgroups:
            if vg.name != "head":
                try:
                    vg.remove([idx])
                except RuntimeError:
                    pass
        vg_head.add([idx], 1.0, "REPLACE")

    # Bind trailing cape/tail onto its own 3-bone chain: rigid follow of parent at the root, no leg/arm pull
    chain_verts = 0
    if appendage:
        app_alpha = _appendage_alpha(p_co, H, lm["z_arm"], lm["z_neck"], lm["x_sh"], appendage["back"], appendage["kind"])
        attach = np.array(appendage["attach"], dtype=np.float64)
        app_len = max(float(appendage["length"]), 1e-4)
        n_seg = len(appendage["names"])
        chain_vgs = [p_vgroups.get(n) or p_vgroups.new(name=n) for n in appendage["names"]]
        vg_parent = p_vgroups.get(appendage["parent"]) or p_vgroups.new(name=appendage["parent"])
        group_by_index = {vg.index: vg for vg in p_vgroups}
        for idx in np.nonzero(app_alpha > 1e-3)[0].tolist():
            a = float(app_alpha[idx])
            t = min(1.0, float(np.linalg.norm(p_co[idx] - attach)) / app_len)
            cw = [max(0.0, 1.0 - abs(t * n_seg - (i + 0.5))) for i in range(n_seg)]
            if t * n_seg <= 0.5:
                cw[0] = 1.0
            if t * n_seg >= n_seg - 0.5:
                cw[-1] = 1.0
            pw = max(0.0, 1.0 - t / 0.12)
            tot = sum(cw) + pw
            cw = [w / tot for w in cw]
            pw /= tot
            old = [(g.group, g.weight) for g in proxy.data.vertices[idx].groups]
            for gi, w in old:
                vg = group_by_index.get(gi)
                if vg is None:
                    continue
                if a >= 0.999:
                    vg.remove([idx])
                else:
                    vg.add([idx], w * (1.0 - a), "REPLACE")
            for vg, w in zip(chain_vgs, cw):
                if w > 1e-4:
                    vg.add([idx], a * w, "ADD")
            if pw > 1e-4:
                vg_parent.add([idx], a * pw, "ADD")
            chain_verts += 1

    bpy.ops.object.select_all(action="DESELECT")
    proxy.select_set(True)
    bpy.context.view_layer.objects.active = proxy
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)

    # Transfer clean smooth weights from welded proxy -> UV-split target mesh
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_NAME")
    for vg in list(obj.vertex_groups):
        obj.vertex_groups.remove(vg)
    for vg in p_vgroups:
        obj.vertex_groups.new(name=vg.name)

    dt = obj.modifiers.new("TransferRigWeights", "DATA_TRANSFER")
    dt.object = proxy
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "NEAREST"
    dt.layers_vgroup_select_src = "ALL"
    dt.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=dt.name)

    bpy.data.objects.remove(proxy, do_unlink=True)
    bpy.data.meshes.remove(proxy_data, do_unlink=True)

    for mod in obj.modifiers:
        if mod.type == "ARMATURE":
            mod.use_deform_preserve_volume = False

    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)

    resolved_anim_glb = anim_glb
    if resolved_anim_glb == "":
        resolved_anim_glb = DEFAULT_ANIM58_RUN_GLB if os.path.exists(DEFAULT_ANIM58_RUN_GLB) else "procedural"

    if resolved_anim_glb and resolved_anim_glb != "procedural" and os.path.exists(resolved_anim_glb):
        ret_info = retarget_anim_glb_to_rig(rig, resolved_anim_glb, action_name=action_name, lm=lm)
        ret_info["backLockedVerts"] = int(len(back_idx))
        ret_info["appendage"] = _key_appendage_sway(rig, appendage, int(ret_info["frames"][1]))
        ret_info["appendageVerts"] = chain_verts
        return rig, ret_info

    # Procedural athletic Run cycle fallback (24 frames @ 24 fps -> 1.0s seamless loop, -Y forward)
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.frame_start = 0
    scene.frame_end = 24

    if not rig.animation_data:
        rig.animation_data_create()
    act = bpy.data.actions.new(name=action_name)
    rig.animation_data.action = act

    pb = rig.pose.bones
    is_tall = bool(lm.get("is_tall_humanoid"))
    sh_drop = 0.16
    arm_drop = 0.72 if is_tall else 0.58
    for f in range(0, 25, 3):
        phase = (f / 24.0) * 2.0 * math.pi
        s1 = math.sin(phase)
        c1 = math.cos(phase)
        s2 = math.sin(phase * 2.0)

        # Hip bounce + forward lean + torso counter-twist
        pelvis_pb = pb["pelvis"]
        pelvis_pb.location = Vector((0.0, 0.0, -0.042 * H * abs(s1)))
        pelvis_pb.keyframe_insert(data_path="location", frame=f)
        _pose_world_rot(pelvis_pb, Euler((0.12, 0.0, 0.16 * s1), "XYZ").to_matrix())
        pelvis_pb.keyframe_insert(data_path="rotation_quaternion", frame=f)

        _pose_world_rot(pb["spine_01"], Euler((0.05, 0.0, -0.06 * s1), "XYZ").to_matrix())
        pb["spine_01"].keyframe_insert(data_path="rotation_quaternion", frame=f)
        _pose_world_rot(pb["spine_02"], Euler((0.04, 0.0, -0.06 * s1), "XYZ").to_matrix())
        pb["spine_02"].keyframe_insert(data_path="rotation_quaternion", frame=f)
        _pose_world_rot(pb["spine_03"], Euler((0.04, 0.0, -0.06 * s1), "XYZ").to_matrix())
        pb["spine_03"].keyframe_insert(data_path="rotation_quaternion", frame=f)
        _pose_world_rot(pb["head"], Euler((-0.14 + 0.035 * s2, 0.0, 0.04 * s1), "XYZ").to_matrix())
        pb["head"].keyframe_insert(data_path="rotation_quaternion", frame=f)

        # Legs: -X pitch swings forward (-Y); +X pitch swings back (+Y) and bends knee backward
        for ue_s, ph_sign in (("l", 1.0), ("r", -1.0)):
            stride = s1 * ph_sign
            knee_lift = max(0.0, c1 * ph_sign)
            thigh_pitch = -0.78 * stride - 0.22 * knee_lift
            knee_flex = 0.22 + 1.15 * max(0.0, -stride * 0.45 + knee_lift * 0.95)
            foot_pitch = -0.22 * knee_flex + 0.18 * stride

            _pose_world_rot(pb[f"thigh_{ue_s}"], Euler((thigh_pitch, 0.0, 0.0), "XYZ").to_matrix())
            pb[f"thigh_{ue_s}"].keyframe_insert(data_path="rotation_quaternion", frame=f)
            _pose_world_rot(pb[f"calf_{ue_s}"], Euler((knee_flex, 0.0, 0.0), "XYZ").to_matrix())
            pb[f"calf_{ue_s}"].keyframe_insert(data_path="rotation_quaternion", frame=f)
            _pose_world_rot(pb[f"foot_{ue_s}"], Euler((foot_pitch, 0.0, 0.0), "XYZ").to_matrix())
            pb[f"foot_{ue_s}"].keyframe_insert(data_path="rotation_quaternion", frame=f)

        # Arms: split drop smoothly across clavicle + upperarm to prevent armpit/chest pinching
        for ue_s, sx, ph_sign in (("l", 1.0, -1.0), ("r", -1.0, 1.0)):
            swing = 0.88 * s1 * ph_sign
            m_sh = Euler((0.0, sx * sh_drop, -sx * swing * 0.16), "XYZ").to_matrix()
            _pose_world_rot(pb[f"clavicle_{ue_s}"], m_sh)
            pb[f"clavicle_{ue_s}"].keyframe_insert(data_path="rotation_quaternion", frame=f)

            m_arm = Euler((0.0, sx * arm_drop, -sx * swing * 0.84), "XYZ").to_matrix()
            _pose_world_rot(pb[f"upperarm_{ue_s}"], m_arm)
            pb[f"upperarm_{ue_s}"].keyframe_insert(data_path="rotation_quaternion", frame=f)

            elbow_flex = 0.75 + 0.55 * max(0.0, s1 * ph_sign)
            m_fa = Euler((0.0, 0.0, -sx * elbow_flex), "XYZ").to_matrix()
            _pose_world_rot(pb[f"lowerarm_{ue_s}"], m_fa)
            pb[f"lowerarm_{ue_s}"].keyframe_insert(data_path="rotation_quaternion", frame=f)

    # Set linear/bezier clean handles & leave scene at frame 6 preview or 0 default
    return rig, {
        "bones": len(lm["bones"]),
        "action": action_name,
        "frames": [0, 24],
        "fps": 24,
        "backLockedVerts": int(len(back_idx)),
        "appendage": _key_appendage_sway(rig, appendage, 24),
        "appendageVerts": chain_verts,
    }


def cmd_rig_run(args):
    import re
    clear_scene_keep_addons()
    import_model(args.input)
    imported = get_mesh_objects()
    if not imported:
        raise RuntimeError(f"No mesh objects found in {args.input}")

    # When re-rigging an already-packed multi-LOD GLB, keep only LOD0 base mesh and drop old LOD1..3/rigs
    lod0_objs = [o for o in imported if re.search(r"mesh_lod0", o.name, re.I)]
    if lod0_objs:
        primary_list = lod0_objs
    else:
        primary_list = [o for o in imported if not re.search(r"(?:_lod|mesh_lod)[1-4]", o.name, re.I)]
    for o in list(imported):
        if o not in primary_list:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in list(bpy.data.objects):
        if o.type == "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m, do_unlink=True)
    bpy.context.view_layer.update()

    obj = primary_list[0] if len(primary_list) == 1 else ensure_single_mesh("RiggedCharacter")
    for mod in list(obj.modifiers):
        if mod.type == "ARMATURE":
            obj.modifiers.remove(mod)
    for vg in list(obj.vertex_groups):
        obj.vertex_groups.remove(vg)
    obj.parent = None
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    exp = _export_rigged_with_lods(
        obj,
        args.out,
        action_name=args.action_name,
        anim_glb=getattr(args, "anim_glb", ""),
        lod1_tris=int(getattr(args, "lod1_tris", 0) or 0),
        lod2_tris=int(getattr(args, "lod2_tris", 0) or 0),
        lod3_tight=bool(getattr(args, "lod3_tight", False)),
        rig_engine=getattr(args, "rig_engine", "auto"),
    )
    rig_info = exp["rig_info"]

    stats = collect_stats([obj])
    rendered = []
    if args.qa_dir:
        os.makedirs(args.qa_dir, exist_ok=True)
        for frame_num in (6, 18):
            bpy.context.scene.frame_set(frame_num)
            bpy.context.view_layer.update()
            sub_dir = os.path.join(args.qa_dir, f"f{frame_num:02d}")
            rendered.extend(
                render_views([obj], sub_dir, view_mode="4", size=args.size, elev_deg=8.0, engine=args.engine)
            )
    print("HGAME_MODEL3D_JSON:" + json.dumps({
        "input": os.path.abspath(args.input),
        "output": os.path.abspath(args.out),
        "rig": rig_info,
        "stats": stats,
        "lod1Stats": exp["lod1_stats"],
        "lod2Stats": exp["lod2_stats"],
        "lod3Stats": exp["lod3_stats"],
        "rendered": rendered,
    }, ensure_ascii=True))


def cmd_assemble_pbr(args):
    import numpy as np
    from PIL import Image, ImageOps

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    tex_dir = os.path.join(out_dir, f"{os.path.splitext(os.path.basename(args.out))[0]}_pbr")
    os.makedirs(tex_dir, exist_ok=True)

    def prep_img(src, dst_name, mode="RGB"):
        im = Image.open(src).convert(mode)
        if args.flip_v:
            im = ImageOps.flip(im)
        dst = os.path.join(tex_dir, dst_name)
        im.save(dst)
        return dst

    bc_path = prep_img(args.base_color, "BaseColor.png", "RGB")
    r_src = Image.open(args.roughness).convert("L")
    m_src = Image.open(args.metallic).convert("L") if args.metallic else Image.new("L", r_src.size, 0)
    if args.flip_v:
        r_src = ImageOps.flip(r_src)
        m_src = ImageOps.flip(m_src)
    r_arr = np.asarray(r_src, dtype=np.uint8)
    m_arr = np.asarray(m_src, dtype=np.uint8)
    orm_path = os.path.join(tex_dir, "ORM.png")
    Image.fromarray(np.stack([np.full_like(r_arr, 255), r_arr, m_arr], axis=-1)).save(orm_path)

    clear_scene()
    import_model(args.mesh)
    obj = ensure_single_mesh("AssembledPBR")
    for p in obj.data.polygons:
        p.use_smooth = True
    wire_clean_pbr_material(obj, bc_path, orm_path, args.normal, "AssembledPBR")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=args.out, export_format="GLB", use_selection=True, export_apply=True)

    result = {
        "mesh": os.path.abspath(args.mesh),
        "output": os.path.abspath(args.out),
        "stats": collect_stats([obj]),
    }
    if args.qa_dir:
        result["rendered"] = render_views(
            [obj],
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
    p_norm.add_argument("--no-repair", action="store_true", default=False)
    p_norm.add_argument("--prune-whiskers", action="store_true", default=False)
    p_norm.add_argument("--keep-largest-island", action="store_true", default=False)
    p_norm.add_argument("--qa-dir", default="")
    p_norm.add_argument("--views", default="4", choices=["4", "6"])
    p_norm.add_argument("--size", type=int, default=512)
    p_norm.add_argument("--elev", type=float, default=12.0)
    p_norm.add_argument("--engine", default="BLENDER_EEVEE")

    p_rb = sub.add_parser("remesh-bake")
    p_rb.add_argument("--input", required=True)
    p_rb.add_argument("--out", required=True)
    p_rb.add_argument("--work-dir", default="")
    p_rb.add_argument("--clean-uv-out", default="")
    p_rb.add_argument("--xremesh", default="")
    p_rb.add_argument("--target-quads", type=int, default=16000)
    p_rb.add_argument("--adaptive", type=int, default=50)
    p_rb.add_argument("--uv-solver", default="organic", choices=["organic", "smart", "blender"])
    p_rb.add_argument("--texture-size", type=int, default=2048)
    p_rb.add_argument("--normal-strength", type=float, default=0.28)
    p_rb.add_argument("--cage-extrusion", type=float, default=0.022)
    p_rb.add_argument("--max-ray-distance", type=float, default=0.08)
    p_rb.add_argument("--voxel-div", type=float, default=260.0)
    p_rb.add_argument("--samples", type=int, default=16)
    p_rb.add_argument("--smooth-head-z", type=float, default=0.0)
    p_rb.add_argument("--smooth-head-ratio", type=float, default=0.0)
    p_rb.add_argument("--no-weld-high", action="store_true")
    p_rb.add_argument("--rig-run", action="store_true", default=False)
    p_rb.add_argument("--rig-engine", default="auto", choices=["auto", "arp", "native"])
    p_rb.add_argument("--lod1-tris", type=int, default=0)
    p_rb.add_argument("--lod2-tris", type=int, default=0)
    p_rb.add_argument("--lod3-tight", action="store_true", default=False)
    p_rb.add_argument("--max-tris", type=int, default=0)
    p_rb.add_argument("--origin", default="keep", choices=["ground", "center", "keep"])
    p_rb.add_argument("--target-height", type=float, default=0.0)
    p_rb.add_argument("--anim-glb", default="")
    p_rb.add_argument("--qa-dir", default="")
    p_rb.add_argument("--views", default="4", choices=["4", "6"])
    p_rb.add_argument("--size", type=int, default=512)
    p_rb.add_argument("--elev", type=float, default=12.0)
    p_rb.add_argument("--engine", default="BLENDER_EEVEE")

    p_rig = sub.add_parser("rig-run")
    p_rig.add_argument("--input", required=True)
    p_rig.add_argument("--out", required=True)
    p_rig.add_argument("--action-name", default="Run")
    p_rig.add_argument("--anim-glb", default="")
    p_rig.add_argument("--rig-engine", default="auto", choices=["auto", "arp", "native"])
    p_rig.add_argument("--lod1-tris", type=int, default=0)
    p_rig.add_argument("--lod2-tris", type=int, default=0)
    p_rig.add_argument("--lod3-tight", action="store_true", default=False)
    p_rig.add_argument("--qa-dir", default="")
    p_rig.add_argument("--size", type=int, default=512)
    p_rig.add_argument("--engine", default="BLENDER_EEVEE")

    p_asm = sub.add_parser("assemble-pbr")
    p_asm.add_argument("--mesh", required=True)
    p_asm.add_argument("--base-color", required=True)
    p_asm.add_argument("--roughness", required=True)
    p_asm.add_argument("--metallic", default="")
    p_asm.add_argument("--normal", default="")
    p_asm.add_argument("--flip-v", action="store_true", default=False)
    p_asm.add_argument("--out", required=True)
    p_asm.add_argument("--qa-dir", default="")
    p_asm.add_argument("--views", default="4", choices=["4", "6"])
    p_asm.add_argument("--size", type=int, default=512)
    p_asm.add_argument("--elev", type=float, default=12.0)
    p_asm.add_argument("--engine", default="BLENDER_EEVEE")

    args = parser.parse_args(argv)
    if args.command == "inspect":
        cmd_inspect(args)
    elif args.command == "normalize":
        cmd_normalize(args)
    elif args.command == "remesh-bake":
        cmd_remesh_bake(args)
    elif args.command == "rig-run":
        cmd_rig_run(args)
    elif args.command == "assemble-pbr":
        cmd_assemble_pbr(args)


if __name__ == "__main__":
    main()
