import { createGameEngine } from '../platform/engine.js';
import { defineProject, resolveFeatureGraph } from './config.js';
import { SceneManager } from './scene.js';

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

/** One scheduler, independent scene/component model, optional services.
 * Standalone projects can inject a renderer without loading any other renderer.
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
  const services = Object.create(null);
  let frameId = null, previousTime = null, accumulator = 0, running = false,
    paused = false, disposed = false, installed = false, installing = null;
  let baseTimeScale = 1, hitStopRemaining = 0, hitStopTimeScale = 0;
  let lastUnscaledDelta = 0, lastScaledDelta = 0;
  const stepSize = project.tickHz > 0 ? 1 / project.tickHz : null;
  const requiresInstall = project.features.some(name =>
    ['physics2d', 'physics3d', 'animation2d', 'tilemap2d', 'pathfinding2d', 'model3d',
      'adaptiveQuality3d'].includes(name));
  const stats = { frames: 0, ticks: 0, droppedTicks: 0 };
  const app = {
    project, platform: runtime, renderer, services,
    get running() { return running; },
    get paused() { return paused; },
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
    installFeatures, step, start, stop, pause, resume, dispatch, dispose,
  };
  app.scenes = new SceneManager(app, scene => {
    if (services.physics2d) scene.physics = services.physics2d.createWorld();
    if (services.physics3d) scene.physics = services.physics3d.createWorld();
  });

  const offResize = runtime.lifecycle?.on?.('resize', () => renderer.resize?.());
  const offFocus = runtime.lifecycle?.on?.('focus', focused => { if (!focused) runtime.input?.reset?.(); });
  const offVisibility = runtime.lifecycle?.on?.('visibility', visible => { if (!visible) runtime.input?.reset?.(); });

  async function installFeatures(adapters = {}) {
    if (disposed) throw new Error('Application disposed');
    if (installed) return app;
    if (installing) return installing;
    const order = resolveFeatureGraph(project.features, builtin);
    installing = Promise.resolve().then(async () => {
      try {
        for (const name of order) {
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
          if (key !== 'scene') delete services[key];
        }
        throw error;
      } finally {
        installing = null;
      }
    });
    return installing;
  }

  function render() {
    const scene = app.scenes.current;
    if (!scene) return;
    renderer.render(scene, app);
    stats.frames++;
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
    if (disposed) throw new Error('Application disposed');
    if (requiresInstall && !installed) throw new Error('Call await app.installFeatures() before stepping this project');
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be >= 0');
    const scene = app.scenes.current;
    if (!scene) throw new Error('Choose a Scene first');
    if (paused) return stats;
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
        active?._capturePreviousTransforms?.();
        active?._run('fixedUpdate', stepSize, app);
        active?.physics?.step?.(stepSize);
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
    current._run('update', scaledDelta, app);
    current._run('lateUpdate', scaledDelta, app);
    render();
    return { ...stats };
  }

  function onFrame(time) {
    frameId = null;
    if (!running || disposed || paused) return;
    try {
      const dt = previousTime === null ? 0 : Math.max(0, (time - previousTime) / 1000);
      previousTime = time;
      step(dt);
      if (services.adaptiveQuality3d && dt > 0) renderer.recordFrameInterval(dt * 1000);
      runtime.diagnostics?.recordFrame?.(time);
    } catch (error) {
      stop();
      runtime.diagnostics?.reportError?.(error, { subsystem: 'hgame' });
      throw error;
    }
    if (running && !paused) frameId = requestFrame(onFrame);
  }
  function start() {
    if (disposed || running) return false;
    if (requiresInstall && !installed) throw new Error('Call await app.installFeatures() before starting this project');
    if (!app.scenes.current) throw new Error('Choose a Scene before start()');
    running = true;
    paused = false;
    previousTime = null;
    runtime.ready?.();
    if (stepSize !== null) frameId = requestFrame(onFrame);
    else render();
    return true;
  }
  function stop() {
    if (!running) return false;
    running = false;
    paused = false;
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
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
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    previousTime = null;
    runtime.input?.reset?.();
    return true;
  }
  function resume() {
    if (!running || !paused) return false;
    paused = false;
    previousTime = null;
    if (stepSize !== null) frameId = requestFrame(onFrame);
    else render();
    return true;
  }
  function dispatch(command) {
    if (!command || typeof command.type !== 'string') throw new TypeError('Command needs type');
    if (!app.scenes.current) throw new Error('Choose a Scene before dispatch');
    app.scenes.current.onCommand(command, app);
    if (stepSize === null && running && !paused) render();
  }
  function dispose() {
    if (disposed) return false;
    stop();
    disposed = true;
    app.scenes.dispose();
    offResize?.(); offFocus?.(); offVisibility?.();
    for (const [key, service] of Object.entries(services).reverse()) {
      if (service !== app.scenes && service !== runtime.input && service !== runtime.audio &&
          service !== runtime.assets && service !== runtime.save && service !== runtime.diagnostics) {
        service?.dispose?.();
      }
      delete services[key];
    }
    renderer.dispose?.();
    if (ownsPlatform) runtime.dispose?.();
    return true;
  }
  return app;
}
