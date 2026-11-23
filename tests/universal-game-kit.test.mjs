import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ART_THEMES,
  STANDARD_ART_SPEC,
  listArtThemes,
  getArtTheme,
  resolvePresentationPreset,
  GAME_AUDIO_EVENTS,
  createAudioDirector,
  listGenreArchetypes,
  defineGameBlueprint,
  evaluateBlueprintBalance,
  createBlueprintFromIdea,
  createGameSession,
  mountGameShell,
} from '../assets/runtime/kit/index.js';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const createGameScript = path.join(repoRoot, 'scripts', 'create-game.mjs');
const checkBlueprintScript = path.join(repoRoot, 'scripts', 'check-blueprint.mjs');
const checkUiScript = path.join(repoRoot, '.agents', 'skills', 'hgame-ui-ux', 'scripts', 'check-ui.mjs');

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

function makeFakeAudio() {
  const synths = [];
  const cues = [];
  let bgmState = { mood: 'adventure', intensity: 0.5, volume: 0.35, muted: false, started: false, paused: false };
  return {
    synths,
    cues,
    get bgmState() { return bgmState; },
    muted: false,
    available: true,
    unlock: async () => {},
    hasCue: name => name === 'custom_hit',
    playCue: (name, opts) => { cues.push({ name, opts }); },
    playSynth: (preset, opts) => { synths.push({ preset, opts }); },
    setMuted: m => m,
    createBgm: (opts) => {
      bgmState = { ...bgmState, ...opts };
      return {
        start: () => { bgmState.started = true; },
        stop: () => { bgmState.started = false; },
        pause: () => { bgmState.paused = true; },
        resume: () => { bgmState.paused = false; },
        setMood: m => { bgmState.mood = m; },
        setIntensity: i => { bgmState.intensity = i; },
        setVolume: v => { bgmState.volume = v; },
        setMuted: m => { bgmState.muted = m; },
        update: () => {},
        getState: () => ({ ...bgmState }),
        dispose: () => {},
      };
    },
  };
}

function makeStubDom() {
  const listeners = new Map();
  function createEl(tag) {
    const attrs = new Map();
    const elListeners = new Map();
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      hidden: false,
      disabled: false,
      children,
      childNodes: children,
      parentElement: null,
      style: {
        _props: new Map(),
        setProperty: (k, v) => el.style._props.set(k, String(v)),
      },
      _text: '',
      get textContent() {
        return el._text || children.map(c => c.textContent).join('');
      },
      set textContent(v) {
        el._text = String(v);
        children.length = 0;
      },
      set innerHTML(v) {
        if (v === '') children.length = 0;
        el._text = String(v);
      },
      get id() { return attrs.get('id') ?? ''; },
      set id(v) { attrs.set('id', String(v)); },
      get className() { return attrs.get('class') ?? ''; },
      set className(v) { attrs.set('class', String(v)); },
      classList: {
        contains: cls => (attrs.get('class') ?? '').split(/\s+/).includes(cls),
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
      hasAttribute: k => attrs.has(k),
      appendChild: child => {
        child.parentElement = el;
        children.push(child);
        return child;
      },
      remove: () => {
        if (!el.parentElement) return;
        const idx = el.parentElement.children.indexOf(el);
        if (idx >= 0) el.parentElement.children.splice(idx, 1);
        el.parentElement = null;
      },
      contains: node => {
        if (node === el) return true;
        return children.some(c => c.contains(node));
      },
      addEventListener: (type, fn) => {
        if (!elListeners.has(type)) elListeners.set(type, new Set());
        elListeners.get(type).add(fn);
      },
      removeEventListener: (type, fn) => {
        elListeners.get(type)?.delete(fn);
      },
      dispatchEvent: ev => {
        for (const fn of elListeners.get(ev.type) ?? []) fn(ev);
      },
      click: () => el.dispatchEvent({ type: 'click', target: el }),
      querySelector: sel => el.querySelectorAll(sel)[0] ?? null,
      querySelectorAll: sel => {
        const res = [];
        const match = node => {
          if (sel.startsWith('#')) return node.id === sel.slice(1);
          if (sel.startsWith('[') && sel.endsWith(']')) {
            const inner = sel.slice(1, -1);
            if (inner.includes('=')) {
              const [k, raw] = inner.split('=');
              return node.getAttribute(k) === raw.replace(/^["']|["']$/g, '');
            }
            return node.hasAttribute(inner);
          }
          return false;
        };
        const walk = node => {
          for (const c of node.children) {
            if (match(c)) res.push(c);
            walk(c);
          }
        };
        walk(el);
        return res;
      },
    };
    return el;
  }

  const head = createEl('head');
  const body = createEl('body');
  const doc = {
    head,
    body,
    createElement: tag => {
      const n = createEl(tag);
      n.ownerDocument = doc;
      return n;
    },
    defaultView: {
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn); },
      emitKey: code => {
        for (const fn of listeners.get('keydown') ?? []) fn({ code, repeat: false });
      },
    },
  };
  head.ownerDocument = doc;
  body.ownerDocument = doc;
  return { doc, body };
}

test('art themes provide cohesive 2D/3D/UI presets and canonical spec', () => {
  assert.equal(STANDARD_ART_SPEC.toneMapping, 'ueFilmic');
  assert.equal(STANDARD_ART_SPEC.character3dMaxTris, 6000);
  assert.equal(STANDARD_ART_SPEC.character3dMaxVertices, 7500);
  assert.equal(STANDARD_ART_SPEC.character3dHardMaxTris, 8000);
  assert.equal(STANDARD_ART_SPEC.character3dHardMaxVertices, 10000);
  assert.equal(STANDARD_ART_SPEC.character3dLod1TargetTris, 1600);
  assert.equal(STANDARD_ART_SPEC.character3dLod2TargetTris, 350);
  assert.equal(STANDARD_ART_SPEC.maxGpuVertsHardCap, 65535);
  const themes = listArtThemes();
  assert.ok(themes.includes('scifi') && themes.includes('cyber') && themes.includes('ink'));
  for (const id of themes) {
    const t = getArtTheme(id);
    assert.equal(t.id, id);
    const p2 = resolvePresentationPreset(id, '2d');
    const p3 = resolvePresentationPreset(id, '3d', 'high');
    const pTop = resolvePresentationPreset(id, 'topdown', 'high');
    assert.equal(p2.background, ART_THEMES[id].palette.bg);
    assert.equal(p3.renderer.toneMapping, 'ueFilmic');
    assert.equal(p3.quality, 'high');
    assert.equal(pTop.renderer.cameraFov, 42);
    assert.deepEqual(pTop.renderer.cameraPosition, [0, 25, 17.5]);
    assert.deepEqual(pTop.renderer.worldLighting.sun.position, [-24, 44, -18]);
    assert.equal(pTop.renderer.worldLighting.hemisphere.ground, '#171f2e');
  }
  assert.throws(() => getArtTheme('nonexistent'), /Unknown art theme/);
});

test('blueprint validates 5-pillar design, golden ratios, and UI Anti-Bloat budgets', () => {
  for (const genre of listGenreArchetypes()) {
    const bp = createBlueprintFromIdea({ id: `test-${genre}`, title: '测试', genre, theme: 'arcane' });
    const res = evaluateBlueprintBalance(bp, { strictSlice: true });
    assert.equal(res.ok, true, `${genre} failed: ${res.errors.join(', ')}`);
    assert.equal(res.score, 100);
  }

  // Catch unconverted pixel speed (e.g. 220 px/s treated as m/s) and excessive UI buttons
  const badBp = defineGameBlueprint({
    meta: { id: 'bad', title: 'Bad', genre: 'action-2d' },
    design: {
      feel: { playerSpeed: 220, playerRadius: 0.5 },
      balance: { playerHp: 10, gruntHp: 500, gruntDamage: 9, weaponDps: 20, arenaSpan: 10 },
    },
    ui: { maxTitleButtons: 3, cardChoices: 6 },
  });
  const badEval = evaluateBlueprintBalance(badBp);
  assert.equal(badEval.ok, false);
  assert.ok(badEval.errors.some(e => e.includes('speedToBodyRatio')));
  assert.ok(badEval.errors.some(e => e.includes('gruntTtkSeconds')));
  assert.ok(badEval.errors.some(e => e.includes('playerHitsToDie')));
  assert.ok(badEval.errors.some(e => e.includes('uiMaxTitleButtons')));
  assert.ok(badEval.errors.some(e => e.includes('uiCardChoices')));
});

test('audio director maps canonical events, throttles spam, and adapts BGM by phase', () => {
  let clock = 1000;
  const audio = makeFakeAudio();
  const dir = createAudioDirector({
    audio,
    theme: 'cyber',
    overrides: { crit: { cue: 'custom_hit', volume: 0.8 } },
    now: () => clock,
  });

  assert.equal(dir.play(GAME_AUDIO_EVENTS.HIT), true);
  // Immediate repeat within 45ms cooldown is throttled
  clock += 10;
  assert.equal(dir.play(GAME_AUDIO_EVENTS.HIT), false);
  clock += 60;
  assert.equal(dir.play(GAME_AUDIO_EVENTS.HIT), true);
  assert.equal(audio.synths.length, 2);

  // Cue override routes to playCue
  assert.equal(dir.play(GAME_AUDIO_EVENTS.CRIT), true);
  assert.equal(audio.cues.length, 1);
  assert.equal(audio.cues[0].name, 'custom_hit');

  // Phase adaptive BGM
  dir.setPhase('playing', { bossActive: true });
  assert.equal(audio.bgmState.mood, 'boss');
  dir.setPhase('paused');
  assert.equal(audio.bgmState.paused, true);
  dir.setPhase('result', { victory: true });
  assert.equal(audio.bgmState.mood, 'victory');
  assert.equal(audio.bgmState.paused, false);
  dir.dispose();
});

test('game session orchestrates lifecycle, combat, choices, persistence, and UI shell', () => {
  const audio = makeFakeAudio();
  const storage = makeMemoryStorage();
  const hitStops = [];
  const chosen = [];
  const bp = createBlueprintFromIdea({ id: 'session-test', title: '星海试炼', genre: 'action-2d', theme: 'scifi' });

  const session = createGameSession({
    blueprint: bp,
    app: { hitStop: s => hitStops.push(s), platform: { audio } },
    storage,
    onChoice: card => chosen.push(card.id),
  });

  const { doc, body } = makeStubDom();
  const shell = mountGameShell({ root: body, session });

  // Starts on title phase with hidden choice/result/debug
  assert.equal(session.state.phase, 'title');
  assert.equal(body.querySelector('#hg-title').hidden, false);
  assert.equal(body.querySelector('#levelup').hidden, true);
  assert.equal(body.querySelector('#debug').hidden, true);

  // Start run via start button
  body.querySelector('#start').click();
  assert.equal(session.state.phase, 'playing');
  assert.equal(body.querySelector('#hg-title').hidden, true);

  // Crit hit triggers hitstop + combo + score
  session.recordHit({ crit: true, score: 25 });
  assert.equal(hitStops.length, 1);
  assert.equal(session.state.combo, 1);

  // Kills trigger level-up and choice cards
  let leveled = false;
  for (let i = 0; i < 5; i++) {
    const k = session.recordKill({ score: 20, xp: 3, currency: 2 });
    if (k.leveledUp) leveled = true;
  }
  assert.equal(leveled, true);
  session.presentChoices();
  assert.equal(session.state.phase, 'choice');
  assert.equal(body.querySelector('#levelup').hidden, false);

  assert.equal(session.cancelChoice(), true);
  assert.equal(session.state.phase, 'playing');
  assert.deepEqual(session.state.choices, []);
  assert.deepEqual(chosen, []);
  assert.equal(body.querySelector('#levelup').hidden, true);
  assert.equal(session.cancelChoice(), false);
  session.presentChoices();

  // Click first card
  const firstCard = body.querySelector('[data-upgrade="atk-up"]');
  assert.ok(firstCard);
  firstCard.click();
  assert.deepEqual(chosen, ['atk-up']);
  assert.equal(session.state.phase, 'playing');

  // Toggle debug with Backquote
  doc.defaultView.emitKey('Backquote');
  assert.equal(body.querySelector('#debug').hidden, false);
  shell.sync();
  assert.match(body.querySelector('#debug').textContent, /playing/);

  // Damage to 0 ends run and persists bestScore
  session.damagePlayer(999);
  assert.equal(session.state.phase, 'result');
  assert.equal(body.querySelector('#gameover').hidden, false);
  assert.ok(session.state.bestScore >= 125);

  // Restart resets run while keeping bestScore
  body.querySelector('#restart').click();
  assert.equal(session.state.phase, 'playing');
  assert.equal(session.state.hp, bp.design.balance.playerHp);
  assert.ok(session.state.bestScore >= 125);

  shell.dispose();
  session.dispose();
});

test('create-game scaffolds valid 5-pillar archetype projects that pass blueprint & UI gates', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-archetypes-'));
  try {
    for (const [arch, theme] of [
      ['action-2d', 'cyber'],
      ['horde-2d', 'scifi'],
      ['arena-3d', 'arcane'],
      ['card-ui', 'cozy'],
    ]) {
      const gameDir = path.join(tmp, `test-${arch}`);
      const gen = spawnSync(process.execPath, [createGameScript, gameDir, '--archetype', arch, '--theme', theme, '--name', '测试模板', '--no-git'], { encoding: 'utf8' });
      assert.equal(gen.status, 0, `${arch} generation failed: ${gen.stderr}`);

      const bp = JSON.parse(await readFile(path.join(gameDir, 'src', 'game.design.json'), 'utf8'));
      assert.equal(bp.meta.genre, arch);
      assert.equal(bp.art.theme, theme);

      const bpCheck = spawnSync(process.execPath, [checkBlueprintScript, path.join(gameDir, 'src', 'game.design.json'), '--strict-slice'], { encoding: 'utf8' });
      assert.equal(bpCheck.status, 0, `${arch} blueprint check failed: ${bpCheck.stdout} ${bpCheck.stderr}`);

      const jsCheck = spawnSync(process.execPath, ['--check', path.join(gameDir, 'src', 'main.js')], { encoding: 'utf8' });
      assert.equal(jsCheck.status, 0, `${arch} syntax check failed: ${jsCheck.stderr}`);

      const uiCheck = spawnSync(process.execPath, [checkUiScript, '--dir', gameDir], { encoding: 'utf8' });
      assert.equal(uiCheck.status, 0, `${arch} UI check failed: ${uiCheck.stdout} ${uiCheck.stderr}`);

      const docCheck = spawnSync(process.execPath, [path.join(gameDir, 'scripts', 'check-design-docs.mjs'), '.', '--json'], { cwd: gameDir, encoding: 'utf8' });
      assert.equal(docCheck.status, 0, `${arch} design doc check failed: ${docCheck.stdout} ${docCheck.stderr}`);
      const docJson = JSON.parse(docCheck.stdout);
      assert.equal(docJson.ok, true);
      assert.equal(docJson.docs.length, 4);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('per-game design docs gate catches missing docs, placeholders, blueprint drift, and updates acceptance digest', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-design-docs-'));
  const gameDir = path.join(tmp, 'doc-gate-game');
  try {
    const gen = spawnSync(process.execPath, [createGameScript, gameDir, '--archetype', 'action-2d', '--theme', 'scifi', '--name', '文档护栏', '--no-git'], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);
    const inputGuide = await readFile(path.join(gameDir, 'docs', 'design', 'UI-UX.md'), 'utf8');
    assert.match(inputGuide, /Xbox.*X.*A\/Y/);
    assert.match(inputGuide, /取消.*放弃当前升级/);
    assert.match(inputGuide, /\?lang=en/);

    const syncedCheck = path.join(gameDir, 'scripts', 'check-design-docs.mjs');
    const syncedAccept = path.join(gameDir, 'scripts', 'accept.mjs');

    // Quick accept passes with designDocs gate active
    const okAccept = spawnSync(process.execPath, [syncedAccept, '.', '--quick', '--json'], { cwd: gameDir, encoding: 'utf8' });
    assert.equal(okAccept.status, 0, okAccept.stdout + okAccept.stderr);
    assert.equal(JSON.parse(okAccept.stdout).gates.designDocs.status, 'passed');

    // Digest changes when a design doc changes
    const { computeSourceDigest } = await import('../scripts/accept.mjs');
    const digestBefore = computeSourceDigest(gameDir);
    const gddPath = path.join(gameDir, 'docs', 'design', 'GDD.md');
    const origGdd = await readFile(gddPath, 'utf8');
    await writeFile(gddPath, origGdd + '\n| v0.2.0 | 2026-11-21 | 平衡 | 调整测试 | `npm test` |\n');
    const digestAfter = computeSourceDigest(gameDir);
    assert.notEqual(digestAfter, digestBefore);

    // Unresolved TODO in UI-UX.md fails check-design-docs & accept
    const uiPath = path.join(gameDir, 'docs', 'design', 'UI-UX.md');
    const origUi = await readFile(uiPath, 'utf8');
    await writeFile(uiPath, origUi + '\nTODO: fill later\n');
    const badTodo = spawnSync(process.execPath, [syncedCheck, '.', '--json'], { cwd: gameDir, encoding: 'utf8' });
    assert.equal(badTodo.status, 1);
    assert.ok(JSON.parse(badTodo.stdout).errors.some(e => e.includes('placeholder')));
    await writeFile(uiPath, origUi);

    // Blueprint theme drift (changing src/game.design.json without updating ART-AND-AUDIO.md) fails
    const bpPath = path.join(gameDir, 'src', 'game.design.json');
    const origBp = await readFile(bpPath, 'utf8');
    const drifted = JSON.parse(origBp);
    drifted.art.theme = 'ink';
    await writeFile(bpPath, JSON.stringify(drifted, null, 2));
    const badDrift = spawnSync(process.execPath, [syncedCheck, '.', '--json'], { cwd: gameDir, encoding: 'utf8' });
    assert.equal(badDrift.status, 1);
    assert.ok(JSON.parse(badDrift.stdout).errors.some(e => e.includes('out of sync')));
    await writeFile(bpPath, origBp);

    // Missing LEVEL.md fails accept --quick
    const levelPath = path.join(gameDir, 'docs', 'design', 'LEVEL.md');
    await rm(levelPath);
    const badMissing = spawnSync(process.execPath, [syncedAccept, '.', '--quick', '--json'], { cwd: gameDir, encoding: 'utf8' });
    assert.equal(badMissing.status, 1);
    assert.equal(JSON.parse(badMissing.stdout).gates.designDocs.status, 'failed');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
