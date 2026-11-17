/**
 * Compile item recipes with station/tag requirements and batch crafting.
 * A craft exchanges all materials and outputs in one inventory transaction.
 * @param {Record<string, CraftRecipe>} definitions
 */
export function createCraftingBook(definitions: Record<string, CraftRecipe>): {
    /** @returns {string[]} */
    list(): string[];
    /** @param {string} id @returns {CraftRecipe | null} */
    get(id: string): CraftRecipe | null;
    quote: (id: string, { quantity, station, tags }?: CraftOptions | undefined) => CraftQuote;
    /** @param {string} id @param {CraftInventory} inventory @param {CraftOptions} [options] @returns {CraftResult} */
    craft(id: string, inventory: CraftInventory, options?: CraftOptions | undefined): CraftResult;
};
export type ItemQuantity = import("./inventory.js").ItemQuantity;
export type CraftRecipe = {
    inputs?: readonly ItemQuantity[];
    outputs: readonly ItemQuantity[];
    station?: string;
    requires?: readonly string[];
};
export type CraftOptions = {
    quantity?: number;
    station?: string;
    tags?: import("../core/tags.js").TagContainer;
};
export type CraftPlan = {
    id: string;
    quantity: number;
    inputs: ItemQuantity[];
    outputs: ItemQuantity[];
};
export type CraftQuote = {
    ok: true;
    plan: CraftPlan;
} | {
    ok: false;
    reason: "unknown-recipe" | "wrong-station" | "requirements";
};
export type CraftResult = CraftQuote | Extract<import("./inventory.js").InventoryResult, {
    ok: false;
}>;
export type CraftInventory = Pick<ReturnType<typeof import("./inventory.js").createInventory>, "transact">;
