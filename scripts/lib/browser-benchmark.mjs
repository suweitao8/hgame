export function classifyGpuRenderer(renderer) {
  if (renderer === 'Canvas2D') return 'none';
  if (!renderer || /^(WebKit WebGL|WebGL(?: 2)?|ANGLE)$/i.test(renderer)) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer)) return 'software';
  return 'hardware';
}

export function benchmarkBrowserOptions(gpu = 'software', executablePath) {
  if (!['software', 'hardware'].includes(gpu)) throw new RangeError('--gpu must be software or hardware.');
  const args = ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-frame-rate-limit'];
  if (gpu === 'software') args.push('--use-gl=angle', '--use-angle=swiftshader');
  return { headless: true, ...(executablePath ? { executablePath } : {}), args };
}

/** Self-contained for use in a page and in the generated stress fixture before disposal. */
export function captureCanvasEnvironment(selector) {
  if (window.__hgameBenchmarkEnvironment) return window.__hgameBenchmarkEnvironment;
  const canvas = document.querySelector(selector);
  const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: gl ? gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'Canvas2D',
    vendor: gl ? gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR) : null,
    webglVersion: gl ? gl.getParameter(gl.VERSION) : null,
    viewport: { width: innerWidth, height: innerHeight },
    canvasPixels: canvas ? [canvas.width, canvas.height] : null,
    devicePixelRatio,
    qualityTier: canvas?.dataset.qualityTier ?? null,
  };
}

export async function readBrowserEnvironment(page, browser, requestedGpu) {
  const canvas = await page.evaluate(captureCanvasEnvironment, '#game');
  const actualGpu = classifyGpuRenderer(canvas.renderer);
  return { ...canvas, browserVersion: browser.version(), platform: process.platform,
    requestedGpu, actualGpu, gpuModeMatches: requestedGpu === actualGpu };
}
