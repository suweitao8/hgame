#!/usr/bin/env node
// Multi-topology level & PvZ-style campaign validator powered by kit/stage-architect.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

async function loadStageArchitect() {
  const candidates = [
    path.resolve(scriptDir, '../../../../assets/runtime/kit/stage-architect.js'),
    path.resolve(scriptDir, '../vendor/hgame/kit/stage-architect.js'),
    path.resolve(process.cwd(), 'vendor/hgame/kit/stage-architect.js'),
    path.resolve(scriptDir, '../assets/runtime/kit/stage-architect.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return import(pathToFileURL(p).href);
  }
  throw new Error('Cannot locate HGame kit/stage-architect.js');
}

function parseArgs(argv) {
  const opts = {
    levelPath: '',
    campaignPath: '',
    demo: false,
    demoPvz: false,
    allowDiag: false,
    strictGameplay: false,
    minScore: null,
    jsonOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--level' || a === '-l') opts.levelPath = argv[++i] ?? '';
    else if (a === '--campaign' || a === '-c') opts.campaignPath = argv[++i] ?? '';
    else if (a === '--demo') opts.demo = true;
    else if (a === '--demo-pvz') opts.demoPvz = true;
    else if (a === '--diag') opts.allowDiag = true;
    else if (a === '--strict-gameplay') opts.strictGameplay = true;
    else if (a === '--min-score') opts.minScore = Number(argv[++i]);
    else if (a === '--json') opts.jsonOnly = true;
  }
  return opts;
}

const DEMO_LEVEL = {
  id: 'demo-dungeon',
  grid: [
    '############',
    '#S..#...G..#',
    '#...#..##..#',
    '#......#...#',
    '###..###.###',
    '#G.........#',
    '############',
  ],
};

const DEMO_PVZ_CAMPAIGN = {
  id: 'pvz-day-pool-5',
  initialTools: ['peashooter'],
  enemyCatalog: {
    walker: { threat: 1, speed: 1.0, traits: [] },
    cone: { threat: 2.2, speed: 1.0, traits: ['armored'] },
    ducky: { threat: 1.4, speed: 1.1, traits: ['aquatic'] },
    door: { threat: 3.5, speed: 0.9, traits: ['shielded'], requiresCounter: true },
    gargantuar: { threat: 8.0, speed: 0.75, traits: ['armored', 'boss'] },
  },
  toolCounters: {
    peashooter: ['basic'],
    'repeater-sun': ['armored'],
  },
  requiredCounterTraits: ['water-lane', 'aquatic', 'shielded'],
  stages: [
    {
      id: '1-1',
      title: '前院初试',
      topology: 'lane-defense',
      cols: 9,
      laneTypes: ['blocked', 'blocked', 'grass', 'blocked', 'blocked'],
      mechanics: { introduced: ['plant-lane'] },
      waves: [
        { id: 'w1', durationSec: 14, breatherSec: 5, spawns: [{ enemy: 'walker', count: 2, lane: 2, intervalSec: 4 }] },
        { id: 'w2', durationSec: 16, breatherSec: 5, spawns: [{ enemy: 'walker', count: 4, lane: 2, intervalSec: 3 }] },
        { id: 'w3', durationSec: 14, breatherSec: 0, flag: true, spawns: [{ enemy: 'walker', count: 6, lane: 2, intervalSec: 2 }] },
      ],
      barks: [
        { at: 'preStage', speaker: '戴夫', icon: '🌻', text: '种下射手守住草坪！' },
        { at: 'firstFlag', speaker: '戴夫', icon: '🚩', text: '一大波僵尸正在靠近！' },
      ],
      unlock: { id: 'sunflower', kind: 'tool', label: '向日葵', icon: '🌻', counters: ['economy'] },
    },
    {
      id: '1-2',
      title: '五线扩张',
      topology: 'lane-defense',
      cols: 9,
      laneTypes: ['grass', 'grass', 'grass', 'grass', 'grass'],
      mechanics: { introduced: ['sun-economy', 'armored-cone'] },
      waves: [
        { id: 'w1', durationSec: 16, breatherSec: 5, spawns: [{ enemy: 'walker', count: 4, intervalSec: 3 }] },
        { id: 'w2', durationSec: 18, breatherSec: 6, spawns: [{ enemy: 'walker', count: 5 }, { enemy: 'cone', count: 2 }] },
        { id: 'w3', durationSec: 14, breatherSec: 5, spawns: [{ enemy: 'walker', count: 3 }] },
        { id: 'w4', durationSec: 18, breatherSec: 0, flag: true, spawns: [{ enemy: 'walker', count: 7 }, { enemy: 'cone', count: 4 }] },
      ],
      barks: [{ at: 'preStage', speaker: '戴夫', icon: '🪣', text: '小心戴路障的家伙！' }],
      unlock: { id: 'lily-pad', kind: 'tool', label: '睡莲', icon: '🪷', counters: ['water-lane', 'aquatic'] },
    },
    {
      id: '1-3',
      title: '后院泳池',
      topology: 'lane-defense',
      cols: 9,
      laneTypes: ['grass', 'grass', 'water', 'water', 'grass', 'grass'],
      mechanics: { introduced: ['water-lane'] },
      waves: [
        { id: 'w1', durationSec: 16, breatherSec: 5, spawns: [{ enemy: 'walker', count: 4, lane: 0 }] },
        { id: 'w2', durationSec: 18, breatherSec: 5, spawns: [{ enemy: 'ducky', count: 4, lane: 2 }, { enemy: 'cone', count: 2, lane: 1 }] },
        { id: 'w3', durationSec: 14, breatherSec: 5, spawns: [{ enemy: 'walker', count: 3, lane: 4 }] },
        { id: 'w4', durationSec: 18, breatherSec: 0, flag: true, spawns: [{ enemy: 'ducky', count: 6, lane: 3 }, { enemy: 'cone', count: 4, lane: 0 }] },
      ],
      barks: [{ at: 'preStage', speaker: '戴夫', icon: '🪷', text: '水路要用睡莲垫脚！' }],
      unlock: { id: 'melon-lobber', kind: 'tool', label: '投石手', icon: '🍉', counters: ['shielded'] },
    },
    {
      id: '1-4',
      title: '铁门夜袭',
      topology: 'lane-defense',
      cols: 9,
      laneTypes: ['grass', 'grass', 'water', 'water', 'grass', 'grass'],
      obstacles: [{ lane: 0, col: 6, kind: 'destructible' }, { lane: 4, col: 7, kind: 'destructible' }],
      mechanics: { introduced: ['shield-counter'], modifiers: ['night'] },
      waves: [
        { id: 'w1', durationSec: 16, breatherSec: 5, spawns: [{ enemy: 'walker', count: 4, lane: 1 }] },
        { id: 'w2', durationSec: 18, breatherSec: 6, spawns: [{ enemy: 'door', count: 2, lane: 0 }, { enemy: 'ducky', count: 3, lane: 2 }] },
        { id: 'w3', durationSec: 15, breatherSec: 5, spawns: [{ enemy: 'walker', count: 3, lane: 5 }] },
        { id: 'w4', durationSec: 18, breatherSec: 0, flag: true, spawns: [{ enemy: 'door', count: 4, lane: 1 }, { enemy: 'cone', count: 5, lane: 4 }] },
      ],
      barks: [{ at: 'preStage', speaker: '戴夫', icon: '🍉', text: '投掷武器能越过铁门！' }],
      unlock: { id: 'cherry-bomb', kind: 'tool', label: '樱桃雷', icon: '🍒', counters: ['armored', 'boss'] },
    },
    {
      id: '1-5',
      title: '屋顶终考',
      topology: 'lane-defense',
      cols: 9,
      laneTypes: ['grass', 'grass', 'grass', 'grass', 'grass'],
      mechanics: { introduced: ['conveyor-belt'], modifiers: ['conveyor', 'roof'] },
      waves: [
        { id: 'w1', durationSec: 16, breatherSec: 4, spawns: [{ enemy: 'cone', count: 4 }] },
        { id: 'w2', durationSec: 18, breatherSec: 6, spawns: [{ enemy: 'door', count: 3 }, { enemy: 'cone', count: 4 }] },
        { id: 'w3', durationSec: 14, breatherSec: 5, spawns: [{ enemy: 'walker', count: 5 }] },
        { id: 'w4', durationSec: 20, breatherSec: 0, flag: true, spawns: [{ enemy: 'gargantuar', count: 2 }, { enemy: 'door', count: 4 }] },
      ],
      barks: [
        { at: 'preStage', speaker: '戴夫', icon: '🚚', text: '传送带发啥你就用啥！' },
        { at: 'finalWave', speaker: '戴夫', icon: '🍒', text: '大块头来了，留好炸弹！' },
        { at: 'victory', speaker: '戴夫', icon: '🏆', text: '草坪保住了！' },
      ],
      unlock: { id: 'trophy', kind: 'badge', label: '草坪奖杯', icon: '🏆', counters: [] },
    },
  ],
};

const { analyzeStageDesign, analyzeCampaignProgression } = await loadStageArchitect();
const opts = parseArgs(process.argv.slice(2));

const analyzeOpts = {
  allowDiag: opts.allowDiag,
  strictGameplay: opts.strictGameplay,
};

if (opts.campaignPath || opts.demoPvz) {
  const raw = opts.campaignPath
    ? JSON.parse(fs.readFileSync(opts.campaignPath, 'utf8'))
    : DEMO_PVZ_CAMPAIGN;
  const res = analyzeCampaignProgression(raw, analyzeOpts);
  const scoreOk = opts.minScore === null || !Number.isFinite(opts.minScore) || res.score >= opts.minScore;
  const pass = res.pass && scoreOk;
  if (!opts.jsonOnly) {
    for (const st of res.stages) {
      console.log(`=== ${st.id} (${st.topology} · ${st.score}/100) ===`);
      console.log(st.minimap);
    }
  }
  console.log(JSON.stringify({ ...res, pass, ok: pass }, null, 2));
  if (!pass) process.exit(1);
} else {
  const raw = opts.levelPath
    ? JSON.parse(fs.readFileSync(opts.levelPath, 'utf8'))
    : (opts.demo ? DEMO_LEVEL : null);

  if (!raw) {
    console.error('Usage: node check-level.mjs (--level <level.json> | --campaign <campaign.json> | --demo | --demo-pvz) [--diag] [--strict-gameplay] [--min-score <N>] [--json]');
    process.exit(1);
  }

  const res = analyzeStageDesign(raw, analyzeOpts);
  const scoreOk = opts.minScore === null || !Number.isFinite(opts.minScore) || res.score >= opts.minScore;
  const pass = res.pass && scoreOk;
  if (!opts.jsonOnly) {
    console.log(res.minimap);
  }
  console.log(JSON.stringify({
    width: res.width,
    height: res.height,
    topology: res.topology,
    reachableCells: res.reachableCells,
    isolatedFloorCells: res.isolatedFloorCells,
    objectiveCount: res.objectiveCount,
    unreachableObjectives: res.unreachableObjectives,
    score: res.score,
    pass,
    ok: pass,
    metrics: res.metrics,
    warnings: res.warnings,
    errors: res.errors,
  }, null, 2));

  if (!pass) process.exit(1);
}
