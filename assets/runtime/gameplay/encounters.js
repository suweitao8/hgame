import { finite, identifier, nonNegative, positiveInteger, publisher } from '../internal/gameplay.js';
import { Component } from '../core/component.js';

/** @typedef {{id: string, enemy: string, point?: string, at?: number, count: number, batches?: number, interval?: number}} SpawnGroup */
/** @typedef {{id: string, waves?: readonly SpawnGroup[], goals?: {clear?: boolean, survive?: number, signals?: readonly string[]}, timeout?: number, checkpoint?: boolean, enterSignal?: string, completeSignal?: string}} EncounterStage */
/** @typedef {{id: string, stages: readonly EncounterStage[]}} EncounterDefinition */
/** @typedef {'idle' | 'running' | 'completed' | 'failed'} EncounterStatus */
/** @typedef {{stage: string, wave: string, enemy: string, point?: string, count: number, batch: number, at: number}} ScheduledBatch */
/** @typedef {ScheduledBatch & {ticket: string}} EncounterSpawn */
/** @typedef {{schemaVersion: 1, encounterId: string, stageId: string}} EncounterCheckpoint */
/** @typedef {{id: string, status: EncounterStatus, stageId: string | null, elapsed: number, pendingBatches: number, alive: number, signalsRemaining: string[], failure: string | null}} EncounterState */
/** @typedef {{type: 'stage-start' | 'stage-complete' | 'complete', state: EncounterState} | {type: 'failed', state: EncounterState, reason: string} | {type: 'checkpoint', checkpoint: EncounterCheckpoint} | {type: 'signal', signal: string, stageId: string}} EncounterEvent */
/** @typedef {{id: string, schedule: ScheduledBatch[], clear: boolean, survive: number, signals: string[], timeout: number, checkpoint: boolean, enterSignal?: string, completeSignal?: string}} CompiledStage */
/** @typedef {{spawn: (batch: Readonly<EncounterSpawn>) => boolean, maxBatchesPerStep?: number, onEvent?: (event: EncounterEvent) => void}} EncounterOptions */

const MAX_BATCHES_PER_STAGE = 4096;

/** @param {EncounterStage} stage @returns {CompiledStage} */
function compileStage(stage) {
  const id = identifier(stage.id, 'stage id');
  /** @type {ScheduledBatch[]} */
  const schedule = [];
  const waveIds = new Set();
  let total = 0;
  for (const wave of stage.waves ?? []) {
    const waveId = identifier(wave.id, 'wave id');
    if (waveIds.has(waveId)) throw new Error('Duplicate wave in ' + id + ': ' + waveId);
    waveIds.add(waveId);
    const enemy = identifier(wave.enemy, 'enemy id');
    const point = wave.point === undefined ? undefined : identifier(wave.point, 'spawn point');
    const at = nonNegative(wave.at ?? 0, 'wave time');
    const count = positiveInteger(wave.count, 'wave count');
    const batches = positiveInteger(wave.batches ?? 1, 'wave batches');
    const interval = nonNegative(wave.interval ?? 0, 'wave interval');
    if (schedule.length + batches > MAX_BATCHES_PER_STAGE) throw new RangeError('Too many spawn batches in ' + id);
    total += count * batches;
    if (!Number.isSafeInteger(total)) throw new RangeError('Too many enemies in stage: ' + id);
    for (let batch = 0; batch < batches; batch++) {
      schedule.push({ stage: id, wave: waveId, enemy, point, count, batch, at: finite(at + batch * interval, 'batch time') });
    }
  }
  schedule.sort((a, b) => a.at - b.at);
  const survive = nonNegative(stage.goals?.survive ?? 0, 'survival time');
  const timeout = stage.timeout === undefined ? Infinity : nonNegative(stage.timeout, 'stage timeout');
  if (timeout < Math.max(survive, schedule[schedule.length - 1]?.at ?? 0)) throw new RangeError('Stage timeout precedes its scheduled work: ' + id);
  return { id, schedule, clear: stage.goals?.clear ?? true, survive,
    signals: [...new Set((stage.goals?.signals ?? []).map(signal => identifier(signal, 'required signal')))],
    timeout, checkpoint: stage.checkpoint === true,
    enterSignal: stage.enterSignal === undefined ? undefined : identifier(stage.enterSignal, 'entry signal'),
    completeSignal: stage.completeSignal === undefined ? undefined : identifier(stage.completeSignal, 'completion signal'),
  };
}

/**
 * Schedule stage waves, clear/survival/signal goals and stage-entry checkpoints on the caller's fixed step.
 * A spawn adapter returns true only after accepting the whole batch. A declined batch retries with the same ticket.
 * @param {EncounterDefinition} definition
 * @param {EncounterOptions} options
 */
export function createEncounterDirector(definition, { spawn, maxBatchesPerStep = 32, onEvent }) {
  const id = identifier(definition.id, 'encounter id');
  const stages = definition.stages.map(compileStage);
  if (!stages.length) throw new Error('Encounter needs at least one stage');
  const indexes = new Map(stages.map((stage, index) => [stage.id, index]));
  if (indexes.size !== stages.length) throw new Error('Duplicate encounter stage');
  if (typeof spawn !== 'function') throw new TypeError('Encounter needs a synchronous spawn adapter');
  positiveInteger(maxBatchesPerStep, 'maxBatchesPerStep');
  const events = publisher(onEvent);

  /** @type {Map<string, number>} */
  const living = new Map();
  /** @type {Set<string>} */
  const remainingSignals = new Set();
  /** @type {EncounterStatus} */
  let status = 'idle';
  let index = -1;
  let elapsed = 0;
  let cursor = 0;
  let alive = 0;
  let generation = 0;
  /** @type {EncounterCheckpoint | null} */
  let checkpoint = null;
  /** @type {string | null} */
  let failure = null;
  let busy = false;
  let disposed = false;

  function writable() {
    if (disposed) throw new Error('Encounter is disposed');
    if (busy) throw new Error('Encounter commands cannot run during spawn or event callbacks');
  }
  /** @returns {EncounterState} */
  function getState() {
    const stage = stages[index];
    return { id, status, stageId: stage?.id ?? null, elapsed, alive,
      pendingBatches: stage ? stage.schedule.length - cursor : 0,
      signalsRemaining: [...remainingSignals], failure };
  }
  /** @param {number} target @param {EncounterEvent[]} pending @param {boolean} [saveEntry] */
  function enter(target, pending, saveEntry = false) {
    const stage = stages[target];
    index = target;
    status = 'running';
    elapsed = 0;
    cursor = 0;
    alive = 0;
    failure = null;
    generation++;
    living.clear();
    remainingSignals.clear();
    for (const signal of stage.signals) remainingSignals.add(signal);
    pending.push({ type: 'stage-start', state: getState() });
    if (saveEntry || stage.checkpoint) {
      checkpoint = { schemaVersion: 1, encounterId: id, stageId: stage.id };
      pending.push({ type: 'checkpoint', checkpoint: { ...checkpoint } });
    }
    if (stage.enterSignal) pending.push({ type: 'signal', signal: stage.enterSignal, stageId: stage.id });
  }
  /** @param {EncounterEvent[]} pending */
  function publish(pending) { for (const event of pending) events.emit(event); }
  /** @param {number} target @param {boolean} saveEntry */
  function startAt(target, saveEntry) {
    writable();
    /** @type {EncounterEvent[]} */
    const pending = [];
    busy = true;
    try { enter(target, pending, saveEntry); publish(pending); }
    finally { busy = false; }
    return getState();
  }

  return {
    getState,
    /** @returns {EncounterState} */
    start() { return startAt(0, true); },
    /** Record confirmed removals from an accepted spawn ticket. @param {string} ticket @param {number} [count] */
    defeated(ticket, count = 1) {
      writable();
      if (status !== 'running') return false;
      positiveInteger(count, 'defeated count');
      const previous = living.get(ticket);
      if (previous === undefined || count > previous) return false;
      if (count === previous) living.delete(ticket);
      else living.set(ticket, previous - count);
      alive -= count;
      return true;
    },
    /** @param {string} signal */
    signal(signal) { writable(); return status === 'running' && remainingSignals.delete(signal); },
    /** @param {string} [reason] */
    fail(reason = 'objective-failed') {
      writable();
      if (status !== 'running') return false;
      failure = identifier(reason, 'failure reason');
      status = 'failed';
      busy = true;
      try { events.emit({ type: 'failed', state: getState(), reason: failure }); }
      finally { busy = false; }
      return true;
    },
    /** Advance from the game's existing fixedUpdate. @param {number} dt Seconds. */
    update(dt) {
      if (disposed) return;
      writable();
      nonNegative(dt, 'dt');
      if (status !== 'running') return;
      const stage = stages[index];
      elapsed = Math.min(stage.timeout, finite(elapsed + dt, 'encounter elapsed time'));
      /** @type {EncounterEvent[]} */
      const pending = [];
      busy = true;
      try {
        const end = Math.min(stage.schedule.length, cursor + maxBatchesPerStep);
        while (cursor < end && stage.schedule[cursor].at <= elapsed + 1e-9) {
          const batch = stage.schedule[cursor];
          const ticket = generation + ':' + cursor;
          const accepted = spawn(Object.freeze({ ...batch, ticket }));
          if (disposed) return;
          if (typeof accepted !== 'boolean') throw new TypeError('Encounter spawn must return a boolean');
          if (!accepted) break;
          cursor++;
          living.set(ticket, batch.count);
          alive += batch.count;
        }
        if (cursor === stage.schedule.length && (!stage.clear || alive === 0) &&
          elapsed + 1e-9 >= stage.survive && remainingSignals.size === 0) {
          const completed = getState();
          pending.push({ type: 'stage-complete', state: completed });
          if (stage.completeSignal) pending.push({ type: 'signal', signal: stage.completeSignal, stageId: stage.id });
          if (index + 1 < stages.length) enter(index + 1, pending);
          else {
            status = 'completed';
            pending.push({ type: 'complete', state: getState() });
          }
        } else if (elapsed + 1e-9 >= stage.timeout) {
          failure = 'timeout';
          status = 'failed';
          pending.push({ type: 'failed', state: getState(), reason: failure });
        }
        publish(pending);
      } finally { busy = false; }
    },
    /** Save the latest checkpoint, which resumes from the start of its stage. @returns {EncounterCheckpoint | null} */
    getCheckpoint() { return checkpoint ? { ...checkpoint } : null; },
    /** The game resets the encounter's entities before restoring the stage entry. @param {EncounterCheckpoint} saved @returns {EncounterState} */
    restoreCheckpoint(saved) {
      writable();
      if (saved?.schemaVersion !== 1 || saved.encounterId !== id) throw new Error('Incompatible encounter checkpoint');
      const target = indexes.get(saved.stageId);
      if (target === undefined || (target !== 0 && !stages[target].checkpoint)) throw new Error('Unknown encounter checkpoint: ' + saved.stageId);
      return startAt(target, true);
    },
    /** @type {(listener: (event: EncounterEvent) => void) => (() => void)} */
    subscribe(listener) { return disposed ? () => {} : events.subscribe(listener); },
    /** Release subscriptions and tracking. The game owns spawned entities. */
    dispose() {
      if (disposed) return;
      disposed = true;
      events.clear();
      living.clear();
      remainingSignals.clear();
      alive = 0;
      index = -1;
      status = 'idle';
      elapsed = 0;
      cursor = 0;
      checkpoint = null;
      failure = null;
    },
  };
}

/** Drive an encounter from an entity's fixed step without a separate timer. */
export class EncounterComponent extends Component {
  /** @param {EncounterDefinition} definition @param {EncounterOptions & {autoStart?: boolean}} options */
  constructor(definition, { autoStart = true, ...options }) {
    super();
    this.director = createEncounterDirector(definition, options);
    this.autoStart = autoStart;
  }

  start() {
    if (this.autoStart && this.director.getState().status === 'idle') this.director.start();
  }

  /** @param {number} dt */
  fixedUpdate(dt) { this.director.update(dt); }

  onDestroy() { this.director.dispose(); }
}
