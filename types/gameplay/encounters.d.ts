/**
 * Schedule stage waves, clear/survival/signal goals and stage-entry checkpoints on the caller's fixed step.
 * A spawn adapter returns true only after accepting the whole batch. A declined batch retries with the same ticket.
 * @param {EncounterDefinition} definition
 * @param {EncounterOptions} options
 */
export function createEncounterDirector(definition: EncounterDefinition, { spawn, maxBatchesPerStep, onEvent }: EncounterOptions): {
    getState: () => EncounterState;
    /** @returns {EncounterState} */
    start(): EncounterState;
    /** Record confirmed removals from an accepted spawn ticket. @param {string} ticket @param {number} [count] */
    defeated(ticket: string, count?: number | undefined): boolean;
    /** @param {string} signal */
    signal(signal: string): boolean;
    /** @param {string} [reason] */
    fail(reason?: string | undefined): boolean;
    /** Advance from the game's existing fixedUpdate. @param {number} dt Seconds. */
    update(dt: number): void;
    /** Save the latest checkpoint, which resumes from the start of its stage. @returns {EncounterCheckpoint | null} */
    getCheckpoint(): EncounterCheckpoint | null;
    /** The game resets the encounter's entities before restoring the stage entry. @param {EncounterCheckpoint} saved @returns {EncounterState} */
    restoreCheckpoint(saved: EncounterCheckpoint): EncounterState;
    /** @type {(listener: (event: EncounterEvent) => void) => (() => void)} */
    subscribe(listener: (event: EncounterEvent) => void): (() => void);
    /** Release subscriptions and tracking. The game owns spawned entities. */
    dispose(): void;
};
/** Drive an encounter from an entity's fixed step without a separate timer. */
export class EncounterComponent extends Component {
    /** @param {EncounterDefinition} definition @param {EncounterOptions & {autoStart?: boolean}} options */
    constructor(definition: EncounterDefinition, { autoStart, ...options }: EncounterOptions & {
        autoStart?: boolean;
    });
    director: {
        getState: () => EncounterState;
        /** @returns {EncounterState} */
        start(): EncounterState;
        /** Record confirmed removals from an accepted spawn ticket. @param {string} ticket @param {number} [count] */
        defeated(ticket: string, count?: number | undefined): boolean;
        /** @param {string} signal */
        signal(signal: string): boolean;
        /** @param {string} [reason] */
        fail(reason?: string | undefined): boolean;
        /** Advance from the game's existing fixedUpdate. @param {number} dt Seconds. */
        update(dt: number): void;
        /** Save the latest checkpoint, which resumes from the start of its stage. @returns {EncounterCheckpoint | null} */
        getCheckpoint(): EncounterCheckpoint | null;
        /** The game resets the encounter's entities before restoring the stage entry. @param {EncounterCheckpoint} saved @returns {EncounterState} */
        restoreCheckpoint(saved: EncounterCheckpoint): EncounterState;
        /** @type {(listener: (event: EncounterEvent) => void) => (() => void)} */
        subscribe(listener: (event: EncounterEvent) => void): (() => void);
        /** Release subscriptions and tracking. The game owns spawned entities. */
        dispose(): void;
    };
    autoStart: boolean;
    /** @param {number} dt */
    fixedUpdate(dt: number): void;
}
export type SpawnGroup = {
    id: string;
    enemy: string;
    point?: string;
    at?: number;
    count: number;
    batches?: number;
    interval?: number;
};
export type EncounterStage = {
    id: string;
    waves?: readonly SpawnGroup[];
    goals?: {
        clear?: boolean;
        survive?: number;
        signals?: readonly string[];
    };
    timeout?: number;
    checkpoint?: boolean;
    enterSignal?: string;
    completeSignal?: string;
};
export type EncounterDefinition = {
    id: string;
    stages: readonly EncounterStage[];
};
export type EncounterStatus = "idle" | "running" | "completed" | "failed";
export type ScheduledBatch = {
    stage: string;
    wave: string;
    enemy: string;
    point?: string;
    count: number;
    batch: number;
    at: number;
};
export type EncounterSpawn = ScheduledBatch & {
    ticket: string;
};
export type EncounterCheckpoint = {
    schemaVersion: 1;
    encounterId: string;
    stageId: string;
};
export type EncounterState = {
    id: string;
    status: EncounterStatus;
    stageId: string | null;
    elapsed: number;
    pendingBatches: number;
    alive: number;
    signalsRemaining: string[];
    failure: string | null;
};
export type EncounterEvent = {
    type: "stage-start" | "stage-complete" | "complete";
    state: EncounterState;
} | {
    type: "failed";
    state: EncounterState;
    reason: string;
} | {
    type: "checkpoint";
    checkpoint: EncounterCheckpoint;
} | {
    type: "signal";
    signal: string;
    stageId: string;
};
export type CompiledStage = {
    id: string;
    schedule: ScheduledBatch[];
    clear: boolean;
    survive: number;
    signals: string[];
    timeout: number;
    checkpoint: boolean;
    enterSignal?: string;
    completeSignal?: string;
};
export type EncounterOptions = {
    spawn: (batch: Readonly<EncounterSpawn>) => boolean;
    maxBatchesPerStep?: number;
    onEvent?: (event: EncounterEvent) => void;
};
import { Component } from '../core/component.js';
