import { SpringDamper1D } from '../time/tween.js';
import { createPanelStack } from './panel-stack.js';

/** Standard cross-game UI flow phases. */
export const UI_PHASES = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  CHOICE: 'choice',
  RESULT: 'result',
});

/** Semantic UI/UX interaction cues routed to audio/haptics. */
export const UI_UX_CUES = Object.freeze({
  HOVER: 'hover',
  PRESS: 'press',
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
  OPEN: 'open',
  CLOSE: 'close',
  REWARD: 'reward',
  ERROR: 'error',
  METRIC_UP: 'metricUp',
  METRIC_DOWN: 'metricDown',
});

const DEFAULT_CUE_SYNTH = Object.freeze({
  hover: Object.freeze({
    preset: Object.freeze({
      wave: 'sine', freqStart: 1320, freqEnd: 1620, duration: 0.022,
      gain: 0.1, noiseMix: 0, filterType: 'highpass', filterStartHz: 700, filterEndHz: 700, attack: 0.001,
    }),
    volume: 0.14,
    pitchJitter: 0.05,
    cooldownMs: 45,
  }),
  press: Object.freeze({ preset: 'click', volume: 0.18, pitchJitter: 0.04, cooldownMs: 30 }),
  confirm: Object.freeze({ preset: 'pickup', volume: 0.22, pitchJitter: 0.03, cooldownMs: 60 }),
  cancel: Object.freeze({
    preset: Object.freeze({
      wave: 'triangle', freqStart: 420, freqEnd: 220, duration: 0.06,
      gain: 0.2, noiseMix: 0.05, filterType: 'lowpass', filterStartHz: 1800, filterEndHz: 600, attack: 0.002,
    }),
    volume: 0.18,
    pitchJitter: 0.02,
    cooldownMs: 60,
  }),
  open: Object.freeze({
    preset: Object.freeze({
      wave: 'triangle', freqStart: 380, freqEnd: 720, duration: 0.09,
      gain: 0.18, noiseMix: 0.04, filterType: 'lowpass', filterStartHz: 2600, filterEndHz: 4200, attack: 0.003,
    }),
    volume: 0.18,
    pitchJitter: 0.02,
    cooldownMs: 80,
  }),
  close: Object.freeze({
    preset: Object.freeze({
      wave: 'sine', freqStart: 620, freqEnd: 320, duration: 0.07,
      gain: 0.16, noiseMix: 0, filterType: 'lowpass', filterStartHz: 2200, filterEndHz: 800, attack: 0.002,
    }),
    volume: 0.16,
    pitchJitter: 0.02,
    cooldownMs: 80,
  }),
  reward: Object.freeze({ preset: 'powerup', volume: 0.24, pitchJitter: 0.02, cooldownMs: 100 }),
  error: Object.freeze({ preset: 'hurt', volume: 0.18, pitchJitter: 0.02, cooldownMs: 120 }),
  metricUp: Object.freeze({
    preset: Object.freeze({
      wave: 'sine', freqStart: 880, freqEnd: 1175, duration: 0.045,
      gain: 0.12, noiseMix: 0, filterType: 'lowpass', filterStartHz: 4500, filterEndHz: 4500, attack: 0.001,
    }),
    volume: 0.14,
    pitchJitter: 0.06,
    cooldownMs: 55,
  }),
  metricDown: Object.freeze({ preset: 'hit', volume: 0.15, pitchJitter: 0.04, cooldownMs: 75 }),
});

/**
 * @typedef {object} UiMetricOptions
 * @property {number} [value=0] Initial numeric value.
 * @property {number} [halfLife=0.09] Spring smoothing half-life (seconds); 0 snaps immediately.
 * @property {boolean} [snap=false] If true, `displayValue` tracks `value` immediately while `pulse` still animates.
 * @property {boolean} [cueOnChange=false] Emit `metricUp` / `metricDown` cues when the value changes.
 */

/**
 * @typedef {object} UiMetricState
 * @property {string} id
 * @property {number} value Target value.
 * @property {number} displayValue Smoothed display value.
 * @property {number} pulse Pop intensity [0..1] after a change.
 * @property {-1 | 0 | 1} direction Last change direction.
 * @property {number} lastDelta Last numeric delta applied.
 * @property {boolean} settled
 */

/**
 * @typedef {object} UiBarOptions
 * @property {number} [value=1] Initial normalized fill ratio [0..1].
 * @property {number} [holdSec=0.28] Delay in seconds before the ghost trail catches up after damage.
 * @property {number} [halfLife=0.09] Catch-up spring half-life in seconds.
 */

/**
 * @typedef {object} UiBarState
 * @property {string} id
 * @property {number} value Primary fill ratio [0..1].
 * @property {number} ghostValue Trailing/preview fill ratio [0..1].
 * @property {-1 | 0 | 1} direction Last change direction.
 * @property {number} holdRemaining Remaining ghost hold time in seconds.
 * @property {boolean} settled
 */

/**
 * @typedef {object} UiCooldownOptions
 * @property {number} [remaining=0] Initial remaining cooldown in seconds.
 * @property {number} [duration=1] Total cooldown duration in seconds.
 * @property {boolean} [cueOnReady=true] Emit `confirm` cue when transitioning from active cooldown to ready.
 */

/**
 * @typedef {object} UiCooldownState
 * @property {string} id
 * @property {number} remaining Remaining seconds.
 * @property {number} duration Total seconds.
 * @property {number} ratio Remaining fraction [0..1] (0 = ready, 1 = full cooldown).
 * @property {boolean} ready True when remaining <= 0.
 * @property {number} readyFlash Flash intensity [0..1] decaying after becoming ready.
 * @property {boolean} settled
 */

/**
 * @typedef {object} UiDirectorOptions
 * @property {'title' | 'playing' | 'paused' | 'choice' | 'result'} [initialPhase='title']
 * @property {ReturnType<typeof createPanelStack>} [panelStack] Optional existing PanelStack to reuse.
 * @property {Record<string, import('./panel-stack.js').PanelDefinition>} [panels] Extra panel definitions.
 * @property {Record<string, UiMetricOptions | number>} [metrics] Initial HUD metrics to track.
 * @property {Record<string, UiBarOptions | number>} [bars] Initial ghost-trail bars to track.
 * @property {Record<string, UiCooldownOptions | number>} [cooldowns] Initial radial cooldown rings to track.
 * @property {{ available?: boolean, playSynth?: (preset: unknown, opts?: object) => unknown } | null} [audio=null] Optional HGame audio service.
 * @property {boolean} [hintEnabled=true] Show initial move/action hint until `notifyMoved()`.
 * @property {number} [hintFadeSec=0.5] Seconds to fade out hint after first movement.
 * @property {() => number} [now] Clock function in milliseconds for cue throttling.
 * @property {(event: { phase: string, prevPhase: string, paused: boolean, payload: unknown }) => void} [onPhaseChange]
 * @property {(cue: string, detail: unknown) => void} [onCue]
 */

/**
 * Universal game UI/UX state & feedback coordinator for 2D, 3D, and DOM/card games.
 * Manages game phase flow, modal stack synchronization, smooth HUD metric roll-up & pulse,
 * first-move hint auto-fade, and throttled procedural UI audio cues.
 *
 * @param {UiDirectorOptions} [options={}]
 */
export function createUiDirector(options = {}) {
  const validPhases = new Set(Object.values(UI_PHASES));
  const initialPhase = validPhases.has(options.initialPhase) ? options.initialPhase : UI_PHASES.TITLE;
  const nowFn = typeof options.now === 'function'
    ? options.now
    : () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
  const audio = options.audio ?? null;
  const hintFadeSec = Number.isFinite(options.hintFadeSec) && options.hintFadeSec > 0 ? options.hintFadeSec : 0.5;
  const hintEnabled = options.hintEnabled !== false;

  const panelStack = options.panelStack ?? createPanelStack({
    panels: {
      hud: { pinned: true, closeOnCancel: false, transitionMs: 0, motion: 'none' },
      title: { modal: false, closeOnCancel: false, transitionMs: 180, motion: 'fade' },
      pause: { modal: true, closeOnCancel: true, closeOnBackdrop: true, transitionMs: 160, motion: 'pop' },
      choice: { modal: true, closeOnCancel: false, closeOnBackdrop: false, transitionMs: 200, motion: 'slide-up' },
      result: { modal: true, closeOnCancel: false, closeOnBackdrop: false, transitionMs: 220, motion: 'pop' },
      ...(options.panels ?? {}),
    },
  });

  if (options.panelStack && options.panels) {
    for (const [id, def] of Object.entries(options.panels)) panelStack.register(id, def);
  }

  let phase = initialPhase;
  let phasePayload = null;
  let hintMoved = false;
  let hintAlpha = hintEnabled && initialPhase === UI_PHASES.PLAYING ? 1 : 0;

  /** @type {Map<string, { spring: SpringDamper1D, snap: boolean, cueOnChange: boolean, state: UiMetricState }>} */
  const metrics = new Map();
  /** @type {Map<string, { spring: SpringDamper1D, holdSec: number, state: UiBarState }>} */
  const bars = new Map();
  /** @type {Map<string, { cueOnReady: boolean, state: UiCooldownState }>} */
  const cooldowns = new Map();
  const lastCueAt = new Map();
  const phaseListeners = new Set();
  const cueListeners = new Set();
  if (typeof options.onPhaseChange === 'function') phaseListeners.add(options.onPhaseChange);
  if (typeof options.onCue === 'function') cueListeners.add(options.onCue);

  function syncPanelsForPhase(targetPhase, payload) {
    for (const pid of ['title', 'pause', 'choice', 'result']) {
      if (pid !== targetPhase && panelStack.isOpen(pid)) {
        panelStack.popById(pid);
      }
    }
    if (!panelStack.isOpen('hud')) {
      panelStack.push('hud');
    }
    if (targetPhase === UI_PHASES.TITLE) {
      panelStack.push('title', payload);
    } else if (targetPhase === UI_PHASES.PAUSED) {
      panelStack.push('pause', payload);
    } else if (targetPhase === UI_PHASES.CHOICE) {
      panelStack.push('choice', payload);
    } else if (targetPhase === UI_PHASES.RESULT) {
      panelStack.push('result', payload);
    }
  }

  function emitCue(cue, detail = null) {
    const spec = DEFAULT_CUE_SYNTH[cue];
    const tNow = nowFn();
    if (spec) {
      const prev = lastCueAt.get(cue) ?? -Infinity;
      if (tNow - prev < spec.cooldownMs) return false;
      lastCueAt.set(cue, tNow);
      if (audio && audio.available !== false && typeof audio.playSynth === 'function') {
        try {
          audio.playSynth(spec.preset, {
            bus: 'sfx',
            volume: spec.volume,
            pitchJitter: spec.pitchJitter,
          });
        } catch {}
      }
    }
    for (const fn of cueListeners) fn(cue, detail);
    return true;
  }

  function setPhase(nextPhase, payload = null, { silent = false } = {}) {
    if (!validPhases.has(nextPhase)) {
      throw new TypeError(`Unknown UI phase: ${String(nextPhase)}`);
    }
    const prevPhase = phase;
    phase = nextPhase;
    phasePayload = payload;
    syncPanelsForPhase(nextPhase, payload);

    if (nextPhase === UI_PHASES.PLAYING && prevPhase !== UI_PHASES.PAUSED && prevPhase !== UI_PHASES.CHOICE) {
      hintMoved = false;
      hintAlpha = hintEnabled ? 1 : 0;
    }

    if (!silent && prevPhase !== nextPhase) {
      if (nextPhase === UI_PHASES.PAUSED || nextPhase === UI_PHASES.CHOICE || nextPhase === UI_PHASES.RESULT) {
        emitCue(UI_UX_CUES.OPEN, { phase: nextPhase });
      } else if (nextPhase === UI_PHASES.PLAYING && (prevPhase === UI_PHASES.PAUSED || prevPhase === UI_PHASES.CHOICE)) {
        emitCue(UI_UX_CUES.CLOSE, { phase: nextPhase });
      }
    }

    const paused = nextPhase !== UI_PHASES.PLAYING;
    if (prevPhase !== nextPhase) {
      const event = { phase: nextPhase, prevPhase, paused, payload };
      for (const fn of phaseListeners) fn(event);
    }
    return phase;
  }

  function registerMetric(id, metricOptions = {}) {
    if (!id || typeof id !== 'string') throw new TypeError('Metric id must be a non-empty string.');
    const opts = typeof metricOptions === 'number' ? { value: metricOptions } : (metricOptions ?? {});
    const initial = Number.isFinite(opts.value) ? opts.value : 0;
    const halfLife = Number.isFinite(opts.halfLife) && opts.halfLife >= 0 ? opts.halfLife : 0.09;
    const spring = new SpringDamper1D({ value: initial, target: initial, halfLife });
    /** @type {UiMetricState} */
    const state = {
      id,
      value: initial,
      displayValue: initial,
      pulse: 0,
      direction: 0,
      lastDelta: 0,
      settled: true,
    };
    metrics.set(id, {
      spring,
      snap: Boolean(opts.snap) || halfLife === 0,
      cueOnChange: Boolean(opts.cueOnChange),
      state,
    });
    return state;
  }

  function setMetric(id, nextValue, opts = {}) {
    if (!Number.isFinite(nextValue)) return null;
    if (!metrics.has(id)) {
      registerMetric(id, { value: nextValue, snap: opts.snap });
      return metrics.get(id).state;
    }
    const entry = metrics.get(id);
    const prev = entry.state.value;
    const delta = nextValue - prev;
    entry.state.value = nextValue;
    entry.spring.setTarget(nextValue);

    if (delta !== 0) {
      entry.state.lastDelta = delta;
      entry.state.direction = delta > 0 ? 1 : -1;
      entry.state.pulse = 1;
      if (entry.cueOnChange && opts.silent !== true) {
        emitCue(delta > 0 ? UI_UX_CUES.METRIC_UP : UI_UX_CUES.METRIC_DOWN, { id, value: nextValue, delta });
      }
    }
    if (opts.snap || entry.snap) {
      entry.spring.snap(nextValue);
      entry.state.displayValue = nextValue;
    }
    entry.state.settled = entry.state.pulse === 0 && entry.spring.isSettled(1e-2, 1e-1);
    return entry.state;
  }

  function pulseMetric(id, direction = 1) {
    const entry = metrics.get(id);
    if (!entry) return null;
    entry.state.pulse = 1;
    entry.state.direction = direction >= 0 ? 1 : -1;
    entry.state.settled = false;
    return entry.state;
  }

  function getMetric(id) {
    return metrics.get(id)?.state ?? null;
  }

  function clamp01(v) {
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  }

  function registerBar(id, barOptions = {}) {
    if (!id || typeof id !== 'string') throw new TypeError('Bar id must be a non-empty string.');
    const opts = typeof barOptions === 'number' ? { value: barOptions } : (barOptions ?? {});
    const initial = clamp01(Number.isFinite(opts.value) ? opts.value : 1);
    const holdSec = Number.isFinite(opts.holdSec) && opts.holdSec >= 0 ? opts.holdSec : 0.28;
    const halfLife = Number.isFinite(opts.halfLife) && opts.halfLife > 0 ? opts.halfLife : 0.09;
    const spring = new SpringDamper1D({ value: initial, target: initial, halfLife });
    /** @type {UiBarState} */
    const state = {
      id,
      value: initial,
      ghostValue: initial,
      direction: 0,
      holdRemaining: 0,
      settled: true,
    };
    bars.set(id, { spring, holdSec, state });
    return state;
  }

  function setBar(id, ratio) {
    if (!Number.isFinite(ratio)) return null;
    const clamped = clamp01(ratio);
    if (!bars.has(id)) {
      return registerBar(id, { value: clamped });
    }
    const entry = bars.get(id);
    const st = entry.state;
    const prevTarget = entry.spring.target;
    const delta = clamped - prevTarget;
    if (Math.abs(delta) < 1e-5) return st;

    if (delta < 0) {
      // Damage: main value drops immediately; ghost holds briefly then catches down.
      st.value = clamped;
      st.direction = -1;
      st.holdRemaining = entry.holdSec;
      entry.spring.snap(Math.max(st.ghostValue, prevTarget));
      entry.spring.setTarget(clamped);
    } else {
      // Heal: ghost jumps ahead as preview; main value catches up smoothly.
      st.ghostValue = clamped;
      st.direction = 1;
      st.holdRemaining = 0;
      entry.spring.snap(st.value);
      entry.spring.setTarget(clamped);
    }
    st.settled = false;
    return st;
  }

  function getBar(id) {
    return bars.get(id)?.state ?? null;
  }

  function registerCooldown(id, cdOptions = {}) {
    if (!id || typeof id !== 'string') throw new TypeError('Cooldown id must be a non-empty string.');
    const opts = typeof cdOptions === 'number' ? { duration: cdOptions } : (cdOptions ?? {});
    const duration = Number.isFinite(opts.duration) && opts.duration > 0 ? opts.duration : 1;
    const remaining = Number.isFinite(opts.remaining) && opts.remaining > 0 ? Math.min(opts.remaining, duration) : 0;
    /** @type {UiCooldownState} */
    const state = {
      id,
      remaining,
      duration,
      ratio: remaining > 0 ? clamp01(remaining / duration) : 0,
      ready: remaining <= 0,
      readyFlash: 0,
      settled: remaining <= 0,
    };
    cooldowns.set(id, { cueOnReady: opts.cueOnReady !== false, state });
    return state;
  }

  function setCooldown(id, remaining, duration = null) {
    const entry = cooldowns.get(id);
    if (!entry) {
      return registerCooldown(id, {
        remaining: Math.max(0, Number(remaining) || 0),
        duration: Number.isFinite(duration) && duration > 0 ? duration : Math.max(1, Number(remaining) || 1),
      });
    }
    const st = entry.state;
    const wasReady = st.ready;
    if (Number.isFinite(duration) && duration > 0) st.duration = duration;
    st.remaining = Number.isFinite(remaining) && remaining > 0 ? remaining : 0;
    st.ratio = st.duration > 0 ? clamp01(st.remaining / st.duration) : 0;
    st.ready = st.remaining <= 0;
    if (!wasReady && st.ready) {
      st.readyFlash = 1;
      if (entry.cueOnReady) emitCue(UI_UX_CUES.CONFIRM, { id });
    }
    st.settled = st.ready && st.readyFlash === 0;
    return st;
  }

  function getCooldown(id) {
    return cooldowns.get(id)?.state ?? null;
  }

  function notifyMoved() {
    if (!hintMoved) {
      hintMoved = true;
    }
  }

  function update(dt) {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    panelStack.update(safeDt);

    let activeAnimations = panelStack.getStack().some(e => e.phase === 'entering') || panelStack.getExiting().length > 0;

    if (hintEnabled && phase === UI_PHASES.PLAYING && hintMoved && hintAlpha > 0) {
      hintAlpha = Math.max(0, hintAlpha - safeDt / hintFadeSec);
      if (hintAlpha > 0) activeAnimations = true;
    }

    for (const entry of metrics.values()) {
      const st = entry.state;
      if (!entry.snap) {
        st.displayValue = entry.spring.step(safeDt);
      } else {
        st.displayValue = st.value;
      }
      if (st.pulse > 0) {
        st.pulse = Math.max(0, st.pulse - safeDt * 3.8);
      }
      const settled = st.pulse === 0 && (entry.snap || entry.spring.isSettled(1e-2, 1e-1));
      if (settled && !entry.snap) {
        entry.spring.snap(st.value);
        st.displayValue = st.value;
      }
      st.settled = settled;
      if (!settled) activeAnimations = true;
    }

    for (const entry of bars.values()) {
      const st = entry.state;
      if (st.holdRemaining > 0) {
        st.holdRemaining = Math.max(0, st.holdRemaining - safeDt);
        st.settled = false;
        activeAnimations = true;
      } else if (!entry.spring.isSettled(1e-3, 1e-3)) {
        const nextVal = entry.spring.step(safeDt);
        if (st.direction < 0) st.ghostValue = nextVal;
        else st.value = nextVal;
        st.settled = false;
        activeAnimations = true;
      } else {
        st.value = entry.spring.target;
        st.ghostValue = entry.spring.target;
        st.direction = 0;
        st.settled = true;
      }
    }

    for (const entry of cooldowns.values()) {
      const st = entry.state;
      if (!st.ready && safeDt > 0) {
        st.remaining = Math.max(0, st.remaining - safeDt);
        st.ratio = st.duration > 0 ? clamp01(st.remaining / st.duration) : 0;
        if (st.remaining <= 0) {
          st.ready = true;
          st.readyFlash = 1;
          if (entry.cueOnReady) emitCue(UI_UX_CUES.CONFIRM, { id: st.id });
        }
      }
      if (st.readyFlash > 0) {
        st.readyFlash = Math.max(0, st.readyFlash - safeDt * 3.2);
      }
      st.settled = st.ready && st.readyFlash === 0;
      if (!st.settled) activeAnimations = true;
    }

    return {
      phase,
      paused: phase !== UI_PHASES.PLAYING,
      modalOpen: panelStack.hasModal(),
      hintAlpha,
      hintVisible: hintEnabled && phase === UI_PHASES.PLAYING && hintAlpha > 0.01,
      activeAnimations,
    };
  }

  if (options.metrics && typeof options.metrics === 'object') {
    for (const [id, cfg] of Object.entries(options.metrics)) {
      registerMetric(id, cfg);
    }
  }
  if (options.bars && typeof options.bars === 'object') {
    for (const [id, cfg] of Object.entries(options.bars)) {
      registerBar(id, cfg);
    }
  }
  if (options.cooldowns && typeof options.cooldowns === 'object') {
    for (const [id, cfg] of Object.entries(options.cooldowns)) {
      registerCooldown(id, cfg);
    }
  }
  syncPanelsForPhase(initialPhase, null);

  return Object.freeze({
    panelStack,
    getPhase: () => phase,
    getPhasePayload: () => phasePayload,
    isPaused: () => phase !== UI_PHASES.PLAYING,
    setPhase,
    startGame: (payload = null) => setPhase(UI_PHASES.PLAYING, payload),
    pause: (payload = null) => setPhase(UI_PHASES.PAUSED, payload),
    resume: () => setPhase(UI_PHASES.PLAYING, null),
    togglePause: () => (phase === UI_PHASES.PAUSED ? setPhase(UI_PHASES.PLAYING) : phase === UI_PHASES.PLAYING ? setPhase(UI_PHASES.PAUSED) : phase),
    openChoice: (payload = null) => setPhase(UI_PHASES.CHOICE, payload),
    closeChoice: () => setPhase(UI_PHASES.PLAYING, null),
    finishRun: (summary = null) => setPhase(UI_PHASES.RESULT, summary),
    restart: (payload = null) => setPhase(UI_PHASES.PLAYING, payload),
    registerMetric,
    setMetric,
    pulseMetric,
    getMetric,
    getMetrics: () => Object.fromEntries(Array.from(metrics, ([k, v]) => [k, v.state])),
    registerBar,
    setBar,
    getBar,
    getBars: () => Object.fromEntries(Array.from(bars, ([k, v]) => [k, v.state])),
    registerCooldown,
    setCooldown,
    getCooldown,
    getCooldowns: () => Object.fromEntries(Array.from(cooldowns, ([k, v]) => [k, v.state])),
    notifyMoved,
    isHintVisible: () => hintEnabled && phase === UI_PHASES.PLAYING && hintAlpha > 0.01,
    getHintAlpha: () => (hintEnabled && phase === UI_PHASES.PLAYING ? hintAlpha : 0),
    emitCue,
    onPhaseChange(fn) {
      if (typeof fn !== 'function') throw new TypeError('Phase listener must be a function.');
      phaseListeners.add(fn);
      return () => phaseListeners.delete(fn);
    },
    onCue(fn) {
      if (typeof fn !== 'function') throw new TypeError('Cue listener must be a function.');
      cueListeners.add(fn);
      return () => cueListeners.delete(fn);
    },
    update,
    snapshot: () => ({
      phase,
      paused: phase !== UI_PHASES.PLAYING,
      modalOpen: panelStack.hasModal(),
      topPanel: panelStack.top()?.id ?? null,
      hintAlpha: hintEnabled && phase === UI_PHASES.PLAYING ? hintAlpha : 0,
      metrics: Object.fromEntries(Array.from(metrics, ([k, v]) => [k, {
        value: v.state.value,
        displayValue: v.state.displayValue,
        pulse: v.state.pulse,
      }])),
      bars: Object.fromEntries(Array.from(bars, ([k, v]) => [k, {
        value: v.state.value,
        ghostValue: v.state.ghostValue,
      }])),
      cooldowns: Object.fromEntries(Array.from(cooldowns, ([k, v]) => [k, {
        remaining: v.state.remaining,
        ratio: v.state.ratio,
        ready: v.state.ready,
      }])),
    }),
    dispose() {
      phaseListeners.clear();
      cueListeners.clear();
      metrics.clear();
      bars.clear();
      cooldowns.clear();
      lastCueAt.clear();
      panelStack.dispose();
    },
  });
}
