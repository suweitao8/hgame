/**
 * Run a story.json graph with gated choices, variable changes, signals and save snapshots.
 * Commands are synchronous. Subscribe before calling start() to receive entry signals.
 * @param {StoryDefinition} definition
 * @param {{onEvent?: (event: StoryEvent) => void}} [options]
 */
export function createStoryRunner(definition: StoryDefinition, { onEvent }?: {
    onEvent?: (event: StoryEvent) => void;
} | undefined): {
    view: () => StoryView | null;
    /** Start a fresh run. Previous variables and visit counts are cleared. @returns {StoryView} */
    start(): StoryView;
    /** @param {number} [expectedRevision] @returns {StoryResult} */
    advance(expectedRevision?: number | undefined): StoryResult;
    /** @param {string} id @param {number} [expectedRevision] @returns {StoryResult} */
    choose(id: string, expectedRevision?: number | undefined): StoryResult;
    /** Apply external flags without replaying any node actions. @param {StoryVariables} values */
    setVariables(values: StoryVariables): void;
    /** @param {string} id @returns {StoryValue | undefined} */
    getVariable(id: string): StoryValue | undefined;
    /** @param {string} id @returns {number} */
    visitCount(id: string): number;
    /** @returns {StorySnapshot} */
    snapshot(): StorySnapshot;
    /** Restore without replaying node actions or signals. @param {StorySnapshot} snapshot @returns {StoryView} */
    restore(snapshot: StorySnapshot): StoryView;
    /** @type {(listener: (event: StoryEvent) => void) => (() => void)} */
    subscribe: (listener: (event: StoryEvent) => void) => (() => void);
};
export type StoryValue = string | number | boolean | null;
export type StoryVariables = Record<string, StoryValue>;
export type StoryCondition = {
    variable: string;
    op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte";
    value: StoryValue;
} | {
    variable: string;
    op: "exists" | "missing";
};
export type StoryAction = {
    op: "set";
    variable: string;
    value: StoryValue;
} | {
    op: "add";
    variable: string;
    value: number;
} | {
    op: "unset";
    variable: string;
} | {
    op: "emit";
    signal: string;
    data?: StoryVariables;
};
export type StoryChoice = {
    id?: string;
    label: string;
    next: string;
    when?: readonly StoryCondition[];
    actions?: readonly StoryAction[];
};
export type StoryNode = {
    text: string;
    speaker?: string;
    next?: string;
    ending?: boolean;
    choices?: readonly StoryChoice[];
    actions?: readonly StoryAction[];
};
export type StoryDefinition = {
    id?: string;
    start?: string;
    variables?: StoryVariables;
    nodes: Record<string, StoryNode> | readonly (StoryNode & {
        id: string;
    })[];
};
export type StoryView = {
    id: string;
    text: string;
    speaker?: string;
    ending: boolean;
    canAdvance: boolean;
    choices: {
        id: string;
        label: string;
    }[];
    revision: number;
};
export type StoryEvent = {
    type: "signal";
    signal: string;
    data: Readonly<StoryVariables>;
} | {
    type: "entered" | "ended" | "restored" | "variables";
    node: string;
    revision: number;
};
export type StorySnapshot = {
    schemaVersion: 1;
    storyId: string | null;
    node: string;
    variables: StoryVariables;
    visits: Record<string, number>;
};
export type StoryResult = {
    ok: true;
    view: StoryView;
} | {
    ok: false;
    reason: "busy" | "stale" | "ending" | "choice-required" | "unavailable";
};
export type CompiledChoice = {
    id: string;
    label: string;
    next: string;
    when: StoryCondition[];
    actions: StoryAction[];
};
export type CompiledNode = {
    id: string;
    text: string;
    speaker?: string;
    ending: boolean;
    next: string | null;
    choices: CompiledChoice[];
    actions: StoryAction[];
};
