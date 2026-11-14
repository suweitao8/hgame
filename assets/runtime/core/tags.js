/**
 * @typedef {Record<string, unknown>} GameplayTagMeta Free-form metadata attached to a registered tag.
 */

/**
 * @typedef {object} TagRegistryEntry
 * @property {string} tag
 * @property {string | null} parent
 * @property {readonly string[]} ancestors Root-to-self chain.
 * @property {GameplayTagMeta | null} meta
 */

/**
 * @typedef {object} TagRegistry Taxonomy cache of hierarchical tags.
 * @property {(tag: string, meta?: GameplayTagMeta | null) => TagRegistryEntry} register
 * @property {(tags: Iterable<string | { tag: string, meta?: GameplayTagMeta | null }> | null | undefined) => TagRegistryEntry[]} registerMany
 * @property {(tag: string) => readonly string[]} ensureAncestors
 * @property {(tag: string) => boolean} has
 * @property {(tag: string) => string | null} getParent
 * @property {(tag: string) => string[]} getAncestors
 * @property {(prefix: string) => string[]} getDescendants Registered tags equal to or below `prefix`.
 * @property {(candidate: string, parentOrExact: string) => boolean} matches
 * @property {() => string[]} list
 * @property {() => void} clear
 */

/** @typedef {string | Iterable<string>} TagInput One tag or an iterable of tags. */

/**
 * @typedef {object} TagContainerChangeEvent
 * @property {'add' | 'remove' | 'clear'} type
 * @property {string} [tag]
 * @property {number} [count] Stack delta.
 * @property {number} [total] Explicit stack count after the change.
 * @property {TagContainer} container
 */

/**
 * @typedef {object} TagContainerOptions
 * @property {TagRegistry | null} [registry] Defaults to {@link GLOBAL_TAG_REGISTRY}.
 * @property {((event: TagContainerChangeEvent) => void) | null} [onChange]
 */

/**
 * @typedef {object} TagQueryObject
 * @property {TagInput} [all] Every tag must be present.
 * @property {TagInput} [any] At least one tag must be present.
 * @property {TagInput} [none] No tag may be present.
 * @property {boolean} [exact=false] Match explicit tags only (no hierarchy).
 */

/** @typedef {string | Iterable<string> | TagQueryObject | ((container: TagContainer) => boolean) | null | undefined} TagQuery */

/**
 * @typedef {{
 *   readonly size: number,
 *   readonly isEmpty: boolean,
 *   add: (tagOrTags: TagInput, count?: number) => TagContainer,
 *   remove: (tagOrTags: TagInput, count?: number | boolean | { all?: boolean }) => boolean,
 *   removeTree: (prefix: string) => number,
 *   set: (tag: string, active: boolean, count?: number) => boolean,
 *   has: (tag: string) => boolean,
 *   hasExact: (tag: string) => boolean,
 *   stackCount: (tag: string, options?: { exact?: boolean }) => number,
 *   hasAny: (tags: TagInput | null | undefined, options?: { exact?: boolean }) => boolean,
 *   hasAll: (tags: TagInput | null | undefined, options?: { exact?: boolean }) => boolean,
 *   hasNone: (tags: TagInput | null | undefined, options?: { exact?: boolean }) => boolean,
 *   matches: (query: TagQuery) => boolean,
 *   list: (options?: { inclusive?: boolean }) => string[],
 *   entries: () => [string, number][],
 *   clear: () => boolean,
 *   clone: (options?: { onChange?: TagContainerOptions['onChange'] }) => TagContainer,
 *   toJSON: () => Record<string, number>,
 * } & Iterable<string>} TagContainer Reference-counted hierarchical tag set.
 */
const TAG_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Validates and normalizes a hierarchical dot-separated gameplay tag string
 * (e.g. `"State.Movement.Dashing"`).
 *
 * @param {string} tag
 * @returns {string}
 */
export function normalizeGameplayTag(tag) {
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new TypeError('Gameplay tag must be a non-empty string');
  }
  if (tag.startsWith('.') || tag.endsWith('.') || tag.includes('..')) {
    throw new RangeError(`Invalid gameplay tag syntax: "${tag}"`);
  }
  const segments = tag.split('.');
  for (let i = 0; i < segments.length; i++) {
    if (!TAG_SEGMENT_RE.test(segments[i])) {
      throw new RangeError(`Invalid gameplay tag segment "${segments[i]}" in "${tag}"`);
    }
  }
  return tag;
}

/**
 * Returns whether a value is a syntactically valid gameplay tag string.
 *
 * @param {unknown} tag
 * @returns {boolean}
 */
export function isValidGameplayTag(tag) {
  if (typeof tag !== 'string' || tag.length === 0) return false;
  if (tag.startsWith('.') || tag.endsWith('.') || tag.includes('..')) return false;
  const segments = tag.split('.');
  for (let i = 0; i < segments.length; i++) {
    if (!TAG_SEGMENT_RE.test(segments[i])) return false;
  }
  return true;
}

/**
 * Returns true when `candidate` equals `parentOrExact` or is a dot-delimited
 * descendant of `parentOrExact` (e.g. `"State.Movement.Dashing"` matches `"State"`).
 *
 * @param {string} candidate
 * @param {string} parentOrExact
 * @returns {boolean}
 */
export function tagMatchesHierarchy(candidate, parentOrExact) {
  if (candidate === parentOrExact) return true;
  if (
    typeof candidate !== 'string' ||
    typeof parentOrExact !== 'string' ||
    candidate.length <= parentOrExact.length
  ) {
    return false;
  }
  return (
    candidate.startsWith(parentOrExact) &&
    candidate.charCodeAt(parentOrExact.length) === 46 /* '.' */
  );
}

/**
 * Expands a hierarchical tag into its ordered root-to-leaf ancestor chain.
 *
 * @param {string} tag
 * @returns {string[]}
 */
export function splitTagAncestors(tag) {
  normalizeGameplayTag(tag);
  const ancestors = [];
  let idx = tag.indexOf('.');
  while (idx !== -1) {
    ancestors.push(tag.slice(0, idx));
    idx = tag.indexOf('.', idx + 1);
  }
  ancestors.push(tag);
  return ancestors;
}

/**
 * Registry that caches tag taxonomy metadata and parent-child hierarchies.
 *
 * @returns {TagRegistry}
 */
export function createTagRegistry() {
  /** @type {Map<string, TagRegistryEntry>} */
  const entries = new Map();

  function register(tag, meta = null) {
    normalizeGameplayTag(tag);
    if (entries.has(tag)) {
      if (meta && typeof meta === 'object') {
        const existing = entries.get(tag);
        existing.meta = existing.meta ? { ...existing.meta, ...meta } : { ...meta };
      }
      return entries.get(tag);
    }

    const ancestors = splitTagAncestors(tag);
    for (let i = 0; i < ancestors.length; i++) {
      const current = ancestors[i];
      if (!entries.has(current)) {
        const parent = i > 0 ? ancestors[i - 1] : null;
        const chain = Object.freeze(ancestors.slice(0, i + 1));
        entries.set(current, {
          tag: current,
          parent,
          ancestors: chain,
          meta: i === ancestors.length - 1 && meta && typeof meta === 'object' ? { ...meta } : null,
        });
      } else if (i === ancestors.length - 1 && meta && typeof meta === 'object') {
        const existing = entries.get(current);
        existing.meta = existing.meta ? { ...existing.meta, ...meta } : { ...meta };
      }
    }
    return entries.get(tag);
  }

  function registerMany(tags) {
    if (!tags) return [];
    const out = [];
    for (const item of tags) {
      if (typeof item === 'string') {
        out.push(register(item));
      } else if (item && typeof item.tag === 'string') {
        out.push(register(item.tag, item.meta ?? null));
      }
    }
    return out;
  }

  function ensureAncestors(tag) {
    const existing = entries.get(tag);
    if (existing) return existing.ancestors;
    return register(tag).ancestors;
  }

  function has(tag) {
    return entries.has(tag);
  }

  function getParent(tag) {
    const entry = entries.get(tag);
    if (entry) return entry.parent;
    normalizeGameplayTag(tag);
    const lastDot = tag.lastIndexOf('.');
    return lastDot === -1 ? null : tag.slice(0, lastDot);
  }

  function getAncestors(tag) {
    const entry = entries.get(tag);
    if (entry) return [...entry.ancestors];
    return splitTagAncestors(tag);
  }

  function getDescendants(prefix) {
    normalizeGameplayTag(prefix);
    const result = [];
    for (const key of entries.keys()) {
      if (tagMatchesHierarchy(key, prefix)) {
        result.push(key);
      }
    }
    return result;
  }

  function list() {
    return [...entries.keys()];
  }

  function clear() {
    entries.clear();
  }

  return {
    register,
    registerMany,
    ensureAncestors,
    has,
    getParent,
    getAncestors,
    getDescendants,
    matches: tagMatchesHierarchy,
    list,
    clear,
  };
}

/** Shared default registry. @type {TagRegistry} */
export const GLOBAL_TAG_REGISTRY = createTagRegistry();

function isEmptyIterable(value) {
  if (value == null) return true;
  if (typeof value === 'string') return false;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Set || value instanceof Map) return value.size === 0;
  return false;
}

function iterateTagInput(input, fn) {
  if (typeof input === 'string') {
    fn(input);
    return;
  }
  if (!input || typeof input[Symbol.iterator] !== 'function') {
    throw new TypeError('Expected a tag string or iterable of tag strings');
  }
  for (const tag of input) {
    fn(tag);
  }
}

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
export function createTagContainer(initialTags = null, { registry = GLOBAL_TAG_REGISTRY, onChange = null } = {}) {
  /** @type {Map<string, number>} */
  const explicitCounts = new Map();
  /** @type {Map<string, number>} */
  const inclusiveCounts = new Map();

  function emitChange(event) {
    if (typeof onChange === 'function') {
      onChange(event);
    }
  }

  function addSingle(tag, count) {
    const cleanCount = Number(count);
    if (!Number.isFinite(cleanCount) || cleanCount <= 0) {
      throw new RangeError('Tag stack count to add must be a positive finite number');
    }
    const ancestors = registry ? registry.ensureAncestors(tag) : splitTagAncestors(tag);
    explicitCounts.set(tag, (explicitCounts.get(tag) ?? 0) + cleanCount);
    for (let i = 0; i < ancestors.length; i++) {
      const anc = ancestors[i];
      inclusiveCounts.set(anc, (inclusiveCounts.get(anc) ?? 0) + cleanCount);
    }
    emitChange({ type: 'add', tag, count: cleanCount, total: explicitCounts.get(tag), container });
  }

  function removeSingle(tag, count) {
    normalizeGameplayTag(tag);
    const current = explicitCounts.get(tag) ?? 0;
    if (current <= 0) return false;

    const removeAll = count === Infinity || count === true;
    const cleanCount = removeAll ? current : Number(count);
    if (!removeAll && (!Number.isFinite(cleanCount) || cleanCount <= 0)) {
      throw new RangeError('Tag stack count to remove must be positive or Infinity');
    }

    const delta = Math.min(current, cleanCount);
    const next = current - delta;
    if (next <= 0) {
      explicitCounts.delete(tag);
    } else {
      explicitCounts.set(tag, next);
    }

    const ancestors = registry ? registry.ensureAncestors(tag) : splitTagAncestors(tag);
    for (let i = 0; i < ancestors.length; i++) {
      const anc = ancestors[i];
      const nextInc = (inclusiveCounts.get(anc) ?? 0) - delta;
      if (nextInc <= 0) {
        inclusiveCounts.delete(anc);
      } else {
        inclusiveCounts.set(anc, nextInc);
      }
    }
    emitChange({ type: 'remove', tag, count: delta, total: next > 0 ? next : 0, container });
    return true;
  }

  function add(tagOrTags, count = 1) {
    iterateTagInput(tagOrTags, tag => addSingle(tag, count));
    return container;
  }

  function remove(tagOrTags, count = 1) {
    const resolvedCount = count && typeof count === 'object' && count.all ? Infinity : count;
    if (typeof tagOrTags === 'string') {
      return removeSingle(tagOrTags, resolvedCount);
    }
    let removedAny = false;
    iterateTagInput(tagOrTags, tag => {
      if (removeSingle(tag, resolvedCount)) {
        removedAny = true;
      }
    });
    return removedAny;
  }

  function removeTree(prefix) {
    normalizeGameplayTag(prefix);
    const toDelete = [];
    for (const tag of explicitCounts.keys()) {
      if (tagMatchesHierarchy(tag, prefix)) {
        toDelete.push(tag);
      }
    }
    for (let i = 0; i < toDelete.length; i++) {
      removeSingle(toDelete[i], Infinity);
    }
    return toDelete.length;
  }

  function set(tag, active, count = 1) {
    normalizeGameplayTag(tag);
    if (!active) {
      return removeSingle(tag, Infinity);
    }
    const targetCount = Number(count);
    if (!Number.isFinite(targetCount) || targetCount <= 0) {
      return removeSingle(tag, Infinity);
    }
    const current = explicitCounts.get(tag) ?? 0;
    if (current < targetCount) {
      addSingle(tag, targetCount - current);
    } else if (current > targetCount) {
      removeSingle(tag, current - targetCount);
    }
    return true;
  }

  function has(tag) {
    return (inclusiveCounts.get(tag) ?? 0) > 0;
  }

  function hasExact(tag) {
    return (explicitCounts.get(tag) ?? 0) > 0;
  }

  function stackCount(tag, { exact = true } = {}) {
    return (exact ? explicitCounts.get(tag) : inclusiveCounts.get(tag)) ?? 0;
  }

  function checkSingle(tag, exact) {
    return exact ? (explicitCounts.get(tag) ?? 0) > 0 : (inclusiveCounts.get(tag) ?? 0) > 0;
  }

  function hasAny(tags, { exact = false } = {}) {
    if (tags == null) return false;
    if (typeof tags === 'string') return checkSingle(tags, exact);
    if (Array.isArray(tags)) {
      for (let i = 0; i < tags.length; i++) {
        if (checkSingle(tags[i], exact)) return true;
      }
      return false;
    }
    for (const tag of tags) {
      if (checkSingle(tag, exact)) return true;
    }
    return false;
  }

  function hasAll(tags, { exact = false } = {}) {
    if (tags == null) return true;
    if (typeof tags === 'string') return checkSingle(tags, exact);
    if (Array.isArray(tags)) {
      for (let i = 0; i < tags.length; i++) {
        if (!checkSingle(tags[i], exact)) return false;
      }
      return true;
    }
    for (const tag of tags) {
      if (!checkSingle(tag, exact)) return false;
    }
    return true;
  }

  function hasNone(tags, { exact = false } = {}) {
    return !hasAny(tags, { exact });
  }

  function matches(query) {
    if (query == null) return true;
    if (typeof query === 'function') return Boolean(query(container));
    if (typeof query === 'string') return has(query);
    if (Array.isArray(query)) {
      return query.length === 0 ? true : hasAll(query);
    }
    if (typeof query[Symbol.iterator] === 'function') {
      return hasAll(query);
    }
    if (typeof query === 'object') {
      const exact = Boolean(query.exact);
      if (query.all != null && !isEmptyIterable(query.all) && !hasAll(query.all, { exact })) {
        return false;
      }
      if (query.any != null && !isEmptyIterable(query.any) && !hasAny(query.any, { exact })) {
        return false;
      }
      if (query.none != null && !isEmptyIterable(query.none) && hasAny(query.none, { exact })) {
        return false;
      }
      return true;
    }
    throw new TypeError('Invalid gameplay tag query');
  }

  function list({ inclusive = false } = {}) {
    return [...(inclusive ? inclusiveCounts.keys() : explicitCounts.keys())];
  }

  function entries() {
    return [...explicitCounts.entries()];
  }

  function clear() {
    if (explicitCounts.size === 0) return false;
    explicitCounts.clear();
    inclusiveCounts.clear();
    emitChange({ type: 'clear', container });
    return true;
  }

  function clone({ onChange: nextOnChange = null } = {}) {
    const copy = createTagContainer(null, { registry, onChange: nextOnChange });
    for (const [tag, count] of explicitCounts.entries()) {
      copy.add(tag, count);
    }
    return copy;
  }

  function toJSON() {
    const out = {};
    for (const [tag, count] of explicitCounts.entries()) {
      out[tag] = count;
    }
    return out;
  }

  const container = {
    get size() {
      return explicitCounts.size;
    },
    get isEmpty() {
      return explicitCounts.size === 0;
    },
    add,
    remove,
    removeTree,
    set,
    has,
    hasExact,
    stackCount,
    hasAny,
    hasAll,
    hasNone,
    matches,
    list,
    entries,
    clear,
    clone,
    toJSON,
    [Symbol.iterator]() {
      return explicitCounts.keys();
    },
  };

  if (initialTags != null) {
    if (
      typeof initialTags === 'object' &&
      !Array.isArray(initialTags) &&
      typeof initialTags !== 'string' &&
      typeof initialTags[Symbol.iterator] !== 'function'
    ) {
      for (const [tag, count] of Object.entries(initialTags)) {
        if (count > 0) addSingle(tag, count);
      }
    } else {
      add(initialTags, 1);
    }
  }

  return container;
}

/**
 * Matches a tag container (or null/array) against a tag string, array,
 * `{ all, any, none, exact }` query object, or predicate without allocating.
 *
 * @param {TagContainer | Iterable<string> | null | undefined} containerOrTags
 * @param {TagQuery} query
 * @returns {boolean}
 */
export function matchGameplayTags(containerOrTags, query) {
  if (query == null) return true;
  if (containerOrTags && typeof containerOrTags.matches === 'function') {
    return containerOrTags.matches(query);
  }
  const hasAnyTags = containerOrTags != null && !isEmptyIterable(containerOrTags);
  if (typeof query === 'function') {
    const temp = createTagContainer(hasAnyTags ? containerOrTags : null);
    return Boolean(query(temp));
  }
  if (!hasAnyTags) {
    if (typeof query === 'string') return false;
    if (Array.isArray(query)) return query.length === 0;
    if (typeof query === 'object') {
      const needsAll = query.all != null && !isEmptyIterable(query.all);
      const needsAny = query.any != null && !isEmptyIterable(query.any);
      return !needsAll && !needsAny;
    }
    return false;
  }
  return createTagContainer(containerOrTags).matches(query);
}
