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

/** Self-contained for use in a page and in the generated stress fixture before disposal. */
export function captureCanvasEnvironment(selector) {
  if (window.__hgameBenchmarkEnvironment) return window.__hgameBenchmarkEnvironment;
  const canvas = document.querySelector(selector);
  const diagnostics = window.__hgameRenderDiagnostics?.();
  const adapter = diagnostics?.adapter ?? null;
  const backend = diagnostics?.backend;
  const gl = backend === 'webgpu' || backend === 'canvas'
    ? null : canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: backend === 'webgpu'
      ? [adapter?.vendor, adapter?.architecture, adapter?.device, adapter?.description].filter(Boolean).join(' ') || 'WebGPU'
      : gl ? gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'Canvas2D',
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

export async function readBrowserEnvironment(page, browser, requestedGpu) {
  const canvas = await page.evaluate(captureCanvasEnvironment, '#game');
  const reportedGpu = classifyGpuRenderer(canvas.renderer);
  const actualGpu = canvas.adapter?.fallback === true || reportedGpu === 'software' ? 'software'
    : canvas.adapter?.fallback === false && canvas.backend === 'webgpu' ? 'hardware'
    : reportedGpu;
  return { ...canvas, browserVersion: browser.version(), platform: process.platform,
    requestedGpu, actualGpu, gpuModeMatches: requestedGpu === actualGpu };
}
