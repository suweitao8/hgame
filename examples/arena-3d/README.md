# Beacon Run / 信标撤离

Charge both beacons and leave through the extraction gate. Either route works. Enemies pause the charge when they enter its perimeter, so time the spin to create space. Finishing saves the win count and fastest extraction time.

This HGame 3D reference uses a spring-arm camera, adaptive presentation and deterministic rules in `src/sim/` at 60 Hz.

```powershell
npm run build:examples   # from repo root: regenerates git-ignored vendor/ and assets/vendor/three
node --test examples/arena-3d/tests/*.test.mjs
```

Controls: WASD/arrows move (camera-relative), Space jump, K/click spin, Q/E or mouse-drag orbit, U restart. QA: `?tier=low|medium|high&seed=N&god=1`.

Play in [WebAsset](http://127.0.0.1:4175/local-games/arena-3d/index.html).
