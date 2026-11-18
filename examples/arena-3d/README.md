# Beacon Run / 信标撤离

Charge both beacons and leave through the extraction gate. Either route works. Enemies pause the charge when they enter its perimeter, so time the spin to create space. Finishing saves the win count and fastest extraction time.

This HGame 3D reference uses a spring-arm camera, adaptive presentation and deterministic rules in `src/sim/` at 60 Hz.

```powershell
npm run build:examples   # from repo root: regenerates git-ignored vendor/ and assets/vendor/three
node --test examples/arena-3d/tests/*.test.mjs
```

Controls: WASD/arrows move (camera-relative), Space jump, K/click spin, Q/E or mouse-drag orbit, U restart. QA: `?tier=low|medium|high&seed=N&god=1`.

The first trusted input enables Web Audio. The shared HGame mixer synthesizes different cues for a missed spin, a hit, damage, a charged beacon, the gate opening and extraction. These cues require no extra downloads.

The rig and five gameplay clips are authored in `tools/build-runner.py`. Regenerate the self-contained glTF with Blender 5.

```powershell
blender --background --factory-startup --python-exit-code 1 --python examples/arena-3d/tools/build-runner.py
```

Use `src/assets/runner.json` to point to a replacement glTF and map its clip names to the game's animation roles. The procedural runner responds to controls while the model loads. The authored rig takes over in the player's current pose state and position. A missing or ambiguous clip leaves the procedural runner playable and records the affected asset and role in the debug trace. For a deterministic snapshot of the rig, pass `--ready '#game[data-engine-ready=true]' --visual-ready '#game:not([data-visual-loading])'`.

Play in [WebAsset](http://127.0.0.1:4175/local-games/arena-3d/index.html).
