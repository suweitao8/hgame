import { identifier, nonNegative } from './gameplay.js';

/** @typedef {{at: number, id: string, data?: Readonly<Record<string, string | number | boolean | null>>}} AbilityCue */
/** @typedef {{duration: number, commitAt: number, clip?: string, cues?: readonly AbilityCue[]}} AbilityTimeline */
/** @typedef {{ability: string, activation: number, clip?: string, duration: number, commitAt: number, context: Readonly<import('../gameplay/abilities.js').AbilityContext>}} TimelineInfo */
/** @typedef {TimelineInfo & ({type: 'start' | 'end', at: number} | {type: 'cue', at: number, cue: string, data?: AbilityCue['data']} | {type: 'cancel', at: number, reason: string})} AbilityTimelineEvent */
/** @typedef {Required<Pick<AbilityTimeline, 'duration' | 'commitAt' | 'cues'>> & Pick<AbilityTimeline, 'clip'>} CompiledTimeline */
/** @typedef {(event: AbilityTimelineEvent) => void} TimelineSink */
/** @typedef {{startAt: number, timeline: CompiledTimeline, start: () => void, advance: (at: number, committed: boolean) => void, finish: (at: number, reason?: string) => void}} AbilityTimelineRun */

/** @param {AbilityTimeline} input @returns {CompiledTimeline} */
export function compileAbilityTimeline(input) {
  const duration = nonNegative(input.duration, 'timeline duration');
  const commitAt = nonNegative(input.commitAt, 'timeline commitAt');
  if (commitAt > duration) throw new RangeError('Timeline commitAt must be within its duration');
  const cues = (input.cues ?? []).map(cue => {
    const at = nonNegative(cue.at, 'cue time');
    if (at > duration) throw new RangeError('Cue lies beyond the timeline: ' + cue.id);
    let data;
    if (cue.data !== undefined) {
      if (!cue.data || typeof cue.data !== 'object' || Array.isArray(cue.data)) throw new TypeError('Cue data must be an object');
      for (const value of Object.values(cue.data)) {
        if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !Number.isFinite(value)) {
          throw new TypeError('Cue data values must be JSON scalars');
        }
      }
      data = Object.freeze({ ...cue.data });
    }
    return { at, id: identifier(cue.id, 'cue id'), data };
  }).sort((a, b) => a.at - b.at);
  return { duration, commitAt, clip: input.clip === undefined ? undefined : identifier(input.clip, 'clip'), cues };
}

/** @param {CompiledTimeline} timeline @param {number} startAt @param {Pick<TimelineInfo, 'ability' | 'activation' | 'context'>} activation @param {TimelineSink | undefined} dispatch @returns {AbilityTimelineRun} */
export function createAbilityTimelineRun(timeline, startAt, activation, dispatch) {
  const { duration, commitAt, clip, cues } = timeline;
  const base = { ...activation, duration, commitAt, clip };
  let index = 0;
  let started = false;
  let closed = false;
  return {
    startAt, timeline,
    start() {
      if (started || closed) return;
      started = true;
      dispatch?.({ ...base, type: 'start', at: 0 });
    },
    advance(at, committed) {
      if (!started || !dispatch) return;
      while (!closed && index < cues.length) {
        const cue = cues[index];
        if (cue.at > at + 1e-9 || (!committed && cue.at >= commitAt)) break;
        index++;
        dispatch({ ...base, type: 'cue', at: cue.at, cue: cue.id, data: cue.data });
      }
    },
    finish(at, reason) {
      if (closed) return;
      closed = true;
      if (!started) return;
      if (reason === undefined) dispatch?.({ ...base, type: 'end', at: duration });
      else dispatch?.({ ...base, type: 'cancel', at: Math.min(duration, Math.max(0, at)), reason });
    },
  };
}
