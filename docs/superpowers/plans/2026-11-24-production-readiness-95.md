# HGame 95-point production-readiness iteration

The 90.04 baseline uses 40% runtime, 35% production kit, and 25% verification and delivery. Keep those weights and the v5.2 engine criteria. The minimum possible runtime score at 95 is 87.5 when production and delivery both score 100. At 98 for production and delivery, runtime must reach 90.5. With the present 92 and 96 values, the required runtime score is 97.0.

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

## Current evidence

- In a Node probe with mock drawing, each version executed 3,000 warmup frames and nine samples of 3,000 identical frames. The baseline compiled all 27,000 measured frames. The cached implementation reused the graph in all 27,000. Median batch-average CPU time was 103.27 µs per frame before and 17.23 µs after. Each version executed all 30,000 frame callbacks. These timings measure JavaScript pipeline overhead with GPU work excluded.
- Matching hardware stress runs used the default post pipeline at 960 × 540, RTX 4070, 2,000 instances, and 64 authored lights. The 12,000-frame runs reported 58 draw calls and 27,691 triangles. Both passed the 16.67 ms p95 budget. The baseline reported 5.5 ms p95 and 7.7 ms p99. The changed pipeline reported 12.1 ms p95 and 17.8 ms p99. RGB channels in the captured frames differed by 0.52 levels on average, on a scale from 0 to 255.
- Four additional 3,000-frame runs in baseline, changed, changed, baseline order reported p95 of 5.91, 8.8, 6.0, and 6.6 ms. Frame timing varied between runs even with the same implementation. The available data establishes lower measured CPU planner overhead and continued budget compliance. It leaves the effect on sustained end-to-end frame pacing inconclusive, so the A2 rating remains unchanged.
- The exact staged build passed `npm run check` with 582 tests and matching API index and type declarations. The runtime-only regression tests also cover callback replacement, mutable callback metadata isolation, and malformed pass rejection after a cache hit.
- `node tests/browser-release-acceptance.mjs` with hardware Chrome configured passed all five releases. The 3D Web build ran for about 70.8 seconds per viewport on RTX 4070. Desktop p95 was 7.0 ms and portrait p95 was 7.1 ms. Both p99 readings were 13.9 ms. Both viewports reported a peak GPU resource estimate of 13,855,680 bytes across 72 samples.
- WebKit 18.2 on Windows loaded the Wi-Fi LAN entry in a 390 × 844 viewport at DPR 3. Eleven trusted taps exercised attack, both dash buttons, all skills, pause, cancel and confirm. The joystick was visible. This run covers WebKit taps, with multi-touch and physical iOS Safari still pending.
