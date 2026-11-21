/** Browser smoke test for the actual HGame runtime + same-origin local Rapier WASM. */
export default async function main(cdp, args, session) {
  const page = await session.ctx.newPage();
  const errors = [];
  const wasmResponses = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 300));
  });
  page.on('response', response => {
    if (response.url().includes('.wasm')) wasmResponses.push({
      status: response.status(), url: response.url(), type: response.headers()['content-type'],
    });
  });
  try {
    await page.goto('http://127.0.0.1:4175/local-games/Saltline/index.html?noaudio=1&q=low', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.bringToFront();
    const results = await page.evaluate(async () => {
      const { HGame, defineProject, Entity, Scene } = await import('/runtime/hgame/index.js');
      const platform = {
        input: { endFrame() {}, reset() {} },
        lifecycle: { on() { return () => {}; } },
        diagnostics: { recordFrame() {}, reportError() {} },
        ready() {}, dispose() {},
      };
      const renderer = { render() {}, resize() {}, dispose() {} };
      const reports = [];
      for (const dimension of [2, 3]) {
        const feature = `physics${dimension}d`;
        const physics = `rapier${dimension}d`;
        const app = HGame.createApplication({
          project: defineProject({ profile: `${dimension}d`, physics, tickHz: 60,
            features: ['scene', 'input', feature] }),
          renderer, platform,
        });
        const scene = app.scenes.add(new Scene('browser-' + dimension + 'd'));
        app.scenes.start(scene.name);
        await app.installFeatures();
        const entity = scene.add(new Entity({ x: 0, y: 2, z: 0, width: 1, height: 1, depth: 1 }));
        const body = scene.physics.add(entity, { shape: 'ball', radius: 0.25, gravityScale: 0 });
        body.setVelocity(dimension === 2 ? { x: 1, y: 0 } : { x: 1, y: 0, z: 0 });
        for (let tick = 0; tick < 60; tick++) app.step(1 / 60);
        const checkTicks = scene.physics.checksums.map(item => item.tick);
        const snapshot = scene.physics.takeSnapshot();
        const checksum = scene.physics.stateChecksum();
        scene.physics.step(1 / 60);
        scene.physics.restoreSnapshot(snapshot);
        reports.push({
          name: HGame.name, version: HGame.version, backend: scene.physics.backend,
          tickHz: scene.physics.tickHz, tick: scene.physics.tick,
          x: entity.x, checksum, restoredChecksum: scene.physics.stateChecksum(),
          checksums: checkTicks,
        });
        app.dispose();
      }
      return reports;
    });
    return { results, wasmResponses, errors };
  } finally {
    await page.close().catch(() => {});
  }
}
