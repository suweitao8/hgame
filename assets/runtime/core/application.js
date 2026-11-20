import { createGameEngine } from '../platform/engine.js';
import { defineProject, resolveFeatureGraph } from './config.js';
import { SceneManager } from './scene.js';
import { createFramePhases } from './internal/frame-phases.js';
import { cleanupAll } from '../internal/cleanup.js';

/** @type {import('./config.js').FeatureCatalog} */
const builtin = {
  scene: { depends: [] },
  input: { depends: [] },
  assets: { depends: [] },
  audio: { depends: [] },
  save: { depends: [] },
  diagnostics: { depends: [] },
  physics2d: { depends: ['scene'] },
  physics3d: { depends: ['scene'] },
  animation2d: { depends: ['scene'] },
  tilemap2d: { depends: [] },
  pathfinding2d: { depends: ['tilemap2d'] },
  model3d: { depends: ['scene'] },
  adaptiveQuality3d: { depends: ['scene'] },
};

/**
 * @typedef {object} GameRenderer Renderer adapter injected into the application.
 * @property {(scene: import('./scene.js').Scene, app: GameApplication) => void} render Draw the current scene.
 * @property {() => void} [resize] Called on window resize.
 * @property {() => void} [dispose] Called when the application is disposed.
 * @property {(frameIntervalMs: number) => void} [recordFrameInterval] Required by the `adaptiveQuality3d` feature (milliseconds).
 * @property {object} [qualityController] Required by the `adaptiveQuality3d` feature.
 */

/**
 * @typedef {object} GameApplicationOptions
 * @property {import('./config.js').ProjectOptions} [project] Project recipe (see {@link defineProject}).
 * @property {import('../platform/engine.js').GameEngine} [platform] Existing platform services; a new engine is created and owned when omitted.
 * @property {GameRenderer} renderer Explicit renderer adapter (required).
 * @property {string} [gameId='html-game'] Slug for the owned platform engine.
 * @property {string} [gameVersion='0.1.0']
 * @property {(callback: (timeMs: number) => void) => number | undefined} [requestFrame] Default `requestAnimationFrame`.
 * @property {(id: number) => void} [cancelFrame] Default `cancelAnimationFrame`.
 * @property {number} [maxSubSteps=5] Max fixed ticks per frame, integer 1..240.
 * @property {number} [maxDelta=0.25] Largest frame delta in seconds that is simulated (> 0).
 */

/**
 * @typedef {object} GameApplicationStats
 * @property {number} frames Rendered frames.
 * @property {number} ticks Fixed ticks executed.
 * @property {number} droppedTicks Ticks discarded because `maxSubSteps` was exceeded.
 */

/**
 * @typedef {object} HitStopOptions
 * @property {number} [scale=0] Time scale during the freeze (>= 0).
 * @property {'max' | 'add' | 'replace'} [stackMode='max'] How overlapping hit-stops combine.
 */

/**
 * @typedef {object} PhysicsWorldFactory
 * @property {(options?: Record<string, unknown>) => import('./scene.js').ScenePhysicsWorld} createWorld
 */

/**
 * @typedef {object} ApplicationServices Installed optional services (keys exist only for loaded features).
 * @property {import('./scene.js').SceneManager} [scene]
 * @property {import('../platform/input/manager.js').InputManager} [input]
 * @property {import('../platform/assets.js').AssetLoader} [assets]
 * @property {import('../platform/audio.js').AudioManager} [audio]
 * @property {import('../platform/storage.js').SaveStore} [save]
 * @property {import('../platform/diagnostics.js').Diagnostics} [diagnostics]
 * @property {PhysicsWorldFactory} [physics2d]
 * @property {PhysicsWorldFactory} [physics3d]
 * @property {{ AnimationPlayer: typeof import('../animation/player.js').AnimationPlayer, SpriteSheet: typeof import('../animation/spritesheet.js').SpriteSheet }} [animation2d]
 * @property {{ TileMap: typeof import('../world/tilemap.js').TileMap, findGridPath: typeof import('../world/tilemap.js').findGridPath }} [tilemap2d]
 * @property {typeof import('../world/tilemap.js').findGridPath} [pathfinding2d]
 * @property {unknown} [model3d] Provider passed to `installFeatures`.
 * @property {object} [adaptiveQuality3d] The renderer's quality controller.
 */

/**
 * @typedef {object} GameFeatureAdapters
 * @property {unknown} [model3d] Loader/provider required by the `model3d` feature.
 */

/**
 * @typedef {object} GameApplication The single scheduler, scenes and services of one game.
 * @property {Readonly<import('./config.js').ProjectConfig>} project
 * @property {import('../platform/engine.js').GameEngine} platform
 * @property {GameRenderer} renderer
 * @property {ApplicationServices} services
 * @property {boolean} running
 * @property {boolean} paused
 * @property {boolean} disposed Whether application ownership has ended.
 * @property {GameApplicationStats} stats Snapshot copy.
 * @property {number} baseTimeScale
 * @property {number} hitStopRemaining Seconds of hit-stop left.
 * @property {number} timeScale Effective scale (hit-stop scale while active).
 * @property {number} unscaledDeltaSeconds Seconds of the last step before scaling.
 * @property {number} deltaSeconds Scaled seconds of the last step.
 * @property {number} renderAlpha Fixed-step interpolation factor, 0..1.
 * @property {import('../platform/input/manager.js').InputManager | null} input
 * @property {import('./scene.js').SceneManager} scenes
 * @property {(phase: import('./internal/frame-phases.js').FramePhase, callback: import('./internal/frame-phases.js').FramePhaseCallback, options?: import('./internal/frame-phases.js').FramePhaseOptions) => () => boolean} onPhase Register a synchronous scheduler extension.
 * @property {(scale: number) => GameApplication} setTimeScale Global time scale (>= 0).
 * @property {(durationSeconds: number, options?: HitStopOptions) => GameApplication} hitStop
 * @property {() => GameApplication} clearHitStop
 * @property {(adapters?: GameFeatureAdapters) => Promise<GameApplication>} installFeatures Load declared optional features.
 * @property {(deltaSeconds: number) => GameApplicationStats} step Advance by `deltaSeconds` (seconds).
 * @property {() => boolean} start
 * @property {() => boolean} stop
 * @property {() => boolean} pause
 * @property {() => boolean} resume
 * @property {(command: import('./scene.js').GameCommand) => void} dispatch Send a command to the current scene.
 * @property {() => boolean} dispose
 */
/**
 * Create the application: one scheduler, independent scene/component model and optional services.
 * Standalone projects inject a renderer without loading any other renderer.
 * @param {GameApplicationOptions} [options]
 * @returns {GameApplication}
 */
export function createGameApplication({
  project: recipe, platform, renderer,
  gameId = 'html-game', gameVersion = '0.1.0',
  requestFrame = callback => globalThis.requestAnimationFrame?.(callback),
  cancelFrame = id => globalThis.cancelAnimationFrame?.(id),
  maxSubSteps = 5, maxDelta = 0.25,
} = {}) {
  const project = defineProject(recipe);
  if (!Number.isInteger(maxSubSteps) || maxSubSteps < 1 || maxSubSteps > 240) throw new RangeError('maxSubSteps must be 1..240');
  if (!Number.isFinite(maxDelta) || maxDelta <= 0) throw new RangeError('maxDelta must be > 0');
  if (!renderer || typeof renderer.render !== 'function') throw new TypeError('Application requires an explicit renderer adapter');

  const ownsPlatform = !platform;
  const runtime = platform ?? createGameEngine({ gameId, gameVersion, renderer: project.renderer });
  /** @type {ApplicationServices} */
  const services = Object.create(null);
  let frameId = null, previousTime = null, accumulator = 0, running = false,
    paused = false, disposed = false, installed = false, installing = null;
  let baseTimeScale = 1, hitStopRemaining = 0, hitStopTimeScale = 0;
  let lastUnscaledDelta = 0, lastScaledDelta = 0;
  let advancing = false, rendering = false;
  let commandRenderTimer = null;
  const framePhases = createFramePhases();
  const stepSize = project.tickHz > 0 ? 1 / project.tickHz : null;
  const requiresInstall = project.features.some(name =>
    ['physics2d', 'physics3d', 'animation2d', 'tilemap2d', 'pathfinding2d', 'model3d',
      'adaptiveQuality3d'].includes(name));
  const stats = { frames: 0, ticks: 0, droppedTicks: 0 };
  /** @type {GameApplication} */
  const app = {
    project, platform: runtime, renderer, services,
    get running() { return running; },
    get paused() { return paused; },
    get disposed() { return disposed; },
    get stats() { return { ...stats }; },
    get baseTimeScale() { return baseTimeScale; },
    get hitStopRemaining() { return hitStopRemaining; },
    get timeScale() { return hitStopRemaining > 0 ? hitStopTimeScale : baseTimeScale; },
    get unscaledDeltaSeconds() { return lastUnscaledDelta; },
    get deltaSeconds() { return lastScaledDelta; },
    get renderAlpha() {
      if (stepSize === null) return 1;
      return Math.max(0, Math.min(1, accumulator / stepSize));
    },
    get input() { return runtime.input ?? null; },
    scenes: null,
    setTimeScale, hitStop, clearHitStop,
    installFeatures, onPhase, step, start, stop, pause, resume, dispatch, dispose,
  };
  app.scenes = new SceneManager(app, scene => {
    if (services.physics2d) scene.physics = services.physics2d.createWorld();
    if (services.physics3d) scene.physics = services.physics3d.createWorld();
  });

  const offResize = runtime.lifecycle?.on?.('resize', () => renderer.resize?.());
  const offFocus = runtime.lifecycle?.on?.('focus', focused => { if (!focused) runtime.input?.reset?.(); });
  const offVisibility = runtime.lifecycle?.on?.('visibility', visible => {
    previousTime = null;
    if (!visible) runtime.input?.reset?.();
  });

  async function installFeatures(adapters = {}) {
    if (disposed) throw new Error('Application disposed');
    if (installed) return app;
    if (installing) return installing;
    const order = resolveFeatureGraph(project.features, builtin);
    installing = Promise.resolve().then(async () => {
      try {
        for (const name of order) {
          if (disposed) throw new Error('Application disposed during feature installation');
          switch (name) {
            case 'scene': services.scene = app.scenes; break;
            case 'input': services.input = runtime.input; break;
            case 'assets': services.assets = runtime.assets; break;
            case 'save': services.save = runtime.save; break;
            case 'audio': services.audio = runtime.audio; break;
            case 'diagnostics': services.diagnostics = runtime.diagnostics; break;
            case 'physics2d': {
              const { RapierPhysicsWorld2D } = await import('../physics/rapier2d.js');
              services.physics2d = { createWorld: options => new RapierPhysicsWorld2D({
                tickHz: project.tickHz, ...options,
              }) };
              break;
            }
            case 'physics3d': {
              const { RapierPhysicsWorld3D } = await import('../physics/rapier3d.js');
              services.physics3d = { createWorld: options => new RapierPhysicsWorld3D({
                tickHz: project.tickHz, ...options,
              }) };
              break;
            }
            case 'animation2d': {
              const [{ AnimationPlayer }, { SpriteSheet }] = await Promise.all([
                import('../animation/player.js'), import('../animation/spritesheet.js'),
              ]);
              services.animation2d = { AnimationPlayer, SpriteSheet };
              break;
            }
            case 'tilemap2d':
            case 'pathfinding2d': {
              const { TileMap, findGridPath } = await import('../world/tilemap.js');
              services.tilemap2d ??= { TileMap, findGridPath };
              if (name === 'pathfinding2d') services.pathfinding2d = findGridPath;
              break;
            }
            case 'model3d': {
              if (!adapters.model3d) throw new Error('model3d requires an explicitly supplied loader/provider');
              services.model3d = adapters.model3d;
              break;
            }
            case 'adaptiveQuality3d': {
              if (!renderer.qualityController || typeof renderer.recordFrameInterval !== 'function') {
                throw new Error('adaptiveQuality3d requires an explicit Three quality adapter/controller');
              }
              services.adaptiveQuality3d = renderer.qualityController;
              break;
            }
            default: throw new Error('Feature unavailable: ' + name);
          }
        }
        if (disposed) throw new Error('Application disposed during feature installation');
        for (const scene of app.scenes.registry.values()) {
          if (!scene.physics) {
            if (services.physics2d) scene.physics = services.physics2d.createWorld();
            else if (services.physics3d) scene.physics = services.physics3d.createWorld();
          }
        }
        installed = true;
        return app;
      } catch (error) {
        for (const key of Object.keys(services)) {
          if (key !== 'scene' || disposed) delete services[key];
        }
        throw error;
      } finally {
        installing = null;
      }
    });
    return installing;
  }

  /** @type {GameApplication['onPhase']} */
  function onPhase(phase, callback, options) {
    if (disposed) throw new Error('Application disposed');
    return framePhases.on(phase, callback, options);
  }

  function render(deltaSeconds = 0) {
    if (rendering || disposed) return;
    if (stepSize === null) cancelScheduledFrame();
    const scene = app.scenes.current;
    const signal = scene?.activationSignal;
    if (!signal) return;
    rendering = true;
    try {
      if (!framePhases.run('beforeRender', app, scene, signal, deltaSeconds)) return;
      renderer.render(scene, app);
      stats.frames++;
      framePhases.run('afterRender', app, scene, signal, deltaSeconds);
    } finally { rendering = false; }
  }

  function cancelScheduledFrame() {
    if (frameId !== null) cancelFrame(frameId);
    if (commandRenderTimer !== null) clearTimeout(commandRenderTimer);
    frameId = null;
    commandRenderTimer = null;
  }

  function requestCommandRender() {
    if (!rendering) {
      if (!advancing) render();
      return;
    }
    if (frameId !== null || commandRenderTimer !== null) return;
    frameId = requestFrame(onCommandFrame) ?? null;
    if (frameId === null) commandRenderTimer = setTimeout(onCommandFrame, 0);
  }

  function onCommandFrame() {
    frameId = null;
    commandRenderTimer = null;
    if (!running || paused || disposed) return;
    try { render(); }
    catch (error) {
      stop();
      runtime.diagnostics?.reportError?.(error, { subsystem: 'hgame' });
      throw error;
    }
  }

  function setTimeScale(scale) {
    if (!Number.isFinite(scale) || scale < 0) {
      throw new RangeError('timeScale must be a finite number >= 0');
    }
    baseTimeScale = scale;
    return app;
  }
  function hitStop(durationSeconds, { scale = 0, stackMode = 'max' } = {}) {
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      throw new RangeError('hitStop durationSeconds must be a finite number >= 0');
    }
    if (!Number.isFinite(scale) || scale < 0) {
      throw new RangeError('hitStop scale must be a finite number >= 0');
    }
    if (durationSeconds === 0) return app;
    if (stackMode === 'replace') {
      hitStopRemaining = durationSeconds;
      hitStopTimeScale = scale;
    } else if (stackMode === 'add') {
      hitStopTimeScale = hitStopRemaining > 0 ? Math.min(hitStopTimeScale, scale) : scale;
      hitStopRemaining += durationSeconds;
    } else {
      if (hitStopRemaining <= 0 || durationSeconds >= hitStopRemaining) {
        hitStopRemaining = durationSeconds;
        hitStopTimeScale = scale;
      } else if (scale < hitStopTimeScale) {
        hitStopTimeScale = scale;
      }
    }
    return app;
  }
  function clearHitStop() {
    hitStopRemaining = 0;
    hitStopTimeScale = 0;
    return app;
  }
  function step(deltaSeconds) {
    advanceFrame(deltaSeconds);
    return { ...stats };
  }

  function advanceFrame(deltaSeconds) {
    if (disposed) throw new Error('Application disposed');
    if (advancing || rendering) throw new Error('Cannot step while a frame is in progress');
    if (requiresInstall && !installed) throw new Error('Call await app.installFeatures() before stepping this project');
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be >= 0');
    if (!app.scenes.current) throw new Error('Choose a Scene first');
    if (paused) return;
    advancing = true;
    try { advanceActiveFrame(deltaSeconds); }
    finally { advancing = false; }
  }

  function advanceActiveFrame(deltaSeconds) {
    lastUnscaledDelta = deltaSeconds;
    const rawStep = Math.min(deltaSeconds, maxDelta);
    let scaledDelta;
    if (hitStopRemaining > 0) {
      const freezeDt = Math.min(rawStep, hitStopRemaining);
      const postFreezeDt = rawStep - freezeDt;
      hitStopRemaining = Math.max(0, hitStopRemaining - deltaSeconds);
      if (hitStopRemaining === 0) {
        const freezeScale = hitStopTimeScale;
        hitStopTimeScale = 0;
        scaledDelta = freezeDt * freezeScale + postFreezeDt * baseTimeScale;
      } else {
        scaledDelta = freezeDt * hitStopTimeScale + postFreezeDt * baseTimeScale;
      }
    } else {
      scaledDelta = rawStep * baseTimeScale;
    }
    const maxScaledStep = maxDelta * Math.max(1, baseTimeScale);
    if (scaledDelta > maxScaledStep) scaledDelta = maxScaledStep;
    lastScaledDelta = scaledDelta;
    if (stepSize !== null) {
      accumulator += scaledDelta;
      let steps = 0;
      while (accumulator + 1e-10 >= stepSize && steps < maxSubSteps) {
        const active = app.scenes.current;
        const signal = active?.activationSignal;
        if (signal) {
          active._capturePreviousTransforms();
          if (framePhases.run('beforeFixedUpdate', app, active, signal, stepSize)) {
            active._run('fixedUpdate', stepSize, app);
            if (!disposed && !signal.aborted && app.scenes.current === active) {
              active.physics?.step?.(stepSize);
              framePhases.run('afterPhysics', app, active, signal, stepSize);
            }
          }
        }
        if (disposed) return;
        runtime.input?.endFrame?.();
        accumulator = Math.max(0, accumulator - stepSize);
        stats.ticks++;
        steps++;
      }
      if (accumulator >= stepSize) {
        const dropped = Math.floor((accumulator + 1e-10) / stepSize);
        accumulator -= dropped * stepSize;
        stats.droppedTicks += dropped;
      }
    }
    const current = app.scenes.current;
    const signal = current?.activationSignal;
    if (signal && framePhases.run('beforeUpdate', app, current, signal, scaledDelta)) {
      current._run('update', scaledDelta, app);
      if (framePhases.run('beforeLateUpdate', app, current, signal, scaledDelta)) {
        current._run('lateUpdate', scaledDelta, app);
      }
    }
    render(scaledDelta);
  }

  function scheduleFrame() {
    if (stepSize !== null && frameId === null && running && !paused && !disposed) {
      frameId = requestFrame(onFrame) ?? null;
    }
  }

  function onFrame(time) {
    frameId = null;
    if (!running || disposed || paused) return;
    try {
      const priorTime = previousTime;
      const dt = priorTime === null ? 0 : Math.max(0, (time - priorTime) / 1000);
      previousTime = time;
      advanceFrame(dt);
      if (disposed) return;
      if (previousTime !== null && runtime.lifecycle?.visible !== false) {
        if (services.adaptiveQuality3d && dt > 0) renderer.recordFrameInterval(dt * 1000);
        if (!disposed && previousTime !== null) {
          runtime.diagnostics?.recordFrame?.(time, priorTime === null);
        }
      }
    } catch (error) {
      stop();
      runtime.diagnostics?.reportError?.(error, { subsystem: 'hgame' });
      throw error;
    }
    scheduleFrame();
  }
  function start() {
    if (disposed || running) return false;
    if (requiresInstall && !installed) throw new Error('Call await app.installFeatures() before starting this project');
    if (!app.scenes.current) throw new Error('Choose a Scene before start()');
    running = true;
    paused = false;
    previousTime = null;
    try {
      runtime.ready?.();
      if (disposed || !running) return false;
      if (!paused) {
        if (stepSize !== null) scheduleFrame();
        else requestCommandRender();
      }
      return true;
    } catch (error) {
      try { stop(); }
      catch (stopError) { throw new AggregateError([error, stopError], 'Application startup failed during cleanup'); }
      throw error;
    }
  }
  function stop() {
    if (!running) return false;
    running = false;
    paused = false;
    cancelScheduledFrame();
    previousTime = null;
    accumulator = 0;
    hitStopRemaining = 0;
    hitStopTimeScale = 0;
    lastUnscaledDelta = 0;
    lastScaledDelta = 0;
    runtime.input?.reset?.();
    return true;
  }
  function pause() {
    if (!running || paused) return false;
    paused = true;
    cancelScheduledFrame();
    previousTime = null;
    runtime.input?.reset?.();
    return true;
  }
  function resume() {
    if (!running || !paused) return false;
    paused = false;
    previousTime = null;
    if (stepSize !== null) scheduleFrame();
    else requestCommandRender();
    return true;
  }
  function dispatch(command) {
    if (disposed) throw new Error('Application disposed');
    if (!command || typeof command.type !== 'string') throw new TypeError('Command needs type');
    if (!app.scenes.current) throw new Error('Choose a Scene before dispatch');
    app.scenes.current.onCommand(command, app);
    if (stepSize === null && running && !paused) requestCommandRender();
  }
  function dispose() {
    if (disposed) return false;
    disposed = true;
    cleanupAll([
      () => stop(),
      () => app.scenes.dispose(),
      () => framePhases.dispose(),
      () => offResize?.(),
      () => offFocus?.(),
      () => offVisibility?.(),
      () => cleanupAll(Object.entries(services).reverse().map(([key, service]) => () => {
        try {
          if (service !== app.scenes && service !== runtime.input && service !== runtime.audio &&
              service !== runtime.assets && service !== runtime.save && service !== runtime.diagnostics) {
            const pending = service?.dispose?.();
            if (typeof pending?.then === 'function') {
              void Promise.resolve(pending).catch(error => {
                if (runtime.diagnostics?.reportError) {
                  runtime.diagnostics.reportError(error, { subsystem: 'hgame', operation: 'dispose', service: key });
                } else {
                  console.error('Feature disposal failed:', key, error);
                }
              }).catch(error => console.error('Feature disposal error reporting failed:', key, error));
            }
          }
        } finally { delete services[key]; }
      }), 'Feature disposal failed'),
      () => renderer.dispose?.(),
      () => { if (ownsPlatform) runtime.dispose?.(); },
    ], 'Application disposal failed');
    return true;
  }
  return app;
}
