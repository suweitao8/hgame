# Beacon Run / 信标撤离

Charge both beacons in either order, then hold the gate circle until extraction completes. Enemies inside a beacon's perimeter interrupt charging, so time the spin to create space. Tall violet sentries and the gate mark the floor before a pulse. Step clear or jump as it strikes. Jumping inside a beacon ring keeps charge already earned, and gate progress stays even if you briefly leave its circle. Finishing saves the win count and fastest extraction time for this course.

This HGame 3D reference uses a spring-arm camera, adaptive presentation and deterministic rules in `src/sim/` at 60 Hz.

```powershell
npm run build:examples   # from repo root: regenerates git-ignored vendor/ and assets/vendor/three
node --test examples/arena-3d/tests/*.test.mjs
node examples/arena-3d/tools/simulate-routes.mjs
```

Controls: WASD/arrows move (camera-relative), Space jump, K/click spin, Q/E or mouse-drag orbit, U restart. QA: `?tier=low|medium|high&seed=N&god=1`.

The first trusted input enables Web Audio. The shared HGame mixer synthesizes different cues for a missed spin, a hit, damage, a charged beacon, the gate opening and extraction. These cues require no extra downloads.

The rig and five gameplay clips are authored in `tools/build-runner.py`. Regenerate the self-contained glTF with Blender 5.

```powershell
blender --background --factory-startup --python-exit-code 1 --python examples/arena-3d/tools/build-runner.py
```

Use `src/assets/runner.json` to point to a replacement glTF and map its clip names to the game's animation roles. The procedural runner responds to controls while the model loads. The authored rig takes over in the player's current pose state and position. A missing or ambiguous clip leaves the procedural runner playable and records the affected asset and role in the debug trace. For a deterministic snapshot of the rig, pass `--ready '#game[data-engine-ready=true]' --visual-ready '#game:not([data-visual-loading])'`.

Add `?runner=scout` to play a second, eight-bone model using the five original runner clips. `scout.json` describes the bone mapping and root translation scale. The targets use equivalent articulation with different rest rotations, names, and proportions. Export compatible clips with linear or stepped interpolation. Regenerate the animation-free target with Blender using `--python examples/arena-3d/tools/build-scout.py`.

Play in [WebAsset](http://127.0.0.1:4175/local-games/arena-3d/index.html).
