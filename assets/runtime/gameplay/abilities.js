import { normalizeGameplayTag } from '../core/tags.js';
import { changes, finite, identifier, nonNegative, positiveInteger, publisher } from '../internal/gameplay.js';
import { compileAbilityTimeline, createAbilityTimelineRun } from '../internal/ability-timeline.js';
import { cleanupAll } from '../internal/cleanup.js';

/** @typedef {import('../internal/ability-timeline.js').AbilityTimeline} AbilityTimeline */
/** @typedef {import('../internal/ability-timeline.js').AbilityTimelineEvent} AbilityTimelineEvent */
/** @typedef {import('../internal/ability-timeline.js').AbilityTimelineRun} AbilityTimelineRun */

/**
 * @typedef {object} AbilityDefinition
 * @property {number} [cooldown=0] Seconds to replenish one charge; sequential recharge.
 * @property {number} [charges=1] Maximum charges; available charges can be used consecutively.
 * @property {Record<string, number>} [costs] Effective attribute costs, paid on commit rather than on cast start.
 * @property {number} [castTime=0]
 * @property {number} [channelTime=0] Busy duration after commit.
 * @property {number} [channelInterval=0] Optional repeated execution during channeling.
 * @property {number} [globalCooldown=0]
 * @property {string} [group] Optional shared cooldown group.
 * @property {number} [groupCooldown] Defaults to cooldown.
 * @property {import('../core/tags.js').TagQuery} [requiredTags]
 * @property {readonly string[]} [blockedTags]
 * @property {readonly string[]} [activeTags] Granted only while casting/channeling.
 * @property {readonly string[]} [effects] Effect definitions applied to this actor on commit.
 * @property {AbilityTimeline} [timeline] Set cast and recovery timing from one clock, with animation and event cues.
 */
/** @typedef {{target?: unknown, payload?: unknown}} AbilityContext */
/** @typedef {{id: string, phase: 'activate' | 'channel', ticks: number, target?: unknown, payload?: unknown, attributes: import('./attributes.js').AttributeSet, tags: import('../core/tags.js').TagContainer, effects: import('./effects.js').EffectController}} AbilityExecution */
/** @typedef {'unknown' | 'disposed' | 'busy' | 'tags' | 'cooldown' | 'global-cooldown' | 'group-cooldown' | 'resources'} AbilityBlockReason */
/** @typedef {{ok: true} | {ok: false, reason: AbilityBlockReason}} AbilityAvailability */
/** @typedef {{ok: true, id: string, phase: 'casting' | 'committed'} | {ok: false, reason: AbilityBlockReason}} AbilityActivation */
/** @typedef {{id: string, charges: number, maxCharges: number, rechargeRemaining: number, active: 'casting' | 'channeling' | null, timeline?: {elapsed: number, duration: number, commitAt: number, clip?: string}}} AbilityState */
/** @typedef {{schemaVersion: 1, abilities: Record<string, {charges: number, rechargeRemaining: number}>, globalRemaining: number, groups: Record<string, number>}} AbilitySnapshot */
/** @typedef {{type: 'cast' | 'commit' | 'channel' | 'end' | 'cancel' | 'queued' | 'queue-expired', id: string, reason?: string, count?: number}} AbilityEvent */
/**
 * @typedef {object} AbilitySystem
 * @property {(id: string, definition: AbilityDefinition) => void} define Cannot redefine an active ability.
 * @property {(id: string) => AbilityAvailability} canActivate
 * @property {(id: string, context?: AbilityContext) => AbilityActivation} tryActivate
 * @property {(id: string, context?: AbilityContext, seconds?: number) => void} queue Buffer one command, replacing the previous one.
 * @property {() => void} clearQueue
 * @property {(reason?: string) => boolean} cancel Cancels casting or channeling; committed costs are not refunded.
 * @property {(id: string) => AbilityState} getState
 * @property {() => string | null} getActive
 * @property {(dt: number) => void} update
 * @property {() => AbilitySnapshot} snapshot Active casts/channels and target references are deliberately not serialized.
 * @property {(snapshot: AbilitySnapshot) => void} restore Cancels transient casts and buffered commands.
 * @property {(listener: (event: AbilityEvent) => void) => (() => void)} subscribe
 * @property {() => void} dispose
 */

/**
 * Data-driven skills, shared resource costs, rechargeable charges, casting and input buffering.
 * Call update from the application's existing fixedUpdate; this system creates no timers.
 * Execution is synchronous and game-owned; targets, hit detection and damage formulas remain game rules.
 * @param {{attributes: import('./attributes.js').AttributeSet, tags: import('../core/tags.js').TagContainer, effects: import('./effects.js').EffectController, definitions?: Record<string, AbilityDefinition>, execute?: (context: AbilityExecution) => void, onEvent?: (event: AbilityEvent) => void, onTimeline?: (event: AbilityTimelineEvent) => void}} options
 * @returns {AbilitySystem}
 */
export function createAbilitySystem({ attributes, tags, effects, definitions = {}, execute, onEvent, onTimeline }) {
  const catalog = new Map(), states = new Map(), groups = new Map();
  const events = publisher(onEvent);
  let clock = 0, globalUntil = 0, current = null, queued = null;
  let nextActivation = 1;
  let disposed = false, committing = false, updating = false;
  function live() { if (disposed) throw new Error('AbilitySystem is disposed'); }
  function define(id, input) {
    live(); identifier(id);
    if (committing || current?.id === id) throw new Error('Cannot redefine an active ability');
    const costs = changes(input.costs);
    for (const [name, amount] of Object.entries(costs)) {
      if (!attributes.has(name)) throw new Error('Unknown resource: ' + name);
      nonNegative(amount, 'ability cost');
    }
    const effectIds = [...(input.effects ?? [])];
    for (const effect of effectIds) if (!effects.hasDefinition(effect)) throw new Error('Unknown ability effect: ' + effect);
    const cooldown = nonNegative(input.cooldown ?? 0, 'cooldown');
    const timeline = input.timeline === undefined ? null : compileAbilityTimeline(input.timeline);
    if (timeline && (input.castTime !== undefined || input.channelTime !== undefined)) {
      throw new Error('Use either an ability timeline or castTime/channelTime: ' + id);
    }
    const def = Object.freeze({ cooldown, charges: positiveInteger(input.charges ?? 1, 'charges'), costs,
      castTime: timeline?.commitAt ?? nonNegative(input.castTime ?? 0, 'castTime'),
      channelTime: timeline ? timeline.duration - timeline.commitAt : nonNegative(input.channelTime ?? 0, 'channelTime'),
      timeline,
      channelInterval: nonNegative(input.channelInterval ?? 0, 'channelInterval'),
      globalCooldown: nonNegative(input.globalCooldown ?? 0, 'globalCooldown'),
      group: input.group === undefined ? null : identifier(input.group, 'cooldown group'),
      groupCooldown: nonNegative(input.groupCooldown ?? cooldown, 'groupCooldown'),
      requiredTags: input.requiredTags,
      blockedTags: Object.freeze((input.blockedTags ?? []).map(tag => normalizeGameplayTag(tag))),
      activeTags: Object.freeze([...new Set((input.activeTags ?? []).map(tag => normalizeGameplayTag(tag)))]),
      effects: Object.freeze(effectIds) });
    catalog.set(id, def);
    states.set(id, { charges: def.charges, nextCharge: Infinity });
  }
  function replenish(id) {
    const def = catalog.get(id), state = states.get(id);
    if (def.cooldown === 0) { state.charges = def.charges; state.nextCharge = Infinity; }
    else if (state.charges < def.charges && state.nextCharge <= clock) {
      const count = Math.min(def.charges - state.charges, Math.floor((clock - state.nextCharge) / def.cooldown + 1e-9) + 1);
      state.charges += count;
      state.nextCharge = state.charges === def.charges ? Infinity : state.nextCharge + count * def.cooldown;
    }
    return state;
  }
  function permitted(def) { return tags.matches(def.requiredTags) && !tags.hasAny(def.blockedTags); }
  function availability(id, allowBusy = false) {
    if (disposed) return { ok: false, reason: 'disposed' };
    const def = catalog.get(id);
    if (!def) return { ok: false, reason: 'unknown' };
    if (!allowBusy && (current || committing)) return { ok: false, reason: 'busy' };
    if (!permitted(def)) return { ok: false, reason: 'tags' };
    if (globalUntil > clock) return { ok: false, reason: 'global-cooldown' };
    if (def.group && (groups.get(def.group) ?? 0) > clock) return { ok: false, reason: 'group-cooldown' };
    if (replenish(id).charges < 1) return { ok: false, reason: 'cooldown' };
    if (!attributes.canSpend(def.costs)) return { ok: false, reason: 'resources' };
    return { ok: true };
  }
  function release(entry) {
    if (current === entry) current = null;
    if (entry.granted.length) { const granted = entry.granted; entry.granted = []; tags.remove(granted); }
  }
  /** @param {AbilityTimelineRun | null} track */
  function begin(id, def, context, phase, seconds, track) {
    const phaseStart = track ? track.startAt + (phase === 'casting' ? 0 : track.timeline.commitAt) : clock;
    const endsAt = track && phase === 'channeling' ? track.startAt + track.timeline.duration : phaseStart + seconds;
    const entry = { id, def, context, phase, endsAt, track,
      nextTick: def.channelInterval > 0 ? phaseStart + def.channelInterval : Infinity,
      granted: [...new Set([phase === 'casting' ? 'State.Casting' : 'State.Channeling', ...def.activeTags])] };
    current = entry;
    tags.add(entry.granted);
    return entry;
  }
  function run(id, context, phase, ticks = 1) {
    execute?.({ id, phase, ticks, target: context.target, payload: context.payload, attributes, tags, effects });
  }
  /** @param {AbilityTimelineRun | null | undefined} track @param {string} [reason] */
  function finishTimeline(track, reason) { if (track) track.finish(clock - track.startAt, reason); }
  function cancelEntry(entry, reason) {
    cleanupAll([
      () => release(entry),
      () => finishTimeline(entry.track, reason),
      () => { if (!disposed) events.emit({ type: 'cancel', id: entry.id, reason }); },
    ], 'Ability cancellation failed');
  }
  function rethrowWithCleanup(error, actions) {
    try { cleanupAll(actions, 'Ability cleanup failed'); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Ability and its cleanup failed'); }
    throw error;
  }
  /** @param {AbilityTimelineRun | null} track */
  function commit(id, def, context, track, cast = null) {
    committing = true;
    try {
      if (cast) release(cast);
      const allowed = availability(id, true);
      if (!allowed.ok) { finishTimeline(track, allowed.reason); return allowed; }
      if (!attributes.spend(def.costs)) { finishTimeline(track, 'resources'); return { ok: false, reason: 'resources' }; }
      if (disposed) { finishTimeline(track, 'disposed'); return { ok: false, reason: 'disposed' }; }
      const state = replenish(id);
      state.charges--;
      if (state.nextCharge === Infinity && def.cooldown > 0) state.nextCharge = clock + def.cooldown;
      globalUntil = Math.max(globalUntil, clock + def.globalCooldown);
      if (def.group) groups.set(def.group, clock + def.groupCooldown);
      if (def.channelTime > 0) begin(id, def, context, 'channeling', def.channelTime, track);
      if (!disposed) track?.start();
      for (const effect of def.effects) { if (disposed) break; effects.apply(effect, { source: id }); }
      if (!disposed) run(id, context, 'activate');
      if (!disposed) events.emit({ type: 'commit', id });
      if (!disposed && track) track.advance(track.timeline.commitAt, true);
      if (disposed) finishTimeline(track, 'disposed');
      else if (def.channelTime === 0) finishTimeline(track);
      return { ok: true, id, phase: 'committed' };
    } catch (error) {
      rethrowWithCleanup(error, [
        () => { if (current?.id === id) release(current); },
        () => finishTimeline(track, 'error'),
      ]);
    } finally { committing = false; }
  }
  /** @type {AbilitySystem} */
  const api = {
    define,
    canActivate(id) { return availability(id); },
    tryActivate(id, context = {}) {
      const allowed = availability(id);
      if (!allowed.ok) return allowed;
      const def = catalog.get(id);
      const track = def.timeline ? createAbilityTimelineRun(def.timeline, clock,
        { ability: id, activation: nextActivation++, context: Object.freeze({ ...context }) }, onTimeline) : null;
      if (def.castTime === 0) return commit(id, def, context, track);
      const entry = begin(id, def, { ...context }, 'casting', def.castTime, track);
      if (!disposed && current === entry) {
        try {
          track?.start();
          track?.advance(0, false);
          if (!disposed && current === entry) events.emit({ type: 'cast', id });
        } catch (error) {
          rethrowWithCleanup(error, [
            () => { if (current === entry) cancelEntry(entry, 'error'); },
          ]);
        }
      }
      return { ok: true, id, phase: 'casting' };
    },
    queue(id, context = {}, seconds = 0.15) {
      live();
      if (!catalog.has(id)) throw new Error('Unknown ability: ' + id);
      nonNegative(seconds, 'buffer seconds');
      queued = { id, context: { ...context }, until: clock + seconds };
      events.emit({ type: 'queued', id });
    },
    clearQueue() { queued = null; },
    cancel(reason = 'cancelled') {
      if (!current || committing) return false;
      cancelEntry(current, reason);
      return true;
    },
    getState(id) {
      if (!catalog.has(id)) throw new Error('Unknown ability: ' + id);
      const state = replenish(id), def = catalog.get(id);
      const entry = current?.id === id ? current : null;
      const track = entry?.track;
      return { id, charges: state.charges, maxCharges: def.charges,
        rechargeRemaining: state.nextCharge === Infinity ? 0 : Math.max(0, state.nextCharge - clock),
        active: entry?.phase ?? null,
        ...(track ? { timeline: { elapsed: Math.min(track.timeline.duration, Math.max(0, clock - track.startAt)),
          duration: track.timeline.duration, commitAt: track.timeline.commitAt, clip: track.timeline.clip } } : {}) };
    },
    getActive() { return current?.id ?? null; },
    update(dt) {
      live(); nonNegative(dt, 'dt');
      if (updating || committing) throw new Error('AbilitySystem.update is not reentrant');
      clock = finite(clock + dt, 'ability clock');
      updating = true;
      try {
        for (const id of catalog.keys()) replenish(id);
        let entry = current;
        if (entry && !permitted(entry.def)) api.cancel('tags');
        else if (entry?.phase === 'casting') {
          if (entry.track) entry.track.advance(clock - entry.track.startAt, false);
          const due = clock >= entry.endsAt || (entry.track && clock + 1e-9 >= entry.endsAt);
          if (!disposed && current === entry && due) {
            const cast = entry;
            const result = commit(cast.id, cast.def, cast.context, cast.track, cast);
            if (!result.ok && !disposed) events.emit({ type: 'cancel', id: cast.id, reason: result.reason });
            // Advance a timeline's recovery against its original start even when a step crosses commit.
            entry = cast.track && current?.track === cast.track ? current : null;
          }
        }
        if (!disposed && current === entry && entry?.phase === 'channeling') {
          const until = Math.min(clock, entry.endsAt);
          if (entry.track) entry.track.advance(until - entry.track.startAt, true);
          if (!disposed && current === entry && entry.nextTick <= until) {
            const count = Math.min(Number.MAX_SAFE_INTEGER, Math.floor((until - entry.nextTick) / entry.def.channelInterval + 1e-9) + 1);
            entry.nextTick += count * entry.def.channelInterval;
            run(entry.id, entry.context, 'channel', count);
            if (!disposed && current === entry) events.emit({ type: 'channel', id: entry.id, count });
          }
          if (!disposed && current === entry && (clock >= entry.endsAt || (entry.track && clock + 1e-9 >= entry.endsAt))) {
            const done = entry;
            cleanupAll([
              () => release(done),
              () => finishTimeline(done.track),
              () => { if (!disposed) events.emit({ type: 'end', id: done.id }); },
            ], 'Ability end failed');
          }
        }
        if (!disposed && queued) {
          const command = queued;
          if (clock > command.until) { queued = null; events.emit({ type: 'queue-expired', id: command.id }); }
          else if (availability(command.id).ok) { queued = null; api.tryActivate(command.id, command.context); }
        }
      } finally { updating = false; }
    },
    snapshot() {
      const saved = Object.create(null);
      for (const id of catalog.keys()) { const state = api.getState(id); saved[id] = { charges: state.charges, rechargeRemaining: state.rechargeRemaining }; }
      return { schemaVersion: 1, abilities: saved, globalRemaining: Math.max(0, globalUntil - clock),
        groups: Object.fromEntries([...groups].filter(([, until]) => until > clock).map(([id, until]) => [id, until - clock])) };
    },
    restore(snapshot) {
      live();
      if (committing || snapshot.schemaVersion !== 1 || !snapshot.abilities || !snapshot.groups) throw new Error('Invalid ability snapshot or restore during commit');
      const pending = new Map();
      for (const id of Object.keys(snapshot.abilities)) if (!catalog.has(id)) throw new Error('Unknown snapshot ability: ' + id);
      for (const [id, def] of catalog) {
        const saved = Object.hasOwn(snapshot.abilities, id) ? snapshot.abilities[id] : { charges: def.charges, rechargeRemaining: 0 };
        if (!Number.isSafeInteger(saved.charges) || saved.charges < 0 || saved.charges > def.charges) throw new Error('Invalid saved charges: ' + id);
        const remaining = nonNegative(saved.rechargeRemaining, 'rechargeRemaining');
        pending.set(id, { charges: saved.charges, nextCharge: saved.charges === def.charges ? Infinity : clock + remaining });
      }
      const globalRemaining = nonNegative(snapshot.globalRemaining, 'globalRemaining');
      const restoredGroups = Object.entries(changes(snapshot.groups));
      for (const [, remaining] of restoredGroups) nonNegative(remaining, 'group remaining');
      api.clearQueue(); api.cancel('restored'); live();
      states.clear(); for (const [id, state] of pending) states.set(id, state);
      groups.clear(); for (const [id, remaining] of restoredGroups) groups.set(id, clock + remaining);
      globalUntil = clock + globalRemaining;
    },
    subscribe: events.subscribe,
    dispose() {
      if (disposed) return;
      disposed = true; queued = null;
      try {
        const entry = current;
        if (entry) cleanupAll([() => release(entry), () => finishTimeline(entry.track, 'disposed')], 'Ability disposal failed');
      }
      finally { events.clear(); catalog.clear(); states.clear(); groups.clear(); }
    },
  };
  for (const [id, def] of Object.entries(definitions)) define(id, def);
  return api;
}
