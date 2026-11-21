// Universal GameSession orchestrator linking Blueprint, UiDirector, AudioDirector, Save & Run Loop.
import { createVersionedStore } from '../platform/storage.js';
import { createSeededRng } from '../sim/rng.js';
import { createUiDirector, UI_PHASES } from '../ui/ux-director.js';
import { createAudioDirector, GAME_AUDIO_EVENTS } from './audio-director.js';
import { defineGameBlueprint } from './blueprint.js';

const SAVE_KEY = 'session.meta';

/**
 * @typedef {object} GameChoiceCard
 * @property {string} id
 * @property {string} label
 * @property {string} [pos]
 * @property {string} [neg]
 * @property {string} [icon]
 * @property {Record<string, unknown>} [payload]
 */

/**
 * @typedef {object} GameSessionOptions
 * @property {ReturnType<typeof defineGameBlueprint> | object} [blueprint]
 * @property {{ hitStop?: (seconds: number) => void, platform?: { audio?: object, save?: object } } | null} [app=null]
 * @property {ReturnType<typeof createUiDirector> | null} [director=null]
 * @property {ReturnType<typeof createAudioDirector> | null} [audioDirector=null]
 * @property {ReturnType<typeof createVersionedStore> | null} [saveStore=null]
 * @property {Storage | null} [storage=null]
 * @property {number} [seed=1337]
 * @property {'title' | 'playing'} [initialPhase='title']
 * @property {(choice: GameChoiceCard, index: number, session: unknown) => void} [onChoice]
 * @property {(phase: string, prevPhase: string, payload: unknown) => void} [onPhaseChange]
 * @property {(session: unknown) => void} [onStartRun]
 * @property {(summary: object, session: unknown) => void} [onEndRun]
 */

/**
 * Create a unified Gameplay Run & Session controller across 2D, 3D, and UI games.
 * @param {GameSessionOptions} [options]
 */
export function createGameSession(options = {}) {
  const blueprint = options.blueprint?.schemaVersion === 1
    ? options.blueprint
    : defineGameBlueprint(options.blueprint ?? {});

  const app = options.app ?? null;
  const maxHp = Math.max(1, blueprint.design.balance.playerHp);
  const startCurrency = blueprint.design.progression.economy?.startingAmount ?? 0;

  const ownsDirector = !options.director;
  const director = options.director ?? createUiDirector({
    initialPhase: options.initialPhase === UI_PHASES.PLAYING ? UI_PHASES.PLAYING : UI_PHASES.TITLE,
    audio: app?.platform?.audio ?? null,
    hintEnabled: blueprint.meta.perspective !== 'ui',
    metrics: {
      hp: { value: maxHp, snap: true },
      score: { value: 0 },
      kills: { value: 0, snap: true },
      wave: { value: 1, snap: true },
      level: { value: 1, snap: true },
      currency: { value: startCurrency },
      timer: { value: 0, snap: true },
    },
    bars: {
      hp: { value: 1 },
      xp: { value: 0 },
    },
  });

  const ownsAudioDirector = !options.audioDirector;
  const audioDirector = options.audioDirector ?? createAudioDirector({
    audio: app?.platform?.audio ?? null,
    theme: blueprint.art.theme,
    mood: blueprint.audio.mood,
    profile: blueprint.audio.profile,
    overrides: blueprint.audio.overrides,
  });

  const saveStore = options.saveStore ?? createVersionedStore({
    gameId: blueprint.meta.id,
    storage: options.storage ?? undefined,
    schemaVersion: 1,
  });

  let savedMeta = { bestScore: 0, runs: 0, totalKills: 0 };
  try {
    const loaded = saveStore.load(SAVE_KEY, savedMeta);
    if (loaded?.ok && loaded.value && typeof loaded.value === 'object') {
      savedMeta = {
        bestScore: Number(loaded.value.bestScore) || 0,
        runs: Number(loaded.value.runs) || 0,
        totalKills: Number(loaded.value.totalKills) || 0,
      };
    }
  } catch { /* Non-fatal in restricted storage environments. */ }

  let rng = createSeededRng(options.seed ?? 1337);
  let disposed = false;

  const state = {
    phase: director.getPhase(),
    hp: maxHp,
    maxHp,
    xp: 0,
    nextXp: 10,
    level: 1,
    score: 0,
    bestScore: savedMeta.bestScore,
    kills: 0,
    wave: 1,
    bossActive: false,
    elapsed: 0,
    currency: startCurrency,
    combo: 0,
    comboTimer: 0,
    victory: false,
    /** @type {GameChoiceCard[]} */
    choices: [],
  };

  function syncUi() {
    director.setMetric('hp', Math.ceil(state.hp));
    director.setMetric('score', Math.floor(state.score));
    director.setMetric('kills', state.kills);
    director.setMetric('wave', state.wave);
    director.setMetric('level', state.level);
    director.setMetric('currency', Math.floor(state.currency));
    director.setMetric('timer', Math.floor(state.elapsed));
    director.setBar('hp', state.maxHp > 0 ? state.hp / state.maxHp : 0);
    director.setBar('xp', state.nextXp > 0 ? state.xp / state.nextXp : 0);
  }

  function persistMeta() {
    try {
      saveStore.save(SAVE_KEY, savedMeta);
    } catch { /* Ignore quota errors during run teardown. */ }
  }

  const unsubPhase = director.onPhaseChange((event) => {
    const nextPhase = typeof event === 'string' ? event : event?.phase;
    const prevPhase = typeof event === 'string' ? state.phase : event?.prevPhase;
    const payload = typeof event === 'string' ? null : event?.payload;
    state.phase = nextPhase;
    audioDirector.setPhase(nextPhase, {
      bossActive: state.bossActive,
      victory: state.victory,
      intensity: Math.min(1, 0.45 + state.wave * 0.08 + Math.min(0.25, state.combo * 0.02)),
    });
    options.onPhaseChange?.(nextPhase, prevPhase, payload);
  });

  function resetRunValues() {
    state.hp = state.maxHp;
    state.xp = 0;
    state.nextXp = 10;
    state.level = 1;
    state.score = 0;
    state.kills = 0;
    state.wave = 1;
    state.bossActive = false;
    state.elapsed = 0;
    state.currency = startCurrency;
    state.combo = 0;
    state.comboTimer = 0;
    state.victory = false;
    state.choices = [];
    rng = createSeededRng(options.seed ?? 1337);
    syncUi();
  }

  function startRun() {
    if (disposed) return state;
    resetRunValues();
    audioDirector.unlock();
    director.startGame();
    audioDirector.play(GAME_AUDIO_EVENTS.UI_CONFIRM);
    options.onStartRun?.(api);
    return state;
  }

  function pause() {
    if (disposed || state.phase !== UI_PHASES.PLAYING) return state.phase;
    director.pause();
    audioDirector.play(GAME_AUDIO_EVENTS.UI_OPEN);
    return state.phase;
  }

  function resume() {
    if (disposed || state.phase !== UI_PHASES.PAUSED) return state.phase;
    director.resume();
    audioDirector.play(GAME_AUDIO_EVENTS.UI_CLOSE);
    return state.phase;
  }

  function togglePause() {
    if (state.phase === UI_PHASES.PLAYING) return pause();
    if (state.phase === UI_PHASES.PAUSED) return resume();
    return state.phase;
  }

  /**
   * Present up to 4 whole-card upgrade/event choices and transition to `choice` phase.
   * @param {GameChoiceCard[]} [choices]
   */
  function presentChoices(choices) {
    if (disposed) return [];
    const pool = Array.isArray(choices) && choices.length > 0
      ? choices
      : blueprint.design.progression.upgrades;
    const cap = Math.max(1, Math.min(4, blueprint.ui.cardChoices || 3));
    state.choices = pool.slice(0, cap).map(c => ({ ...c }));
    director.openChoice({ choices: state.choices });
    audioDirector.play(GAME_AUDIO_EVENTS.LEVEL_UP);
    return state.choices;
  }

  /** @param {number} index */
  function selectChoice(index) {
    if (disposed || state.phase !== UI_PHASES.CHOICE) return null;
    const picked = state.choices[index] ?? null;
    if (!picked) return null;
    state.choices = [];
    director.closeChoice();
    audioDirector.play(GAME_AUDIO_EVENTS.UI_REWARD);
    options.onChoice?.(picked, index, api);
    return picked;
  }

  /**
   * End the current run, save best score / run totals, and transition to `result` phase.
   * @param {{ victory?: boolean, bonusScore?: number }} [summary]
   */
  function endRun(summary = {}) {
    if (disposed) return null;
    if (state.phase === UI_PHASES.RESULT) return snapshot();
    const bonus = Number.isFinite(summary.bonusScore) ? summary.bonusScore : 0;
    state.score += bonus;
    state.victory = Boolean(summary.victory);
    savedMeta.runs += 1;
    savedMeta.totalKills += state.kills;
    if (state.score > savedMeta.bestScore) savedMeta.bestScore = Math.floor(state.score);
    state.bestScore = savedMeta.bestScore;
    persistMeta();
    syncUi();

    const payload = {
      victory: state.victory,
      score: Math.floor(state.score),
      bestScore: state.bestScore,
      kills: state.kills,
      wave: state.wave,
      elapsed: state.elapsed,
    };
    director.finishRun(payload);
    audioDirector.play(state.victory ? GAME_AUDIO_EVENTS.VICTORY : GAME_AUDIO_EVENTS.DEFEAT);
    options.onEndRun?.(payload, api);
    return payload;
  }

  function restart() {
    return startRun();
  }

  /**
   * Record an offensive hit with optional hitstop and audio feedback.
   * @param {{ damage?: number, crit?: boolean, score?: number, hitStopSec?: number }} [info]
   */
  function recordHit(info = {}) {
    if (disposed || state.phase !== UI_PHASES.PLAYING) return;
    state.combo += 1;
    state.comboTimer = 2.5;
    if (Number.isFinite(info.score) && info.score > 0) state.score += info.score;
    const hitStopSec = Number.isFinite(info.hitStopSec)
      ? info.hitStopSec
      : (info.crit ? (blueprint.design.feel.hitStopMs / 1000) : 0);
    if (hitStopSec > 0) app?.hitStop?.(hitStopSec);
    audioDirector.play(info.crit ? GAME_AUDIO_EVENTS.CRIT : GAME_AUDIO_EVENTS.HIT);
    syncUi();
  }

  /**
   * Record an enemy kill, grant XP/score/currency, and emit kill/pickup feedback.
   * @param {{ score?: number, xp?: number, currency?: number }} [info]
   */
  function recordKill(info = {}) {
    if (disposed || state.phase !== UI_PHASES.PLAYING) return { leveledUp: false };
    state.kills += 1;
    state.combo += 1;
    state.comboTimer = 2.8;
    state.score += Number.isFinite(info.score) ? info.score : 10;
    state.currency += Number.isFinite(info.currency) ? info.currency : 1;
    const xpGain = Number.isFinite(info.xp) ? info.xp : 2;
    state.xp += xpGain;
    let leveledUp = false;
    if (state.xp >= state.nextXp) {
      state.xp -= state.nextXp;
      state.level += 1;
      state.nextXp = Math.round(state.nextXp * 1.4 + 6);
      leveledUp = true;
    }
    audioDirector.play(GAME_AUDIO_EVENTS.KILL);
    syncUi();
    return { leveledUp, level: state.level };
  }

  /**
   * Apply damage to the player; triggers `endRun({ victory: false })` at 0 HP.
   * @param {number} amount
   */
  function damagePlayer(amount) {
    if (disposed || state.phase !== UI_PHASES.PLAYING) return state.hp;
    const dmg = Math.max(0, Number(amount) || 0);
    if (dmg <= 0) return state.hp;
    state.hp = Math.max(0, state.hp - dmg);
    state.combo = 0;
    audioDirector.play(GAME_AUDIO_EVENTS.HURT);
    syncUi();
    if (state.hp <= 0) endRun({ victory: false });
    return state.hp;
  }

  /** @param {number} amount */
  function healPlayer(amount) {
    if (disposed) return state.hp;
    const heal = Math.max(0, Number(amount) || 0);
    state.hp = Math.min(state.maxHp, state.hp + heal);
    if (heal > 0) audioDirector.play(GAME_AUDIO_EVENTS.PICKUP);
    syncUi();
    return state.hp;
  }

  /** @param {number} amount */
  function addCurrency(amount) {
    if (disposed) return state.currency;
    state.currency = Math.max(0, state.currency + (Number(amount) || 0));
    audioDirector.play(GAME_AUDIO_EVENTS.PICKUP);
    syncUi();
    return state.currency;
  }

  /**
   * Advance or set current wave and optional boss state.
   * @param {number} wave
   * @param {{ bossActive?: boolean }} [meta]
   */
  function setWave(wave, meta = {}) {
    if (disposed) return state.wave;
    state.wave = Math.max(1, Math.floor(Number(wave) || 1));
    state.bossActive = Boolean(meta.bossActive);
    audioDirector.setPhase(state.phase, { bossActive: state.bossActive });
    audioDirector.play(state.bossActive ? GAME_AUDIO_EVENTS.BOSS_SPAWN : GAME_AUDIO_EVENTS.WAVE_START);
    syncUi();
    return state.wave;
  }

  /**
   * Advance session timers, UI director springs, and adaptive BGM clock.
   * @param {number} dt
   */
  function update(dt) {
    if (disposed) return;
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (state.phase === UI_PHASES.PLAYING) {
      state.elapsed += safeDt;
      if (state.comboTimer > 0) {
        state.comboTimer = Math.max(0, state.comboTimer - safeDt);
        if (state.comboTimer === 0) state.combo = 0;
      }
      director.setMetric('timer', Math.floor(state.elapsed));
    }
    director.update(safeDt);
    audioDirector.update(safeDt);
  }

  function snapshot() {
    return {
      phase: state.phase,
      hp: state.hp,
      maxHp: state.maxHp,
      xp: state.xp,
      nextXp: state.nextXp,
      level: state.level,
      score: Math.floor(state.score),
      bestScore: state.bestScore,
      kills: state.kills,
      wave: state.wave,
      bossActive: state.bossActive,
      elapsed: Number(state.elapsed.toFixed(2)),
      currency: Math.floor(state.currency),
      combo: state.combo,
      victory: state.victory,
      choices: state.choices.map(c => c.id),
      meta: { ...savedMeta },
      ui: director.snapshot(),
      audio: audioDirector.snapshot(),
    };
  }

  syncUi();
  audioDirector.setPhase(state.phase);

  const api = Object.freeze({
    blueprint,
    director,
    audio: audioDirector,
    saveStore,
    get rng() { return rng; },
    get state() { return state; },
    startRun,
    pause,
    resume,
    togglePause,
    presentChoices,
    selectChoice,
    endRun,
    restart,
    recordHit,
    recordKill,
    damagePlayer,
    healPlayer,
    addCurrency,
    setWave,
    notifyMoved: () => director.notifyMoved(),
    update,
    snapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubPhase();
      if (ownsAudioDirector) audioDirector.dispose();
      if (ownsDirector) director.dispose();
    },
  });
  return api;
}
