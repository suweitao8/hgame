/** @typedef {{bufferBytes: number, textureBytes: number, calls: number, unmeasuredCalls: number}} WebGlUploadTotals */

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// WebGL's optional subranges address elements, while byteLength includes the view's element width.
function sourceBytes(source, offset = 0, length = 0) {
  if (source == null || typeof source === 'number') return 0;
  const elementSize = source.BYTES_PER_ELEMENT ?? 1;
  const available = source.byteLength / elementSize;
  if (![available, offset, length].every(isNonNegativeInteger) || offset > available) return null;
  const count = length || available - offset;
  return count <= available - offset ? count * elementSize : null;
}

function enumSizes(gl, groups) {
  const sizes = new Map();
  for (const [size, names] of groups) {
    for (const name of names) {
      try {
        const value = gl[name];
        if (typeof value === 'number') sizes.set(value, size);
      } catch { /* An unavailable constant leaves related transfers unmeasured. */ }
    }
  }
  return sizes;
}

function makePixelSizes(gl) {
  const components = enumSizes(gl, [
    [1, ['RED', 'RED_INTEGER', 'ALPHA', 'LUMINANCE', 'DEPTH_COMPONENT']],
    [2, ['RG', 'RG_INTEGER', 'LUMINANCE_ALPHA']],
    [3, ['RGB', 'RGB_INTEGER']], [4, ['RGBA', 'RGBA_INTEGER']],
  ]);
  const types = enumSizes(gl, [
    [1, ['BYTE', 'UNSIGNED_BYTE']], [2, ['SHORT', 'UNSIGNED_SHORT', 'HALF_FLOAT']],
    [4, ['INT', 'UNSIGNED_INT', 'FLOAT']],
  ]);
  const packed = enumSizes(gl, [
    [2, ['UNSIGNED_SHORT_4_4_4_4', 'UNSIGNED_SHORT_5_5_5_1', 'UNSIGNED_SHORT_5_6_5']],
    [4, ['UNSIGNED_INT_2_10_10_10_REV', 'UNSIGNED_INT_10F_11F_11F_REV', 'UNSIGNED_INT_5_9_9_9_REV', 'UNSIGNED_INT_24_8']],
    [8, ['FLOAT_32_UNSIGNED_INT_24_8_REV']],
  ]);
  return (format, type) => packed.get(type) ?? components.get(format) * types.get(type);
}

function pixelPayload(source, width, height, depth, format, type, pixelSize) {
  // No client bytes for empty allocations or offsets into a bound pixel-unpack buffer.
  if (source == null || typeof source === 'number') return 0;
  const size = pixelSize(format, type);
  const bytes = width * height * depth * size;
  return [width, height, depth, bytes].every(isNonNegativeInteger) ? bytes : null;
}

function pixelSourcePayload(source, format, type, pixelSize) {
  const width = source?.naturalWidth ?? source?.videoWidth ?? source?.displayWidth ?? source?.width;
  const height = source?.naturalHeight ?? source?.videoHeight ?? source?.displayHeight ?? source?.height;
  return pixelPayload(source, width, height, 1, format, type, pixelSize);
}

/** Observe client upload commands only while a diagnostics frame is rendering. */
export function beginWebGlUploadProbe(gl) {
  if (!gl) return null;
  const pixelSize = makePixelSizes(gl);
  const buffer = [
    ['bufferData', a => sourceBytes(a[1], a[3], a[4])],
    ['bufferSubData', a => sourceBytes(a[2], a[3], a[4])],
  ];
  const textures = [
    ['texImage2D', a => a.length === 6 ? pixelSourcePayload(a[5], a[3], a[4], pixelSize) :
      pixelPayload(a[8], a[3], a[4], 1, a[6], a[7], pixelSize)],
    ['texSubImage2D', a => a.length === 7 ? pixelSourcePayload(a[6], a[4], a[5], pixelSize) :
      pixelPayload(a[8], a[4], a[5], 1, a[6], a[7], pixelSize)],
    ['texImage3D', a => pixelPayload(a[9], a[3], a[4], a[5], a[7], a[8], pixelSize)],
    ['texSubImage3D', a => pixelPayload(a[10], a[5], a[6], a[7], a[8], a[9], pixelSize)],
  ];
  for (const [name, index] of [
    ['compressedTexImage2D', 6], ['compressedTexSubImage2D', 7],
    ['compressedTexImage3D', 7], ['compressedTexSubImage3D', 9],
  ]) {
    textures.push([name, a => sourceBytes(a[index], a[index + 1], a[index + 2])]);
  }

  /** @type {WebGlUploadTotals} */
  const totals = { bufferBytes: 0, textureBytes: 0, calls: 0, unmeasuredCalls: 0 };
  const wrappers = [];
  let collecting = true;
  function observe(methods, field) {
    for (const [name, measure] of methods) {
      try {
        const original = gl[name];
        if (typeof original !== 'function') continue;
        const descriptor = Object.getOwnPropertyDescriptor(gl, name);
        const wrapper = function (...args) {
          const result = Reflect.apply(original, this, args);
          if (!collecting) return result;
          let bytes;
          try { bytes = measure(args); } catch { bytes = null; }
          if (bytes !== 0) {
            totals.calls++;
            if (bytes === null) totals.unmeasuredCalls++;
            else totals[field] += bytes;
          }
          return result;
        };
        Object.defineProperty(gl, name, descriptor && 'value' in descriptor ? { ...descriptor, value: wrapper } :
          { configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false, value: wrapper });
        wrappers.push({ name, descriptor, wrapper });
      } catch { /* This context does not expose an overridable method. */ }
    }
  }
  observe(buffer, 'bufferBytes');
  observe(textures, 'textureBytes');
  if (!wrappers.length) return null;

  return {
    read: () => ({ ...totals }),
    methods: wrappers.map(({ name }) => name),
    stop() {
      collecting = false;
      for (const { name, descriptor, wrapper } of wrappers) {
        try {
          if (Object.getOwnPropertyDescriptor(gl, name)?.value !== wrapper) continue;
          if (descriptor) Object.defineProperty(gl, name, descriptor);
          else delete gl[name];
        } catch { /* A context sealed during rendering keeps an inert forwarding wrapper. */ }
      }
      wrappers.length = 0;
    },
  };
}
