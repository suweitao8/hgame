# HGame Playable Game Iteration

**Goal** · Give AI agents a complete HTML game to build, play, and improve, then use the same seven-category scorecard to assess progress toward 90.

**Architecture** · Use the WebAsset-registered `arena-3d` reference game. Keep mission rules in the deterministic simulation and present their state through the existing Three.js scene and game HUD. Keep authored rules and content in the example.

## First playable stage

- [x] Prove the objective contract in Node. Players can charge either of two beacons first. Leaving resets an unfinished charge. Nearby enemies pause charging until the player creates space. The exit unlocks after both are charged. Death takes precedence, and victory freezes the run.
- [x] Show the beacons, their progress, and the exit in the world. Reuse the existing result screen for victory and defeat, persist completed runs, and expose objective state to the browser playtest.
- [x] Verify an actual browser playthrough from spawn to victory, restart, and persistence. Recheck the existing defeat lifecycle, the UI constraints, floor connectivity, and engine checks.

## Follow-on scorecard work

- The arena now has distinct synthesized combat and objective audio. Start with a procedural runner immediately, then attach the authored rig at the live player position. Keep visual asset waits passive in frozen snapshots.
- Give each run a dodge decision. Add a pulse enemy that marks a fixed ground target before impact. Stepping out or jumping at the right moment avoids damage. A jump inside a beacon ring pauses charge and keeps progress. Leaving the ring still resets it. Exercise the rule, telegraph and normal browser controls.
- Give the run a finale. The open gate visibly channels extraction while the player holds the zone. Charge persists while the player briefly dodges or clears space. Gate interference guarantees recognizable pulses during the hold. Validate both routes and compare no-dodge and timed-dodge runs.
- Observe gameplay and iterate on navigation clarity, pacing, and replay value. Collect human playtest evidence before treating enjoyment or retention as verified.
- The arena now loads an authored replacement glTF with five named animation roles. Browser playtests exercised animation switches, the spin notify, and a missing binding with a playable fallback. Its local release contains the same glTF bytes and loader.
- Gameplay trace verified. The diagnostics service retains bounded tick-addressed events. The arena and playtest runner identify the affected beacon, player, or asset and the relevant opponent slot or animation name.
- Re-evaluate the original seven categories using the playable game and verified evidence. Score gameplay, content production, runtime, and agent workflows under the existing HTML-only review criteria.
