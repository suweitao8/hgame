export function classifyGpuRenderer(renderer) {
  if (renderer === 'Canvas2D') return 'none';
  if (!renderer || /^(WebKit WebGL|WebGL(?: 2)?|ANGLE|WebGPU)$/i.test(renderer)) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer)) return 'software';
  return 'hardware';
}

export function benchmarkBrowserOptions(gpu = 'software', executablePath) {
  if (!['software', 'hardware'].includes(gpu)) throw new RangeError('--gpu must be software or hardware.');
  const args = ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-frame-rate-limit'];
  if (gpu === 'software') args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  return { headless: true, ...(executablePath ? { executablePath } : {}), args };
}

/** Observe game-owned contexts without initializing a renderer on the canvas. */
export function observeCanvasContexts() {
  const contexts = new WeakMap();
  const prototype = HTMLCanvasElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext');
  Object.defineProperty(prototype, 'getContext', {
    ...descriptor,
    value: function getContext(type, options) {
      const context = Reflect.apply(descriptor.value, this, arguments);
      if (context && !contexts.has(this)) contexts.set(this, { type, context });
      return context;
    },
  });
  Object.defineProperty(window, '__hgameObservedCanvasContext', { value: canvas => contexts.get(canvas) });
}

/** Self-contained for use in a page and in the generated stress fixture before disposal. */
export function captureCanvasEnvironment(options) {
  const { selector, element = null, observeOnly = false } = typeof options === 'string' ? { selector: options } : options;
  if (!observeOnly && window.__hgameBenchmarkEnvironment) return window.__hgameBenchmarkEnvironment;
  const target = observeOnly ? element : document.querySelector(selector);
  const canvas = target instanceof HTMLCanvasElement ? target : target?.querySelector('canvas');
  const diagnostics = window.__hgameRenderDiagnostics?.();
  const adapter = diagnostics?.adapter ?? null;
  const observed = observeOnly ? window.__hgameObservedCanvasContext?.(canvas) : null;
  const observedWebGl = ['webgl', 'webgl2', 'experimental-webgl'].includes(observed?.type);
  const backend = observeOnly
    ? observedWebGl ? 'webgl' : observed?.type === '2d' ? 'canvas' : observed?.type ?? (canvas ? 'unknown' : 'dom')
    : diagnostics?.backend;
  const gl = observeOnly ? (observedWebGl ? observed.context : null)
    : backend === 'webgpu' || backend === 'canvas' ? null : canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: backend === 'webgpu'
      ? [adapter?.vendor, adapter?.architecture, adapter?.device, adapter?.description].filter(Boolean).join(' ') || 'WebGPU'
      : gl ? gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
        : (!observeOnly || backend === 'canvas' ? 'Canvas2D' : null),
    backend: backend ?? (gl ? 'webgl' : 'canvas'),
    vendor: gl ? gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR) : adapter?.vendor ?? null,
    adapter,
    webglVersion: gl ? gl.getParameter(gl.VERSION) : null,
    viewport: { width: innerWidth, height: innerHeight },
    canvasPixels: canvas ? [canvas.width, canvas.height] : null,
    devicePixelRatio,
    touch: navigator.maxTouchPoints > 0,
    qualityTier: canvas?.dataset.qualityTier ?? null,
  };
}

export async function readBrowserEnvironment(page, browser, requestedGpu, selector = '#game', { observeOnly = false } = {}) {
  const locators = observeOnly ? await page.locator(selector).all() : [];
  const element = locators.length ? await locators[0].elementHandle() : null;
  let canvas;
  try {
    canvas = await page.evaluate(captureCanvasEnvironment, { selector, element, observeOnly });
  } finally {
    await element?.dispose();
  }
  const reportedGpu = classifyGpuRenderer(canvas.renderer);
  const actualGpu = canvas.adapter?.fallback === true || reportedGpu === 'software' ? 'software'
    : canvas.adapter?.fallback === false && canvas.backend === 'webgpu' ? 'hardware'
    : reportedGpu;
  return { ...canvas, browserVersion: browser.version(), platform: process.platform,
    requestedGpu, actualGpu, gpuModeMatches: requestedGpu === actualGpu };
}
