import { bindVisibilitySuspension } from './VisibilityController.js';

/** @typedef {import('./Renderer2D.js').Renderer2D} Renderer2D */
/** @typedef {typeof import('./ProceduralAtlas.js').createDefaultGameAtlas} CreateDefaultAtlas */
/** @typedef {import('../../vendor/hgame/core/application.js').GameApplication} GameApplication */
/** @typedef {{app: GameApplication, renderer: Renderer2D, Scene: typeof import('../../vendor/hgame/core/scene.js').Scene, Entity: typeof import('../../vendor/hgame/core/entity.js').Entity, Component: typeof import('../../vendor/hgame/core/component.js').Component}} PixiGameContext */
/** @typedef {{scene: string, state?: () => unknown, visibility?: Parameters<typeof bindVisibilitySuspension>[1]}} PixiGameSetupResult */

/** @param {string} path Relative to the game document. */
export async function readGameJson(path) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw new Error(`Could not load ${path}: HTTP ${response.status}`);
  return response.json();
}

/** @param {string} module Path within HGame, such as world/tilemap.js. */
export function loadRuntime(module) {
  const hosted = location.pathname.startsWith('/local-games/');
  const runtime = new URL(hosted ? '/runtime/hgame/' : './vendor/hgame/', document.baseURI);
  return import(new URL(module, runtime).href);
}

/**
 * Start one HGame application backed by Pixi. The setup callback receives
 * installed services and returns { scene, state?, visibility? }.
 * @template [Resources=undefined]
 * @param {(context: PixiGameContext, resources: Resources) => PixiGameSetupResult | Promise<PixiGameSetupResult>} setup
 * @param {object} [options]
 * @param {HTMLElement | null} [options.mount]
 * @param {() => ReturnType<CreateDefaultAtlas> | Promise<ReturnType<CreateDefaultAtlas>>} [options.createAtlas]
 * @param {ConstructorParameters<typeof import('./Renderer2D.js').Renderer2D>[1]} [options.rendererOptions]
 * @param {() => Promise<Resources>} [options.loadResources]
 * @returns {Promise<{app: GameApplication, renderer: Renderer2D}>}
 */
export async function startPixiGame(setup, {
  mount = document.querySelector('#game-canvas'),
  createAtlas,
  rendererOptions,
  loadResources,
} = {}) {
  if (!mount) throw new Error('Missing Pixi game canvas mount');
  if (typeof setup !== 'function') throw new TypeError('Pixi game setup callback is required');
  const [gameConfig, engineConfig, presentation, { createGameApplication }, { defineProject },
    { Scene }, { Entity }, { Component }, { createAdaptiveQualityController, QUALITY2D_PRESETS },
    { createDefaultGameAtlas }, { Renderer2D }, resources] = await Promise.all([
    readGameJson('./game.config.json'), readGameJson('./engine.config.json'), readGameJson('./src/presentation.json'),
    loadRuntime('core/application.js'), loadRuntime('core/config.js'), loadRuntime('core/scene.js'),
    loadRuntime('core/entity.js'), loadRuntime('core/component.js'), loadRuntime('integrations/quality3d.js'),
    import('./ProceduralAtlas.js'), import('./Renderer2D.js'), Promise.resolve().then(loadResources),
  ]);
  const project = defineProject(engineConfig);
  const requestedMode = presentation.quality ?? 'auto';
  const mode = requestedMode === 'auto' && project.tickHz === 0 ? 'high' : requestedMode;
  const qualityController = createAdaptiveQualityController({
    mode,
    device: {
      mobile: globalThis.matchMedia?.('(pointer: coarse)')?.matches ?? false,
      memoryGB: navigator.deviceMemory ?? null,
    },
  });
  const atlas = await (createAtlas ?? createDefaultGameAtlas)();
  let app;
  let renderer;
  let canvas;
  let visibility;
  let state;
  const diagnostics = () => renderer.renderDiagnostics();
  function pagehide(event) {
    if (!event.persisted) app.dispose();
  }

  try {
    renderer = new Renderer2D(atlas, {
      backend: presentation.backend ?? 'auto',
      qualityController, qualityPresets: QUALITY2D_PRESETS, maxPixelRatio: 3,
      ...rendererOptions,
    });
    await renderer.init(mount);
    canvas = renderer.app.canvas;
    app = createGameApplication({
      project, gameId: gameConfig.id, gameVersion: gameConfig.version,
      renderer: {
        render(_scene, app) {
          const elapsed = app?.unscaledDeltaSeconds;
          renderer.render(project.tickHz === 0 ? null : elapsed === undefined ? undefined : elapsed * 1000);
        },
        resize() { renderer.resize(); },
        dispose() {
          window.removeEventListener('pagehide', pagehide);
          if (state && window.__hgameState === state) delete window.__hgameState;
          if (window.__hgameRenderDiagnostics === diagnostics) delete window.__hgameRenderDiagnostics;
          delete mount.dataset.engineReady;
          delete canvas.dataset.engineReady;
          try { visibility?.dispose(); } finally { renderer.dispose(); }
        },
      },
    });
    window.addEventListener('pagehide', pagehide);
    await app.installFeatures();
    const ready = await setup({ app, renderer, Scene, Entity, Component }, resources);
    if (app.disposed) throw new Error('Pixi game was disposed during setup');
    if (typeof ready?.scene !== 'string' || !app.scenes.get(ready.scene)) {
      throw new Error('Pixi game setup must return the name of a registered scene in { scene }');
    }
    visibility = bindVisibilitySuspension(app, {
      ...ready.visibility,
      onVisibility(visible) {
        renderer.resetQualityMeasurements();
        ready.visibility?.onVisibility?.(visible);
      },
    });
    renderer.onResize = () => { if (project.tickHz === 0 && app.running && !app.paused) renderer.render(null); };
    app.scenes.start(ready.scene);
    app.start();
    visibility.sync();
    state = ready.state;
    if (state) window.__hgameState = state;
    window.__hgameRenderDiagnostics = diagnostics;
    mount.dataset.engineReady = 'true';
    canvas.dataset.engineReady = 'true';
    return { app, renderer };
  } catch (error) {
    try {
      if (app) app.dispose();
      else if (renderer) renderer.dispose();
      else atlas.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Pixi game startup and cleanup failed');
    }
    throw error;
  }
}
