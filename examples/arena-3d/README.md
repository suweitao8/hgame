# Arena Brawler (HGame 3D reference)

Third-person arena brawler: spring-arm camera, jump/spin attack, chasing enemies, quality-tier enemy caps, procedural meshes only.
Gameplay is pure and headless-testable in `src/sim/` (seeded RNG, fixed 60 Hz step).

```powershell
npm run build:examples   # from repo root: regenerates git-ignored vendor/ and assets/vendor/three
node scripts/preview.mjs examples/arena-3d
node --test examples/arena-3d/tests/*.test.mjs
```

Controls: WASD/arrows move (camera-relative), Space jump, K/click spin, Q/E or mouse-drag orbit, U restart. QA: `?tier=low|medium|high&seed=N&god=1`.
