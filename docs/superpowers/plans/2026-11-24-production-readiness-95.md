# HGame 95-point production-readiness iteration

The 90.04 baseline uses 40% runtime, 35% production kit, and 25% verification and delivery. Keep those weights and the v5.2 engine criteria. The minimum possible runtime score at 95 is 87.5 when production and delivery both score 100. At 98 for production and delivery, runtime must reach 90.5. With the baseline scores of 92 and 96, the required runtime score is 97.0.

The scorecard update in `9652b29` moved runtime from 84.6 to 85.8 by recording trimmed-plan exemptions and deferrals. Retaining the two other scores yields **90.52**. Attribute this change to the updated scope. Record each new capability and its separate evidence before changing its rating.

## Default 3D frame graph

- [x] Prove the default pipeline recompiles identical topology. Add an identity regression test for unchanged frames, test current callbacks replacing prior callbacks, and verify topology invalidation on dimensions or effect changes.
- [x] Cache only compiled graph structure for the immediately preceding pass layout. Pass current-frame execution functions at execution time. Generate the diagnostic plan only when requested, using the captured frame options and dimensions.
- [x] Run the render graph and rendering tests, then compare the same 2,000-instance, 64-light hardware workload before and after. Check draw workload, pixels, frame tails and graph reuse.
- [x] Re-run standalone Web and Toy acceptance, including the sustained 3D package on hardware.

## Subsequent work

- Measure retained 3D attachments and pipeline synchronization before choosing further render graph, resource management or animation changes.
- Extend WebKit evidence for the mobile controls. Keep physical Android, iOS, Xbox and Toy host evidence explicitly tracked.
- Reassess scorecard items only when the corresponding default-path changes and reproducible evidence meet the current criteria.

## Bloom target lifetimes

- [x] Describe each downsample and upsample as an actual graph pass. Use the pool for the entire chain, including single-level Bloom and the final color sampled by tone mapping.
- [x] Count all resident pooled targets, including idle targets awaiting eviction. Verify that disabling Bloom releases targets at the existing idle limit, and that re-enabling, resizing, context recovery and teardown work.
- [x] Verify target sizes, formats and source/destination separation. Compare rendered pixels and the GPU resource ledger in a real browser.
- [x] Run packaged release checks.

The A2 rating moves from 9.0 to 9.5 for full Bloom target lifetime management on the default 3D path. The scene color and depth target remains persistent. Runtime is 86.1 and the weighted overall score is **90.64** with production kit at 92 and verification and delivery at 96.

Run `node tests/browser-bloom-pool.mjs --gpu hardware --chrome <path>` for the GPU comparison. At 1920 × 1080 on RTX 4070, the prior pipeline retained 9 Three.js GPU textures and 28,284,960 estimated scalable target bytes after five disabled frames. The new pipeline retained 3 textures and 24,883,200 bytes. Both pipelines reported 10 textures and 30,358,560 bytes with Bloom enabled. The first disabled frame of the new path still reports all idle textures. Turning Bloom back on restores the exact original pixel buffer. On/off pixel fingerprints match the baseline. The same lifecycle passes under SwiftShader.

The Bloom-enabled high-tier package fixture executes the seven Bloom passes in its unminified, Web and Toy archives. All three produced the same screenshot hash. The staged runtime, package tests, generated API index and declarations passed `npm run check` with 591 tests.

The five standard release fixtures also pass. The low-tier 3D Web release ran for about 70.7 seconds on each viewport at 7.0 ms p95 on RTX 4070. Its estimated peak was 13,855,680 bytes. The low-tier fixture verifies the existing published frame and memory budgets. The high-tier archive fixture verifies the changed Bloom path.

## Main scene target lifetimes

- [x] Use a single pool lease for the main scene color and depth attachments while the world and downstream passes read or write them, including injected post-world hooks. Preserve the current attachment accessor and shadow ordering.
- [x] Reuse scene targets across alternating internal render scales, then evict unused sizes. Respect sampling mode, MSAA, native depth and context loss. Keep the existing immediate size updates for callers.
- [x] Verify reuse, eviction, failed callbacks, and depth binding in Node. Compare deterministic real WebGL2 frame captures and attachment counts.
- [x] Validate the package and release routes.

On RTX 4070 at 1920 × 1080, alternating the internal temporal render scale from 0.5 to 1.0 and back over seven draws reduces distinct scene attachment sets from seven to two. The reduced-resolution result has the same pixel fingerprint as the old renderer and is identical on repeated draws after a switch. The unused full-resolution set remains available during the four-frame grace period and is evicted on the fifth frame. The ledger includes both sizes while they remain resident. The pool handles each viewport independently.

Hardware WebGL2 and SwiftShader both sample the resolved scene depth from a post-world hook with 4× MSAA and all other depth readers disabled. The executed graph exposes the main target lifetime from the world pass through tone mapping. Node regressions also cover repeated failures before the world pass, scale changes in a hook, and changes to configurations that never draw.

The final runtime passed `npm run check` with 621 tests. The unminified, Web and Toy archive pixel comparisons passed, along with two forced WebGL loss and recovery cycles in each lifecycle sample. All five normal release fixtures passed. The packaged 3D arena on RTX 4070 ran for about 70.7 seconds in each viewport. Desktop p95/p99 were 13.9/20.9 ms and portrait p95/p99 were 7.1/13.9 ms. Both peaked at 13,855,680 estimated GPU bytes. The release runs establish budget compliance and do not establish a whole-frame speedup.

At the end of the scene attachment change, A2 stayed at 9.5 and the weighted overall score stayed at **90.64**. A browser probe found that a scheduled projected decal left the final pixel unchanged because tone mapping subsequently overwrote the backbuffer.

## Projected decals in the HDR pipeline

- [x] Reproduce the missing decal with an output pixel assertion. Verify depth isolation, 4× MSAA with half-resolution temporal AA, and the inactive path.
- [x] Copy world color into a graph-owned HDR target only when projected decals are active. Draw the decals there while sampling the original world depth, then feed the result to GI and composite passes.
- [x] Verify the final staged code, including browser and archive output, and run the repository gates.

On the RTX 4070, the final center pixel changes from `[50, 50, 50, 255]` to `[246, 0, 0, 255]`, including with 4× MSAA and temporal upsampling from 160 × 120 to 320 × 240. Pixels outside the decal remain unchanged. The test verifies the original camera projection is restored, the first-person layer remains visible and clearing the decal omits its draw. A separate Chromium test with `EXT_clip_control` reports the same final decal color with regular and reversed depth.

SwiftShader passes the same combined MSAA and temporal test. The active high-tier decal and Bloom fixture produces the same screenshot hash (`b3c6aad7b43897df`) in the unminified, Web and Toy archives. The exact staged code passes `npm run check` with 621 tests and current API and declaration outputs.

A2 moves from 9.5 to 10. Runtime reaches 86.4 and the weighted overall score reaches **90.76**, retaining 92 for production kit and 96 for verification and delivery. The active pass uses one additional color-only target at world resolution, and the forward path continues to use surface decals.

## Streamed audio seeking in WebAsset

- [x] Verify the library, imported audio and game preview respond to single byte ranges. Cover normal GET, HEAD, open-ended and suffix ranges, unsatisfiable ranges and unsupported range forms.
- [x] Stream the selected file bytes from an open file handle, preserving the existing route checks and whole-file responses.
- [x] Verify the BGM playhead moves in a real browser without creating an AudioBuffer, then record which parts of the long audio checklist have evidence.

On a Chromium connection limited to 48 KiB/s, the buffered audio reached 21.3 s before the seek. Chromium requested bytes 622,592–897,593, completed the native seek to 52.3 s and continued playing there. The streaming player held zero decoded buffers throughout the 60-second soak. In that run, starting playback increased renderer private memory by 4.1 MiB with streaming and 32.6 MiB with whole-track decoding. The exact candidate passed the 621-test repository check and all 49 WebAsset tests.

At the end of the WebAsset seek change, S3 was 8.5 and the weighted score was **90.76**. The long-audio criterion also required evidence for the default long-voice path.

## Streamed dialogue in the audio cue player

- [x] Register URL variants through the existing cue API. Use their authored duration for inspection and ducking while keeping buffer-based cues on the current path.
- [x] Send streamed dialogue through the same voice mixer, cooldown, polyphony, and spatial graph. Pause playback while hidden and release the media and graph on stop, failure, and disposal.
- [x] Verify cue playback through a WebAsset game preview in Chromium. Check the real media source, gain, lifecycle, and release without allocating a decoded audio buffer.
- [x] Run the repository and WebAsset gates against the staged code.

At 64 KiB/s, Chromium started a 24-second cue through WebAsset with about 7.7 seconds buffered. The test recorded one MediaElementAudioSourceNode, no AudioBufferSourceNodes and no decodeAudioData calls. The measured mix signal reached RMS 0.108 and fell to zero with the voice bus muted. The playhead stopped while hidden, advanced after showing, and released the media URL on stop. The fake-media test covers failed playback and a pending request overtaken at a one-voice limit.

The exact candidate passed 622 repository tests, the physics and generated-metadata gates, and 49 WebAsset tests. The native BGM seek regression passed again. The Web and Toy archive screenshots matched the unminified archive pixel for pixel.

S3 moves from 8.5 to 9.5. Runtime now scores 86.8 and the weighted score reaches **90.92**, retaining 92 for production kit and 96 for verification and delivery. The voice fixture uses a synthetic signal on desktop Chromium. Physical mobile and Toy host audio remain to be tested.

## Packaged mobile multi-touch release gate

- [x] Distinguish sequential taps and script-generated events from concurrent, moving contacts inside the measured playtest.
- [x] Let a release manifest require two concurrent contacts and a trusted move while both are held inside a passing checkpoint. Reject missing evidence in both release and freshness checks.
- [x] Verify the Pixi Toy package with joystick movement and attack together, and verify that a package exercised with sequential taps fails this gate.
- [x] Run the complete repository gate and release fixture suite with the staged touch changes.

The Pixi Toy package reported three touch presses, a peak of two simultaneous contacts, and one concurrent move inside the joystick-and-attack checkpoint. The sequential-tap fixture reached two presses and a peak of one, with zero concurrent moves, and failed release while remaining playable. Chromium telemetry regressions also verify cancellation and trusted release events consumed by a game capture handler.

The staged candidate passed 642 repository tests and all eight browser telemetry tests. All five release fixtures passed their budgets, including the 3D Web release on RTX 4070 at 7.0 ms p95 in both viewports.

Verification and delivery moves from 96 to 97. Runtime remains 86.8 and production kit remains 92. The weighted score reaches **91.17**. Evidence here uses Chromium's touch context; physical mobile, Xbox and Toy host coverage remains open.

## Acceptance shipped with action starters

- [x] Ship one editable acceptance scenario with the default Pixi arena and the three action archetypes.
- [x] Verify movement, a fresh manually triggered attack, further movement, and pause/resume. Use each shipped state hook to observe a bolt, pulse or slash dispatch.
- [x] Exercise release using the generated scenario in the Pixi Toy archive and verify its multi-touch evidence. Keep generic acceptance for bare, UI and unrelated profiles.
- [x] Include the archetypes in the SDK distribution and generate default Pixi and Action 2D projects from the produced SDK.

The four generated projects pass full WebAsset acceptance. Each also passes the portrait touch scenario through the registered WebAsset entry with two simultaneous contacts and one measured overlapping move. A separate Action 2D probe kept movement while suppressing manual attacks during movement. It moved 622 pixels and reported zero manual attacks. The shared scenario rejected that build at the two-finger combat checkpoint.

The staged repository gate passes 649 tests. All five release fixtures pass. The packaged Pixi Toy fixture uses the generated scenario directly and passes the release and report-freshness checks. The 3D Web release on RTX 4070 reports 7.0 ms p95 in both viewports. Release budgets remain project-authored.

Production kit moves from 92 to 94. Runtime remains 86.8 and verification and delivery remains 97. The weighted score reaches **91.87**.

## Current evidence

- In a Node probe with mock drawing, each version executed 3,000 warmup frames and nine samples of 3,000 identical frames. The baseline compiled all 27,000 measured frames. The cached implementation reused the graph in all 27,000. Median batch-average CPU time was 103.27 µs per frame before and 17.23 µs after. Each version executed all 30,000 frame callbacks. These timings measure JavaScript pipeline overhead with GPU work excluded.
- Matching hardware stress runs used the default post pipeline at 960 × 540, RTX 4070, 2,000 instances, and 64 authored lights. The 12,000-frame runs reported 58 draw calls and 27,691 triangles. Both passed the 16.67 ms p95 budget. The baseline reported 5.5 ms p95 and 7.7 ms p99. The changed pipeline reported 12.1 ms p95 and 17.8 ms p99. RGB channels in the captured frames differed by 0.52 levels on average, on a scale from 0 to 255.
- Four additional 3,000-frame runs in baseline, changed, changed, baseline order reported p95 of 5.91, 8.8, 6.0, and 6.6 ms. Frame timing varied between runs even with the same implementation. The available data establishes lower measured CPU planner overhead and continued budget compliance. It leaves the effect on sustained end-to-end frame pacing inconclusive, so the A2 rating remains unchanged.
- The exact staged build passed `npm run check` with 582 tests and matching API index and type declarations. The runtime-only regression tests also cover callback replacement, mutable callback metadata isolation, and malformed pass rejection after a cache hit.
- `node tests/browser-release-acceptance.mjs` with hardware Chrome configured passed all five releases. The 3D Web build ran for about 70.8 seconds per viewport on RTX 4070. Desktop p95 was 7.0 ms and portrait p95 was 7.1 ms. Both p99 readings were 13.9 ms. Both viewports reported a peak GPU resource estimate of 13,855,680 bytes across 72 samples.
- WebKit 18.2 on Windows loaded the Wi-Fi LAN entry in a 390 × 844 viewport at DPR 3. Eleven trusted taps exercised attack, both dash buttons, all skills, pause, cancel and confirm. The joystick was visible. This run covers WebKit taps, with multi-touch and physical iOS Safari still pending.
