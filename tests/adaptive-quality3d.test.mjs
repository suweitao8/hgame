import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveQualityController, QUALITY3D_PRESETS,
  chooseInitial3dQuality } from '../assets/runtime/integrations/quality3d.js';
import { createGameApplication, defineProject, Scene } from '../assets/runtime/index.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

test('adaptive quality selection is device-aware, deterministic and opt-in', () => {
  assert.equal(chooseInitial3dQuality({ mobile: true }), 'low');
  assert.equal(chooseInitial3dQuality({ rendererName: 'Google SwiftShader' }), 'low');
  assert.equal(chooseInitial3dQuality({ rendererName: 'Intel UHD Graphics 620' }), 'medium');
  assert.equal(chooseInitial3dQuality({ rendererName: 'NVIDIA RTX 4070' }), 'high');
  assert.equal(chooseInitial3dQuality({}), 'medium');
  assert.deepEqual(Object.keys(QUALITY3D_PRESETS), ['low','medium','high','ultra']);
  const manual = createAdaptiveQualityController({ mode: 'high' });
  assert.equal(manual.state.tier, 'high');
  for (let i = 0; i < 500; i++) manual.sampleFrame(55);
  assert.equal(manual.state.tier, 'high', 'user manual setting cannot silently downgrade');
  assert.equal(manual.state.dynamicScale, 1);
  assert.throws(() => createAdaptiveQualityController({ mode: 'insane' }), /mode/i);
  assert.throws(() => createAdaptiveQualityController({ mode: 'auto', minScale: 1.3 }), /scale/i);
});

test('render planning caps 4K HiDPI pixel budgets without touching CSS pixels', () => {
  const quality = createAdaptiveQualityController({
    mode: 'auto', device: { rendererName: 'NVIDIA RTX 4070' },
  });
  assert.equal(quality.state.tier, 'high');
  const viewport = quality.planViewport(3840, 2160, 2.5);
  assert.equal(viewport.cssWidth, 3840);
  assert.equal(viewport.cssHeight, 2160);
  assert.ok(viewport.bufferWidth * viewport.bufferHeight <= QUALITY3D_PRESETS.high.maxPixels + 5000);
  assert.ok(viewport.pixelRatio <= 2);
  assert.ok(viewport.pixelRatio > 0);
  assert.equal(quality.planViewport(320, 200, 1).bufferWidth, 320);
  assert.throws(() => quality.planViewport(-2, 1080, 1), /width/i);
});

test('4K pixel cap is the baseline for each resolution step and downgrade does not increase pixels', () => {
  const controller = createAdaptiveQualityController({
    device: { rendererName: 'NVIDIA RTX 4070' }, settleMs: 0, settleAfterChangeMs: 0, sampleFrames: 2,
  });
  const pixels = (w, h, dpr) => {
    const plan = controller.planViewport(w, h, dpr);
    return plan.bufferWidth * plan.bufferHeight;
  };
  const initial = pixels(3840, 2160, 2);
  controller.sampleFrame(45);
  controller.sampleFrame(45);
  assert.ok(pixels(3840, 2160, 2) < initial * 0.65, 'the first 0.8 scale step saves about 36% of capped pixels');
  controller.sampleFrame(45);
  controller.sampleFrame(45);
  const beforeTierDrop = pixels(960, 540, 1);
  for (let i = 0; i < 4; i++) controller.sampleFrame(45);
  assert.equal(controller.state.tier, 'medium');
  assert.ok(pixels(960, 540, 1) <= beforeTierDrop, 'an overloaded tier change must not increase resolution');
});

test('auto quality honours the configured maximum scale at startup and when re-enabled', () => {
  const controller = createAdaptiveQualityController({ minScale: 0.5, maxScale: 0.7 });
  assert.equal(controller.state.dynamicScale, 0.7);
  controller.setMode('high');
  assert.equal(controller.planViewport(960, 540, 1).bufferWidth, 960, 'manual quality still uses its full budget');
  controller.setMode('auto');
  assert.equal(controller.planViewport(960, 540, 1).bufferWidth, 672);
});

test('slower frame windows reduce render scale, later fast windows recover gradually', () => {
  const quality = createAdaptiveQualityController({
    mode: 'auto', device: { rendererName: 'NVIDIA RTX 4070' },
    settleMs: 0, sampleFrames: 30, settleAfterChangeMs: 0,
  });
  const before = quality.state;
  for (let i = 0; i < 40; i++) quality.sampleFrame(30);
  assert.ok(quality.state.dynamicScale < before.dynamicScale);
  assert.equal(quality.state.tier, 'high');
  const low = quality.state.dynamicScale;
  for (let i = 0; i < 260; i++) quality.sampleFrame(12);
  assert.ok(quality.state.dynamicScale > low, 'recovery needs stable fast frames');
  assert.ok(quality.state.dynamicScale <= 1);
});

test('quality drops only after sustained overload at minimum scale and does not react to tab stalls', () => {
  const quality = createAdaptiveQualityController({
    mode: 'auto', device: { rendererName: 'NVIDIA RTX 4070' },
    minScale: 0.6, settleMs: 0, sampleFrames: 30, settleAfterChangeMs: 0,
  });
  for (let i = 0; i < 300; i++) quality.sampleFrame(45);
  assert.ok(['low','medium'].includes(quality.state.tier));
  const prev = quality.state;
  for (let i = 0; i < 100; i++) quality.sampleFrame(1200);
  assert.equal(quality.state.tier, prev.tier, 'background tab stalls ignored');
  assert.equal(quality.state.dynamicScale, prev.dynamicScale);
  assert.ok(quality.state.droppedLongFrames >= 100);
});

test('3D application is the only RAF scheduler and opt-in quality is fed frame intervals', async () => {
  assert.throws(() => defineProject({
    profile: '2d', features: ['scene','adaptiveQuality3d'],
  }), /3d/i);
  const project = defineProject({
    profile:'3d', tickHz:60, features:['scene','adaptiveQuality3d'],
  });
  const callbacks = [];
  const renderer = {
    qualityController: createAdaptiveQualityController({mode:'low'}),
    render(){}, resize(){}, observed:[],
    recordFrameInterval(ms){this.observed.push(ms)},
  };
  const platform = { input:{reset(){},endFrame(){}},
    lifecycle:{on(){return ()=>{}}}, ready(){}, dispose(){}, diagnostics:{recordFrame(){}} };
  const app = createGameApplication({
    project, platform, renderer,
    requestFrame(callback){callbacks.push(callback);return callbacks.length},
    cancelFrame(){},
  });
  await app.installFeatures();
  assert.equal(app.services.adaptiveQuality3d, renderer.qualityController);
  app.scenes.add(new Scene('level'));
  app.scenes.start('level');
  app.start();
  assert.equal(callbacks.length, 1);
  callbacks.shift()(100);
  callbacks.shift()(116);
  assert.equal(callbacks.length, 1);
  assert.deepEqual(renderer.observed, [16]);
  app.pause();
  assert.equal(callbacks.length, 1);
  app.dispose();

  const missing = createGameApplication({
    project, platform, renderer:{render(){}},
  });
  await assert.rejects(missing.installFeatures(), /quality.*adapter|controller/i);
  missing.dispose();
});

test('Three adapter opts into adaptive quality pixel budgets without affecting legacy default', () => {
  const spy = [];
  class Renderer {
    constructor(){this.lastScale=null}
    setPixelRatio(r){this.lastScale=r;spy.push(['dpr',r])}
    setSize(w,h){spy.push(['size',w,h])}
    render(){}
    dispose(){}
  }
  class Vec {set(){}}
  class Camera { constructor(){this.position=new Vec()}lookAt(){}updateProjectionMatrix(){}}
  class Scene3 {}
  const THREE={ Scene:Scene3, PerspectiveCamera:Camera, WebGLRenderer:Renderer, Color:class{} };
  const canvas={clientWidth:3840,clientHeight:2160};
  const adapter=createThreeAdapter({
    THREE, canvas, width:3840, height:2160, pixelRatio:2,
    quality3d:{mode:'auto',device:{rendererName:'Google SwiftShader'}},
  });
  assert.ok(adapter.qualityController);
  assert.equal(adapter.qualityController.state.tier,'low');
  const capped=adapter.qualityController.planViewport(3840,2160,2);
  assert.ok(spy.find(([tag,scale])=>tag==='dpr'&&scale===capped.pixelRatio));
  adapter.dispose();
  const legacy=createThreeAdapter({THREE,canvas,width:3840,height:2160,pixelRatio:2});
  assert.equal(legacy.qualityController,null);
  assert.equal(legacy.renderer.lastScale,2);
  legacy.dispose();
});

test('adaptive viewport plans keep at least one physical pixel on each axis', () => {
  const controller = createAdaptiveQualityController({ maxScale: 0.8 });
  const viewport = controller.planViewport(1, 540);
  assert.equal(Math.floor(viewport.cssWidth * viewport.pixelRatio), viewport.bufferWidth);
  assert.equal(viewport.bufferWidth, 1);
});

test('the 3D generator writes explicit quality settings outside the WebAsset manifest', async () => {
  const tool = fileURLToPath(new URL('../scripts/create-game.mjs', import.meta.url));
  const temp = await mkdtemp(path.join(os.tmpdir(),'hgame-quality-'));
  try {
    const game = path.join(temp,'opt-in-3d');
    const created = spawnSync(process.execPath, [tool,game,'--profile','3d',
      '--quality','auto','--no-git'], { encoding:'utf8' });
    assert.equal(created.status,0,created.stderr);
    const recipe = JSON.parse(await readFile(path.join(game,'engine.config.json'),'utf8'));
    assert.ok(recipe.features.includes('adaptiveQuality3d'));
    const cfg = JSON.parse(await readFile(path.join(game,'game.config.json'),'utf8'));
    assert.deepEqual(Object.keys(cfg).sort(), ['schemaVersion','id','name','version','entry','renderer','runtime','standalone'].sort());
    const main = await readFile(path.join(game,'src/main.js'),'utf8');
    assert.match(main,/qualityController/);
    assert.match(main,/quality3d/);
    assert.equal(JSON.parse(await readFile(path.join(game,'src/presentation.json'),'utf8')).quality, 'auto');
    const bare = path.join(temp,'bare-low');
    const bareCreated = spawnSync(process.execPath, [tool,bare,'--profile','3d',
      '--quality','low','--bare','--no-git'], { encoding:'utf8' });
    assert.equal(bareCreated.status,0,bareCreated.stderr);
    const bareCfg = JSON.parse(await readFile(path.join(bare,'game.config.json'),'utf8'));
    assert.deepEqual(Object.keys(bareCfg).sort(), Object.keys(cfg).sort());
    assert.equal(JSON.parse(await readFile(path.join(bare,'src/presentation.json'),'utf8')).quality, 'low');
    const gl2d = path.join(temp,'gl2d');
    const glCreated = spawnSync(process.execPath, [tool,gl2d,'--profile','2d',
      '--renderer','webgl2d','--no-git'], { encoding:'utf8' });
    assert.equal(glCreated.status,0,glCreated.stderr);
    assert.equal(JSON.parse(await readFile(path.join(gl2d,'game.config.json'),'utf8')).renderer,'webgl-custom');
    assert.equal(JSON.parse(await readFile(path.join(gl2d,'engine.config.json'),'utf8')).renderer,'webgl2d');
    const generatedTests = spawnSync(process.execPath, ['--test','tests/config.test.mjs'], {cwd:gl2d,encoding:'utf8'});
    assert.equal(generatedTests.status,0,generatedTests.stdout + generatedTests.stderr);
    const disabled = spawnSync(process.execPath, [tool,path.join(temp,'invalid-ui'),
      '--profile','ui','--quality','auto','--no-git'], { encoding:'utf8' });
    assert.notEqual(disabled.status,0);
    assert.match(disabled.stderr,/3d/i);
  } finally {
    await rm(temp,{recursive:true,force:true});
  }
});
