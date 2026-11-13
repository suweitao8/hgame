# Generated HGame Project Rules

1. `engine.config.json` is the authoritative runtime recipe. Load only the selected profile and declared optional features.
2. The self-contained runtime copy is in `vendor/hgame/`. Do not edit that copy as a substitute for changing the HGame source repository and regenerating/updating the project deliberately.
3. Keep game rules, AI, authoritative state, content, renderer code, and save schemas inside this game project.
4. The Application owns the only RAF and fixed-step scheduler. Do not create a second RAF or step physics from a renderer callback.
5. When physics is enabled, use deterministic Rapier 0.21.0 for the selected dimension. Offline and online modes do not select different physics backends.
6. UI projects are command-driven. Do not add an idle 60 Hz loop to cards, dialogue, or turn-based interfaces.
7. Respect this project's visual and interaction requirements. Do not add unrequested buttons, menus, overlays, or permanent instructional copy.
8. Keep this game in its own Git repository. Do not initialize Git in a parent workspace or modify sibling game projects.
9. A 3D display model or material change must not silently change collision, navigation, AI, or authoritative simulation data.
10. Record the exact tests and browser/device coverage performed; do not claim unsupported platform or lockstep guarantees.
