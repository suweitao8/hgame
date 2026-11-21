// Universal game audio matrix & adaptive BGM director with 0-KB synth defaults and cue overrides.
import { getArtTheme } from './art-themes.js';

/** Canonical gameplay and UI audio event identifiers. */
export const GAME_AUDIO_EVENTS = Object.freeze({
  ATTACK: 'attack',
  HIT: 'hit',
  CRIT: 'crit',
  KILL: 'kill',
  DASH: 'dash',
  HURT: 'hurt',
  PICKUP: 'pickup',
  LEVEL_UP: 'levelup',
  WAVE_START: 'waveStart',
  BOSS_SPAWN: 'bossSpawn',
  VICTORY: 'victory',
  DEFEAT: 'defeat',
  INTERACT: 'interact',
  UI_HOVER: 'uiHover',
  UI_PRESS: 'uiPress',
  UI_CONFIRM: 'uiConfirm',
  UI_CANCEL: 'uiCancel',
  UI_OPEN: 'uiOpen',
  UI_CLOSE: 'uiClose',
  UI_REWARD: 'uiReward',
  UI_ERROR: 'uiError',
});

/** Default 0-KB synth preset + anti-spam cooldown matrix for every canonical audio event. */
export const DEFAULT_AUDIO_MATRIX = Object.freeze({
  attack: Object.freeze({ preset: 'slash', volume: 0.42, pitchJitter: 0.08, cooldownMs: 55 }),
  hit: Object.freeze({ preset: 'hit', volume: 0.38, pitchJitter: 0.12, cooldownMs: 45 }),
  crit: Object.freeze({ preset: 'explosion', volume: 0.48, pitchJitter: 0.08, cooldownMs: 90 }),
  kill: Object.freeze({ preset: 'pickup', volume: 0.36, pitchJitter: 0.14, cooldownMs: 55 }),
  dash: Object.freeze({ preset: 'laser', volume: 0.38, pitchJitter: 0.06, cooldownMs: 120 }),
  hurt: Object.freeze({ preset: 'hurt', volume: 0.56, pitchJitter: 0.04, cooldownMs: 140 }),
  pickup: Object.freeze({ preset: 'pickup', volume: 0.32, pitchJitter: 0.15, cooldownMs: 40 }),
  levelup: Object.freeze({ preset: 'powerup', volume: 0.58, pitchJitter: 0.02, cooldownMs: 250 }),
  waveStart: Object.freeze({ preset: 'powerup', volume: 0.45, pitchJitter: 0.02, cooldownMs: 300 }),
  bossSpawn: Object.freeze({ preset: 'explosion', volume: 0.65, pitchJitter: 0.02, cooldownMs: 500 }),
  victory: Object.freeze({ preset: 'powerup', volume: 0.64, pitchJitter: 0, cooldownMs: 300 }),
  defeat: Object.freeze({ preset: 'hurt', volume: 0.62, pitchJitter: 0, cooldownMs: 300 }),
  interact: Object.freeze({ preset: 'click', volume: 0.36, pitchJitter: 0.04, cooldownMs: 60 }),
  uiHover: Object.freeze({ preset: 'click', volume: 0.12, pitchJitter: 0.05, cooldownMs: 45 }),
  uiPress: Object.freeze({ preset: 'click', volume: 0.22, pitchJitter: 0.04, cooldownMs: 30 }),
  uiConfirm: Object.freeze({ preset: 'pickup', volume: 0.28, pitchJitter: 0.03, cooldownMs: 60 }),
  uiCancel: Object.freeze({ preset: 'hit', volume: 0.22, pitchJitter: 0.03, cooldownMs: 60 }),
  uiOpen: Object.freeze({ preset: 'pickup', volume: 0.24, pitchJitter: 0.03, cooldownMs: 80 }),
  uiClose: Object.freeze({ preset: 'click', volume: 0.2, pitchJitter: 0.03, cooldownMs: 80 }),
  uiReward: Object.freeze({ preset: 'powerup', volume: 0.34, pitchJitter: 0.02, cooldownMs: 120 }),
  uiError: Object.freeze({ preset: 'hurt', volume: 0.25, pitchJitter: 0.02, cooldownMs: 120 }),
});

/** Genre audio mixing profiles. */
export const AUDIO_PROFILES = Object.freeze({
  action: Object.freeze({ bgmVolume: 0.36, baseIntensity: 0.55, combatIntensity: 0.78 }),
  arcade: Object.freeze({ bgmVolume: 0.38, baseIntensity: 0.62, combatIntensity: 0.85 }),
  tactical: Object.freeze({ bgmVolume: 0.3, baseIntensity: 0.38, combatIntensity: 0.65 }),
  cozy: Object.freeze({ bgmVolume: 0.32, baseIntensity: 0.28, combatIntensity: 0.48 }),
});

/**
 * @typedef {object} AudioDirectorOptions
 * @property {import('../platform/audio.js').AudioManager | null} [audio=null]
 * @property {string} [theme='scifi']
 * @property {string} [mood]
 * @property {'action' | 'arcade' | 'tactical' | 'cozy'} [profile='action']
 * @property {boolean} [bgmEnabled=true]
 * @property {Record<string, { cue?: string, preset?: string | object, volume?: number, pitchJitter?: number, cooldownMs?: number }>} [overrides]
 * @property {() => number} [now]
 */

/**
 * Create a unified AudioDirector that maps game/UI events to custom cues or 0-KB synth defaults
 * and coordinates adaptive BGM mood/intensity transitions across game phases.
 * @param {AudioDirectorOptions} [options]
 */
export function createAudioDirector(options = {}) {
  const audio = options.audio ?? null;
  const theme = getArtTheme(options.theme ?? 'scifi');
  const baseMood = options.mood ?? theme.audioMood ?? 'adventure';
  const profile = AUDIO_PROFILES[options.profile ?? 'action'] ?? AUDIO_PROFILES.action;
  const nowFn = typeof options.now === 'function' ? options.now : () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const bgmEnabled = options.bgmEnabled !== false;

  const matrix = new Map(Object.entries(DEFAULT_AUDIO_MATRIX).map(([k, v]) => [k, { ...v }]));
  if (options.overrides && typeof options.overrides === 'object') {
    for (const [k, v] of Object.entries(options.overrides)) {
      if (v && typeof v === 'object') matrix.set(k, { ...(matrix.get(k) ?? {}), ...v });
    }
  }

  const lastPlayedAt = new Map();
  let muted = Boolean(audio?.muted);
  let phase = 'title';
  let intensity = profile.baseIntensity;
  let currentMood = baseMood;
  let playedCount = 0;
  let throttledCount = 0;
  let disposed = false;

  const bgm = bgmEnabled && typeof audio?.createBgm === 'function'
    ? audio.createBgm({ mood: baseMood, intensity, volume: profile.bgmVolume })
    : null;
  let bgmStarted = false;

  function ensureUnlockedAndBgm() {
    if (disposed || muted) return;
    if (typeof audio?.unlock === 'function') {
      void audio.unlock().catch(() => {});
    }
    if (bgm && !bgmStarted) {
      bgmStarted = true;
      bgm.start?.();
    }
  }

  /**
   * Register or override cue/synth rules for one or more game events.
   * @param {Record<string, { cue?: string, preset?: string | object, volume?: number, pitchJitter?: number, cooldownMs?: number }>} map
   */
  function registerCueOverrides(map) {
    if (!map || typeof map !== 'object') return;
    for (const [event, cfg] of Object.entries(map)) {
      if (cfg && typeof cfg === 'object') {
        matrix.set(event, { ...(matrix.get(event) ?? {}), ...cfg });
      }
    }
  }

  /**
   * Play a canonical or custom game audio event with anti-spam throttling.
   * @param {string} event
   * @param {object} [playOpts]
   */
  function play(event, playOpts = {}) {
    if (disposed || !event) return false;
    const rule = matrix.get(event) ?? { preset: 'click', volume: 0.35, pitchJitter: 0.04, cooldownMs: 45 };
    const t = nowFn();
    const cooldownMs = Number.isFinite(playOpts.cooldownMs) ? playOpts.cooldownMs : (rule.cooldownMs ?? 45);
    const prev = lastPlayedAt.get(event) ?? -Infinity;
    if (t - prev < cooldownMs) {
      throttledCount++;
      return false;
    }
    lastPlayedAt.set(event, t);
    playedCount++;

    if (muted || !audio) return true;
    if (!String(event).startsWith('ui')) ensureUnlockedAndBgm();

    const volume = Number.isFinite(playOpts.volume) ? playOpts.volume : (rule.volume ?? 0.4);
    const pitchJitter = Number.isFinite(playOpts.pitchJitter) ? playOpts.pitchJitter : (rule.pitchJitter ?? 0.04);

    if (rule.cue && typeof audio.hasCue === 'function' && audio.hasCue(rule.cue) && typeof audio.playCue === 'function') {
      audio.playCue(rule.cue, { ...playOpts, volume });
      return true;
    }
    if (typeof audio.playSynth === 'function' && rule.preset) {
      audio.playSynth(rule.preset, {
        ...playOpts,
        volume,
        pitchJitter,
      });
      return true;
    }
    return false;
  }

  /**
   * Sync adaptive BGM mood, intensity, and ducking to the active game phase.
   * @param {'title' | 'playing' | 'paused' | 'choice' | 'result'} nextPhase
   * @param {{ bossActive?: boolean, victory?: boolean, intensity?: number }} [meta]
   */
  function setPhase(nextPhase, meta = {}) {
    if (disposed) return;
    phase = nextPhase;
    let nextMood = baseMood;
    let nextIntensity = Number.isFinite(meta.intensity) ? meta.intensity : intensity;
    let nextVolume = profile.bgmVolume;

    if (nextPhase === 'title') {
      nextIntensity = 0.25;
      nextVolume = profile.bgmVolume * 0.72;
      bgm?.resume?.();
    } else if (nextPhase === 'playing') {
      nextMood = meta.bossActive ? 'boss' : baseMood;
      nextIntensity = Number.isFinite(meta.intensity) ? meta.intensity : profile.combatIntensity;
      bgm?.resume?.();
    } else if (nextPhase === 'choice') {
      nextIntensity = 0.35;
      nextVolume = profile.bgmVolume * 0.65;
      bgm?.resume?.();
    } else if (nextPhase === 'paused') {
      nextVolume = profile.bgmVolume * 0.35;
      bgm?.pause?.();
    } else if (nextPhase === 'result') {
      nextMood = meta.victory ? 'victory' : 'chill';
      nextIntensity = meta.victory ? 0.75 : 0.22;
      nextVolume = profile.bgmVolume * 0.85;
      bgm?.resume?.();
    }

    currentMood = nextMood;
    intensity = Math.max(0, Math.min(1, nextIntensity));
    if (bgm) {
      bgm.setMood?.(currentMood);
      bgm.setIntensity?.(intensity);
      bgm.setVolume?.(nextVolume);
    }
  }

  /** @param {number} value */
  function setIntensity(value) {
    intensity = Math.max(0, Math.min(1, Number(value) || 0));
    bgm?.setIntensity?.(intensity);
  }

  /** @param {boolean} nextMuted */
  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    audio?.setMuted?.(muted);
    bgm?.setMuted?.(muted);
    return muted;
  }

  /** @param {number} dt */
  function update(dt) {
    if (!disposed && bgm) bgm.update?.(dt);
  }

  return Object.freeze({
    play,
    setPhase,
    setIntensity,
    setMuted,
    isMuted: () => muted,
    unlock: ensureUnlockedAndBgm,
    registerCueOverrides,
    update,
    snapshot: () => ({
      phase,
      mood: currentMood,
      intensity,
      muted,
      playedCount,
      throttledCount,
      bgm: bgm?.getState?.() ?? null,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      bgm?.dispose?.();
      lastPlayedAt.clear();
      matrix.clear();
    },
  });
}
