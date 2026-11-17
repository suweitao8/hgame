# HGame commercial readiness roadmap

Goal: make HGame a coherent AI-operated engine for Bilibili Toy games, with each major area worthy of a 9/10 assessment. A score is a judgment, not a substitute for evidence. Work directly on main; retain existing games and honor the user's preference not to add testing work.

## Current gaps and sequence

1. **2D and AI entry points:** the normal 2D generator and API recipe still select the custom WebGL renderer, while PixiJS is a separate starter. Make PixiJS the default for new 2D projects, including clean scaffolds, preserve explicit legacy renderers, and align documentation and recipes. Do not migrate existing projects.
2. **Renderer integration:** the Pixi starter is currently game-profile code rather than a documented, reusable engine-level rendering contract; assess lifetime, camera, batching, effects, asset ownership and scheduler integration and close gaps without duplicating HGame services.
3. **Toy delivery:** ensure generated games, incremental builds, asset paths, packaging and permission declarations remain coherent and self-contained. Fix specific issues in those paths.
4. **Performance and mobile:** identify allocations and per-frame work in real gameplay paths; improve scalability, mobile input, background/resume and adaptive settings where needed. Avoid claiming universal frame rates or maximum counts.
5. **3D and asset pipelines:** assess scene/model ownership, loading, shadows, materials, world streaming and device budgets against actual game workflows. Prioritize compatibility and resource lifecycle over adding features.
6. **AI usability and game completion:** align machine-readable API, recipes and project instructions; improve saved-game, audio, gameplay and lifecycle integration where actual use reveals friction.

Continue through these areas rather than treating a single milestone as completion. Preserve unrelated working-tree changes, commit scoped changes, and push after each commit. User instructions override older instructions that demand extra tests.

## Initial implementation slice

- Add a PixiJS blank entry built with the existing profile and lifecycle, keeping the arena demo available separately.
- Route default and `2d` preset generation through PixiJS, including `--bare`; leave `horde` and explicit renderer selection on their existing implementation.
- Ensure generated release metadata includes runtime dependencies even without a preset.
- Update the API recipe and developer documentation to describe the actual default and compatibility routes.
