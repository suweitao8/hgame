import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGE_CELL_PALETTE,
  defineStage,
  analyzeStageDesign,
  analyzeCampaignProgression,
  createStageDirector,
  renderGameDesignDocs,
} from '../assets/runtime/kit/index.js';
import { auditDesignDocs } from '../scripts/check-design-docs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkLevelScript = path.join(root, '.agents', 'skills', 'hgame-level-architect', 'scripts', 'check-level.mjs');

test('1. grid-2d BFS reachability, unreachable !, isolated islands x, and modular-3d level.json', () => {
  assert.equal(STAGE_CELL_PALETTE['~'].swimOnly, true);
  assert.equal(STAGE_CELL_PALETTE['='].blocksSight, false);
  assert.equal(STAGE_CELL_PALETTE['+'].destructible, true);

  const bad = analyzeStageDesign({
    id: 'bad-grid',
    grid: [
      '#######',
      '#S.#.G#',
      '#..#..#',
      '#..#..#',
      '#######',
    ],
  });
  assert.equal(bad.pass, false);
  assert.equal(bad.unreachableObjectives.length, 1);
  assert.ok(bad.minimap.includes('!'));
  assert.ok(bad.isolatedFloorCells > 0 && bad.minimap.includes('x'));

  const modularRaw = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'profiles', '3d', 'level.json'), 'utf8'));
  const modular = analyzeStageDesign(modularRaw);
  assert.equal(modular.topology, 'modular-3d');
  assert.equal(modular.pass, true);
  assert.equal(modular.isolatedFloorCells, 0);
  assert.ok(modular.reachableCells > 50);
});

test('2. lane-defense PvZ stage: water lane & shielded hard-counter fairness', () => {
  const baseStage = (tools) => ({
    id: 'pool-stage',
    topology: 'lane-defense',
    cols: 9,
    laneTypes: ['grass', 'water', 'water', 'grass'],
    mechanics: {
      introduced: ['water-lane'],
      availableTools: tools,
      enemyCatalog: {
        ducky: { threat: 1.5, speed: 1.0, traits: ['aquatic'] },
        door: { threat: 3.0, speed: 0.9, traits: ['shielded'], requiresCounter: true },
      },
      toolCounters: {
        peashooter: ['basic'],
        'lily-pad': ['water-lane', 'aquatic'],
        lobber: ['shielded'],
      },
    },
    waves: [
      { id: 'w1', durationSec: 15, breatherSec: 5, spawns: [{ enemy: 'ducky', count: 2, lane: 1 }] },
      { id: 'w2', durationSec: 15, breatherSec: 5, spawns: [{ enemy: 'door', count: 2, lane: 0 }] },
      { id: 'w3', durationSec: 12, breatherSec: 4, spawns: [{ enemy: 'ducky', count: 2, lane: 2 }] },
      { id: 'w4', durationSec: 18, breatherSec: 0, flag: true, spawns: [{ enemy: 'door', count: 4, lane: 3 }] },
    ],
  });

  const okRes = analyzeStageDesign(baseStage(['peashooter', 'lily-pad', 'lobber']));
  assert.equal(okRes.pass, true);
  assert.deepEqual(okRes.metrics.mechanics.uncounteredTraits, []);

  const missingLily = analyzeStageDesign(baseStage(['peashooter', 'lobber']));
  assert.equal(missingLily.pass, false);
  assert.ok(missingLily.metrics.mechanics.uncounteredTraits.includes('water-lane'));
  assert.ok(missingLily.metrics.mechanics.uncounteredTraits.includes('aquatic'));

  const missingLobber = analyzeStageDesign(baseStage(['peashooter', 'lily-pad']));
  assert.equal(missingLobber.pass, false);
  assert.ok(missingLobber.metrics.mechanics.uncounteredTraits.includes('shielded'));
});

test('3. arena topology flags face-spawn and featureless flat arena; tactical cover & safe spawn pass higher', () => {
  const flatBad = analyzeStageDesign({
    id: 'flat-arena',
    topology: 'arena',
    bounds: { width: 32, height: 32 },
    cellSize: 2,
    spawn: { x: 0, y: 0 },
    enemySpawns: [{ id: 'near', x: 2, y: 0 }],
    waves: [{ id: 'w1', durationSec: 20, spawns: [{ enemy: 'rusher', count: 5 }] }],
  }, { strictGameplay: true });
  assert.equal(flatBad.pass, false);
  assert.ok(flatBad.metrics.spatial.firstContactSec < 2.5);
  assert.ok(flatBad.errors.some((e) => e.includes('firstContact')));
  assert.ok(flatBad.errors.some((e) => e.includes('Empty flat arena')));

  const tacticalOk = analyzeStageDesign({
    id: 'cover-arena',
    topology: 'arena',
    bounds: { width: 40, height: 40 },
    cellSize: 2,
    spawn: { x: 0, y: 0 },
    enemySpawns: [{ id: 'north', x: 0, y: -18 }, { id: 'east', x: 18, y: 0 }],
    obstacles: [
      { id: 'cover1', x: -6, y: -6, width: 4, height: 2, kind: 'cover' },
      { id: 'cover2', x: 6, y: 6, width: 4, height: 2, kind: 'cover' },
      { id: 'haz1', x: 0, y: 8, radius: 2, kind: 'hazard' },
    ],
    waves: [{ id: 'w1', durationSec: 20, spawns: [{ enemy: 'rusher', count: 5 }] }],
  }, { strictGameplay: true });
  assert.equal(tacticalOk.pass, true);
  assert.ok(tacticalOk.score > flatBad.score);
  assert.ok(tacticalOk.metrics.spatial.featureRatio > 0);
});

test('4. sawtooth wave pacing flags Wave-1 peak / flatline and rewards warmup -> breather -> flag climax', () => {
  const flatline = analyzeStageDesign({
    id: 'flat-waves',
    topology: 'lane-defense',
    cols: 9,
    lanes: 3,
    waves: [
      { id: 'w1', durationSec: 15, breatherSec: 0, spawns: [{ enemy: 'grunt', count: 6 }] },
      { id: 'w2', durationSec: 15, breatherSec: 0, spawns: [{ enemy: 'grunt', count: 6 }] },
      { id: 'w3', durationSec: 15, breatherSec: 0, spawns: [{ enemy: 'grunt', count: 6 }] },
      { id: 'w4', durationSec: 15, breatherSec: 0, spawns: [{ enemy: 'grunt', count: 6 }] },
    ],
  }, { strictGameplay: true });
  assert.equal(flatline.pass, false);
  assert.ok(flatline.errors.some((e) => e.includes('peaks')));
  assert.ok(flatline.errors.some((e) => e.includes('sawtoothDrops=0')));
  assert.ok(flatline.errors.some((e) => e.includes('flag climax')));

  const sawtooth = analyzeStageDesign({
    id: 'sawtooth-waves',
    topology: 'lane-defense',
    cols: 9,
    lanes: 3,
    waves: [
      { id: 'w1', durationSec: 15, breatherSec: 5, spawns: [{ enemy: 'grunt', count: 2 }] },
      { id: 'w2', durationSec: 15, breatherSec: 5, flag: true, spawns: [{ enemy: 'grunt', count: 6 }] },
      { id: 'w3', durationSec: 15, breatherSec: 4, spawns: [{ enemy: 'grunt', count: 3 }] },
      { id: 'w4', durationSec: 15, breatherSec: 0, flag: true, spawns: [{ enemy: 'grunt', count: 10 }] },
    ],
  }, { strictGameplay: true });
  assert.equal(sawtooth.pass, true);
  assert.ok(sawtooth.metrics.pacing.sawtoothDrops >= 2);
  const pos = sawtooth.metrics.pacing.flagPositions;
  assert.equal(pos.length, 2);
  assert.ok(pos[0] > 0 && pos[0] < pos[1] && pos[1] <= 1);
});

test('5. PvZ micro-barks enforce <= 24 chars, single-line, <= 3 barks, and <= 8 char unlock labels', () => {
  const good = analyzeStageDesign({
    id: 'good-barks',
    topology: 'lane-defense',
    lanes: 3,
    barks: [
      { at: 'preStage', speaker: '戴夫', text: '种下向日葵攒阳光！' },
      { at: 'firstFlag', speaker: '戴夫', text: '一大波僵尸来啦！' },
      { at: 'victory', speaker: '戴夫', text: '漂亮，继续前进！' },
    ],
    unlock: { id: 'wallnut', kind: 'tool', label: '坚果墙', counters: ['burst'] },
  });
  assert.equal(good.pass, true);

  const proseWall = analyzeStageDesign({
    id: 'bad-prose',
    topology: 'lane-defense',
    lanes: 3,
    barks: [{ at: 'preStage', text: '在遥远的暮色庭院里，大家围坐在一起清点所剩无几的阳光补给并准备迎接漫长的夜晚。' }],
  });
  assert.equal(proseWall.pass, false);
  assert.ok(proseWall.errors.some((e) => e.includes('exceeds 24 chars')));

  const multiLine = analyzeStageDesign({
    id: 'bad-multiline',
    topology: 'lane-defense',
    lanes: 3,
    barks: [{ at: 'preStage', text: '第一行\n第二行' }],
  });
  assert.equal(multiLine.pass, false);

  const tooMany = analyzeStageDesign({
    id: 'bad-count',
    topology: 'lane-defense',
    lanes: 3,
    barks: [
      { at: 'preStage', text: '一' },
      { at: 'firstFlag', text: '二' },
      { at: 'finalWave', text: '三' },
      { at: 'victory', text: '四' },
    ],
  });
  assert.equal(tooMany.pass, false);

  const longUnlock = analyzeStageDesign({
    id: 'bad-unlock',
    topology: 'lane-defense',
    lanes: 3,
    unlock: { id: 'x', label: '超级无敌自动防御超级大坚果' },
  });
  assert.equal(longUnlock.pass, false);
});

test('6. analyzeCampaignProgression catches premature enemies and stagnation droughts', () => {
  const premature = analyzeCampaignProgression({
    id: 'premature-camp',
    initialTools: ['peashooter'],
    enemyCatalog: { door: { threat: 3, traits: ['shielded'], requiresCounter: true } },
    toolCounters: { peashooter: ['basic'] },
    stages: [
      {
        id: '1-1',
        topology: 'lane-defense',
        lanes: 3,
        waves: [{ id: 'w1', durationSec: 15, spawns: [{ enemy: 'door', count: 2 }] }],
        unlock: { id: 'lobber', kind: 'tool', label: '投石手', counters: ['shielded'] },
      },
    ],
  });
  assert.equal(premature.pass, false);
  assert.ok(premature.errors.some((e) => e.includes('shielded')));

  const stagnant = analyzeCampaignProgression({
    id: 'stagnant-camp',
    initialTools: ['peashooter'],
    stages: [
      { id: '1-1', topology: 'lane-defense', lanes: 3, mechanics: { introduced: ['basic'] }, waves: [{ id: 'w1', durationSec: 15, spawns: [{ enemy: 'walker', count: 2 }] }] },
      { id: '1-2', topology: 'lane-defense', lanes: 3, waves: [{ id: 'w1', durationSec: 15, spawns: [{ enemy: 'walker', count: 3 }] }] },
      { id: '1-3', topology: 'lane-defense', lanes: 3, waves: [{ id: 'w1', durationSec: 15, spawns: [{ enemy: 'walker', count: 4 }] }] },
      { id: '1-4', topology: 'lane-defense', lanes: 3, waves: [{ id: 'w1', durationSec: 15, flag: true, spawns: [{ enemy: 'walker', count: 5 }] }] },
    ],
  }, { strictGameplay: true });
  assert.equal(stagnant.pass, false);
  assert.ok(stagnant.errors.some((e) => e.includes('stagnation drought')));
});

test('7. createStageDirector executes 60Hz waves, barks, early-clear rush, HUD state, and snapshots', () => {
  const stage = defineStage({
    id: 'dir-stage',
    topology: 'lane-defense',
    lanes: 3,
    waves: [
      { id: 'w1', durationSec: 10, breatherSec: 5, spawns: [{ enemy: 'walker', count: 2, lane: 1, intervalSec: 1, delaySec: 0 }] },
      { id: 'w2', durationSec: 10, breatherSec: 0, flag: true, spawns: [{ enemy: 'cone', count: 3, lane: 2, intervalSec: 0.5, delaySec: 0 }] },
    ],
    barks: [
      { at: 'preStage', speaker: '戴夫', text: '准备迎战！', durationSec: 1.5 },
      { at: 'firstFlag', speaker: '戴夫', text: '旗帜波来袭！', durationSec: 2.0 },
      { at: 'victory', speaker: '戴夫', text: '大获全胜！', durationSec: 2.0 },
    ],
    unlock: { id: 'wallnut', kind: 'tool', label: '坚果墙', counters: ['stall'] },
  });

  const makeRunner = () => {
    const log = { spawns: [], waves: [], flags: [], barks: [], unlocks: [], completed: 0 };
    const dir = createStageDirector(stage, {
      earlyClearDelaySec: 0.5,
      onSpawn: (s) => log.spawns.push(s),
      onWaveStart: (w) => log.waves.push(w.waveId),
      onFlagWave: (f) => log.flags.push(f.waveId),
      onBark: (b) => log.barks.push(b.at),
      onUnlock: (u) => log.unlocks.push(u.id),
      onComplete: () => log.completed++,
    });
    return { dir, log };
  };

  const { dir, log } = makeRunner();
  const hud0 = dir.start();
  assert.equal(hud0.status, 'running');
  assert.equal(hud0.activeBark?.at, 'preStage');
  assert.deepEqual(hud0.flagPositions, [1]);

  // Step 2.05s -> both w1 spawns fire, preStage bark expires; aliveEnemies=0 at 1.5s triggers early-clear rush into w2!
  let snap = null;
  for (let i = 0; i < 125; i++) {
    dir.update(1 / 60, { aliveEnemies: i < 90 ? 1 : 0 });
    if (i === 59) snap = dir.getSnapshot();
  }
  assert.equal(log.spawns.filter((s) => s.waveId === 'w1').length, 2);
  assert.deepEqual(log.waves, ['w1', 'w2']);
  assert.deepEqual(log.flags, ['w2']);
  assert.ok(log.barks.includes('firstFlag'));

  // Snapshot equivalence check: restore mid-run state on fresh director and step to completion
  const cloned = makeRunner();
  cloned.dir.start();
  cloned.dir.restoreSnapshot(snap);
  for (let i = 60; i < 125; i++) cloned.dir.update(1 / 60, { aliveEnemies: i < 90 ? 1 : 0 });
  assert.deepEqual(cloned.dir.getHudState(), dir.getHudState());

  // Finish w2
  for (let i = 0; i < 700; i++) dir.update(1 / 60, { aliveEnemies: 0 });
  const endHud = dir.getHudState();
  assert.equal(endHud.status, 'completed');
  assert.equal(endHud.progress, 1);
  assert.equal(log.spawns.filter((s) => s.waveId === 'w2').length, 3);
  assert.deepEqual(log.unlocks, ['wallnut']);
  assert.equal(log.completed, 1);
  assert.ok(log.barks.includes('victory'));
});

test('8. CLI check-level (--demo, --demo-pvz, modular-3d) and auditDesignDocs integrate cleanly', async () => {
  const demoOut = JSON.parse(execFileSync(process.execPath, [checkLevelScript, '--demo', '--json'], { encoding: 'utf8' }));
  assert.equal(demoOut.pass, true);
  assert.equal(demoOut.topology, 'grid-2d');

  const pvzOut = JSON.parse(execFileSync(process.execPath, [checkLevelScript, '--demo-pvz', '--strict-gameplay', '--json'], { encoding: 'utf8' }));
  assert.equal(pvzOut.pass, true);
  assert.equal(pvzOut.stageCount, 5);
  assert.ok(pvzOut.unlockedTools.includes('lily-pad'));
  assert.ok(pvzOut.unlockedTools.includes('melon-lobber'));

  const modOut = JSON.parse(execFileSync(process.execPath, [checkLevelScript, '--level', path.join(root, 'assets/profiles/3d/level.json'), '--json'], { encoding: 'utf8' }));
  assert.equal(modOut.pass, true);
  assert.equal(modOut.topology, 'modular-3d');

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-stage-audit-'));
  try {
    await mkdir(path.join(tmp, 'docs', 'design'), { recursive: true });
    await mkdir(path.join(tmp, 'src'), { recursive: true });
    await writeFile(path.join(tmp, 'game.config.json'), JSON.stringify({ schemaVersion: 1, id: 'pvz-test', name: '草坪测试', version: '0.1.0', entry: 'index.html', renderer: 'webgl2d' }));
    const docs = renderGameDesignDocs({ gameConfig: { id: 'pvz-test', name: '草坪测试', version: '0.1.0' }, archetype: 'action-2d' });
    for (const [name, content] of Object.entries(docs)) {
      await writeFile(path.join(tmp, 'docs', 'design', name), content);
    }
    await writeFile(path.join(tmp, 'src', 'level.json'), JSON.stringify({
      id: 'softlock',
      grid: ['#####', '#S#G#', '#####'],
    }));
    const audit = await auditDesignDocs(tmp);
    assert.equal(audit.ok, false);
    assert.ok(audit.errors.some((e) => e.includes('src/level.json') && e.includes('Unreachable')));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
