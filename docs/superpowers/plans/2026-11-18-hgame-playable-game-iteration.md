# HGame Playable Game Iteration

**Goal** · Give AI agents a complete HTML game to build, play, and improve, then use the same seven-category scorecard to assess progress toward 90.

**Architecture** · Use the WebAsset-registered `arena-3d` reference game. Keep mission rules in the deterministic simulation and present their state through the existing Three.js scene and game HUD. Keep authored rules and content in the example.

## First playable stage

- [x] Prove the objective contract in Node. Players can charge either of two beacons first. Leaving resets an unfinished charge. Nearby enemies pause charging until the player creates space. The exit unlocks after both are charged. Death takes precedence, and victory freezes the run.
- [x] Show the beacons, their progress, and the exit in the world. Reuse the existing result screen for victory and defeat, persist completed runs, and expose objective state to the browser playtest.
- [x] Verify an actual browser playthrough from spawn to victory, restart, and persistence. Recheck the existing defeat lifecycle, the UI constraints, floor connectivity, and engine checks.

## Follow-on scorecard work

- Observe gameplay and iterate on navigation clarity, combat decisions, pacing, and replay value. Collect human playtest evidence before treating enjoyment or retention as verified.
- Use replacement character assets in the same game to exercise import, animation mapping, and state transitions. Improve shared tooling where the game reveals an integration problem.
- Gameplay trace verified. The diagnostics service retains bounded tick-addressed events. The arena and playtest runner confirm that the report identifies the beacon or player and the relevant enemy slot. Animation and asset attribution are part of the model replacement stage.
- Re-evaluate the original seven categories using the playable game and verified evidence. Score gameplay, content production, runtime, and agent workflows under the existing HTML-only review criteria.
