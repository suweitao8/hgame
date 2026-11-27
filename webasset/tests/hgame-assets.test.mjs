import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebAssetServer } from '../server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function makeMinimalGlb(jsonObj = {
  asset: { version: '2.0' },
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  buffers: [{ byteLength: 4 }],
}) {
  const jsonText = JSON.stringify(jsonObj);
  const padLen = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
  const jsonBuf = Buffer.from(jsonText + ' '.repeat(padLen), 'utf8');
  const binBuf = Buffer.alloc(4);
  const totalLen = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const out = Buffer.alloc(totalLen);
  out.write('glTF', 0, 'ascii');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.write('JSON', 16, 'ascii');
  jsonBuf.copy(out, 20);
  const binStart = 20 + jsonBuf.length;
  out.writeUInt32LE(binBuf.length, binStart);
  out.writeUInt32LE(0x004e4942, binStart + 4);
  binBuf.copy(out, binStart + 8);
  return out;
}

function makeMinimalPng() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

function makeMinimalWav() {
  const dataSize = 8;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(44100, 24);
  buf.writeUInt32LE(88200, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

async function runWithHGameServer(callback, { cnFixture = false } = {}) {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'webasset-hgame-'));
  const hgameAssetRoot = path.join(tmpRoot, 'hgame-assets');
  const materialLibraryRoot = path.join(tmpRoot, 'curated-materials');
  const unrealExportRoot = path.join(tmpRoot, 'unreal-export');
  const anim23Root = path.join(tmpRoot, 'anim23');
  await mkdir(path.join(anim23Root, '_AnimDaily', 'MaleLocomotionSet'), { recursive: true });
  await writeFile(path.join(anim23Root, '_AnimDaily', 'MaleLocomotionSet', 'A_INP_Idle.glb'), makeMinimalGlb());
  await writeFile(
    path.join(anim23Root, 'catalog.json'),
    JSON.stringify({
      version: 3,
      rig: 'humanoid_23',
      animations: [
        {
          id: 'MaleLocomotionSet__A_INP_Idle',
          name: 'Idle',
          assetName: 'A_INP_Idle',
          pack: 'MaleLocomotionSet',
          sourceCategory: '_AnimDaily',
          category: '待机站姿',
          rig: 'humanoid_23',
          motionType: 'IP',
          clipType: 'action',
          loop: true,
          duration: 1.5,
          bytes: 400,
          url: '/files/hgame-anim23/_AnimDaily/MaleLocomotionSet/A_INP_Idle.glb',
        },
      ],
    }),
  );
  await mkdir(path.join(materialLibraryRoot, 'textures'), { recursive: true });
  await mkdir(path.join(materialLibraryRoot, 'thumbnails'), { recursive: true });
  await mkdir(path.join(unrealExportRoot, 'characters'), { recursive: true });
  await mkdir(path.join(unrealExportRoot, 'attachments'), { recursive: true });
  await mkdir(path.join(unrealExportRoot, 'animations'), { recursive: true });
  await mkdir(path.join(unrealExportRoot, 'static_models'), { recursive: true });
  await mkdir(path.join(unrealExportRoot, 'vfx_meshes'), { recursive: true });
  await mkdir(path.join(unrealExportRoot, 'vfx_textures'), { recursive: true });
  await mkdir(path.join(unrealExportRoot, 'materials'), { recursive: true });
  await mkdir(path.join(unrealExportRoot, 'decals'), { recursive: true });
  await mkdir(path.join(unrealExportRoot, 'audio'), { recursive: true });

  const sampleGlb = makeMinimalGlb();
  const samplePng = makeMinimalPng();
  const sampleWebp = Buffer.from('RIFF\x18\x00\x00\x00WEBPVP8 \x0c\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00', 'ascii');
  const sampleWav = makeMinimalWav();
  await writeFile(path.join(unrealExportRoot, 'characters', 'PolygonAdventure__Knight.glb'), sampleGlb);
  await writeFile(path.join(unrealExportRoot, 'attachments', 'Polygon_BattleRoyale__SM_Chr_Attach_Male_Hair_01.glb'), sampleGlb);
  await writeFile(path.join(unrealExportRoot, 'animations', 'MaleLocomotion__Idle.glb'), sampleGlb);
  await writeFile(path.join(unrealExportRoot, 'static_models', 'PolygonAdventure__SM_Prop_Stall_Table_01.glb'), sampleGlb);
  await writeFile(path.join(unrealExportRoot, 'vfx_meshes', 'VFXMesh__SM_Aura.glb'), sampleGlb);
  await writeFile(path.join(unrealExportRoot, 'vfx_textures', 'FlyingMageAnimSet__T_Circle_4Seq_ST.png'), samplePng);
  await writeFile(path.join(unrealExportRoot, 'materials', 'topscan-floorpaving-02_color.webp'), sampleWebp);
  await writeFile(path.join(unrealExportRoot, 'materials', 'topscan-floorpaving-02_normal.png'), samplePng);
  await writeFile(path.join(unrealExportRoot, 'materials', 'topscan-floorpaving-02_orm.png'), samplePng);
  await writeFile(path.join(unrealExportRoot, 'materials', 'topscan-floorpaving-02_thumb.webp'), sampleWebp);
  await writeFile(path.join(unrealExportRoot, 'decals', 'Concrete_Decals__MI_bullet_01_color.png'), samplePng);
  await writeFile(path.join(unrealExportRoot, 'decals', 'Concrete_Decals__MI_bullet_01_normal.png'), samplePng);
  await writeFile(path.join(unrealExportRoot, 'decals', 'Concrete_Decals__MI_bullet_01_orm.png'), samplePng);
  await writeFile(path.join(unrealExportRoot, 'decals', 'Concrete_Decals__MI_bullet_01_thumb.webp'), sampleWebp);
  await writeFile(path.join(unrealExportRoot, 'audio', 'Anim58__Collapse01.wav'), sampleWav);
  await writeFile(path.join(unrealExportRoot, 'characters', 'secret.uasset'), Buffer.from('nope'));
  await writeFile(
    path.join(unrealExportRoot, 'catalog.json'),
    JSON.stringify({
      version: 2,
      generatedAt: '2026-11-16T00:00:00.000Z',
      characters: [
        {
          id: 'PolygonAdventure__Knight',
          name: 'Knight',
          pack: 'PolygonAdventure',
          packLabel: '奇幻冒险 Adventure',
          boneCount: 68,
          headAttachment: {
            id: 'Polygon_BattleRoyale__SM_Chr_Attach_Male_Hair_01',
            name: '短发 01',
            url: '/files/hgame-unreal/attachments/Polygon_BattleRoyale__SM_Chr_Attach_Male_Hair_01.glb',
            groundPivot: false,
          },
          bytes: sampleGlb.length,
          url: '/files/hgame-unreal/characters/PolygonAdventure__Knight.glb',
        },
      ],
      animations: [
        {
          id: 'MaleLocomotion__Idle',
          name: '站立待机 Idle',
          category: '基础待机',
          loop: true,
          duration: 2.7,
          bytes: sampleGlb.length,
          url: '/files/hgame-unreal/animations/MaleLocomotion__Idle.glb',
        },
      ],
      staticModels: [
        {
          id: 'PolygonAdventure__SM_Prop_Stall_Table_01',
          name: 'Stall Table 01',
          pack: 'PolygonAdventure',
          packLabel: '奇幻冒险 Adventure',
          category: '家具桌椅',
          meshCount: 1,
          bytes: sampleGlb.length,
          url: '/files/hgame-unreal/static_models/PolygonAdventure__SM_Prop_Stall_Table_01.glb',
        },
      ],
      vfxSystems: [
        {
          id: 'SpecialMoves_Energy__NS_Aura',
          name: 'Aura',
          assetName: 'NS_Aura',
          pack: 'SpecialMoves_Energy',
          sourceType: 'niagara',
          kind: 'system',
          category: '法阵与护盾',
          loop: true,
          duration: 0.6,
          emitterCount: 1,
          emitters: [
            {
              name: 'Aura_Inside',
              renderer: 'sprite',
              facing: 'billboard',
              shape: 'glow',
              blend: 'additive',
              spawnRate: 20,
              burstCount: 0,
              lifetimeMin: 0.3,
              lifetimeMax: 0.6,
              sizeStart: 0.25,
              sizeEnd: 0.05,
              velMin: [-0.2, 0.5, -0.2],
              velMax: [0.2, 1.2, 0.2],
              gravity: 0,
              drag: 0.5,
              spawnRadius: 0.4,
              colorStart: '#60a5fa',
              colorEnd: '#2563eb',
              subUV: [1, 1],
              textureUrl: null,
              meshUrl: null,
            },
          ],
          hgamePreset: {
            recipe: 'telegraph',
            element: 'physical',
            color: '#60a5fa',
            colorInt: 0x60a5fa,
            shapeId: 3,
            count: 16,
            speedMin: 1.5,
            speedMax: 4.0,
            sizeStart: 0.3,
            sizeEnd: 0.05,
            durationMin: 0.3,
            durationMax: 0.6,
            gravity: 0,
            drag: 0.5,
            additive: true,
            meshUrl: null,
          },
        },
      ],
      vfxMeshes: [
        {
          id: 'VFXMesh__SM_Aura',
          name: '3D 能量护盾环 SM_Aura',
          kind: 'mesh',
          category: '3D 特效网格',
          meshCount: 1,
          bytes: sampleGlb.length,
          url: '/files/hgame-unreal/vfx_meshes/VFXMesh__SM_Aura.glb',
        },
      ],
      vfxTextures: [
        {
          id: 'FlyingMageAnimSet__T_Circle_4Seq_ST',
          name: 'T_Circle_4Seq_ST',
          kind: 'flipbook',
          category: '法阵光环',
          columns: 2,
          rows: 2,
          frameCount: 4,
          fps: 8,
          blend: 'additive',
          bytes: samplePng.length,
          url: '/files/hgame-unreal/vfx_textures/FlyingMageAnimSet__T_Circle_4Seq_ST.png',
        },
      ],
      materials: [
        {
          id: 'topscan-floorpaving-02',
          name: 'FloorPaving 02',
          category: 'masonry',
          sourcePackage: 'TopScan_Library',
          tileSize: 1,
          projection: 'triplanar',
          color: '/files/hgame-unreal/materials/topscan-floorpaving-02_color.webp',
          normal: '/files/hgame-unreal/materials/topscan-floorpaving-02_normal.png',
          orm: '/files/hgame-unreal/materials/topscan-floorpaving-02_orm.png',
          thumbnail: '/files/hgame-unreal/materials/topscan-floorpaving-02_thumb.webp',
        },
      ],
      decals: [
        {
          id: 'Concrete_Decals__MI_bullet_01',
          name: 'bullet 01',
          assetName: 'MI_bullet_01',
          pack: 'Concrete_Decals',
          packLabel: '混凝土贴花 Concrete',
          category: '弹孔',
          color: '/files/hgame-unreal/decals/Concrete_Decals__MI_bullet_01_color.png',
          normal: '/files/hgame-unreal/decals/Concrete_Decals__MI_bullet_01_normal.png',
          orm: '/files/hgame-unreal/decals/Concrete_Decals__MI_bullet_01_orm.png',
          thumbnail: '/files/hgame-unreal/decals/Concrete_Decals__MI_bullet_01_thumb.webp',
        },
      ],
      audio: [
        {
          id: 'Anim58__Collapse01',
          name: 'Collapse01',
          category: '环境与爆破',
          bytes: sampleWav.length,
          url: '/files/hgame-unreal/audio/Anim58__Collapse01.wav',
        },
      ],
    }),
  );

  const hashHex = 'a'.repeat(64);
  const pngBytes = makeMinimalPng();
  await writeFile(path.join(materialLibraryRoot, 'textures', `${hashHex}.png`), pngBytes);
  await writeFile(path.join(materialLibraryRoot, 'thumbnails', 'stone-wall.png'), pngBytes);
  await writeFile(
    path.join(materialLibraryRoot, 'catalog.json'),
    JSON.stringify({
      version: 1,
      materials: [
        {
          id: 'stone-wall',
          name: 'Stone Wall',
          category: 'Brick & Stone',
          tileSize: 1.5,
          projection: 'triplanar',
          color: `textures/${hashHex}.png`,
          normal: `textures/${hashHex}.png`,
          orm: `textures/${hashHex}.png`,
          thumbnail: 'thumbnails/stone-wall.png',
        },
      ],
    }),
  );

  const siteRoot = cnFixture ? tmpRoot : root;
  if (cnFixture) {
    await mkdir(path.join(siteRoot, 'public'));
    await copyFile(path.join(root, 'public', 'index.html'), path.join(siteRoot, 'public', 'index.html'));
    const built = path.join(siteRoot, 'hgame-assets-cn', 'built');
    const material = { slot: '__missing__', layer: 0, alphaCutout: false, blendMode: 'opaque' };
    const model = { path: 'models/fixture.glb', lods: [0], bounds: { boundingSphereRadius: 1 } };
    const fixture = {
      'catalog.json': JSON.stringify({ models: [model], materials: [material] }),
      'materials/material_table.json': JSON.stringify({ pipeline: '2-map-pbr', layerCount: 1, materials: [material] }),
      'foliage/foliage_table.json': JSON.stringify({ slots: ['fixture'] }),
      'decals/decals_table.json': JSON.stringify({ atlases: ['fixture'] }),
      'foliage/foliage_albedo.png': samplePng,
      'decals/cn_shop_signs_color.png': samplePng,
      'materials/water_normal.png': samplePng,
      'models/fixture.glb': sampleGlb,
      'audio/streams/seek.mp3': '0123456789',
    };
    for (const size of [256, 512]) {
      fixture['materials/' + size + '/albedo_array.webp'] = sampleWebp;
      fixture['materials/' + size + '/normal_rm_array.webp'] = sampleWebp;
    }
    for (const [relativePath, contents] of Object.entries(fixture)) {
      const target = path.join(built, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
  }
  const server = createWebAssetServer({
    siteRoot,
    gamesRoot: path.join(tmpRoot, 'games'),
    htmlGamesRoot: path.join(tmpRoot, 'html-games'),
    hgameAssetRoot,
    dbPath: path.join(tmpRoot, 'assets.db'),
    materialLibraryRoot,
    unrealExportRoot,
    anim23Root,
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    await callback(`http://127.0.0.1:${server.address().port}`, {
      tmpRoot,
      hgameAssetRoot,
      materialLibraryRoot,
      unrealExportRoot,
      sampleGlb,
    });
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

test('HTML exposes all 8+1 workspaces and HGame module scripts', async () => {
  await runWithHGameServer(async base => {
    const html = await (await fetch(base)).text();
    for (const tab of ['characters', 'games', 'models', 'animations', 'vfx', 'materials', 'audio', 'music', 'tests']) {
      assert.match(html, new RegExp(`data-workspace="${tab}"`));
    }
    for (const id of ['models-view', 'animations-view', 'vfx-view', 'materials-view', 'audio-view', 'music-view', 'tests-view']) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    for (const script of ['hgame-models.js', 'hgame-animations.js', 'hgame-vfx.js', 'hgame-materials.js', 'hgame-audio.js', 'hgame-music.js', 'hgame-tests.js']) {
      assert.match(html, new RegExp(script));
    }
    assert.doesNotMatch(html, /id="hgame-anim-2d-pane"/);
  });
});

test('WebAsset serves byte ranges for library audio and imported audio', async () => {
  await runWithHGameServer(async (base) => {
    const response = await fetch(base + '/assets/cn/audio/streams/seek.mp3', {
      headers: { Range: 'bytes=3-5' },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-range'), 'bytes 3-5/10');
    assert.equal(response.headers.get('content-length'), '3');
    assert.equal(await response.text(), '345');

    const sampleWav = makeMinimalWav();
    const upload = await fetch(base + '/api/hgame/audio?name=seek.wav&category=bgm', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: sampleWav,
    });
    assert.equal(upload.status, 201);
    const { item } = await upload.json();
    const imported = await fetch(base + item.url, { headers: { Range: 'bytes=0-3' } });
    assert.equal(imported.status, 206);
    assert.equal(imported.headers.get('content-range'), `bytes 0-3/${sampleWav.length}`);
    assert.equal(await imported.text(), 'RIFF');
  }, { cnFixture: true });
});

test('HGame asset API disables static models/materials and serves procedural .hmat/.hmesh recipes', async () => {
  await runWithHGameServer(async base => {
    const initial = await (await fetch(`${base}/api/hgame/assets`)).json();
    assert.equal(initial.schemaVersion, 1);
    assert.equal(initial.curatedMaterialsAvailable, false);
    assert.deepEqual(initial.models, []);
    assert.deepEqual(initial.materials, []);

    // 1. Static GLB model & PNG material uploads are disabled
    const badModelRes = await fetch(`${base}/api/hgame/models?name=crate.glb`, {
      method: 'POST',
      body: makeMinimalGlb(),
    });
    assert.equal(badModelRes.status, 404);

    const staticTexRes = await fetch(`${base}/api/hgame/materials/textures?name=albedo.png&channel=color`, {
      method: 'POST',
      body: makeMinimalPng(),
    });
    assert.equal(staticTexRes.status, 404);

    const curatedRes = await fetch(`${base}/api/hgame/materials/curated`);
    assert.equal(curatedRes.status, 200);
    const curatedData = await curatedRes.json();
    assert.equal(curatedData.available, false);
    assert.deepEqual(curatedData.materials, []);

    // 2. Spritesheet upload + PATCH update + validation
    const badPngRes = await fetch(`${base}/api/hgame/spritesheets?name=hero.png`, {
      method: 'POST',
      body: Buffer.from('NOTPNG'),
    });
    assert.equal(badPngRes.status, 400);

    const sheetRes = await fetch(`${base}/api/hgame/spritesheets?name=hero.png&columns=4&rows=2&fps=12&inset=1`, {
      method: 'POST',
      body: makeMinimalPng(),
    });
    assert.equal(sheetRes.status, 201);
    const { item: sheetItem } = await sheetRes.json();
    assert.equal(sheetItem.columns, 4);
    assert.equal(sheetItem.rows, 2);

    const patchRes = await fetch(`${base}/api/hgame/spritesheets/${sheetItem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: 6, fps: 15, loop: false }),
    });
    assert.equal(patchRes.status, 200);
    const { item: patchedSheet } = await patchRes.json();
    assert.equal(patchedSheet.columns, 6);
    assert.equal(patchedSheet.fps, 15);
    assert.equal(patchedSheet.loop, false);

    // 3. Phase 0: procedural .hmat/.hmesh endpoints disabled (404), replaced by hgame-assets-cn v4.1
    assert.equal((await fetch(`${base}/api/hgame/procedural/manifest`)).status, 404);
    assert.equal((await fetch(`${base}/api/hgame/procedural/materials`, { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await fetch(`${base}/files/procedural/manifest.json`)).status, 404);

    // 3b. hgame-assets-cn catalog, synthetic PBR catalog, material table, grid atlases, decals, foliage and model
    const cnCatRes = await fetch(`${base}/api/hgame/cn/catalog`);
    assert.equal(cnCatRes.status, 200);
    const cnCat = await cnCatRes.json();
    assert.equal(cnCat.available, true);
    assert.equal(cnCat.models.length, 1);
    assert.ok(cnCat.materials.length >= 1);

    const pbrTableRes = await fetch(`${base}/assets/cn/materials/material_table.json`);
    assert.equal(pbrTableRes.status, 200);
    const pbrTable = await pbrTableRes.json();
    assert.equal(pbrTable.pipeline, '2-map-pbr');
    assert.equal(pbrTable.layerCount, cnCat.materials.length);
    assert.equal(pbrTable.materials[0].slot, '__missing__');
    assert.equal(pbrTable.materials[0].layer, 0);
    for (const mat of pbrTable.materials) {
      assert.equal(mat.alphaCutout, false, `Unexpected alphaCutout material: ${mat.slot}`);
      if (mat.blendMode === 'translucent') {
        assert.match(mat.slot, /glass/i, `Only glass materials may be translucent: ${mat.slot}`);
      }
    }
    for (const res of [512, 256]) {
      for (const map of ['albedo_array.webp', 'normal_rm_array.webp']) {
        const atlasRes = await fetch(`${base}/assets/cn/materials/${res}/${map}`);
        assert.equal(atlasRes.status, 200, `Expected /assets/cn/materials/${res}/${map} to be served`);
      }
    }

    const folTableRes = await fetch(`${base}/assets/cn/foliage/foliage_table.json`);
    assert.equal(folTableRes.status, 200);
    const folTable = await folTableRes.json();
    assert.deepEqual(folTable.slots, ['fixture']);
    assert.equal((await fetch(`${base}/assets/cn/foliage/foliage_albedo.png`)).status, 200);

    const decTableRes = await fetch(`${base}/assets/cn/decals/decals_table.json`);
    assert.equal(decTableRes.status, 200);
    const decTable = await decTableRes.json();
    assert.deepEqual(decTable.atlases, ['fixture']);
    assert.equal((await fetch(`${base}/assets/cn/decals/cn_shop_signs_color.png`)).status, 200);
    assert.equal((await fetch(`${base}/assets/cn/materials/water_normal.png`)).status, 200);
    assert.equal((await fetch(`${base}/assets/cn/${cnCat.models[0].path}`)).status, 200);
    assert.ok(Array.isArray(cnCat.models[0].lods) && cnCat.models[0].lods.length >= 1);
    assert.ok(cnCat.models[0].bounds?.boundingSphereRadius > 0);

    // 4. Legacy /api/hgame/vfx & /api/hgame/materials endpoints remain 404, while VFX review persistence works cleanly
    const vfxRes = await fetch(`${base}/api/hgame/vfx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
    assert.equal(vfxRes.status, 404);

    const badReviewRes = await fetch(`${base}/api/hgame/vfx/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '../bad', approved: true }),
    });
    assert.equal(badReviewRes.status, 400);

    const reviewApproveRes = await fetch(`${base}/api/hgame/vfx/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'arpg_realistic_paladin_pack__arpg_paladin_shock_calling', approved: true }),
    });
    assert.equal(reviewApproveRes.status, 200);
    const reviewApproveBody = await reviewApproveRes.json();
    assert.equal(reviewApproveBody.ok, true);
    assert.ok(reviewApproveBody.reviewedIds.includes('arpg_realistic_paladin_pack__arpg_paladin_shock_calling'));

    const vfxCatApproved = await (await fetch(`${base}/api/hgame/vfx/catalog`)).json();
    assert.ok(vfxCatApproved.reviewedIds.includes('arpg_realistic_paladin_pack__arpg_paladin_shock_calling'));

    const reviewRevertRes = await fetch(`${base}/api/hgame/vfx/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'arpg_realistic_paladin_pack__arpg_paladin_shock_calling', approved: false }),
    });
    assert.equal(reviewRevertRes.status, 200);
    const reviewRevertBody = await reviewRevertRes.json();
    assert.equal(reviewRevertBody.reviewedIds.includes('arpg_realistic_paladin_pack__arpg_paladin_shock_calling'), false);

    const matRes = await fetch(`${base}/api/hgame/materials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
    assert.equal(matRes.status, 404);

    // 5. Audio upload & playback serving
    const audioRes = await fetch(`${base}/api/hgame/audio?name=hit.wav&category=sfx`, {
      method: 'POST',
      body: makeMinimalWav(),
    });
    assert.equal(audioRes.status, 201);
    const { item: audioItem } = await audioRes.json();
    const audioFile = await fetch(`${base}${audioItem.url}`);
    assert.equal(audioFile.status, 200);

    // 6. Deletion removes files and index entries
    assert.equal((await fetch(`${base}/api/hgame/spritesheets/${sheetItem.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/api/hgame/audio/${audioItem.id}`, { method: 'DELETE' })).status, 204);

    const afterDelete = await (await fetch(`${base}/api/hgame/assets`)).json();
    assert.deepEqual(afterDelete.models, []);
    assert.deepEqual(afterDelete.spritesheets, []);
    assert.deepEqual(afterDelete.vfx, []);
    assert.deepEqual(afterDelete.materials, []);
    assert.deepEqual(afterDelete.audio, []);

    // 7. Unreal catalog omits Polygon characters, staticModels and static materials while preserving animations/vfx/decals/audio
    const unrealCatalogRes = await fetch(`${base}/api/hgame/unreal/catalog`);
    assert.equal(unrealCatalogRes.status, 200);
    const unrealCatalog = await unrealCatalogRes.json();
    assert.equal(unrealCatalog.available, true);
    assert.equal(unrealCatalog.characters.length, 0);
    assert.equal(unrealCatalog.animations.length, 1);
    assert.equal(unrealCatalog.staticModels.length, 0);
    assert.equal(unrealCatalog.materials.length, 0);

    const animGlbRes = await fetch(`${base}${unrealCatalog.animations[0].url}`);
    assert.equal(animGlbRes.status, 200);

    assert.equal((await fetch(`${base}/files/hgame-unreal/characters/PolygonAdventure__Knight.glb`)).status, 404);
    assert.equal((await fetch(`${base}/files/hgame-unreal/attachments/Polygon_BattleRoyale__SM_Chr_Attach_Male_Hair_01.glb`)).status, 404);
    assert.equal((await fetch(`${base}/files/hgame-unreal/static_models/PolygonAdventure__SM_Prop_Stall_Table_01.glb`)).status, 404);
    assert.equal((await fetch(`${base}/files/hgame-unreal/materials/topscan-floorpaving-02_color.webp`)).status, 404);
    assert.equal(unrealCatalog.vfxSystems.length, 1);
    assert.equal(unrealCatalog.vfxSystems[0].sourceType, 'niagara');
    assert.equal(unrealCatalog.vfxMeshes.length, 1);
    assert.equal(unrealCatalog.vfxTextures.length, 1);
    assert.equal(unrealCatalog.decals.length, 1);
    assert.equal(unrealCatalog.audio.length, 1);

    const vfxMeshRes = await fetch(`${base}${unrealCatalog.vfxMeshes[0].url}`);
    assert.equal(vfxMeshRes.status, 200);
    assert.match(vfxMeshRes.headers.get('content-type') || '', /gltf-binary/);

    const vfxTexRes = await fetch(`${base}${unrealCatalog.vfxTextures[0].url}`);
    assert.equal(vfxTexRes.status, 200);
    assert.match(vfxTexRes.headers.get('content-type') || '', /image\/png/);

    const unrealDecalRes = await fetch(`${base}${unrealCatalog.decals[0].color}`);
    assert.equal(unrealDecalRes.status, 200);
    assert.match(unrealDecalRes.headers.get('content-type') || '', /image\/png/);

    const unrealDecalThumbRes = await fetch(`${base}${unrealCatalog.decals[0].thumbnail}`);
    assert.equal(unrealDecalThumbRes.status, 200);
    assert.match(unrealDecalThumbRes.headers.get('content-type') || '', /image\/webp/);

    const unrealAudioRes = await fetch(`${base}${unrealCatalog.audio[0].url}`);
    assert.equal(unrealAudioRes.status, 200);
    assert.match(unrealAudioRes.headers.get('content-type') || '', /audio\/wav/);

    // Reject non-GLB, catalog.json direct access, traversal, and mutations on read-only Unreal mount
    assert.equal((await fetch(`${base}/files/hgame-unreal/characters/secret.uasset`)).status, 404);
    assert.equal((await fetch(`${base}/files/hgame-unreal/catalog.json`)).status, 404);
    assert.equal((await fetch(`${base}/files/hgame-unreal/animations/../../catalog.json`)).status, 404);
    assert.equal((await fetch(`${base}/files/hgame-unreal/animations/MaleLocomotion__Idle.glb`, { method: 'DELETE' })).status, 405);

    assert.equal((await fetch(`${base}/api/hgame/unity/catalog`)).status, 404);
    assert.equal((await fetch(`${base}/files/hgame-unity/meshes/circle.glb`)).status, 404);

    const anim23CatRes = await fetch(`${base}/api/hgame/anim23/catalog`);
    assert.equal(anim23CatRes.status, 200);
    const anim23Cat = await anim23CatRes.json();
    assert.equal(anim23Cat.available, true);
    assert.equal(anim23Cat.rig, 'humanoid_23');
    assert.equal(anim23Cat.animations.length, 1);

    const anim23FileRes = await fetch(`${base}${anim23Cat.animations[0].url}`);
    assert.equal(anim23FileRes.status, 200);
    assert.match(anim23FileRes.headers.get('content-type') || '', /model\/gltf-binary/);
    assert.equal((await fetch(`${base}/files/hgame-anim23/catalog.json`)).status, 404);
    assert.equal((await fetch(`${base}/files/hgame-anim23/_AnimDaily/../../catalog.json`)).status, 404);

    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /hgame-ui-shell\.js/);
    assert.match(html, /class="stage-params-popover"/);
    assert.match(html, /class="[^"]*\basset-stage-tab\b/);
    assert.match(html, /id="hgame-model-pack-filter"/);
    assert.match(html, /id="hgame-anim-pack-filter"/);
    assert.doesNotMatch(html, /id="hgame-anim-source-pack-filter"/);
    assert.doesNotMatch(html, /id="hgame-anim-character-select"/);
    assert.doesNotMatch(html, /id="hgame-anim-prev-character-button"/);
    assert.doesNotMatch(html, /id="hgame-anim-next-character-button"/);
    assert.doesNotMatch(html, /id="hgame-anim-clip-select"/);
    assert.doesNotMatch(html, /id="hgame-anim-restart-button"/);
    assert.doesNotMatch(html, /id="hgame-anim-params-popover"/);
    assert.match(html, /id="hgame-anim-character-dialog-button"/);
    assert.match(html, /id="hgame-character-picker-dialog"/);
    assert.match(html, /id="hgame-vfx-stage"/);
    assert.match(html, /id="hgame-vfx-bundle-tabs"/);
    assert.match(html, /id="hgame-vfx-type-filter"/);
    assert.match(html, /id="hgame-vfx-subtype-filter"/);
    assert.doesNotMatch(html, /id="hgame-vfx-kind-filter"/);
    assert.match(html, /id="hgame-vfx-mode-tabs"/);
    assert.match(html, /data-hgame-vfx-mode="source"/);
    assert.match(html, /id="hgame-vfx-plane-mode"/);
    assert.match(html, /id="hgame-vfx-replay-button"/);
    assert.match(html, /id="hgame-vfx-review-toggle"/);
    assert.match(html, /id="hgame-vfx-variant-select"/);
    assert.doesNotMatch(html, /精选复刻基准/);
    assert.match(html, /id="hgame-vfx-copy-code"/);
    assert.match(html, /id="nav-decals"/);
    assert.match(html, /id="decals-view"/);
    assert.doesNotMatch(html, /class="[^"]*\bhgame-decal-lib-tab\b/);
    assert.match(html, /hgame-decals\.js/);
    assert.doesNotMatch(html, /id="hgame-material-bakemode-wrap"/);
    assert.match(html, /id="hgame-test-quality"/);
    assert.match(html, /id="hgame-test-lod"/);
    assert.match(html, /id="hgame-test-lut-cat"/);
    assert.match(html, /id="hgame-test-lut"/);
    assert.match(html, /id="hgame-test-lut-intensity"/);
    assert.doesNotMatch(html, /id="hgame-test-lock-cam"/);
    assert.doesNotMatch(html, /id="hgame-test-fly-hud"/);
    assert.doesNotMatch(html, /id="hgame-model-proc-controls"/);
    assert.doesNotMatch(html, /<option value="procedural"/);
    assert.doesNotMatch(html, /id="hgame-audio-export-wav"/);

    assert.doesNotMatch(html, /class="character-mode-tab hgame-audio-lib-tab"/);
    assert.doesNotMatch(html, /data-audio-lib="music"/);
    assert.doesNotMatch(html, /id="hgame-audio-music-bar"/);
    assert.match(html, /metrics-inline/);
    assert.match(html, /id="nav-music"/);
    assert.match(html, /id="music-view"/);
    assert.match(html, /id="hgame-music-filter"/);
    assert.match(html, /id="hgame-music-seek"/);
    assert.match(html, /id="hgame-audio-seek"/);
    assert.match(html, /id="hgame-audio-filter"/);
    assert.match(html, /id="hgame-audio-ref-tone-button"[^>]*data-debug-only/);

  }, { cnFixture: true });
});

if (process.env.HGAME_TEST_LOCAL_ASSETS === '1') {
  test('installed CN asset library meets the production catalog contract', async () => {
    await runWithHGameServer(async base => {
      // 9. Milestone 2 endpoints: 207 LUTs, 8 Glass maps, 9 GlassPieces GLBs, 133 unified v5.0 2-Texture Decals
      const lutRes = await fetch(`${base}/assets/cn/luts/luts_table.json`);
      assert.equal(lutRes.status, 200);
      const lutTable = await lutRes.json();
      assert.equal(lutTable.count, 207);
      assert.ok(lutTable.presets.length >= 20);
      assert.equal((await fetch(`${base}/assets/cn/luts/${lutTable.items[0].path}`)).status, 200);
      const glassMapRes = await fetch(`${base}/assets/cn/shader_maps/glass/glass_maps_table.json`);
      assert.equal(glassMapRes.status, 200);
      const glassMaps = await glassMapRes.json();
      assert.equal(glassMaps.count, 8);
      assert.equal((await fetch(`${base}/assets/cn/shader_maps/glass/${glassMaps.items[0].path}`)).status, 200);
      const glassMeshRes = await fetch(`${base}/assets/cn/vfx_meshes/glass/glass_meshes_table.json`);
      assert.equal(glassMeshRes.status, 200);
      const glassMeshes = await glassMeshRes.json();
      assert.equal(glassMeshes.count, 9);
      assert.equal((await fetch(`${base}/assets/cn/vfx_meshes/glass/${glassMeshes.items[0].path}`)).status, 200);
      const pbrDecalsRes = await fetch(`${base}/assets/cn/pbr_decals/pbr_decals_table.json`);
      assert.equal(pbrDecalsRes.status, 200);
      const pbrDecals = await pbrDecalsRes.json();
      assert.equal(pbrDecals.normalConvention, 'OpenGL (+Y)');
      assert.ok(pbrDecals.count >= 133);
      assert.equal((await fetch(`${base}/assets/cn/pbr_decals/decal_bullet_glass_01/color.png`)).status, 200);
      assert.equal((await fetch(`${base}/assets/cn/pbr_decals/decal_blood_jet_01/normal_rm.png`)).status, 200);
      assert.equal((await fetch(`${base}/assets/cn/pbr_decals/decal_road_tire_skid_01/color.png`)).status, 200);
      // 10. Milestone 3 audio endpoints: Cue table (buffer-only SFX), Music table & AI index, Streams table, and standalone Music/Audio UI hooks
      const cueRes = await fetch(`${base}/assets/cn/audio/cue_table.json`);
      assert.equal(cueRes.status, 200);
      const cueTable = await cueRes.json();
      assert.equal(cueTable.preloadRule, 'buffer_only_sfx_under_4s');
      assert.ok(cueTable.cueCount > 100);
      assert.ok(cueTable.cues.every((c) => (
        c.preload === 'buffer'
        && !String(c.cueName || '').startsWith('bgm.')
        && !String(c.cueName || '').startsWith('stinger.')
        && c.variants.length >= 1
        && c.variants.length <= 4
      )));
      const musicRes = await fetch(`${base}/assets/cn/audio/music_table.json`);
      assert.equal(musicRes.status, 200);
      const musicTable = await musicRes.json();
      assert.ok(Array.isArray(musicTable.tracks) && Array.isArray(musicTable.bgm) && Array.isArray(musicTable.stingers));
      const aiIdxRes = await fetch(`${base}/assets/cn/audio/music-ai-index.json`);
      assert.equal(aiIdxRes.status, 200);
      const aiIndex = await aiIdxRes.json();
      assert.ok(Array.isArray(aiIndex.items) && aiIndex.count === aiIndex.items.length);
      for (const s of ['asphalt', 'concrete', 'tile', 'wood', 'metal', 'glass', 'dirt', 'grass', 'water', 'fabric']) {
        assert.ok(cueTable.surfaceCoverage?.step?.[s] >= 1, `missing step_${s} in cue_table.json`);
        assert.ok(cueTable.surfaceCoverage?.impact?.[s] >= 1, `missing impact_${s} in cue_table.json`);
      }
      assert.ok(!cueTable.cues.some((c) => /ClassicZombieSFXv2/i.test(c.pack || '')));
      const streamsRes = await fetch(`${base}/assets/cn/audio/streams_table.json`);
      assert.equal(streamsRes.status, 200);
      const streamsTable = await streamsRes.json();
      assert.ok(streamsTable.count > 0);
      assert.ok(streamsTable.streams.every((s) => s.preload === 'stream' && s.duration >= 4.0));
      // 11. PBR materials 1m standard UV alignment (uvScale === 1 / scanSizeMeters) + glass slots
      const matTableRes = await fetch(`${base}/assets/cn/materials/material_table.json`);
      assert.equal(matTableRes.status, 200);
      const matTable = await matTableRes.json();
      assert.ok(Array.isArray(matTable.materials) && matTable.materials.length >= 93);
      for (const m of matTable.materials) {
        const scanM = Array.isArray(m.scanSizeMeters) ? Number(m.scanSizeMeters[0]) : Number(m.scanSizeMeters);
        assert.ok(Number.isFinite(scanM) && scanM > 0, `invalid scanSizeMeters on ${m.id}`);
        const expectedUvScale = Number((1 / scanM).toFixed(3));
        assert.equal(m.uvScale, expectedUvScale, `material ${m.id} uvScale (${m.uvScale}) must equal 1 / scanSizeMeters (${expectedUvScale})`);
      }
      for (const glassId of [
        'glass_clean',
        'glass_colored_blue',
        'glass_pattern_03a',
        'glass_scratched_01',
        'glass_dirty_01',
        'glass_frozen_01',
        'glass_shattered_01',
        'glass_rain_01',
      ]) {
        const g = matTable.materials.find((m) => m.id === glassId);
        assert.ok(g, `missing glass material ${glassId}`);
        assert.equal(g.surfaceType, 'glass');
        assert.equal(g.blendMode, 'translucent');
        assert.equal((await fetch(`${base}/assets/cn/materials/${glassId}/color.png`)).status, 200);
        assert.equal((await fetch(`${base}/assets/cn/materials/${glassId}/normal_rm.png`)).status, 200);
      }
    });
  });
}

test('VFX catalog API exposes bundles summary and per-pack bundleId/bundleName across multiple packs', async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'webasset-vfx-bundles-'));
  const vfxPacksDir = path.join(tmpRoot, 'assets', 'vfx', 'packs');
  await mkdir(path.join(tmpRoot, 'public'), { recursive: true });
  await writeFile(path.join(tmpRoot, 'public', 'index.html'), '<!doctype html><html></html>');
  await mkdir(path.join(tmpRoot, 'assets', 'vfx', 'meshes'), { recursive: true });
  await writeFile(path.join(tmpRoot, 'assets', 'vfx', 'meshes', 'mesh_index.json'), '{}');

  await mkdir(path.join(vfxPacksDir, 'piloto_fire'), { recursive: true });
  await writeFile(path.join(vfxPacksDir, 'piloto_fire', 'pack_index.json'), JSON.stringify({
    id: 'piloto_fire',
    name: 'Piloto Fire',
    atlasImage: 'packs/piloto_fire/atlas.png',
    atlasMeta: 'packs/piloto_fire/atlas.json',
    effects: [{ id: 'fire_slash', name: 'Fire Slash', file: 'packs/piloto_fire/recipes/fire_slash.vfx.json', duration: 1, loop: false, layerCount: 2 }],
    meshAliases: {},
  }));

  await mkdir(path.join(vfxPacksDir, 'epic_toon_fx__combat'), { recursive: true });
  await writeFile(path.join(vfxPacksDir, 'epic_toon_fx__combat', 'pack_index.json'), JSON.stringify({
    id: 'epic_toon_fx__combat',
    name: 'Combat',
    bundleId: 'epic_toon_fx',
    bundleName: 'Epic Toon FX',
    atlasImage: 'packs/epic_toon_fx__combat/atlas.png',
    atlasMeta: 'packs/epic_toon_fx__combat/atlas.json',
    effects: [
      { id: 'nova_blue', name: 'NovaBlue', relSource: 'Combat/Explosions/NovaExplosion/NovaBlue.prefab', categoryPath: ['Combat', 'Explosions', 'NovaExplosion'], file: 'packs/epic_toon_fx__combat/recipes/nova_blue.vfx.json', duration: 1, loop: false, layerCount: 3 },
      { id: 'nova_red', name: 'NovaRed', relSource: 'Combat/Explosions/NovaExplosion/NovaRed.prefab', categoryPath: ['Combat', 'Explosions', 'NovaExplosion'], file: 'packs/epic_toon_fx__combat/recipes/nova_red.vfx.json', duration: 1, loop: false, layerCount: 3 },
    ],
    meshAliases: {},
  }));

  await writeFile(path.join(vfxPacksDir, 'packs_index.json'), JSON.stringify({
    schemaVersion: 1,
    packs: [
      { id: 'piloto_fire', name: 'Piloto Fire', effectCount: 1, manifestFile: 'packs/piloto_fire/pack_index.json' },
      { id: 'epic_toon_fx__combat', name: 'Combat', bundleId: 'epic_toon_fx', bundleName: 'Epic Toon FX', effectCount: 2, manifestFile: 'packs/epic_toon_fx__combat/pack_index.json' },
    ],
  }));

  const server = createWebAssetServer({
    siteRoot: tmpRoot,
    gamesRoot: path.join(tmpRoot, 'games'),
    htmlGamesRoot: path.join(tmpRoot, 'html-games'),
    hgameAssetRoot: path.join(tmpRoot, 'hgame-assets'),
    dbPath: path.join(tmpRoot, 'assets.db'),
    materialLibraryRoot: path.join(tmpRoot, 'curated-materials'),
    unrealExportRoot: path.join(tmpRoot, 'unreal-export'),
    anim23Root: path.join(tmpRoot, 'anim23'),
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/hgame/vfx/catalog`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.available, true);
    assert.deepEqual(body.bundles, [
      { id: 'piloto_studio', name: 'Piloto Studio', packCount: 1, effectCount: 1 },
      { id: 'epic_toon_fx', name: 'Epic Toon FX', packCount: 1, effectCount: 2 },
    ]);
    assert.equal(body.packs.length, 2);
    assert.equal(body.packs[0].bundleId, 'piloto_studio');
    assert.equal(body.packs[1].bundleId, 'epic_toon_fx');
    assert.equal(body.packs[1].bundleName, 'Epic Toon FX');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
