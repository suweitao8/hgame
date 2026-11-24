import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { benchmarkBrowserOptions } from '../scripts/lib/browser-benchmark.mjs';

const { values } = parseArgs({ options: { chrome: { type: 'string' } } });
const browser = await chromium.launch(benchmarkBrowserOptions('software', values.chrome ?? process.env.HGAME_CHROME));
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://hgame-shader.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>HDR shader probe</title>' });
    if (!pathname.startsWith('/assets/')) return route.fulfill({ status: 404 });
    try {
      const body = await readFile(new URL('..' + pathname, import.meta.url));
      await route.fulfill({ contentType: 'text/javascript', body });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
  await page.goto('http://hgame-shader.test/');
  const captures = await page.evaluate(async () => {
    const THREE = await import('/assets/optional/three/three.module.js');
    const { createFullscreenShaderPass, createPostPipeline3D } = await import('/assets/runtime/integrations/post3d.js');
    const { createDecalSystem3D } = await import('/assets/runtime/integrations/decal3d.js');
    const { QUALITY3D_PRESETS } = await import('/assets/runtime/integrations/quality3d.js');
    const width = 64;
    const height = 32;
    const world = new THREE.Scene();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(16, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.35, 0.65), toneMapped: false }));
    plane.position.z = -4;
    world.add(plane);
    const texture = colorSpace => {
      const result = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
      result.colorSpace = colorSpace;
      result.needsUpdate = true;
      return result;
    };
    const albedo = texture(THREE.SRGBColorSpace);
    const mask = texture(THREE.NoColorSpace);
    const depthPass = createFullscreenShaderPass(THREE, {
      id: 'depth', sceneDepth: true,
      fragment: `vec4 shadeFullscreen(vec2 uv) {
        return vec4(hgameSceneEyeDepth(uv) / 8.0, hgameSceneLinearDepth(uv),
          hgameSceneDepthRaw(uv), hgameSceneColor(uv).g);
      }`,
    });
    const texturePass = createFullscreenShaderPass(THREE, {
      id: 'texture', uniforms: { albedo: { value: albedo }, mask: { value: mask } },
      fragment: `uniform sampler2D albedo;
      uniform sampler2D mask;
      vec4 shadeFullscreen(vec2 uv) {
        return vec4(hgameSceneColor(uv).r, texture(albedo, uv).r, texture(mask, uv).r,
          hgameScreenPixels().x / 64.0);
      }`,
    });
    const perspective = new THREE.PerspectiveCamera(55, width / height, 1, 20);
    const ortho = new THREE.OrthographicCamera(-4, 4, 2, -2, 1, 20);
    function renderCases(renderer, cameras) {
      renderer.setSize(width, height);
      const pipeline = createPostPipeline3D({ THREE, renderer, width, height,
        preset: QUALITY3D_PRESETS.low, fxaa: false, sharpness: 0, passes: [depthPass, texturePass] });
      const results = cameras.map(camera => {
        const pixels = {};
        pipeline.render(world, camera, { diagnostics: { beginPass(name, target) {
          if (name !== 'custom:depth' && name !== 'custom:texture') return () => {};
          return () => {
            const half = target.texture.type === THREE.HalfFloatType;
            const rgba = half ? new Uint16Array(4) : new Uint8Array(4);
            renderer.readRenderTargetPixels(target, 32, 16, 1, 1, rgba);
            pixels[name] = Array.from(rgba, value => half ? THREE.DataUtils.fromHalfFloat(value) : value / 255);
          };
        }, recordTarget() {} } });
        return pixels;
      });
      pipeline.dispose();
      return results;
    }
    function sampleProjectedDecal(renderer, camera) {
      const pipeline = createPostPipeline3D({ THREE, renderer, width, height, preset: QUALITY3D_PRESETS.low });
      const decals = createDecalSystem3D(THREE, { mode: 'projected', maxDecals: 1 });
      try {
        decals.spawn({ position: [0, 0, -4], normal: [0, 0, 1], size: [2, 2, 2], color: 0xff0000 });
        pipeline.render(world, camera, { projectedDecals: [decals] });
        const gl = renderer.getContext();
        const rgba = new Uint8Array(4);
        gl.readPixels(width / 2, height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        return { rgba: Array.from(rgba), glError: gl.getError() };
      } finally {
        decals.dispose();
        pipeline.dispose();
      }
    }
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    const normal = renderCases(renderer, [perspective, ortho]);
    const normalDecal = sampleProjectedDecal(renderer, perspective);
    renderer.dispose();
    const reversed = new THREE.WebGLRenderer({ antialias: false, reversedDepthBuffer: true });
    const reversedDepth = reversed.capabilities.reversedDepthBuffer ? renderCases(reversed, [perspective])[0] : null;
    const reversedDecal = reversedDepth ? sampleProjectedDecal(reversed, perspective) : null;
    reversed.dispose();
    depthPass.material.dispose();
    texturePass.material.dispose();
    albedo.dispose();
    mask.dispose();
    plane.material.dispose();
    plane.geometry.dispose();
    return { normal, reversedDepth, normalDecal, reversedDecal };
  });
  console.log(JSON.stringify({ captures, errors }, null, 2));
  assert.deepEqual(errors, []);
  function near(actual, expected, description) {
    assert.ok(actual?.every((value, i) => Math.abs(value - expected[i]) < 0.006), description);
  }
  near(captures.normal[0]['custom:depth'], [0.5, 0.2, 15 / 19, 0.35], 'perspective scene depth and linear HDR color');
  near(captures.normal[1]['custom:depth'], [0.5, 0.2, 3 / 19, 0.35], 'orthographic scene depth and linear HDR color');
  for (const result of captures.normal) {
    near(result['custom:texture'], [0.5, 0.21586, 128 / 255, 32.5 / 64], 'HDR chain input, color-space decode, and pixel coordinates');
  }
  if (captures.reversedDepth) {
    near(captures.reversedDepth['custom:depth'], [0.5, 0.2, 4 / 19, 0.35], 'reversed scene depth retains linear eye distance');
    assert.deepEqual(captures.reversedDecal, captures.normalDecal, 'reversed depth preserves the final decal color');
  }
  const [red, green, blue] = captures.normalDecal.rgba;
  assert.ok(red > Math.max(green, blue) + 100);
  assert.equal(captures.normalDecal.glError, 0);
} finally {
  await browser.close();
}
