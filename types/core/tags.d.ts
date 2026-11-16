/**
 * Validates and normalizes a hierarchical dot-separated gameplay tag string
 * (e.g. `"State.Movement.Dashing"`).
 *
 * @param {string} tag
 * @returns {string}
 */
export function normalizeGameplayTag(tag: string): string;
/**
 * Returns whether a value is a syntactically valid gameplay tag string.
 *
 * @param {unknown} tag
 * @returns {boolean}
 */
export function isValidGameplayTag(tag: unknown): boolean;
/**
 * Returns true when `candidate` equals `parentOrExact` or is a dot-delimited
 * descendant of `parentOrExact` (e.g. `"State.Movement.Dashing"` matches `"State"`).
 *
 * @param {string} candidate
 * @param {string} parentOrExact
 * @returns {boolean}
 */
export function tagMatchesHierarchy(candidate: string, parentOrExact: string): boolean;
/**
 * Expands a hierarchical tag into its ordered root-to-leaf ancestor chain.
 *
 * @param {string} tag
 * @returns {string[]}
 */
export function splitTagAncestors(tag: string): string[];
/**
 * Registry that caches tag taxonomy metadata and parent-child hierarchies.
 *
 * @returns {TagRegistry}
 */
export function createTagRegistry(): TagRegistry;
/**
 * Creates a hierarchical, reference-counted gameplay tag container.
 * Explicit leaf additions maintain O(1) inclusive ancestor counts so queries
 * like `container.has('State.Movement')` succeed in constant time whenever
 * `'State.Movement.Dashing'` is present.
 *
 * @param {Iterable<string> | string | Record<string, number> | null} [initialTags]
 *   Tags to add (one, an iterable, or a `{ tag: stackCount }` map).
 * @param {TagContainerOptions} [options]
 * @returns {TagContainer}
 */
export function createTagContainer(initialTags?: string | Iterable<string> | Record<string, number> | null | undefined, { registry, onChange }?: TagContainerOptions | undefined): TagContainer;
/**
 * Matches a tag container (or null/array) against a tag string, array,
 * `{ all, any, none, exact }` query object, or predicate without allocating.
 *
 * @param {TagContainer | Iterable<string> | null | undefined} containerOrTags
 * @param {TagQuery} query
 * @returns {boolean}
 */
export function matchGameplayTags(containerOrTags: TagContainer | Iterable<string> | null | undefined, query: TagQuery): boolean;
/** Shared default registry. @type {TagRegistry} */
export const GLOBAL_TAG_REGISTRY: TagRegistry;
/**
 * Free-form metadata attached to a registered tag.
 */
export type GameplayTagMeta = Record<string, unknown>;
export type TagRegistryEntry = {
    tag: string;
    parent: string | null;
    /**
     * Root-to-self chain.
     */
    ancestors: readonly string[];
    meta: GameplayTagMeta | null;
};
/**
 * Taxonomy cache of hierarchical tags.
 */
export type TagRegistry = {
    register: (tag: string, meta?: GameplayTagMeta | null) => TagRegistryEntry;
    registerMany: (tags: Iterable<string | {
        tag: string;
        meta?: GameplayTagMeta | null;
    }> | null | undefined) => TagRegistryEntry[];
    ensureAncestors: (tag: string) => readonly string[];
    has: (tag: string) => boolean;
    getParent: (tag: string) => string | null;
    getAncestors: (tag: string) => string[];
    /**
     * Registered tags equal to or below `prefix`.
     */
    getDescendants: (prefix: string) => string[];
    matches: (candidate: string, parentOrExact: string) => boolean;
    list: () => string[];
    clear: () => void;
};
/**
 * One tag or an iterable of tags.
 */
export type TagInput = string | Iterable<string>;
export type TagContainerChangeEvent = {
    type: "add" | "remove" | "clear";
    tag?: string | undefined;
    /**
     * Stack delta.
     */
    count?: number | undefined;
    /**
     * Explicit stack count after the change.
     */
    total?: number | undefined;
    container: TagContainer;
};
export type TagContainerOptions = {
    /**
     * Defaults to {@link GLOBAL_TAG_REGISTRY}.
     */
    registry?: TagRegistry | null | undefined;
    onChange?: ((event: TagContainerChangeEvent) => void) | null | undefined;
};
export type TagQueryObject = {
    /**
     * Every tag must be present.
     */
    all?: TagInput | undefined;
    /**
     * At least one tag must be present.
     */
    any?: TagInput | undefined;
    /**
     * No tag may be present.
     */
    none?: TagInput | undefined;
    /**
     * Match explicit tags only (no hierarchy).
     */
    exact?: boolean | undefined;
};
export type TagQuery = string | Iterable<string> | TagQueryObject | ((container: TagContainer) => boolean) | null | undefined;
/**
 * Reference-counted hierarchical tag set.
 */
export type TagContainer = {
    readonly size: number;
    readonly isEmpty: boolean;
    add: (tagOrTags: TagInput, count?: number) => TagContainer;
    remove: (tagOrTags: TagInput, count?: number | boolean | {
        all?: boolean;
    }) => boolean;
    removeTree: (prefix: string) => number;
    set: (tag: string, active: boolean, count?: number) => boolean;
    has: (tag: string) => boolean;
    hasExact: (tag: string) => boolean;
    stackCount: (tag: string, options?: {
        exact?: boolean;
    }) => number;
    hasAny: (tags: TagInput | null | undefined, options?: {
        exact?: boolean;
    }) => boolean;
    hasAll: (tags: TagInput | null | undefined, options?: {
        exact?: boolean;
    }) => boolean;
    hasNone: (tags: TagInput | null | undefined, options?: {
        exact?: boolean;
    }) => boolean;
    matches: (query: TagQuery) => boolean;
    list: (options?: {
        inclusive?: boolean;
    }) => string[];
    entries: () => [string, number][];
    clear: () => boolean;
    clone: (options?: {
        onChange?: TagContainerOptions["onChange"];
    }) => TagContainer;
    toJSON: () => Record<string, number>;
} & Iterable<string>;
