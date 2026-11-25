import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createWebAssetServer } from '../server.mjs';
import { computeFilmAvatarCropRect } from '../lib/asset-server.mjs';
import { buildCharacterSheetPrompt } from '../lib/character-image-prompt.mjs';
import { sampleGlb } from './fixtures/sample-glb.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl+6gAAAABJRU5ErkJggg==', 'base64');

async function withServer(options, callback) {
  const server = createWebAssetServer(options);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { await callback('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('standalone website preserves the full character UI and its catalogued references', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webasset-character-page-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const imageRoot = path.join(dir, 'images');
  const characterCatalog = path.join(imageRoot, 'characters', 'index.json');
  const imagePath = 'characters/fixture/images/preview.png';
  await mkdir(path.dirname(path.join(imageRoot, imagePath)), { recursive: true });
  await writeFile(path.join(imageRoot, imagePath), tinyPng);
  await writeFile(characterCatalog, JSON.stringify({ schemaVersion: 3, characters: [{
    id: 'fixture', name: 'Fixture', props: ['Lantern'], personality: [],
    assets: [{ name: 'preview.png', path: imagePath, kind: 'reference' }], generatedAssets: [],
  }] }));
  await withServer({ siteRoot: root, imageRoot, characterCatalog, gamesRoot: path.join(dir, 'games') }, async base => {
    const html = await (await fetch(base)).text();
    assert.match(html, /角色资产/);
    assert.match(html, /id="character-list"/);
    assert.match(html, /data-mode="default"/);
    assert.match(html, /data-mode="humanoid"/);
    assert.match(html, /data-mode="default"[^>]*>影视<\/button>/);
    assert.match(html, /data-mode="humanoid"[^>]*>模型<\/button>/);
    assert.doesNotMatch(html, /默认形态 · 六视图|人形态 · 双视图|>人形<\/button>/);
    assert.match(html, /id="games-view"/);
    assert.match(html, /id="asset-model-section"/);
    assert.match(html, /id="asset-stage-body"/);
    assert.match(html, /data-asset-stage="models"/);
    assert.match(html, /data-asset-stage="gallery"/);
    assert.match(html, /data-asset-stage="settings"/);
    assert.match(html, /id="asset-settings"/);
    const styles = await (await fetch(base + '/css/site.css')).text();
    assert.match(styles, /\.assets-stage-shell\s*\{[^}]*display:\s*flex;/);
    for (const mode of ['high','low','uv']) assert.match(html, new RegExp('class="asset-model-tab character-mode-tab"[^>]*data-model-view="'+mode+'"'));
    assert.doesNotMatch(html, /id="asset-model-upload"|id="asset-model-upload-button"/);
    const three = await fetch(base + '/vendor/three/build/three.module.js');
    assert.equal(three.status, 200);
    assert.match(three.headers.get('content-type'), /javascript/);
    const createDialog = html.match(/<dialog id="character-create-dialog"[\s\S]*?<\/dialog>/)?.[0] || '';
    assert.match(createDialog, /<input name="name"[^>]*required/);
    assert.doesNotMatch(createDialog, /name="(keywords|gender|aliases|props|personality)"|AI 补充资料|网络资料摘要/);
    const response = await fetch(base + '/api/assets?category=characters:all&limit=120');
    assert.equal(response.status, 200);
    const catalog = await response.json();
    assert.equal(catalog.items.length, 1);
    const character = catalog.items[0];
    assert.equal(character.id, 'fixture');
    assert.deepEqual(character.props, ['Lantern']);
    assert.ok(character.assets[0].url.startsWith('/files/images/'));
    const imageResponse = await fetch(base + character.assets[0].url);
    assert.equal(imageResponse.status, 200);
    assert.match(imageResponse.headers.get('content-type'), /^image\//);
    assert.equal((await fetch(base + '/assets/characters/index.json')).status, 404, 'raw catalog should not be exposed');
  });
});

test('model API registers high/low GLBs, serves only registered files and supports replacement', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'webasset-model-test-'));
  const assetRoot=path.join(dir,'assets');
  const catalogFile=path.join(assetRoot,'characters','index.json');
  try {
    await mkdir(path.dirname(catalogFile),{recursive:true});
    await writeFile(catalogFile,JSON.stringify({schemaVersion:3,characters:[{id:'hero',name:'Hero',assets:[],generatedAssets:[],props:[],personality:[]}]}));
    await withServer({siteRoot:root,imageRoot:assetRoot,characterCatalog:catalogFile},async base=>{
      const glb=sampleGlb();
      for(const mode of ['high','low']){
        const response=await fetch(base+`/api/character-models?characterId=hero&mode=${mode}&name=${mode}.glb`,{method:'POST',headers:{'content-type':'model/gltf-binary'},body:glb});
        assert.equal(response.status,201,await response.text().catch(()=>'')); // no mutation of real catalog
      }
      const payload=await (await fetch(base+'/api/assets?category=characters:all')).json();
      const models=payload.items[0].models;
      assert.equal(models.high.name,'high.glb');
      assert.equal(models.low.name,'low.glb');
      assert.match(models.low.url,/^\/files\/models\/characters\/hero\/models\/low-[0-9a-f-]{36}\.glb$/);
      const fileResponse=await fetch(base+models.low.url);
      assert.equal(fileResponse.status,200);
      assert.match(fileResponse.headers.get('content-type'),/model\/gltf-binary/);
      assert.deepEqual(Buffer.from(await fileResponse.arrayBuffer()),glb);
      assert.equal((await fetch(base+'/files/models/characters/hero/models/not-listed.glb')).status,404);
      assert.equal((await fetch(base+'/assets/characters/hero/models/low.glb')).status,404);
      assert.equal((await fetch(base+'/files/models/%2e%2e/%2e%2e/index.json')).status>=400,true);
      const invalid=await fetch(base+'/api/character-models?characterId=hero&mode=high&name=evil.glb',{method:'POST',body:Buffer.from('invalid glb')});
      assert.equal(invalid.status,400);
      const badMode=await fetch(base+'/api/character-models?characterId=hero&mode=uv&name=uv.glb',{method:'POST',body:glb});
      assert.equal(badMode.status,400);
      const externalGlb=sampleGlb({externalImage:true});
      const external=await fetch(base+'/api/character-models?characterId=hero&mode=low&name=external.glb',{method:'POST',body:externalGlb});
      assert.equal(external.status,400);
      assert.equal((await external.json()).error,'EXTERNAL_MODEL_ASSETS');
      const newGlb=sampleGlb({animated:false});
      const replaced=await fetch(base+'/api/character-models?characterId=hero&mode=low&name=updated.glb',{method:'POST',body:newGlb});
      assert.equal(replaced.status,201);
      const updated=(await (await fetch(base+'/api/assets')).json()).items[0].models;
      assert.equal(updated.low.name,'updated.glb');
      assert.equal(updated.high.name,'high.glb');
      assert.equal((await fetch(base+models.low.url)).status,404);
      assert.equal((await fetch(base+updated.high.url)).status,200);
      assert.ok(externalGlb.length);
    });
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('new character creation needs only a name and initializes other fields empty', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webasset-create-test-'));
  const assetRoot = path.join(dir, 'assets');
  const catalogFile = path.join(assetRoot, 'characters', 'index.json');
  try {
    await mkdir(path.dirname(catalogFile), { recursive: true });
    await writeFile(catalogFile, JSON.stringify({ schemaVersion: 3, characters: [] }));
    await withServer({ siteRoot: root, imageRoot: assetRoot, characterCatalog: catalogFile }, async base => {
      const response = await fetch(base + '/api/characters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '新角色' }),
      });
      assert.equal(response.status, 201);
      const { character } = await response.json();
      assert.equal(character.name, '新角色');
      assert.equal(character.gender, '');
      assert.deepEqual(character.keywords, []);
      assert.deepEqual(character.aliases, []);
      assert.deepEqual(character.props, []);
      assert.deepEqual(character.personality, []);
      assert.deepEqual(character.assets, []);
      assert.deepEqual(character.generatedAssets, []);

      const duplicate = await fetch(base + '/api/characters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '新角色' }),
      });
      assert.equal(duplicate.status, 409);

      const secondRes = await fetch(base + '/api/characters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '二号角色' }),
      });
      assert.equal(secondRes.status, 201);

      const renameRes = await fetch(base + '/api/characters', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId: character.id, name: '新角色改名' }),
      });
      assert.equal(renameRes.status, 200);
      const renamedPayload = await renameRes.json();
      assert.equal(renamedPayload.character.id, character.id);
      assert.equal(renamedPayload.character.name, '新角色改名');

      const restRenameRes = await fetch(base + `/api/characters/${encodeURIComponent(character.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Hero Renamed' }),
      });
      assert.equal(restRenameRes.status, 200);
      assert.equal((await restRenameRes.json()).character.name, 'Hero Renamed');

      const caseOnlyRes = await fetch(base + `/api/characters/${encodeURIComponent(character.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'hero renamed' }),
      });
      assert.equal(caseOnlyRes.status, 200);
      assert.equal((await caseOnlyRes.json()).character.name, 'hero renamed');

      const conflictRes = await fetch(base + '/api/characters', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId: character.id, name: '二号角色' }),
      });
      assert.equal(conflictRes.status, 409);
      assert.equal((await conflictRes.json()).error, 'NAME_EXISTS');

      const emptyRes = await fetch(base + '/api/characters', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId: character.id, name: '   ' }),
      });
      assert.equal(emptyRes.status, 400);

      const missingRes = await fetch(base + '/api/characters', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId: 'does-not-exist', name: '其他名字' }),
      });
      assert.equal(missingRes.status, 404);

      const assetsPayload = await (await fetch(base + '/api/assets?category=characters:all')).json();
      assert.equal(assetsPayload.items.find(item => item.id === character.id)?.name, 'hero renamed');
      const snapshot = JSON.parse(await readFile(catalogFile, 'utf8'));
      assert.equal(snapshot.characters.find(item => item.id === character.id)?.name, 'hero renamed');

      const html = await (await fetch(base)).text();
      assert.match(html, /id="character-rename-button"/);
      assert.match(html, /id="character-rename-form"/);
      assert.match(html, /id="character-rename-input"/);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('two generation modes produce different modelling briefs', () => {
  const c = { name: '丑橘', id: 'chouju', props: ['橘子'], personality: ['机灵'] };
  const standard = buildCharacterSheetPrompt(c, { mode: 'default' });
  const humanoid = buildCharacterSheetPrompt(c, { mode: 'humanoid' });
  assert.match(standard, /六视图/);
  assert.match(standard, /猫爪/);
  assert.match(standard, /#333333/);
  assert.match(standard, /严禁纯白/);
  assert.match(humanoid, /前视图/);
  assert.match(humanoid, /侧视图/);
  assert.match(humanoid, /握拳/);
  assert.match(humanoid, /微距分腿防粘连规范/);
  assert.match(humanoid, /微微分开/);
  assert.match(humanoid, /直立|两足|双足/);
  assert.match(humanoid, /#333333/);
  assert.match(humanoid, /严禁纯白/);
  assert.doesNotMatch(humanoid, /四栏六视图/);
  assert.throws(() => buildCharacterSheetPrompt(c, { mode: 'invalid' }), /mode/i);
});

test('all image prompts show only the character and exclude registered weapons and props', () => {
  const prompt = (id, name, props) => buildCharacterSheetPrompt({ id, name, props, personality: [] });
  const props = ['剑', '西瓜', '吸铁石', '一碗白米饭', '菜刀', '盾牌', '西瓜刀', '霰弹枪', '面包', '橘子', '烂生姜'];
  for (const [id, name, characterProps] of [
    ['cat-knight', '猫咪骑士', ['剑']],
    ['haoge', '郝哥', ['西瓜', '吸铁石']],
    ['dafeiyu', '大肥鱼', ['一碗白米饭']],
    ['daodun-dog', '刀盾狗', ['菜刀', '盾牌']],
    ['liuhuaqiang', '刘华强', ['西瓜刀', '霰弹枪']],
    ['character-3dca756f-0ef7-4d03-a008-11decc26c3cc', '杰哥', ['面包']],
    ['chouju', '丑橘', ['橘子', '烂生姜']],
  ]) {
    for (const mode of ['default', 'humanoid']) {
      const generatedPrompt = buildCharacterSheetPrompt({ id, name, props: characterProps }, { mode });
      assert.match(generatedPrompt, /纯角色原则｜最高优先级/);
      assert.match(generatedPrompt, /双手\/前爪自然空置/);
      assert.match(generatedPrompt, /包括参考图中原本拿着、背着、挂着/);
      assert.match(generatedPrompt, /所有斗篷去掉/);
      assert.match(generatedPrompt, /所有长裙改为短裙/);
      assert.match(generatedPrompt, /保留原有袖长，大袖口改为贴臂小袖口（严禁长袖改短袖）/);
      assert.doesNotMatch(generatedPrompt, /所有大袖口统一改为短袖口/);
      for (const prop of props) assert.ok(!generatedPrompt.includes(prop), `${name} ${mode} prompt must not mention ${prop}`);
    }
  }
});

test('generation mode survives storage and does not replace the other form', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webasset-mode-test-'));
  const assetRoot = path.join(dir, 'assets');
  const characterRoot = path.join(assetRoot, 'characters', 'demo');
  const codexHome = path.join(dir, '.codex');
  try {
    await mkdir(path.join(characterRoot, 'images'), { recursive: true });
    await mkdir(path.join(codexHome, 'generated_images'), { recursive: true });
    await writeFile(path.join(characterRoot, 'images', 'ref.png'), tinyPng);
    const catalogFile = path.join(assetRoot, 'characters', 'index.json');
    await writeFile(catalogFile, JSON.stringify({ schemaVersion: 3, characters: [{
      id: 'demo', name: 'Demo', props: [], personality: [], assets: [{
        name: 'ref.png', path: 'characters/demo/images/ref.png', kind: 'reference',
      }], generatedAssets: [],
    }] }));
    const generationPrompts = [];
    const generationReferences = [];
    const generateCharacterImage = async ({ prompt, referencePaths, jobId }) => {
      generationPrompts.push(prompt);
      generationReferences.push(referencePaths);
      const filepath = path.join(codexHome, 'generated_images', jobId + '.png');
      await copyFile(path.join(characterRoot, 'images', 'ref.png'), filepath);
      return { stdout: 'GAMEHUB_GENERATED_IMAGE_PATH=' + filepath };
    };
    await withServer({ siteRoot: root, imageRoot: assetRoot, characterCatalog: catalogFile, codexHome, generateCharacterImage }, async base => {
      const prematureModel = await fetch(base + '/api/character-images/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId: 'demo', mode: 'humanoid' }),
      });
      assert.equal(prematureModel.status, 409);
      assert.equal((await prematureModel.json()).error, 'NO_FILM_IMAGE');
      for (const mode of ['default', 'humanoid']) {
        const start = await fetch(base + '/api/character-images/generate', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ characterId: 'demo', mode }),
        });
        assert.equal(start.status, 202);
        const { job } = await start.json();
        assert.equal(job.mode, mode);
        let done;
        for (let retries = 0; retries < 30; retries += 1) {
          const polled = await (await fetch(base + '/api/character-images/generate?jobId=' + job.id)).json();
          done = polled.job;
          if (done.status === 'completed' || done.status === 'failed') break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(done.status, 'completed', JSON.stringify(done.error));
      }
      assert.match(generationPrompts[0], /六视图/);
      assert.match(generationPrompts[0], /#333333/);
      assert.match(generationPrompts[0], /纯角色原则｜最高优先级/);
      assert.match(generationPrompts[1], /前视图/);
      assert.match(generationPrompts[1], /#333333/);
      assert.match(generationPrompts[1], /纯角色原则｜最高优先级/);
      assert.match(generationPrompts[1], /影视.*唯一外观标准/);
      assert.deepEqual(generationReferences[0], [path.join(characterRoot, 'images', 'ref.png')]);
      const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
      const filmPath = path.join(assetRoot, ...catalog.characters[0].generatedAssets[0].path.split('/'));
      assert.deepEqual(generationReferences[1], [filmPath]);
      assert.deepEqual(catalog.characters[0].generatedAssets.map(item => item.mode), ['default', 'humanoid']);
      const data = await (await fetch(base + '/api/assets')).json();
      assert.deepEqual(data.items[0].generatedAssets.map(item => item.mode), ['default', 'humanoid']);
      const invalid = await fetch(base + '/api/character-images/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ characterId: 'demo', mode: 'unknown' }),
      });
      assert.equal(invalid.status, 400);
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tests workspace exposes Unreal flycam HUD, inspector, and showcase scene modules', async () => {
  await withServer({ siteRoot: root }, async base => {
    const html = await (await fetch(base)).text();
    assert.match(html, /id="tests-view"/);
    assert.match(html, /data-test-cam="fly"[^>]*aria-selected="true"/);
    assert.doesNotMatch(html, /id="hgame-test-lock-cam"/);
    assert.doesNotMatch(html, /id="hgame-test-fly-hud"/);
    assert.match(html, /id="hgame-test-fly-speed"/);
    assert.match(html, /id="hgame-test-help-button"/);
    assert.match(html, /id="hgame-test-inspector"/);
    for (const rel of [
      '/js/unreal-fly-controls.js',
      '/js/hgame-tests.js',
      '/js/test-scenes/showcase-common.js',
      '/js/test-scenes/material-showcase.js',
      '/js/test-scenes/model-showcase.js',
      '/js/test-scenes/decal-foliage-showcase.js',
      '/js/test-scenes/city-rural-showcase.js',
    ]) {
      const res = await fetch(base + rel);
      assert.equal(res.status, 200, `${rel} should be served`);
      assert.match(res.headers.get('content-type') || '', /javascript/);
    }
  });
});

test('character avatar crops a square from the top-left of the film sheet and sidebar uses it first', async () => {
  const rect = computeFilmAvatarCropRect(1774, 887);
  assert.equal(rect.width, rect.height);
  assert.ok(rect.left >= 0 && rect.top >= 0);
  assert.ok(rect.left + rect.width <= 443);
  assert.ok(rect.top + rect.height <= 443);
  assert.deepEqual(computeFilmAvatarCropRect(1, 1), { left: 0, top: 0, width: 1, height: 1 });

  const dir = await mkdtemp(path.join(os.tmpdir(), 'webasset-avatar-test-'));
  const assetRoot = path.join(dir, 'assets');
  const generatedDir = path.join(assetRoot, 'characters', 'hero', 'generated');
  const catalogFile = path.join(assetRoot, 'characters', 'index.json');
  try {
    await mkdir(generatedDir, { recursive: true });
    // Build a 400x200 (2:1) synthetic film sheet whose top-left 100x100 cell is green
    // while the rest of the sheet is blue, so any wrong crop region is immediately caught.
    const sheetW = 400;
    const sheetH = 200;
    const raw = Buffer.alloc(sheetW * sheetH * 4);
    for (let y = 0; y < sheetH; y += 1) {
      for (let x = 0; x < sheetW; x += 1) {
        const idx = (y * sheetW + x) * 4;
        const inTopLeft = x < 100 && y < 100;
        raw[idx] = inTopLeft ? 20 : 30;
        raw[idx + 1] = inTopLeft ? 210 : 40;
        raw[idx + 2] = inTopLeft ? 40 : 220;
        raw[idx + 3] = 255;
      }
    }
    const filmPng = await sharp(raw, { raw: { width: sheetW, height: sheetH, channels: 4 } }).png().toBuffer();
    await writeFile(path.join(generatedDir, 'film.png'), filmPng);
    await writeFile(catalogFile, JSON.stringify({
      schemaVersion: 3,
      characters: [
        {
          id: 'hero',
          name: 'Hero',
          props: [],
          personality: [],
          assets: [],
          generatedAssets: [
            { name: 'film.png', path: 'characters/hero/generated/film.png', kind: 'ai-generated', mode: 'default' },
          ],
        },
        {
          id: 'empty-hero',
          name: 'Empty',
          props: [],
          personality: [],
          assets: [],
          generatedAssets: [],
        },
      ],
    }));

    await withServer({ siteRoot: root, imageRoot: assetRoot, characterCatalog: catalogFile }, async base => {
      const listPayload = await (await fetch(base + '/api/assets?category=characters:all')).json();
      const hero = listPayload.items.find(item => item.id === 'hero');
      const emptyHero = listPayload.items.find(item => item.id === 'empty-hero');
      assert.match(hero.avatarUrl, /^\/api\/character-avatar\?characterId=hero&v=film\.png$/);
      assert.equal(emptyHero.avatarUrl, undefined);

      const avatarRes = await fetch(base + hero.avatarUrl);
      assert.equal(avatarRes.status, 200);
      assert.match(avatarRes.headers.get('content-type') || '', /^image\/png/);
      const avatarBuf = Buffer.from(await avatarRes.arrayBuffer());
      const avatarRaw = await sharp(avatarBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(avatarRaw.info.width, avatarRaw.info.height);
      assert.ok(avatarRaw.info.width >= 80);
      // Sample center pixel: must be green from top-left quadrant, never blue.
      const cx = Math.floor(avatarRaw.info.width / 2);
      const centerIdx = (cx * avatarRaw.info.width + cx) * 4;
      assert.ok(avatarRaw.data[centerIdx + 1] > 180 && avatarRaw.data[centerIdx + 2] < 80);

      assert.equal((await fetch(base + '/api/character-avatar?characterId=empty-hero')).status, 404);
      assert.equal((await fetch(base + '/api/character-avatar?characterId=../etc')).status, 400);

      const siteJs = await (await fetch(base + '/js/site.js')).text();
      assert.match(siteJs, /character\.avatarUrl\s*\|\|\s*character\.assets\?\.\[0\]\?\.url/);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tests workspace exposes global LOD0-LOD3 switcher with manual overrides and distance auto-switch', async () => {
  const html = await readFile(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /<select id="hgame-test-lod">[\s\S]*?<option value="3">LOD3<\/option>/);

  const [testsJs, charShowcaseJs, modelShowcaseJs] = await Promise.all([
    readFile(path.join(root, 'public', 'js', 'hgame-tests.js'), 'utf8'),
    readFile(path.join(root, 'public', 'js', 'test-scenes', 'character-showcase.js'), 'utf8'),
    readFile(path.join(root, 'public', 'js', 'test-scenes', 'model-showcase.js'), 'utf8'),
  ]);

  assert.match(testsJs, /buildCharacterShowcaseScene\(\{[\s\S]*?lodMode:\s*lodSelect\?\.value\s*\|\|\s*'auto'/);
  assert.match(testsJs, /resolveDistanceLodLevel/);
  assert.match(testsJs, /updateActiveModelAutoLod/);
  assert.match(charShowcaseJs, /applyForcedLodToModel\(root,\s*lodMode\)/);
  assert.match(charShowcaseJs, /return\s*\{[\s\S]*?modelRoots,/);
  assert.match(modelShowcaseJs, /detectMeshLodLevel/);
  assert.match(modelShowcaseJs, /export function resolveDistanceLodLevel/);
  assert.match(modelShowcaseJs, /lodMode === '3' \|\| numMode === 3/);
});
