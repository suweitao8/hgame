/**
 * Track staged quests from game signals. The caller owns acceptance UI and reward delivery.
 * An incoming signal counts once per matching objective in the current stage, then advances the stage.
 * @param {Record<string, QuestDefinition>} definitions
 * @param {{onEvent?: (event: QuestEvent) => void}} [options]
 */
export function createQuestLog(definitions: Record<string, QuestDefinition>, { onEvent }?: {
    onEvent?: (event: QuestEvent) => void;
} | undefined): {
    get: (id: string) => QuestView | null;
    /** @param {QuestStatus} [status] @returns {QuestView[]} */
    list(status?: QuestStatus | undefined): QuestView[];
    /** @param {string} id @returns {boolean} */
    accept(id: string): boolean;
    /** Record a signal. Returns the number of active quests that advanced. @param {string} signal @param {{amount?: number, data?: SignalData}} [options] */
    record(signal: string, { amount, data }?: {
        amount?: number;
        data?: SignalData;
    } | undefined): number;
    /**
     * Mark rewards as claimed and return their descriptors once. `accept` is a synchronous
     * admission check; returning false or throwing leaves the quest complete and claimable.
     * @param {string} id
     * @param {{accept?: (rewards: readonly Readonly<{id: string, amount: number}>[]) => boolean}} [options]
     * @returns {{id: string, amount: number}[] | null}
     */
    claim(id: string, { accept }?: {
        accept?: (rewards: readonly Readonly<{
            id: string;
            amount: number;
        }>[]) => boolean;
    } | undefined): {
        id: string;
        amount: number;
    }[] | null;
    /** @returns {QuestSnapshot} */
    snapshot(): QuestSnapshot;
    /** Restore progress and signal routing without emitting rewards or completion events. @param {QuestSnapshot} snapshot */
    restore(snapshot: QuestSnapshot): void;
    /** @type {(listener: (event: QuestEvent) => void) => (() => void)} */
    subscribe: (listener: (event: QuestEvent) => void) => (() => void);
};
export type SignalData = import("./story.js").StoryVariables;
export type QuestObjective = {
    id: string;
    signal: string;
    count?: number;
    match?: SignalData;
};
export type QuestStage = {
    id: string;
    objectives: readonly QuestObjective[];
};
export type QuestReward = {
    id: string;
    amount?: number;
};
export type QuestDefinition = {
    title?: string;
    requires?: readonly string[];
    stages: readonly QuestStage[];
    rewards?: readonly QuestReward[];
};
export type QuestStatus = "locked" | "available" | "active" | "complete" | "claimed";
export type QuestView = {
    id: string;
    title: string;
    status: QuestStatus;
    stageId: string | null;
    objectives: {
        id: string;
        count: number;
        target: number;
    }[];
};
export type QuestProgress = {
    status: "active" | "complete" | "claimed";
    stage: number;
    counts: number[];
};
export type SavedQuest = {
    status: "active";
    stageId: string;
    objectives: Record<string, number>;
} | {
    status: "complete" | "claimed";
};
export type QuestSnapshot = {
    schemaVersion: 1;
    quests: Record<string, SavedQuest>;
};
export type QuestEvent = {
    type: "accepted" | "progress" | "stage" | "completed";
    quest: QuestView;
} | {
    type: "restored";
};
export type CompiledObjective = {
    id: string;
    signal: string;
    target: number;
    match: readonly [string, SignalData[string]][];
};
export type CompiledQuest = {
    id: string;
    title: string;
    requires: string[];
    stages: {
        id: string;
        objectives: CompiledObjective[];
    }[];
    rewards: {
        id: string;
        amount: number;
    }[];
};
