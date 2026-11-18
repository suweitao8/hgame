"""Build a second Beacon Run rig without authored animation clips."""

import importlib.util
from pathlib import Path

import bpy
from mathutils import Vector


source = importlib.util.spec_from_file_location("runner_tools", Path(__file__).with_name("build-runner.py"))
runner = importlib.util.module_from_spec(source)
source.loader.exec_module(runner)
output = runner.OUTPUT.with_name("scout.gltf")


def make_scout():
    rig = runner.create_rig()
    rig.name = "Scout"
    bpy.ops.object.mode_set(mode="EDIT")
    bones = rig.data.edit_bones
    rename = {
        "Root": "Pivot", "Body": "Chassis", "Head": "Sensor",
        "Arm.L": "VaneLeft", "Arm.R": "VaneRight",
        "Leg.L": "StrutLeft", "Leg.R": "StrutRight",
    }
    for name, target in rename.items():
        bone = bones[name]
        bone.head.x *= 1.18
        bone.tail.x *= 1.18
        bone.head.z *= 0.9
        bone.tail.z *= 0.9
        if name.startswith("Arm"):
            bone.tail.x += 0.13 if name.endswith(".L") else -0.13
        bone.name = target
    hinge = bones.new("Beacon")
    hinge.head = Vector((0, 0.24, 1.26))
    hinge.tail = Vector((0, 0.35, 1.59))
    hinge.parent = bones["Chassis"]
    bpy.ops.object.mode_set(mode="OBJECT")

    white = runner.surface("Ceramic", (0.78, 0.75, 0.62), 0.21)
    base = runner.surface("Slate", (0.055, 0.10, 0.14), 0.34)
    mint = runner.surface("Beacon mint", (0.03, 0.71, 0.43), glow=1.6)
    runner.part(rig, "Wide chassis", "Chassis", (0, 0, 0.95), (0.8, 0.49, 0.48), white, 0.12)
    runner.part(rig, "Sensor pod", "Sensor", (0, 0, 1.38), (0.47, 0.37, 0.45), base, 0.09)
    runner.part(rig, "Sensor glass", "Sensor", (0, -0.19, 1.4), (0.34, 0.05, 0.17), mint, 0.024)
    runner.part(rig, "Signal spine", "Beacon", (0, 0.27, 1.49), (0.15, 0.13, 0.65), mint, 0.034)
    for side, direction in [("Left", 1), ("Right", -1)]:
        runner.part(rig, side + " vane", "Vane" + side, (0.6 * direction, 0.04, 0.95), (0.22, 0.43, 0.56), white, 0.08)
        runner.part(rig, side + " strut", "Strut" + side, (0.2 * direction, 0, 0.4), (0.16, 0.24, 0.49), base)
        runner.part(rig, side + " boot", "Strut" + side, (0.2 * direction, -0.08, 0.10), (0.25, 0.41, 0.2), white, 0.052)
    runner.export_embedded(output)


if __name__ == "__main__":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_scout()
