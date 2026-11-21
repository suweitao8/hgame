/**
 * Lightweight KTX2 / Basis Universal GPU compressed texture capability & container helpers
 * targeting 4-6x mobile VRAM savings for 50MB single-bundle HTML5 games.
 */

export const KTX2_MAGIC = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Inspect WebGL/WebGL2 compressed texture extension support cleanly.
 * @param {object|null} [glOrRenderer] Three.js WebGLRenderer or raw WebGL2RenderingContext.
 */
export function detectCompressedTextureSupport(glOrRenderer = null) {
  const gl = typeof glOrRenderer?.getContext === 'function'
    ? glOrRenderer.getContext()
    : glOrRenderer;

  if (!gl || typeof gl.getExtension !== 'function') {
    return Object.freeze({
      astc: false,
      etc2: false,
      bc7: false,
      dxt: false,
      preferred: 'rgba8',
      vramSavingsRatio: 1,
      maxTextureSize: 0,
    });
  }

  const astc = Boolean(gl.getExtension('WEBGL_compressed_texture_astc'));
  const etc2 = Boolean(gl.getExtension('WEBGL_compressed_texture_etc'));
  const bc7 = Boolean(gl.getExtension('EXT_texture_compression_bptc'));
  const dxt = Boolean(gl.getExtension('WEBGL_compressed_texture_s3tc'));
  const maxTextureSize = typeof gl.getParameter === 'function' && gl.MAX_TEXTURE_SIZE !== undefined
    ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0
    : 0;

  let preferred = 'rgba8';
  let vramSavingsRatio = 1;
  if (astc) {
    preferred = 'astc';
    vramSavingsRatio = 4.0;
  } else if (etc2) {
    preferred = 'etc2';
    vramSavingsRatio = 4.0;
  } else if (bc7) {
    preferred = 'bc7';
    vramSavingsRatio = 4.0;
  } else if (dxt) {
    preferred = 'dxt';
    vramSavingsRatio = 4.0;
  }

  return Object.freeze({
    astc,
    etc2,
    bc7,
    dxt,
    preferred,
    vramSavingsRatio,
    maxTextureSize,
  });
}

/**
 * Parse KTX2 file header metadata without allocating decoded image buffers.
 * @param {ArrayBuffer|ArrayBufferView} input
 */
export function parseKtx2Header(input) {
  let view;
  if (input instanceof ArrayBuffer) {
    view = new DataView(input);
  } else if (ArrayBuffer.isView(input)) {
    view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  } else {
    throw new TypeError('parseKtx2Header expects ArrayBuffer or TypedArray');
  }

  if (view.byteLength < 80) {
    throw new RangeError(`Truncated KTX2 buffer: expected >= 80 bytes, got ${view.byteLength}`);
  }

  for (let i = 0; i < KTX2_MAGIC.length; i++) {
    if (view.getUint8(i) !== KTX2_MAGIC[i]) {
      throw new Error('Invalid KTX2 magic identifier');
    }
  }

  return Object.freeze({
    vkFormat: view.getUint32(12, true),
    typeSize: view.getUint32(16, true),
    pixelWidth: view.getUint32(20, true),
    pixelHeight: view.getUint32(24, true),
    pixelDepth: view.getUint32(28, true),
    layerCount: view.getUint32(32, true),
    faceCount: view.getUint32(36, true),
    levelCount: view.getUint32(40, true),
    supercompressionScheme: view.getUint32(44, true),
  });
}

/**
 * Select the highest-priority GPU-compressed texture variant supported by the device.
 * @param {Record<string, string>} [variants]
 * @param {{ astc?: boolean, etc2?: boolean, bc7?: boolean, dxt?: boolean }} [support]
 */
export function selectOptimalTextureVariant(variants = {}, support = {}) {
  const order = ['astc', 'etc2', 'bc7', 'dxt'];
  for (const fmt of order) {
    if (support?.[fmt] && typeof variants?.[fmt] === 'string' && variants[fmt].length > 0) {
      return Object.freeze({
        format: fmt,
        url: variants[fmt],
        compressed: true,
      });
    }
  }
  return Object.freeze({
    format: 'fallback',
    url: variants?.fallback ?? variants?.webp ?? variants?.png ?? '',
    compressed: false,
  });
}

/**
 * Construct a Three.js CompressedTexture from pre-decoded or transcoded GPU mip payloads,
 * or return a serializable descriptor if Three.js is absent.
 */
export function createCompressedTextureFromMipData(
  THREE = null,
  { width = 0, height = 0, format = 0, mipmaps = [] } = {},
) {
  if (THREE?.CompressedTexture && format) {
    const tex = new THREE.CompressedTexture(mipmaps, width, height, format);
    tex.needsUpdate = true;
    return tex;
  }
  return Object.freeze({
    isCompressedTexture: false,
    width,
    height,
    format,
    mipCount: Array.isArray(mipmaps) ? mipmaps.length : 0,
  });
}
