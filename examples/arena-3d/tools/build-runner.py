"""Build the original articulated runner for Beacon Run with Blender 5."""

import base64
import json
import math
from pathlib import Path
import struct
import tempfile

import bpy


OUTPUT = Path(__file__).resolve().parents[1] / "src" / "assets" / "runner.gltf"


def surface(name, color, metallic=0.0, glow=0.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = material.diffuse_color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = 0.44
    shader.inputs["Emission Color"].default_value = material.diffuse_color
    shader.inputs["Emission Strength"].default_value = glow
    return material


def create_rig():
    armature = bpy.data.armatures.new("RunnerRig")
    rig = bpy.data.objects.new("Runner", armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    anchors = [
        ("Root", (0, 0, 0), (0, 0, 0.3), None),
        ("Body", (0, 0, 0.73), (0, 0, 1.34), "Root"),
        ("Head", (0, 0, 1.4), (0, 0, 1.82), "Body"),
        ("Arm.L", (0.43, 0, 1.3), (0.43, 0, 0.85), "Body"),
        ("Arm.R", (-0.43, 0, 1.3), (-0.43, 0, 0.85), "Body"),
        ("Leg.L", (0.17, 0, 0.74), (0.17, 0, 0.17), "Root"),
        ("Leg.R", (-0.17, 0, 0.74), (-0.17, 0, 0.17), "Root"),
    ]
    for name, head, tail, parent in anchors:
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        if parent:
            bone.parent = armature.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def part(rig, name, bone, position, dimensions, material, bevel=0.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    mesh = bpy.context.object
    mesh.name = name
    mesh.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    edge = mesh.modifiers.new("Armor edges", "BEVEL")
    edge.width, edge.segments = bevel, 1
    bpy.ops.object.modifier_apply(modifier=edge.name)
    mesh.data.materials.append(material)
    mesh.vertex_groups.new(name=bone).add(list(range(len(mesh.data.vertices))), 1.0, "REPLACE")
    skin = mesh.modifiers.new("Runner skin", "ARMATURE")
    skin.object = rig
    mesh.parent = rig


def dress(rig):
    shell = surface("Graphite plate", (0.045, 0.078, 0.11), 0.32)
    trim = surface("Patrol orange", (0.92, 0.22, 0.065), 0.12)
    light = surface("Signal glass", (0.065, 0.63, 0.78), glow=1.8)
    part(rig, "Torso armor", "Body", (0, 0, 1.09), (0.73, 0.42, 0.59), shell, 0.07)
    part(rig, "Chest plate", "Body", (0, -0.204, 1.17), (0.49, 0.09, 0.34), trim)
    part(rig, "Chest signal", "Body", (0, -0.258, 1.17), (0.18, 0.025, 0.07), light, 0.009)
    part(rig, "Pack", "Body", (0, 0.23, 1.11), (0.37, 0.21, 0.43), shell)
    part(rig, "Helmet", "Head", (0, 0, 1.59), (0.46, 0.40, 0.39), shell, 0.055)
    part(rig, "Visor", "Head", (0, -0.203, 1.63), (0.36, 0.058, 0.096), light, 0.02)
    part(rig, "Antenna", "Head", (0.17, 0.05, 1.81), (0.055, 0.055, 0.24), trim, 0.01)
    for side, x in [("L", 1), ("R", -1)]:
        arm, leg = f"Arm.{side}", f"Leg.{side}"
        part(rig, f"Shoulder {side}", arm, (x * 0.46, 0, 1.29), (0.27, 0.31, 0.29), trim)
        part(rig, f"Gauntlet {side}", arm, (x * 0.48, -0.02, 1.01), (0.23, 0.26, 0.38), shell)
        part(rig, f"Leg plate {side}", leg, (x * 0.17, 0, 0.45), (0.25, 0.29, 0.52), shell)
        part(rig, f"Boot {side}", leg, (x * 0.17, -0.08, 0.12), (0.26, 0.42, 0.24), trim)


def add_clip(rig, name, poses):
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    for frame, rotations, bounce in poses:
        for bone in rig.pose.bones:
            bone.rotation_mode = "XYZ"
            bone.rotation_euler = rotations.get(bone.name, (0, 0, 0))
            bone.keyframe_insert(data_path="rotation_euler", frame=frame)
        root = rig.pose.bones["Root"]
        root.location = (0, bounce, 0)
        root.keyframe_insert(data_path="location", frame=frame)
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, poses[0][0], action)


def animate(rig):
    rig.animation_data_create()
    add_clip(rig, "Idle", [(1, {}, 0), (31, {"Head": (0.05, 0.09, 0)}, 0.028), (61, {}, 0)])
    run = {"Arm.L": (0.62, 0, 0), "Arm.R": (-0.62, 0, 0), "Leg.L": (-0.61, 0, 0), "Leg.R": (0.61, 0, 0)}
    reverse = {name: (-angles[0], 0, 0) for name, angles in run.items()}
    add_clip(rig, "Run", [(1, run, 0), (5, {}, 0.07), (9, reverse, 0), (13, {}, 0.07), (17, run, 0)])
    tuck = {"Leg.L": (0.44, 0, 0), "Leg.R": (-0.24, 0, 0), "Arm.L": (-0.78, 0, 0), "Arm.R": (-0.78, 0, 0)}
    add_clip(rig, "Jump", [(1, {}, 0), (8, tuck, 0), (19, {}, 0)])
    add_clip(rig, "Spin", [(frame, {"Root": (0, math.pi * turn / 2, 0),
        "Arm.L": (0, 0, 0.86), "Arm.R": (0, 0, -0.86)}, 0) for turn, frame in enumerate([1, 3, 5, 7, 9])])
    add_clip(rig, "Hit", [(1, {}, 0), (4, {"Body": (0.23, 0, 0.34)}, -0.04), (8, {}, 0)])


def export_embedded(output=OUTPUT):
    # Keep the authored example self-contained and small enough to ship with the SDK.
    with tempfile.TemporaryDirectory() as scratch:
        glb = Path(scratch) / "runner.glb"
        bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", export_animation_mode="NLA_TRACKS")
        raw = glb.read_bytes()
    json_length, = struct.unpack_from("<I", raw, 12)
    model = json.loads(raw[20:20 + json_length])
    for index, buffer in enumerate(model["buffers"]):
        if index != 0:
            raise ValueError("Expected a single GLB buffer")
        start = 28 + json_length
        buffer["uri"] = "data:application/octet-stream;base64," + base64.b64encode(
            raw[start:start + buffer["byteLength"]]
        ).decode("ascii")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    rig = create_rig()
    dress(rig)
    animate(rig)
    export_embedded()


if __name__ == "__main__":
    main()
