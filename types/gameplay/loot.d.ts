/**
 * Compile weighted loot tables and keep one durable roll and claim per game-owned source ID.
 * Identical run seed, table and source ID produce the same result regardless of other drops.
 * @param {Record<string, LootTable>} definitions
 * @param {{seed?: string | number}} [options]
 */
export function createLootSystem(definitions: Record<string, LootTable>, { seed }?: {
    seed?: string | number;
} | undefined): {
    /** Keep the first result for a source ID. @param {string} table @param {string} source @returns {LootReceipt} */
    roll(table: string, source: string): LootReceipt;
    /** @param {string} source @returns {LootReceipt | null} */
    get(source: string): LootReceipt | null;
    /** @param {string} source @param {LootInventory} inventory @returns {LootClaim} */
    claim(source: string, inventory: LootInventory): LootClaim;
    /** @returns {LootSnapshot} */
    snapshot(): LootSnapshot;
    /** Restore the recorded outcomes without rolling or granting items. @param {LootSnapshot} snapshot */
    restore(snapshot: LootSnapshot): void;
};
export type ItemQuantity = import("./inventory.js").ItemQuantity;
export type LootOutcome = {
    kind: "item";
    id: string;
    amount?: number | readonly [number, number];
} | {
    kind: "table";
    id: string;
} | {
    kind: "empty";
};
export type LootTable = {
    guaranteed?: readonly LootOutcome[];
    entries?: readonly (LootOutcome & {
        weight: number;
    })[];
    rolls?: number;
};
export type CompiledOutcome = {
    kind: "item";
    id: string;
    min: number;
    max: number;
} | {
    kind: "table";
    id: string;
} | {
    kind: "empty";
};
export type CompiledTable = {
    guaranteed: CompiledOutcome[];
    entries: {
        weight: number;
        outcome: CompiledOutcome;
    }[];
    rolls: number;
    total: number;
};
export type LootReceipt = {
    source: string;
    table: string;
    status: "pending" | "claimed";
    items: ItemQuantity[];
};
export type LootSnapshot = {
    schemaVersion: 1;
    seed: string | number;
    receipts: LootReceipt[];
};
export type LootClaim = {
    ok: true;
    items: ItemQuantity[];
} | {
    ok: false;
    reason: "unavailable" | "full";
};
export type LootInventory = Pick<ReturnType<typeof import("./inventory.js").createInventory>, "transact">;
