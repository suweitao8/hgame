function positiveLimit(value) {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : Infinity;
}

export function readDrawingBufferLimits(renderer) {
  const gl = renderer.getContext?.();
  const textureSize = positiveLimit(renderer.capabilities?.maxTextureSize ??
    (gl?.MAX_TEXTURE_SIZE === undefined ? null : gl.getParameter?.(gl.MAX_TEXTURE_SIZE)));
  const renderbufferSize = positiveLimit(gl?.MAX_RENDERBUFFER_SIZE === undefined
    ? null : gl.getParameter?.(gl.MAX_RENDERBUFFER_SIZE));
  const viewport = gl?.MAX_VIEWPORT_DIMS === undefined ? null : gl.getParameter?.(gl.MAX_VIEWPORT_DIMS);
  return {
    maxBufferWidth: Math.min(textureSize, renderbufferSize, positiveLimit(viewport?.[0])),
    maxBufferHeight: Math.min(textureSize, renderbufferSize, positiveLimit(viewport?.[1])),
  };
}

export function fitDrawingBuffer(width, height, requestedRatio, {
  maxPixels = Infinity,
  maxBufferWidth = Infinity,
  maxBufferHeight = Infinity,
  scale = 1,
} = {}) {
  // Cap each side by the area budget too, since the other side cannot round below one pixel.
  const pixelRatio = Math.min(
    requestedRatio, Math.sqrt(maxPixels / width / height),
    Math.min(positiveLimit(maxBufferWidth), maxPixels) / width,
    Math.min(positiveLimit(maxBufferHeight), maxPixels) / height,
  ) * scale;
  return {
    pixelRatio,
    bufferWidth: Math.max(1, Math.floor(width * pixelRatio)),
    bufferHeight: Math.max(1, Math.floor(height * pixelRatio)),
  };
}
