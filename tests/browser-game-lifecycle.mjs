#!/usr/bin/env node
// Temporary loopback fixtures are used only by this automated acceptance tool.
// --webasset instead verifies the already registered isolated live runtimes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, firefox, webkit } from 'playwright-core';
import { buildExample } from '../scripts/build-examples.mjs';
import { numberOption } from '../scripts/lib/cli-numbers.mjs';
import { createFrameTelemetry, summarizeFrameTelemetry } from '../scripts/lib/performance-stats.mjs';
import { readBrowserEnvironment } from '../scripts/lib/browser-benchmark.mjs';

const argv = process.argv.slice(2);
const live = argv.includes('--webasset');
const mobile = argv.includes('--mobile');
const contextRecovery = argv.includes('--context-recovery');
function option(name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}
const browserName = option('--browser') ?? 'chromium';
const browserType = { chromium, firefox, webkit }[browserName];
const soakOption = option('--soak-seconds');
const soakSeconds = soakOption === undefined ? null : numberOption(soakOption, '--soak-seconds', { min: 30, integer: true });
const gpu = option('--gpu') ?? (soakSeconds ? 'hardware' : 'software');
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName), 'Use --browser chromium, firefox or webkit');
assert.ok(!mobile || browserName === 'chromium', '--mobile uses Chromium touch dispatch');
assert.ok(gpu === 'hardware' || gpu === 'software', 'Use --gpu hardware or software');
assert.ok(!soakSeconds || (browserName === 'chromium' && !contextRecovery), 'Soak testing uses Chromium without forced context losses');
const executablePath = option('--executable') ?? option('--chrome');
const children = [];
let browser;
async function fixture(id) {
  if (live) return `http://127.0.0.1:4175/local-games/${id}/index.html`;
  const dir = await buildExample(id);
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['scripts/preview.mjs', dir, '--port', String(port)],
    { windowsHide: true, stdio: 'ignore' });
  children.push(child);
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`${id} fixture exited`);
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return `http://127.0.0.1:${port}/`; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`${id} fixture timed out`);
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, (b.z ?? b.y) - (a.z ?? a.y));
}

async function exerciseRunnerLoading(page, url) {
  const loaderPattern = '**/jsm/loaders/GLTFLoader.js';
  const modelPattern = '**/src/assets/runner.gltf';
  const releaseLoader = Promise.withResolvers();
  const releaseModel = Promise.withResolvers();
  await page.route(loaderPattern, async route => {
    await releaseLoader.promise;
    await route.continue();
  });
  await page.route(modelPattern, async route => {
    await releaseModel.promise;
    await route.continue();
  });
  try {
    await Promise.all([page.waitForRequest(loaderPattern), page.goto(url, { waitUntil: 'domcontentloaded' })]);
    await page.locator('#game[data-engine-ready=true]').waitFor({ timeout: 10000 });
    const read = () => page.evaluate(() => window.__hgameState());
    const initial = await read();
    assert.equal(initial.animation, null);
    await page.keyboard.down('d');
    try {
      await page.waitForFunction(x => window.__hgameState().player.x < x - 0.5, initial.player.x, { timeout: 4000 });
      const modelRequested = page.waitForRequest(modelPattern, { timeout: 5000 });
      releaseLoader.resolve();
      await modelRequested;
      const loading = await read();
      assert.equal(loading.animation, null);
      await page.waitForFunction(x => window.__hgameState().player.x < x - 0.5, loading.player.x, { timeout: 4000 });
      releaseModel.resolve();
      await page.waitForFunction(() => window.__hgameState().animation !== null, null, { timeout: 5000 });
    } finally {
      await page.keyboard.up('d');
    }
  } finally {
    releaseLoader.resolve();
    releaseModel.resolve();
    await page.unroute(loaderPattern);
    await page.unroute(modelPattern);
  }
}

async function exerciseContextRecovery(page, id) {
  const textured = id === 'survivor-2d';
  const results = await page.evaluate(async ({ textured, runtime }) => {
    const canvas = document.querySelector('#game');
    const { app } = window.__arena ?? window.__survivor;
    const gl = canvas.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('WEBGL_lose_context is required for this test');

    const markers = [];
    const markerColors = [0xff00ff, 0x00ff00, 0x00ffff];
    if (textured) {
      const [{ Entity }, { Sprite2D }] = await Promise.all([
        import(`${runtime}/index.js`), import(`${runtime}/integrations/webgl2d.js`),
      ]);
      // Preserve the exact same image object across both context losses.
      const image = document.createElement('canvas');
      image.width = image.height = 32;
      const ctx = image.getContext('2d');
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, 32, 32);
      const { x, y } = app.renderer.camera;
      const addMarker = (offset, options) => {
        const entity = app.scenes.current.add(new Entity({ x: x + offset, y }));
        entity.addComponent(new Sprite2D({ width: 32, height: 32, layer: 1000, ...options }));
        markers.push(entity);
      };
      addMarker(0, { image });
      addMarker(-80, { customDraw(ctx) {
        ctx.fillStyle = '#00ff00';
        ctx.rect(-16, -16, 32, 32);
        ctx.fill();
        // The next callback still gets a fresh drawing state.
        ctx.save();
        ctx.translate(150, 150);
      } });
      addMarker(80, { customDraw(ctx) {
        ctx.fillStyle = '#00ffff';
        ctx.rect(-8, -16, 16, 32);
        ctx.fill();
      } });
    }

    function contextEvent(type, action) {
      return new Promise((resolve, reject) => {
        const listener = () => {
          clearTimeout(deadline);
          resolve();
        };
        const deadline = setTimeout(() => {
          canvas.removeEventListener(type, listener);
          reject(new Error(`Timed out waiting for ${type}`));
        }, 8000);
        canvas.addEventListener(type, listener, { once: true });
        action();
      });
    }

    function sampleFrame() {
      return new Promise((resolve, reject) => {
        const deadline = setTimeout(() => {
          cancelAnimationFrame(frame);
          reject(new Error('Timed out waiting for a rendered WebGL frame'));
        }, 8000);
        const frame = requestAnimationFrame(() => {
          clearTimeout(deadline);
          // The app's scheduled render runs before this callback in the same frame.
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const colors = new Set();
          const markerPixels = [0, 0, 0];
          for (let i = 0; i < pixels.length; i += 16) {
            const color = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
            colors.add(color);
            const marker = markerColors.indexOf(color);
            if (marker >= 0) markerPixels[marker]++;
          }
          resolve({ colors: colors.size, markerPixels, glError: gl.getError(), tick: app.stats.ticks });
        });
      });
    }

    const before = await sampleFrame();
    const rounds = [];
    for (let i = 0; i < 2; i++) {
      await contextEvent('webglcontextlost', () => extension.loseContext());
      const lost = gl.isContextLost() && app.renderer.contextLost === true;
      const lostTick = app.stats.ticks;
      // Real frames can keep advancing game logic while GPU draws are suspended.
      await new Promise(resolve => setTimeout(resolve, 150));
      const recoveryStart = performance.now();
      await contextEvent('webglcontextrestored', () => extension.restoreContext());
      const restored = !gl.isContextLost() && app.renderer.contextLost === false;
      const after = await sampleFrame();
      rounds.push({ lost, restored, lostTick, after, recoveryMs: +(performance.now() - recoveryStart).toFixed(2) });
    }
    for (const marker of markers) marker.destroy();
    return { before, rounds };
  }, { textured, runtime: live ? './assets/vendor/hgame' : './vendor/hgame' });
  const hasMarkers = ({ markerPixels: [image, full, half] }) => image > 100 && full > 100 && half > 80 && half < full * 0.75;
  assert.ok(results.before.colors > 1, `${id} initial WebGL frame contains scene pixels`);
  if (textured) assert.ok(hasMarkers(results.before), `${id} initial texture markers: ${results.before.markerPixels}`);
  assert.equal(results.before.glError, 0, `${id} initial GL error`);
  for (const [index, result] of results.rounds.entries()) {
    const label = `${id} restore ${index + 1}: ${JSON.stringify(result)}`;
    assert.ok(result.lost && result.restored, label);
    assert.ok(result.after.tick > result.lostTick, label);
    assert.ok(result.after.colors > 1, label);
    if (textured) assert.ok(hasMarkers(result.after), `${label} contains all texture markers`);
    assert.equal(result.after.glError, 0, label);
  }
  return results;
}

async function exerciseModelReplacement(page) {
  const result = await page.evaluate(async runtime => {
    const { createModel3DProvider } = await import(`${runtime}/integrations/model3d.js`);
    const { app, renderer } = window.__arena;
    const { THREE } = renderer;
    const provider = createModel3DProvider({ THREE });
    const scene = app.scenes.current;
    const world = renderer.getWorld(scene);
    const geometryCount = () => renderer.renderer.info.memory.geometries;
    renderer.render(scene, app);
    const before = geometryCount();
    const events = [0, 0];
    const instances = [];
    for (let i = 0; i < 2; i++) {
      const geometry = new THREE.BoxGeometry(0.7, 0.7, 0.7);
      geometry.addEventListener('dispose', () => { events[i]++; });
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: i ? 0x00ffff : 0xff00ff }));
      mesh.frustumCulled = false;
      mesh.position.set(i - 0.5, 1, 6);
      provider.registerAsset('hero', { scene: mesh, owned: true });
      const { root } = await provider.instantiate('hero');
      instances.push(root);
      world.add(root);
    }
    renderer.render(scene, app);
    const rendered = geometryCount();
    const disposedDuringUse = [...events];
    world.remove(...instances);
    await provider.dispose();
    return { before, rendered, after: geometryCount(), disposedDuringUse, events };
  }, live ? './assets/vendor/hgame' : './vendor/hgame');
  assert.equal(result.rendered, result.before + 2, 'both model revisions were uploaded');
  assert.deepEqual(result.disposedDuringUse, [0, 0], 'replacing a key keeps earlier instances alive');
  assert.equal(result.after, result.before, 'both revisions released their GPU geometry');
  assert.deepEqual(result.events, [1, 1], 'each geometry was disposed once');
  return result;
}

async function exerciseAdaptiveResolution(page) {
  const result = await page.evaluate(async runtime => {
    const { createThreeAdapter } = await import(`${runtime}/integrations/three.js`);
    const { THREE } = window.__arena.renderer;
    const canvas = document.createElement('canvas');
    canvas.style.setProperty('width', '3840px', 'important');
    canvas.style.setProperty('height', '2160px', 'important');
    canvas.style.position = 'fixed';
    canvas.style.visibility = 'hidden';
    document.body.append(canvas);
    const allocations = [];
    const namespace = {
      ...THREE,
      DepthTexture: class extends THREE.DepthTexture {
        constructor(width, height, type) {
          super(width, height, type);
          allocations.push([width, height]);
        }
      },
    };
    let adapter;
    try {
      adapter = createThreeAdapter({
        THREE: namespace, canvas, pixelRatio: 2, post3d: { autoExposure: false },
        quality3d: { mode: 'auto', device: {}, settleMs: 0, settleAfterChangeMs: 0, sampleFrames: 2 },
      });
      const gl = adapter.renderer.getContext();
      const read = () => ({
        canvas: [canvas.width, canvas.height],
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        post: [adapter.postPipeline.targets.bufferWidth, adapter.postPipeline.targets.bufferHeight],
        css: [canvas.clientWidth, canvas.clientHeight],
        allocations: [...allocations],
      });
      const before = read();
      allocations.length = 0;
      adapter.recordFrameInterval(45);
      adapter.recordFrameInterval(45);
      adapter.resize();
      return { before, after: read(), glError: gl.getError() };
    } finally {
      adapter?.dispose();
      canvas.remove();
    }
  }, live ? './assets/vendor/hgame' : './vendor/hgame');
  const { before, after } = result;
  assert.deepEqual(before.css, [3840, 2160]);
  assert.deepEqual(after.css, before.css, 'adaptive scaling preserves layout');
  assert.ok(after.canvas[0] * after.canvas[1] < before.canvas[0] * before.canvas[1] * 0.65,
    'slow frames reduce the real pixel count below the tier cap');
  for (const state of [before, after]) {
    assert.deepEqual(state.drawingBuffer, state.canvas, 'canvas uses the real WebGL drawing buffer size');
    assert.deepEqual(state.post, state.canvas, 'post processing uses the real WebGL drawing buffer size');
    assert.deepEqual(state.allocations, [state.canvas], 'allocate once at the final size');
  }
  assert.equal(result.glError, 0);
  return result;
}

async function exerciseTouch(page, read, id) {
  const joystick = page.locator('.hgame-joy-zone');
  await joystick.waitFor();
  const zone = await joystick.boundingBox();
  const x = Math.round(zone.x + zone.width / 3);
  const y = Math.round(zone.y + zone.height / 2);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const input = () => page.evaluate(() => ({
    pointers: (window.__arena ?? window.__survivor).app.input.pointerCount,
    joystick: document.querySelector('.hgame-joy-base').dataset.active,
  }));
  try {
    for (const interruption of ['hidden', 'cancel']) {
      const before = await read();
      await touch('touchStart', [{ x, y, id: 0 }]);
      await page.waitForFunction(() => {
        const input = (window.__arena ?? window.__survivor).app.input;
        return input.pointerCount === 1 && document.querySelector('.hgame-joy-base').dataset.active === 'true';
      }, null, { timeout: 3000 });
      await touch('touchMove', [{ x: x + (interruption === 'hidden' ? 45 : -45), y, id: 0 }]);
      await page.waitForFunction(({ tick, player }) => {
        const state = window.__hgameState();
        return state.tick >= tick + 10 && Math.hypot(state.player.x - player.x,
          (state.player.z ?? state.player.y) - (player.z ?? player.y)) > 0.1;
      }, { tick: before.tick, player: before.player }, { timeout: 3000 });
      assert.ok(distance(before.player, (await read()).player) > 0.1, `${id} ${interruption} touch movement`);
      assert.deepEqual(await input(), { pointers: 1, joystick: 'true' });
      if (interruption === 'hidden') {
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          try { document.dispatchEvent(new Event('visibilitychange')); }
          finally {
            delete document.visibilityState;
            delete document.hidden;
          }
        });
        assert.deepEqual(await input(), { pointers: 0, joystick: 'false' }, `${id} releases touch on hiding`);
      }
      await touch('touchCancel');
      if (interruption === 'hidden') {
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      }
      await page.waitForFunction(() => {
        const input = (window.__arena ?? window.__survivor).app.input;
        return input.pointerCount === 0 && document.querySelector('.hgame-joy-base').dataset.active === 'false';
      }, null, { timeout: 3000 });
      assert.deepEqual(await input(), { pointers: 0, joystick: 'false' });
      const released = await read();
      await page.waitForFunction(tick => window.__hgameState().tick >= tick + 36, released.tick);
      const settled = await read();
      await page.waitForFunction(tick => window.__hgameState().tick >= tick + 12, settled.tick);
      assert.ok(distance(settled.player, (await read()).player) < 0.05, `${id} motion settled after ${interruption}`);
    }
  } finally { await cdp.detach(); }
  return { moved: true, cancelled: true, hidden: true };
}

async function exerciseSoak(page, read, id, errors) {
  const environment = await readBrowserEnvironment(page, browser, gpu);
  assert.equal(environment.gpuModeMatches, true, `${id} requested ${gpu}, observed ${environment.renderer}`);
  const isSurvivor = id === 'survivor-2d';
  const upgrade = isSurvivor ? page.locator('#levelup button').first() : null;
  const moves = ['d', 's', 'a', 'w'];
  let moveIndex = 0;
  let upgrades = 0;
  async function playUntil(deadline) {
    while (performance.now() < deadline && !errors.length) {
      const key = moves[moveIndex++ % moves.length];
      await page.keyboard.down(key);
      if (!isSurvivor) await page.keyboard.down('k');
      try {
        const changeDirection = Math.min(deadline, performance.now() + 2500);
        while (performance.now() < changeDirection && !errors.length) {
          if (upgrade && await upgrade.isVisible()) {
            await upgrade.click({ timeout: 3000 });
            upgrades++;
          }
          await page.waitForTimeout(Math.max(0, Math.min(150, changeDirection - performance.now())));
        }
      } finally {
        if (!isSurvivor) await page.keyboard.up('k');
        await page.keyboard.up(key);
      }
    }
  }

  const cdp = await page.context().newCDPSession(page);
  const checkpoint = async () => {
    // Consistent post-GC heap samples. Collect outside recorded frame windows.
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    return { state: await read(), heapKiB: Math.round(heap.usedSize / 1024) };
  };
  try {
    await playUntil(performance.now() + 2500);
    const initial = await checkpoint();
    const checkpoints = [];
    for (let i = 0; i < 4 && !errors.length; i++) {
      await page.evaluate(collectorSource => {
        // The imported collector is self-contained and has no game dependencies.
        const create = new Function(`return (${collectorSource})`)();
        const recorder = create();
        let frame, last;
        const record = now => {
          if (last !== undefined) recorder.record(now - last);
          last = now;
          frame = requestAnimationFrame(record);
        };
        frame = requestAnimationFrame(record);
        window.__hgameSoakStop = () => new Promise((resolve, reject) => {
          const deadline = setTimeout(() => {
            cancelAnimationFrame(frame);
            cancelAnimationFrame(finalFrame);
            delete window.__hgameSoakStop;
            reject(new Error('Timed out waiting for the final soak frame'));
          }, 8000);
          const finalFrame = requestAnimationFrame(() => {
            clearTimeout(deadline);
            cancelAnimationFrame(frame);
            delete window.__hgameSoakStop;
            resolve(recorder.snapshot());
          });
        });
      }, createFrameTelemetry.toString());
      const start = performance.now();
      await playUntil(start + soakSeconds * 250);
      const frameStats = summarizeFrameTelemetry(await page.evaluate(() => window.__hgameSoakStop()));
      const elapsedMs = performance.now() - start;
      const result = { ...(await checkpoint()), elapsedMs: Math.round(elapsedMs), frameStats };
      const previous = checkpoints.at(-1) ?? initial;
      assert.ok(result.state.tick - previous.state.tick >= elapsedMs * 0.03,
        `${id} simulation ran for under half of checkpoint ${i + 1}: ${JSON.stringify(result)}`);
      assert.ok(frameStats.frames > 0 && result.state.running && !result.state.disposed, `${id} stopped during soak`);
      checkpoints.push(result);
      console.error(`${id} checkpoint ${i + 1}/4: tick ${result.state.tick}, ${result.state.kills} kills, P95 ${frameStats.p95Ms} ms`);
    }
    assert.equal(checkpoints.length, 4, `${id} soak checkpoints; ${errors.join('; ')}`);
    const final = checkpoints.at(-1).state;
    assert.ok(final.kills > initial.state.kills, `${id} no combat progress during soak`);
    if (isSurvivor) assert.ok(upgrades > 0, `${id} no upgrades selected during soak`);
    await page.evaluate(() => (window.__arena ?? window.__survivor).app.dispose());
    assert.ok((await read()).disposed, `${id} soak teardown`);
    return { environment, initial, checkpoints, upgrades };
  } finally {
    await cdp.detach();
  }
}

try {
  browser = await browserType.launch({ headless: !argv.includes('--headed'), ...(executablePath ? { executablePath } : {}),
    ...(browserName === 'chromium' ? { args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
      ...(gpu === 'software' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [])] } : {}) });
  for (const id of ['survivor-2d', 'arena-3d']) {
    const url = await fixture(id);
    const page = await browser.newPage(mobile
      ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 960, height: 540 } });
    const errors = [];
    const startupPaths = [];
    const trackStartup = request => startupPaths.push(new URL(request.url()).pathname);
    page.on('request', trackStartup);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`);
    });
    const soakQuery = id === 'survivor-2d' ? 'seed=1&horde=3000' : 'seed=1&tier=medium&god=1';
    const query = soakSeconds ? soakQuery : 'seed=1&tier=low';
    const entry = `${url}?${query}`;
    const runnerLoading = id === 'arena-3d' && !mobile && !soakSeconds;
    if (runnerLoading) await exerciseRunnerLoading(page, entry);
    else await page.goto(entry);
    await page.locator('#game[data-engine-ready=true]').waitFor({ timeout: 20000 })
      .catch(error => { throw new Error(`${id} did not load: ${errors.join('; ')}; ${error.message}`); });
    page.off('request', trackStartup);
    assert.equal(startupPaths.some(pathname => pathname.endsWith('/hgame/index.js')), false,
      `${id} starts from its required runtime modules`);
    assert.equal(startupPaths.some(pathname => /\/vendor\/rapier[23]d\//.test(pathname)), false,
      `${id} starts without downloading unselected physics`);
    assert.equal(await page.evaluate(() => typeof window.__hgameState), 'function', `${id} state hook`);
    const read = () => page.evaluate(() => window.__hgameState());
    if (soakSeconds) {
      const result = await exerciseSoak(page, read, id, errors);
      assert.deepEqual(errors, [], `${id} browser errors`);
      console.log(JSON.stringify({ id, live, mobile, query, soakSeconds, ...result }));
      await page.close();
      continue;
    }
    const initial = await read();
    if (id === 'arena-3d' && !runnerLoading) {
      await page.waitForFunction(() => window.__hgameState().animation !== null, null, { timeout: 5000 });
    }
    await page.keyboard.down('d');
    if (id === 'arena-3d') {
      await page.waitForFunction(() => window.__hgameState().animation === 'run', null, { timeout: 3000 });
    }
    await page.waitForTimeout(500);
    await page.keyboard.up('d');
    const moved = await read();
    assert.ok(moved.tick > initial.tick, `${id} scheduler progress`);
    assert.ok(distance(initial.player, moved.player) > 0.1, `${id} keyboard movement`);
    const touch = mobile ? await exerciseTouch(page, read, id) : null;
    const recovery = contextRecovery ? await exerciseContextRecovery(page, id) : null;
    const modelReplacement = contextRecovery && id === 'arena-3d' ? await exerciseModelReplacement(page) : null;
    const adaptiveResolution = contextRecovery && id === 'arena-3d' ? await exerciseAdaptiveResolution(page) : null;
    assert.equal(await page.locator('#debug').isVisible(), false);
    let completed;
    for (let cycle = 0; cycle < 3; cycle++) {
      // Drive the existing deterministic game-owned simulation, never write death flags or scores.
      const combat = await page.evaluate(({ id, cycle }) => {
        const sim = id === 'survivor-2d' ? window.__survivor.sim : window.__arena.sim;
        if (id === 'survivor-2d') sim.prefill(1500, 120);
        for (let i = 0; i < 1800 && !sim.state.over; i++) {
          sim.step(1 / 60, id === 'survivor-2d' ? { choice: 0 } : { attack: true });
        }
        const kills = sim.state.kills;
        for (let i = 0; i < 7200 && !sim.state.over; i++) {
          sim.step(1 / 60, id === 'survivor-2d' ? { choice: 2 } : {});
        }
        return { kills, over: sim.state.over, hp: sim.player.hp, cycle };
      }, { id, cycle });
      assert.ok(combat.kills > 0, `${id} combat ${JSON.stringify(combat)}`);
      assert.equal(combat.over, true, `${id} natural death ${JSON.stringify(combat)}`);
      assert.equal(combat.hp, 0);
      await page.locator('#gameover').waitFor({ state: 'visible' });
      completed = await read();
      assert.equal(completed.phase, 'over');
      assert.equal(completed.best.runs, initial.best.runs + cycle + 1);
      assert.ok(completed.best.time + 0.005 >= completed.time, `${id} saved time ${JSON.stringify(completed)}`);
      if (cycle < 2) {
        if (cycle === 0 && mobile) await page.locator('#restart').tap();
        else if (cycle === 0) await page.locator('#restart').click();
        else { await page.keyboard.down('u'); await page.waitForTimeout(100); await page.keyboard.up('u'); }
        await page.waitForFunction(() => window.__hgameState().phase === 'playing', null, { timeout: 3000 })
          .catch(async error => { throw new Error(`${id} restart cycle ${cycle}: ${JSON.stringify(await read())}; errors: ${errors.join('; ')}; ${error.message}`); });
        const restarted = await read();
        assert.ok(restarted.time < 3, `${id} restart clears simulation time`);
        assert.ok(restarted.player.hp > 0);
        assert.deepEqual(restarted.best, completed.best);
      }
    }
    await page.reload();
    await page.locator('#game[data-engine-ready=true]').waitFor();
    const reloaded = await read();
    assert.deepEqual(reloaded.best, completed.best, `${id} persistence after reload`);
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      const restored = await read();
      assert.equal(restored.running, true, `${id} remains running after cached navigation ${i + 1}`);
      assert.equal(restored.disposed, false);
      await page.waitForFunction(tick => window.__hgameState().tick > tick, restored.tick);
    }
    await page.keyboard.down('d');
    const disposal = await page.evaluate(id => {
      const { app } = id === 'survivor-2d' ? window.__survivor : window.__arena;
      const renderer = app.renderer;
      let disposed = 0;
      const dispose = renderer.dispose.bind(renderer);
      renderer.dispose = () => { disposed++; return dispose(); };
      const active = !app.disposed;
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      const exited = active && app.disposed;
      const second = app.dispose();
      return { exited, second, disposed, running: app.running, inputHeld: app.input.isDown('KeyD'),
        touchRoots: document.querySelectorAll('[data-hgame-touch-root]').length };
    }, id);
    assert.deepEqual(disposal, { exited: true, second: false, disposed: 1, running: false, inputHeld: false, touchRoots: 0 });
    const stopped = await read();
    await page.waitForTimeout(150);
    await page.keyboard.up('d');
    assert.deepEqual(await read(), stopped, `${id} no work after disposal`);
    assert.equal(stopped.disposed, true);
    assert.deepEqual(errors, [], `${id} browser errors`);
    console.log(JSON.stringify({ id, browser: browserName, version: browser.version(), live, mobile, touch, recovery,
      modelReplacement, adaptiveResolution, runnerLoading,
      cycles: 3, kills: completed.kills, best: completed.best, disposal, errors }));
    await page.close();
  }
} finally {
  await browser?.close();
  for (const child of children) {
    if (child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
  }
}
