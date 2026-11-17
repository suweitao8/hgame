/** @typedef {{at: number, id: string, data?: Readonly<Record<string, string | number | boolean | null>>}} AbilityCue */
/** @typedef {{duration: number, commitAt: number, clip?: string, cues?: readonly AbilityCue[]}} AbilityTimeline */
/** @typedef {{ability: string, activation: number, clip?: string, duration: number, commitAt: number, context: Readonly<import('../gameplay/abilities.js').AbilityContext>}} TimelineInfo */
/** @typedef {TimelineInfo & ({type: 'start' | 'end', at: number} | {type: 'cue', at: number, cue: string, data?: AbilityCue['data']} | {type: 'cancel', at: number, reason: string})} AbilityTimelineEvent */
/** @typedef {Required<Pick<AbilityTimeline, 'duration' | 'commitAt' | 'cues'>> & Pick<AbilityTimeline, 'clip'>} CompiledTimeline */
/** @typedef {(event: AbilityTimelineEvent) => void} TimelineSink */
/** @typedef {{startAt: number, timeline: CompiledTimeline, start: () => void, advance: (at: number, committed: boolean) => void, finish: (at: number, reason?: string) => void}} AbilityTimelineRun */
/** @param {AbilityTimeline} input @returns {CompiledTimeline} */
export function compileAbilityTimeline(input: AbilityTimeline): CompiledTimeline;
/** @param {CompiledTimeline} timeline @param {number} startAt @param {Pick<TimelineInfo, 'ability' | 'activation' | 'context'>} activation @param {TimelineSink | undefined} dispatch @returns {AbilityTimelineRun} */
export function createAbilityTimelineRun(timeline: CompiledTimeline, startAt: number, activation: Pick<TimelineInfo, "ability" | "activation" | "context">, dispatch: TimelineSink | undefined): AbilityTimelineRun;
export type AbilityCue = {
    at: number;
    id: string;
    data?: Readonly<Record<string, string | number | boolean | null>>;
};
export type AbilityTimeline = {
    duration: number;
    commitAt: number;
    clip?: string;
    cues?: readonly AbilityCue[];
};
export type TimelineInfo = {
    ability: string;
    activation: number;
    clip?: string;
    duration: number;
    commitAt: number;
    context: Readonly<import("../gameplay/abilities.js").AbilityContext>;
};
export type AbilityTimelineEvent = TimelineInfo & ({
    type: "start" | "end";
    at: number;
} | {
    type: "cue";
    at: number;
    cue: string;
    data?: AbilityCue["data"];
} | {
    type: "cancel";
    at: number;
    reason: string;
});
export type CompiledTimeline = Required<Pick<AbilityTimeline, "duration" | "commitAt" | "cues">> & Pick<AbilityTimeline, "clip">;
export type TimelineSink = (event: AbilityTimelineEvent) => void;
export type AbilityTimelineRun = {
    startAt: number;
    timeline: CompiledTimeline;
    start: () => void;
    advance: (at: number, committed: boolean) => void;
    finish: (at: number, reason?: string) => void;
};
