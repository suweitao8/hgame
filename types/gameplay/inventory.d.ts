/**
 * Create a slotted inventory with atomic exchanges, equipment modifiers and reward admission.
 * Create one per actor or party. Item definitions, presentation and item use belong to the game.
 * @param {InventoryOptions} options
 */
export function createInventory({ items, capacity, equipmentSlots, attributes, onEvent }: InventoryOptions): {
    readonly capacity: number;
    readonly revision: number;
    /** @param {number} index @returns {ItemQuantity | null} */
    getSlot(index: number): ItemQuantity | null;
    /** @returns {(ItemQuantity | null)[]} */
    list(): (ItemQuantity | null)[];
    /** @param {string} id */
    count(id: string): number;
    /** @param {string} slot @returns {string | null} */
    getEquipped(slot: string): string | null;
    /** @param {InventoryTransaction} transaction */
    canTransact(transaction: InventoryTransaction): boolean;
    /**
     * Apply the exchange. The optional synchronous onCommit runs once after success,
     * before inventory observers, and also runs for an empty successful exchange.
     * @param {InventoryTransaction} transaction
     * @param {{onCommit?: () => void}} [options]
     * @returns {InventoryResult}
     */
    transact(transaction: InventoryTransaction, { onCommit }?: {
        onCommit?: () => void;
    } | undefined): InventoryResult;
    /** @param {string} id @param {number} [amount] @returns {InventoryResult} */
    add(id: string, amount?: number | undefined): InventoryResult;
    /** @param {string} id @param {number} [amount] @returns {InventoryResult} */
    remove(id: string, amount?: number | undefined): InventoryResult;
    /** Move/swap stacks, or merge matching stacks up to their size limit. @param {number} from @param {number} to @returns {InventoryResult} */
    move(from: number, to: number): InventoryResult;
    /** @param {number} index Bag slot containing the item. @param {string} [slot] @returns {InventoryResult} */
    equip(index: number, slot?: string | undefined): InventoryResult;
    /** @param {string} slot @returns {InventoryResult} */
    unequip(slot: string): InventoryResult;
    /** Admit every reward before claiming. @param {ClaimableQuests} quests @param {string} id @returns {InventoryResult} */
    claimQuestRewards(quests: ClaimableQuests, id: string): InventoryResult;
    /** @returns {InventorySnapshot} */
    snapshot(): InventorySnapshot;
    /** @param {InventorySnapshot} snapshot */
    restore(snapshot: InventorySnapshot): void;
    /** @type {(listener: (event: InventoryEvent) => void) => (() => void)} */
    subscribe: (listener: (event: InventoryEvent) => void) => (() => void);
    dispose(): void;
};
export type AttributeModifier = import("./attributes.js").AttributeModifier;
export type ItemQuantity = {
    id: string;
    amount: number;
};
export type ItemDefinition = {
    maxStack?: number;
    equipment?: {
        slots: readonly string[];
        modifiers?: readonly AttributeModifier[];
    };
};
export type InventoryTransaction = {
    remove?: readonly ItemQuantity[];
    add?: readonly ItemQuantity[];
};
export type InventorySnapshot = {
    schemaVersion: 1;
    slots: (ItemQuantity | null)[];
    equipment: Record<string, string>;
};
export type InventoryEvent = {
    type: "transaction" | "moved" | "equipped" | "unequipped" | "restored" | "quest-reward";
    revision: number;
    slot?: string;
    quest?: string;
};
export type InventoryResult = {
    ok: true;
} | {
    ok: false;
    reason: "full" | "insufficient" | "empty" | "incompatible" | "unavailable";
};
export type CompiledItem = {
    maxStack: number;
    equipment: {
        slots: string[];
        modifiers: AttributeModifier[];
    } | null;
};
export type InventoryOptions = {
    items: Record<string, ItemDefinition>;
    capacity: number;
    equipmentSlots?: readonly string[];
    attributes?: import("./attributes.js").AttributeSet;
    onEvent?: (event: InventoryEvent) => void;
};
export type ClaimableQuests = Pick<ReturnType<typeof import("./quests.js").createQuestLog>, "claim">;
