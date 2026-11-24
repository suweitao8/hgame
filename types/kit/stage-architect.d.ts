/**
 * Normalize a 2D grid, PvZ lane-defense board, arena, or modular-3d level into a canonical StageDefinition.
 * @param {object} input
 * @returns {StageDefinition}
 */
export function defineStage(input?: object): StageDefinition;
/**
 * Audit a stage across connectivity, tactical spatial shape, sawtooth wave pacing,
 * one-new-thing / counter fairness, and PvZ-style light micro-barks.
 * @param {object} input
 * @param {StageAnalyzeOptions} [options]
 * @returns {StageAuditReport}
 */
export function analyzeStageDesign(input: object, options?: StageAnalyzeOptions | undefined): StageAuditReport;
/**
 * Validate a multi-stage PvZ-style campaign ("起-承-转-合"):
 * propagates cumulative tool unlocks, prevents premature enemy counters, and catches stagnation droughts.
 * @param {object} campaign
 * @param {StageAnalyzeOptions} [options]
 */
export function analyzeCampaignProgression(campaign: object, options?: StageAnalyzeOptions | undefined): {
    ok: boolean;
    pass: boolean;
    score: number;
    stageCount: number;
    stages: {
        ok: boolean;
        pass: boolean;
        score: number;
        topology: StageTopology;
        width: number;
        height: number;
        reachableCells: number;
        isolatedFloorCells: number;
        objectiveCount: number;
        unreachableObjectives: string[];
        minimap: string;
        metrics: {
            spatial: {
                walkableRatio: number;
                featureRatio: number;
                chokepointCount: number;
                routeCount: number;
                minEnemySpawnDistMeters: number | null;
                firstContactSec: number | null;
            };
            pacing: {
                waveCount: number;
                totalDurationSec: number;
                waveThreats: number[];
                waveIntensities: number[];
                flagWaves: string[];
                flagPositions: number[];
                sawtoothDrops: number;
                peakToFirstRatio: number;
            };
            mechanics: {
                introducedCount: number;
                activeTraits: string[];
                uncounteredTraits: string[];
                encounteredEnemies: string[];
            };
            barks: {
                count: number;
                maxTextLength: number;
                unlockLabelLength: number;
            };
        };
        warnings: string[];
        errors: string[];
        id: any;
    }[];
    unlockedTools: string[];
    warnings: string[];
    errors: string[];
};
/**
 * Deterministic 60Hz runtime wave & light-bark director for any StageDefinition.
 * @param {object} stageInput
 * @param {{
 *   earlyClearDelaySec?: number,
 *   onSpawn?: (entry: { waveId: string, waveIndex: number, enemy: string, lane?: number, point?: string }) => void,
 *   onWaveStart?: (info: { waveId: string, waveIndex: number, totalWaves: number, flag: boolean }) => void,
 *   onFlagWave?: (info: { waveId: string, waveIndex: number }) => void,
 *   onBark?: (bark: StageBark) => void,
 *   onUnlock?: (unlock: StageUnlock) => void,
 *   onComplete?: (summary: { stageId: string, elapsed: number }) => void
 * }} [options]
 */
export function createStageDirector(stageInput: object, options?: {
    earlyClearDelaySec?: number;
    onSpawn?: (entry: {
        waveId: string;
        waveIndex: number;
        enemy: string;
        lane?: number;
        point?: string;
    }) => void;
    onWaveStart?: (info: {
        waveId: string;
        waveIndex: number;
        totalWaves: number;
        flag: boolean;
    }) => void;
    onFlagWave?: (info: {
        waveId: string;
        waveIndex: number;
    }) => void;
    onBark?: (bark: StageBark) => void;
    onUnlock?: (unlock: StageUnlock) => void;
    onComplete?: (summary: {
        stageId: string;
        elapsed: number;
    }) => void;
} | undefined): Readonly<{
    stage: StageDefinition;
    start: () => {
        status: string;
        stageId: string;
        waveIndex: number;
        totalWaves: number;
        progress: number;
        flagPositions: number[];
        isFlagWave: boolean;
        activeBark: any;
        unlock: {
            id: string;
            kind: "tool" | "upgrade" | "passive" | "badge";
            label: string;
            icon: string;
            counters: string[];
        } | null;
    };
    update: (dt: any, { aliveEnemies }?: {
        aliveEnemies?: null | undefined;
    }) => {
        status: string;
        stageId: string;
        waveIndex: number;
        totalWaves: number;
        progress: number;
        flagPositions: number[];
        isFlagWave: boolean;
        activeBark: any;
        unlock: {
            id: string;
            kind: "tool" | "upgrade" | "passive" | "badge";
            label: string;
            icon: string;
            counters: string[];
        } | null;
    };
    triggerBark: (at: any) => void;
    getHudState: () => {
        status: string;
        stageId: string;
        waveIndex: number;
        totalWaves: number;
        progress: number;
        flagPositions: number[];
        isFlagWave: boolean;
        activeBark: any;
        unlock: {
            id: string;
            kind: "tool" | "upgrade" | "passive" | "badge";
            label: string;
            icon: string;
            counters: string[];
        } | null;
    };
    getSnapshot: () => {
        schemaVersion: number;
        stageId: string;
        status: string;
        waveIndex: number;
        waveElapsed: number;
        totalElapsed: number;
        spawnCursor: number;
        earlyClearTimer: any;
        firstFlagFired: boolean;
        activeBark: any;
        barkTimer: number;
    };
    restoreSnapshot: (snap: any) => {
        status: string;
        stageId: string;
        waveIndex: number;
        totalWaves: number;
        progress: number;
        flagPositions: number[];
        isFlagWave: boolean;
        activeBark: any;
        unlock: {
            id: string;
            kind: "tool" | "upgrade" | "passive" | "badge";
            label: string;
            icon: string;
            counters: string[];
        } | null;
    };
}>;
/**
 * @typedef {'floor' | 'wall' | 'water' | 'hazard' | 'cover' | 'destructible' | 'spawn' | 'enemySpawn' | 'goal' | 'pad'} StageCellKind
 * @typedef {{ code: string, kind: StageCellKind, walkable: boolean, swimOnly: boolean, blocksSight: boolean, destructible: boolean, hazard: boolean, tactical: boolean }} StageCellSpec
 * @typedef {'grid-2d' | 'lane-defense' | 'arena' | 'modular-3d'} StageTopology
 * @typedef {{ x: number, y: number, id?: string }} StagePoint
 * @typedef {{ enemy: string, count?: number, lane?: number, point?: string, intervalSec?: number, delaySec?: number }} StageWaveSpawn
 * @typedef {{ id: string, durationSec: number, breatherSec: number, flag: boolean, spawns: StageWaveSpawn[] }} StageWave
 * @typedef {'preStage' | 'firstFlag' | 'finalWave' | 'boss' | 'victory'} StageBarkTrigger
 * @typedef {{ at: StageBarkTrigger, speaker: string, icon: string, text: string, cue?: string | null, durationSec: number }} StageBark
 * @typedef {{ id: string, kind: 'tool' | 'upgrade' | 'passive' | 'badge', label: string, icon: string, counters: string[] }} StageUnlock
 * @typedef {{ threat?: number, speed?: number, traits?: readonly string[], requiresCounter?: boolean }} StageEnemySpec
 * @typedef {{
 *   introduced: string[],
 *   availableTools: string[],
 *   modifiers: string[],
 *   enemyCatalog: Record<string, StageEnemySpec>,
 *   toolCounters: Record<string, string[]>,
 *   requiredCounterTraits: string[]
 * }} StageMechanics
 * @typedef {{
 *   schemaVersion: 1,
 *   id: string,
 *   title: string,
 *   topology: StageTopology,
 *   width: number,
 *   height: number,
 *   cellSize: number,
 *   allowDiag: boolean,
 *   cells: string[],
 *   spawn: StagePoint,
 *   objectives: StagePoint[],
 *   enemySpawns: StagePoint[],
 *   laneTypes: string[],
 *   mechanics: StageMechanics,
 *   waves: StageWave[],
 *   barks: StageBark[],
 *   unlock: StageUnlock | null
 * }} StageDefinition
 * @typedef {{
 *   allowDiag?: boolean,
 *   allowSwim?: boolean,
 *   strictGameplay?: boolean,
 *   minReactionSec?: number,
 *   maxBarkChars?: number,
 *   maxBarksPerStage?: number
 * }} StageAnalyzeOptions
 * @typedef {{
 *   ok: boolean,
 *   pass: boolean,
 *   score: number,
 *   topology: StageTopology,
 *   width: number,
 *   height: number,
 *   reachableCells: number,
 *   isolatedFloorCells: number,
 *   objectiveCount: number,
 *   unreachableObjectives: string[],
 *   minimap: string,
 *   metrics: {
 *     spatial: {
 *       walkableRatio: number,
 *       featureRatio: number,
 *       chokepointCount: number,
 *       routeCount: number,
 *       minEnemySpawnDistMeters: number | null,
 *       firstContactSec: number | null
 *     },
 *     pacing: {
 *       waveCount: number,
 *       totalDurationSec: number,
 *       waveThreats: number[],
 *       waveIntensities: number[],
 *       flagWaves: string[],
 *       flagPositions: number[],
 *       sawtoothDrops: number,
 *       peakToFirstRatio: number
 *     },
 *     mechanics: {
 *       introducedCount: number,
 *       activeTraits: string[],
 *       uncounteredTraits: string[],
 *       encounteredEnemies: string[]
 *     },
 *     barks: {
 *       count: number,
 *       maxTextLength: number,
 *       unlockLabelLength: number
 *     }
 *   },
 *   warnings: string[],
 *   errors: string[]
 * }} StageAuditReport
 */
/** Canonical tactical terrain cell palette shared by validators and runtime renderers. */
export const STAGE_CELL_PALETTE: Readonly<{
    '.': Readonly<{
        code: ".";
        kind: "floor";
        walkable: true;
        swimOnly: false;
        blocksSight: false;
        destructible: false;
        hazard: false;
        tactical: false;
    }>;
    '#': Readonly<{
        code: "#";
        kind: "wall";
        walkable: false;
        swimOnly: false;
        blocksSight: true;
        destructible: false;
        hazard: false;
        tactical: true;
    }>;
    '~': Readonly<{
        code: "~";
        kind: "water";
        walkable: false;
        swimOnly: true;
        blocksSight: false;
        destructible: false;
        hazard: false;
        tactical: true;
    }>;
    '^': Readonly<{
        code: "^";
        kind: "hazard";
        walkable: true;
        swimOnly: false;
        blocksSight: false;
        destructible: false;
        hazard: true;
        tactical: true;
    }>;
    '=': Readonly<{
        code: "=";
        kind: "cover";
        walkable: false;
        swimOnly: false;
        blocksSight: false;
        destructible: false;
        hazard: false;
        tactical: true;
    }>;
    '+': Readonly<{
        code: "+";
        kind: "destructible";
        walkable: true;
        swimOnly: false;
        blocksSight: false;
        destructible: true;
        hazard: false;
        tactical: true;
    }>;
    S: Readonly<{
        code: "S";
        kind: "spawn";
        walkable: true;
        swimOnly: false;
        blocksSight: false;
        destructible: false;
        hazard: false;
        tactical: false;
    }>;
    E: Readonly<{
        code: "E";
        kind: "enemySpawn";
        walkable: true;
        swimOnly: false;
        blocksSight: false;
        destructible: false;
        hazard: false;
        tactical: false;
    }>;
    G: Readonly<{
        code: "G";
        kind: "goal";
        walkable: true;
        swimOnly: false;
        blocksSight: false;
        destructible: false;
        hazard: false;
        tactical: false;
    }>;
    P: Readonly<{
        code: "P";
        kind: "pad";
        walkable: true;
        swimOnly: false;
        blocksSight: false;
        destructible: false;
        hazard: false;
        tactical: true;
    }>;
}>;
export type StageCellKind = "floor" | "wall" | "water" | "hazard" | "cover" | "destructible" | "spawn" | "enemySpawn" | "goal" | "pad";
export type StageCellSpec = {
    code: string;
    kind: StageCellKind;
    walkable: boolean;
    swimOnly: boolean;
    blocksSight: boolean;
    destructible: boolean;
    hazard: boolean;
    tactical: boolean;
};
export type StageTopology = "grid-2d" | "lane-defense" | "arena" | "modular-3d";
export type StagePoint = {
    x: number;
    y: number;
    id?: string;
};
export type StageWaveSpawn = {
    enemy: string;
    count?: number;
    lane?: number;
    point?: string;
    intervalSec?: number;
    delaySec?: number;
};
export type StageWave = {
    id: string;
    durationSec: number;
    breatherSec: number;
    flag: boolean;
    spawns: StageWaveSpawn[];
};
export type StageBarkTrigger = "preStage" | "firstFlag" | "finalWave" | "boss" | "victory";
export type StageBark = {
    at: StageBarkTrigger;
    speaker: string;
    icon: string;
    text: string;
    cue?: string | null;
    durationSec: number;
};
export type StageUnlock = {
    id: string;
    kind: "tool" | "upgrade" | "passive" | "badge";
    label: string;
    icon: string;
    counters: string[];
};
export type StageEnemySpec = {
    threat?: number;
    speed?: number;
    traits?: readonly string[];
    requiresCounter?: boolean;
};
export type StageMechanics = {
    introduced: string[];
    availableTools: string[];
    modifiers: string[];
    enemyCatalog: Record<string, StageEnemySpec>;
    toolCounters: Record<string, string[]>;
    requiredCounterTraits: string[];
};
export type StageDefinition = {
    schemaVersion: 1;
    id: string;
    title: string;
    topology: StageTopology;
    width: number;
    height: number;
    cellSize: number;
    allowDiag: boolean;
    cells: string[];
    spawn: StagePoint;
    objectives: StagePoint[];
    enemySpawns: StagePoint[];
    laneTypes: string[];
    mechanics: StageMechanics;
    waves: StageWave[];
    barks: StageBark[];
    unlock: StageUnlock | null;
};
export type StageAnalyzeOptions = {
    allowDiag?: boolean;
    allowSwim?: boolean;
    strictGameplay?: boolean;
    minReactionSec?: number;
    maxBarkChars?: number;
    maxBarksPerStage?: number;
};
export type StageAuditReport = {
    ok: boolean;
    pass: boolean;
    score: number;
    topology: StageTopology;
    width: number;
    height: number;
    reachableCells: number;
    isolatedFloorCells: number;
    objectiveCount: number;
    unreachableObjectives: string[];
    minimap: string;
    metrics: {
        spatial: {
            walkableRatio: number;
            featureRatio: number;
            chokepointCount: number;
            routeCount: number;
            minEnemySpawnDistMeters: number | null;
            firstContactSec: number | null;
        };
        pacing: {
            waveCount: number;
            totalDurationSec: number;
            waveThreats: number[];
            waveIntensities: number[];
            flagWaves: string[];
            flagPositions: number[];
            sawtoothDrops: number;
            peakToFirstRatio: number;
        };
        mechanics: {
            introducedCount: number;
            activeTraits: string[];
            uncounteredTraits: string[];
            encounteredEnemies: string[];
        };
        barks: {
            count: number;
            maxTextLength: number;
            unlockLabelLength: number;
        };
    };
    warnings: string[];
    errors: string[];
};
