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

## Pixi 2D playable reference

- [x] Exercise optional extraction in the survivor simulation. Retrieve an ember from either relay, survive the opening horde, then hold the origin while enemies approach. Leaving the ring pauses extraction. Upgrade choices freeze both clocks. Lethal contact takes priority.
- [x] Add a Pixi entry using the generated project's renderer, scheduler, and input. Render the exit and progress in the world, show upgrades and the final score, and persist and restart a finished run.
- [x] Compile the entry for WebAsset. The Chromium playthrough completed a normal-input right-relay victory, 11 upgrade choices, restart, and score restoration. Across 1,200 headless runs, idle players never unlocked the exit and both relay routes completed on all 400 seeds. Three catalog images round-tripped through the asset store.

## Cross-rig animation proof

- [x] Use the same five clips on a second rig with different bone names, proportions, and rest rotations. Preserve its extra beacon bone and keep the mapping in the game manifest.
- [x] Exercise the shipped files with the vendored glTF loader and Three mixer. Confirm a target bone moves, the Spin notify fires, and a missing mapping retains a playable procedural runner.

## Second 2D playthrough

- [x] Unlock Storm after a first victory. It requires both relays, reduces the exit area, and applies a 17-second deadline to a seven-second hold. Retain the chosen mode and unlock on reload.
- [x] Verify both routes across 1,200 seeds. Staying on the one-relay route always timed out. Both routed strategies completed all 400 seeds per route with a mean of 14.15 seconds.
- [x] Replay both modes over WebAsset with normal input using `examples/survivor-2d/pixi/playtest.mjs`. Check the unlock, restart, saved score and selected mode after reload.

## Scorecard

| Criterion | Maximum | Prior workspace | Updated |
| --- | ---: | ---: | ---: |
| AI authoring and iteration | 20 | 19 | 19 |
| Playable game completeness | 22 | 18 | 20 |
| HTML runtime and delivery | 18 | 16 | 16 |
| 2D rendering and production | 10 | 8 | 9 |
| 3D rendering and animation | 12 | 9 | 10 |
| Asset handling | 8 | 7 | 8 |
| Automated playtest and regression | 10 | 9 | 9 |
| Total | 100 | 86 | 91 |

These are engineering scores for the AI-authored HTML workflow. The updated score credits the two reference games' complete browser sessions, a second 2D challenge, verified catalog restore and package inclusion, and motion transfer between the two compatible rigs. Game enjoyment and long-term replay value still need human playtest evidence. The 2D art can be restored from the project asset store. A source-only checkout can use the procedural atlas.
