/**
 * @typedef {object} FullscreenPassContract
 * @property {string} name Diagnostic pass name.
 * @property {readonly string[]} reads Required sampler uniforms.
 * @property {readonly string[]} [optional] Sampler uniforms with a shader fallback.
 * @property {'screen' | 'color' | 'color-depth' | 'color-or-screen'} writes Writable framebuffer attachments.
 */

/** @type {Readonly<Record<string, FullscreenPassContract>>} */
export const FULLSCREEN_PASSES = {
  aoVolumetrics: { name: 'ao-volumetrics', reads: ['tDepth'], optional: ['tSunShadow'], writes: 'color' },
  aoBlurX: { name: 'ao-volumetrics-blur-x', reads: ['tInput'], writes: 'color' },
  aoBlurY: { name: 'ao-volumetrics-blur-y', reads: ['tInput'], writes: 'color' },
  giSsr: { name: 'gi-ssr', reads: ['tScene', 'tDepth'], writes: 'color' },
  giSsrBlurX: { name: 'gi-ssr-blur-x', reads: ['tInput'], writes: 'color' },
  giSsrBlurY: { name: 'gi-ssr-blur-y', reads: ['tInput'], writes: 'color' },
  giSsrTemporal: { name: 'gi-ssr-temporal', reads: ['tInput', 'tSceneDepth', 'tHistory'], writes: 'color' },
  projectedDecalsCopy: { name: 'projected-decals-copy', reads: ['tInput'], writes: 'color' },
  worldLighting: { name: 'world-lighting', reads: ['tScene'], optional: ['tDepth', 'tAoVol', 'tGiSsr'], writes: 'color' },
  temporalAA: { name: 'temporal-aa', reads: ['tCurrentColor', 'tCurrentDepth'],
    optional: ['tPreviousColor', 'tPreviousDepth', 'tMotionVectors'], writes: 'color-depth' },
  luminance: { name: 'luminance', reads: ['tScene'], writes: 'color' },
  luminanceDown: { name: 'luminance-downsample', reads: ['tSource'], writes: 'color' },
  eyeAdaptation: { name: 'eye-adaptation', reads: ['tLogLuma', 'tPrevAdapt'], writes: 'color' },
  bloomPrefilter: { name: 'bloom-prefilter', reads: ['tSource'], writes: 'color' },
  bloomDown: { name: 'bloom-downsample', reads: ['tSource'], writes: 'color' },
  bloomUp: { name: 'bloom-upsample', reads: ['tLower', 'tUpper'], writes: 'color' },
  toneMapping: { name: 'tone-mapping', reads: ['tScene'],
    optional: ['tDepth', 'tAoVol', 'tGiSsr', 'tBloom', 'tAutoExposure'], writes: 'color-or-screen' },
  fxaaSharpen: { name: 'fxaa-sharpen', reads: ['tDiffuse'], writes: 'screen' },
};

/**
 * @param {FullscreenPassContract} pass
 * @param {Record<string, {value: unknown}>} uniforms
 * @param {{texture?: unknown, depthTexture?: unknown} | null} target
 */
export function validateFullscreenPass(pass, uniforms, target) {
  const { name, reads, optional, writes } = pass;
  if ((writes === 'screen' && target) ||
      (writes === 'color' && !target?.texture) ||
      (writes === 'color-or-screen' && target && !target.texture) ||
      (writes === 'color-depth' && (!target?.texture || !target.depthTexture))) {
    throw new Error(`${name} has no compatible ${writes} output`);
  }
  for (const input of reads) {
    const texture = uniforms[input]?.value;
    if (!texture) throw new Error(`${name} requires ${input}`);
    if (target && (texture === target.texture || texture === target.depthTexture)) {
      throw new Error(`${name} samples its own output through ${input}`);
    }
  }
  if (!target || !optional) return;
  for (const input of optional) {
    const texture = uniforms[input]?.value;
    if (texture && (texture === target.texture || texture === target.depthTexture)) {
      throw new Error(`${name} samples its own output through ${input}`);
    }
  }
}
