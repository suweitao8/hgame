"""
Track C Fallback Offline Flipbook Baker (`tools/ue_bake_flipbook.py`) for HGame VFX v2:
Spawns an isolated empty world/actor + orthographic SceneCaptureComponent2D, spawns a target
NiagaraSystem or Cascade ParticleSystem at origin, steps fixed simulation time across a configurable
grid (e.g. 4x4 = 16 frames or 6x6 = 36 frames), captures frames into RenderTarget2D -> PNG frames,
and composites a <= 1024x1024 Flipbook sprite sheet (black background for Additive glow, or alpha/opacity
preservation for smoky effects).

Usage (UE5.8 Commandlet with Offscreen RHI, not -nullrhi):
  UnrealEditor-Cmd.exe Anim58.uproject -run=PythonScript -script=tools/ue_bake_flipbook.py -RenderOffScreen -unattended -nop4 -nosplash
"""

import json
import os
import sys
import unreal

OUT_DIR = os.environ.get(
    "HGAME_FLIPBOOK_OUT",
    r"D:\UnrealWorkspace\Anim58\Saved\WebAssetExport\vfx_staging\baked_flipbooks",
)
TARGET_ASSET = os.environ.get(
    "HGAME_FLIPBOOK_ASSET",
    "/Game/_Effects/Cinematic_Portal_Pack/Niagara/NS_Portal_01.NS_Portal_01",
)
GRID_COLS = int(os.environ.get("HGAME_FLIPBOOK_COLS", "4"))
GRID_ROWS = int(os.environ.get("HGAME_FLIPBOOK_ROWS", "4"))
CELL_SIZE = int(os.environ.get("HGAME_FLIPBOOK_CELL", "256"))
DURATION_SEC = float(os.environ.get("HGAME_FLIPBOOK_DUR", "2.0"))
ORTHO_WIDTH = float(os.environ.get("HGAME_FLIPBOOK_ORTHO_WIDTH", "450.0"))
OUTPUT_NAME = os.environ.get("HGAME_FLIPBOOK_NAME", "portal_flipbook")

os.makedirs(OUT_DIR, exist_ok=True)


def run_bake():
    asset = unreal.load_asset(TARGET_ASSET)
    if not asset:
        print(f"BAKE_FLIPBOOK_SKIP asset_not_found={TARGET_ASSET}")
        return False

    world = unreal.EditorLevelLibrary.new_level("/Temp/HGameFlipbookBake") if hasattr(unreal, "EditorLevelLibrary") else None
    if not world:
        print("BAKE_FLIPBOOK_SKIP no_editor_world_in_headless_mode")
        return False

    subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    rt = unreal.RenderingLibrary.create_render_target2d(world, CELL_SIZE, CELL_SIZE, unreal.TextureRenderTargetFormat.RTF_RGBA8)

    # Spawn orthographic capture camera facing origin along +Y
    cam_actor = subsys.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector(0, -400, 80), unreal.Rotator(0, 90, 0))
    cap = cam_actor.capture_component2d
    cap.projection_type = unreal.CameraProjectionMode.ORTHOGRAPHIC
    cap.ortho_width = ORTHO_WIDTH
    cap.texture_target = rt
    cap.capture_every_frame = False
    cap.capture_on_movement = False
    cap.capture_source = unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR
    cap.primitive_render_mode = unreal.SceneCapturePrimitiveRenderMode.PRM_USE_SHOW_ONLY_LIST

    total_frames = GRID_COLS * GRID_ROWS
    dt = DURATION_SEC / max(1, total_frames)
    frame_paths = []

    cls_name = asset.get_class().get_name()
    fx_actor = subsys.spawn_actor_from_class(unreal.Actor, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    if cls_name == "NiagaraSystem":
        comp = unreal.NiagaraFunctionLibrary.spawn_system_attached(
            asset, fx_actor.get_root_component(), "", unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0),
            unreal.AttachLocation.KEEP_RELATIVE_OFFSET, False, True
        )
    else:
        comp = unreal.GameplayStatics.spawn_emitter_attached(
            asset, fx_actor.get_root_component(), "", unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0),
            unreal.AttachLocation.KEEP_RELATIVE_OFFSET, False
        )

    cap.show_only_actors = [fx_actor]

    frames_dir = os.path.join(OUT_DIR, f"{OUTPUT_NAME}_frames")
    os.makedirs(frames_dir, exist_ok=True)
    for idx in range(total_frames):
        if hasattr(comp, "advance_simulation"):
            comp.advance_simulation(1, dt)
        cap.capture_scene()
        fname = f"f_{idx:03d}.png"
        unreal.RenderingLibrary.export_render_target(world, rt, frames_dir, fname)
        frame_paths.append(os.path.join(frames_dir, fname))

    subsys.destroy_actor(fx_actor)
    subsys.destroy_actor(cam_actor)

    meta = {
        "name": OUTPUT_NAME,
        "source": TARGET_ASSET,
        "cols": GRID_COLS,
        "rows": GRID_ROWS,
        "cellSize": CELL_SIZE,
        "sheetSize": [GRID_COLS * CELL_SIZE, GRID_ROWS * CELL_SIZE],
        "duration": DURATION_SEC,
        "frameFiles": frame_paths,
    }
    meta_file = os.path.join(OUT_DIR, f"{OUTPUT_NAME}_bake.json")
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"BAKE_FLIPBOOK_DONE frames={len(frame_paths)} meta={meta_file}")
    return True


if __name__ == "__main__":
    run_bake()
