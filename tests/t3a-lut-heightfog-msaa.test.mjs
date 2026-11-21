import assert from 'node:assert/strict';
import test from 'node:test';
import { COLOR_LUT_PRESETS, createColorLutTexture3D } from '../assets/runtime/index.js';
import { COMPOSITE_FRAGMENT_GLSL3 } from '../assets/runtime/integrations/post3d/shaders.js';
import { MOBILE_PORTRAIT_PRESET } from '../assets/runtime/integrations/quality3d.js';

test('Phase T3-A: 3D LUT strip generation covers all presets cleanly with zero THREE dependency', () => {
  assert.deepEqual(COLOR_LUT_PRESETS, ['neutral', 'cinematic', 'vibrant', 'cool-scifi', 'warm-sunset']);
  for (const preset of COLOR_LUT_PRESETS) {
    const lut = createColorLutTexture3D(null, preset, 16);
    assert.equal(lut.width, 256);
    assert.equal(lut.height, 16);
    assert.equal(lut.size, 16);
    assert.equal(lut.preset, preset);
    assert.equal(lut.data.length, 256 * 16 * 4);
    assert.equal(lut.isDataTexture, false);
  }
  const neutral = createColorLutTexture3D(null, 'neutral', 8);
  assert.equal(neutral.width, 64);
  assert.equal(neutral.height, 8);
  assert.equal(neutral.data[0], 0);
  assert.equal(neutral.data[3], 255);

  const vibrant = createColorLutTexture3D(null, 'vibrant', 16);
  // Warm reddish sample (b=0, g=0, r=15 -> idx = (0*256 + 15)*4) preserves saturation
  const redCornerIdx = 15 * 4;
  assert.ok(vibrant.data[redCornerIdx] >= 250);
  assert.ok(vibrant.data[redCornerIdx + 3] === 255);

  // Custom grading curve function
  const inverted = createColorLutTexture3D(null, (r, g, b) => [1 - r, 1 - g, 1 - b], 4);
  assert.equal(inverted.preset, 'custom');
  assert.equal(inverted.data[0], 255);
});

test('Phase T3-A: COMPOSITE_FRAGMENT_GLSL3 includes height fog, 3D LUT sampling, and MOBILE_PORTRAIT_PRESET defaults', () => {
  assert.match(COMPOSITE_FRAGMENT_GLSL3, /uniform float uHeightFogDensity;/);
  assert.match(COMPOSITE_FRAGMENT_GLSL3, /uniform vec3 uHeightFogColor;/);
  assert.match(COMPOSITE_FRAGMENT_GLSL3, /uniform mat4 uInvViewMat;/);
  assert.match(COMPOSITE_FRAGMENT_GLSL3, /uniform sampler2D tColorLut;/);
  assert.match(COMPOSITE_FRAGMENT_GLSL3, /uniform float uLutIntensity;/);
  assert.match(COMPOSITE_FRAGMENT_GLSL3, /vec3 sampleStripLut\(/);

  assert.equal(MOBILE_PORTRAIT_PRESET.msaaSamples, 4);
  assert.equal(MOBILE_PORTRAIT_PRESET.colorLut, 'vibrant');
  assert.equal(MOBILE_PORTRAIT_PRESET.heightFog.density, 0.012);
});
