import { finite, identifier, positiveInteger, publisher } from '../internal/gameplay.js';

/** @typedef {string | number | boolean | null} StoryValue */
/** @typedef {Record<string, StoryValue>} StoryVariables */
/** @typedef {{variable: string, op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte', value: StoryValue} | {variable: string, op: 'exists' | 'missing'}} StoryCondition */
/** @typedef {{op: 'set', variable: string, value: StoryValue} | {op: 'add', variable: string, value: number} | {op: 'unset', variable: string} | {op: 'emit', signal: string, data?: StoryVariables}} StoryAction */
/** @typedef {{id?: string, label: string, next: string, when?: readonly StoryCondition[], actions?: readonly StoryAction[]}} StoryChoice */
/** @typedef {{text: string, speaker?: string, next?: string, ending?: boolean, choices?: readonly StoryChoice[], actions?: readonly StoryAction[]}} StoryNode */
/** @typedef {{id?: string, start?: string, variables?: StoryVariables, nodes: Record<string, StoryNode> | readonly (StoryNode & {id: string})[]}} StoryDefinition */
/** @typedef {{id: string, text: string, speaker?: string, ending: boolean, canAdvance: boolean, choices: {id: string, label: string}[], revision: number}} StoryView */
/** @typedef {{type: 'signal', signal: string, data: Readonly<StoryVariables>} | {type: 'entered' | 'ended' | 'restored' | 'variables', node: string, revision: number}} StoryEvent */
/** @typedef {{schemaVersion: 1, storyId: string | null, node: string, variables: StoryVariables, visits: Record<string, number>}} StorySnapshot */
/** @typedef {{ok: true, view: StoryView} | {ok: false, reason: 'busy' | 'stale' | 'ending' | 'choice-required' | 'unavailable' }} StoryResult */
/** @typedef {{id: string, label: string, next: string, when: StoryCondition[], actions: StoryAction[]}} CompiledChoice */
/** @typedef {{id: string, text: string, speaker?: string, ending: boolean, next: string | null, choices: CompiledChoice[], actions: StoryAction[]}} CompiledNode */

/** @param {unknown} value @returns {StoryValue} */
function scalar(value) {
  if (typeof value === 'number') return finite(value, 'story value');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  throw new TypeError('Story values must be JSON scalars');
}

/** @param {StoryVariables} values @returns {Map<string, StoryValue>} */
function variableMap(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Story variables must be an object');
  return new Map(Object.entries(values).map(([key, value]) => [identifier(key, 'variable'), scalar(value)]));
}

/** @param {readonly StoryAction[]} [actions] @returns {StoryAction[]} */
function compileActions(actions = []) {
  return actions.map(action => {
    switch (action.op) {
      case 'emit': return { op: 'emit', signal: identifier(action.signal, 'signal'), data: Object.freeze(Object.fromEntries(variableMap(action.data ?? {}))) };
      case 'set': return { op: 'set', variable: identifier(action.variable, 'variable'), value: scalar(action.value) };
      case 'add': return { op: 'add', variable: identifier(action.variable, 'variable'), value: finite(action.value, 'delta') };
      case 'unset': return { op: 'unset', variable: identifier(action.variable, 'variable') };
      default: throw new Error('Unknown story action');
    }
  });
}

/** @param {StoryCondition} condition @returns {StoryCondition} */
function compileCondition(condition) {
  const variable = identifier(condition.variable, 'variable');
  switch (condition.op) {
    case 'exists': case 'missing': return { variable, op: condition.op };
    case 'eq': case 'ne': return { variable, op: condition.op, value: scalar(condition.value) };
    case 'lt': case 'lte': case 'gt': case 'gte': return { variable, op: condition.op, value: finite(condition.value, 'comparison') };
    default: throw new Error('Unknown story condition');
  }
}

/** @param {StoryCondition} condition @param {StoryValue | undefined} value */
function matches(condition, value) {
  switch (condition.op) {
    case 'exists': return value !== undefined;
    case 'missing': return value === undefined;
    case 'eq': return value === condition.value;
    case 'ne': return value !== undefined && value !== condition.value;
    case 'lt': return typeof value === 'number' && value < Number(condition.value);
    case 'lte': return typeof value === 'number' && value <= Number(condition.value);
    case 'gt': return typeof value === 'number' && value > Number(condition.value);
    case 'gte': return typeof value === 'number' && value >= Number(condition.value);
  }
}

/**
 * Run a story.json graph with gated choices, variable changes, signals and save snapshots.
 * Commands are synchronous. Subscribe before calling start() to receive entry signals.
 * @param {StoryDefinition} definition
 * @param {{onEvent?: (event: StoryEvent) => void}} [options]
 */
export function createStoryRunner(definition, { onEvent } = {}) {
  /** @type {Iterable<[string, StoryNode]>} */
  const entries = Array.isArray(definition.nodes)
    ? definition.nodes.map(node => [node.id, node])
    : Object.entries(definition.nodes);
  /** @type {Map<string, CompiledNode>} */
  const nodes = new Map();
  const events = publisher(onEvent);
  const initialVariables = variableMap(definition.variables ?? {});
  const storyId = definition.id === undefined ? null : identifier(definition.id, 'story id');
  for (const [rawId, source] of entries) {
    const id = identifier(rawId, 'node id');
    if (nodes.has(id)) throw new Error('Duplicate story node: ' + id);
    const ids = new Set();
    const choices = (source.choices ?? []).map((choice, index) => {
      const choiceId = identifier(choice.id ?? 'choice:' + index, 'choice id');
      if (ids.has(choiceId)) throw new Error('Duplicate choice in ' + id + ': ' + choiceId);
      ids.add(choiceId);
      return { id: choiceId, label: identifier(choice.label, 'choice label'), next: identifier(choice.next, 'choice target'),
        when: (choice.when ?? []).map(compileCondition), actions: compileActions(choice.actions) };
    });
    const ending = source.ending === true;
    const next = source.next === undefined ? null : identifier(source.next, 'next node');
    if (ending && (next !== null || choices.length)) throw new Error('Ending cannot have outgoing links: ' + id);
    if (!ending && next === null && !choices.length) throw new Error('Story node needs a next link, choice or ending: ' + id);
    nodes.set(id, { id, text: identifier(source.text, 'node text'), speaker: source.speaker, ending, next, choices,
      actions: compileActions(source.actions) });
  }
  const startId = definition.start ?? nodes.keys().next().value;
  if (startId === undefined || !nodes.has(startId)) throw new Error('Missing story start: ' + startId);
  for (const node of nodes.values()) {
    for (const target of [node.next, ...node.choices.map(choice => choice.next)]) {
      if (target !== null && !nodes.has(target)) throw new Error('Unknown story target ' + target + ' from ' + node.id);
    }
  }

  /** @type {Map<string, StoryValue>} */
  let variables = new Map(initialVariables);
  /** @type {Map<string, number>} */
  let visits = new Map();
  /** @type {string | null} */
  let current = null;
  let revision = 0;
  let busy = false;

  /** @param {CompiledNode} node */
  function available(node) { return node.choices.filter(choice => choice.when.every(condition => matches(condition, variables.get(condition.variable)))); }
  /** @returns {StoryView | null} */
  function view() {
    if (current === null) return null;
    const node = nodes.get(current);
    const choices = available(node).map(({ id, label }) => ({ id, label }));
    return { id: node.id, text: node.text, speaker: node.speaker, ending: node.ending, canAdvance: choices.length === 0 && node.next !== null, choices, revision };
  }
  /** @param {string} nodeId @param {Map<string, StoryValue>} base @param {readonly StoryAction[]} firstActions @param {Map<string, number>} previousVisits @returns {StoryView} */
  function enter(nodeId, base, firstActions, previousVisits) {
    const node = nodes.get(nodeId);
    const pending = new Map(base);
    /** @type {StoryEvent[]} */
    const signals = [];
    for (const action of [...firstActions, ...node.actions]) {
      if (action.op === 'set') pending.set(action.variable, action.value);
      else if (action.op === 'unset') pending.delete(action.variable);
      else if (action.op === 'add') {
        const old = pending.has(action.variable) ? pending.get(action.variable) : 0;
        pending.set(action.variable, finite(finite(old, action.variable) + action.value, action.variable));
      } else signals.push({ type: 'signal', signal: action.signal, data: action.data ?? {} });
    }
    const count = positiveInteger((previousVisits.get(nodeId) ?? 0) + 1, 'visit count');
    previousVisits.set(nodeId, count);
    variables = pending;
    visits = previousVisits;
    current = nodeId;
    revision++;
    busy = true;
    try {
      for (const signal of signals) events.emit(signal);
      events.emit({ type: 'entered', node: nodeId, revision });
      if (node.ending) events.emit({ type: 'ended', node: nodeId, revision });
      return /** @type {StoryView} */ (view());
    } finally { busy = false; }
  }
  function liveNode() {
    if (current === null) throw new Error('Start or restore the story first');
    return nodes.get(current);
  }
  return {
    view,
    /** Start a fresh run. Previous variables and visit counts are cleared. @returns {StoryView} */
    start() {
      if (busy) throw new Error('Cannot start a story during an event');
      return enter(startId, initialVariables, [], new Map());
    },
    /** @param {number} [expectedRevision] @returns {StoryResult} */
    advance(expectedRevision) {
      if (busy) return { ok: false, reason: 'busy' };
      if (expectedRevision !== undefined && expectedRevision !== revision) return { ok: false, reason: 'stale' };
      const node = liveNode();
      if (node.ending) return { ok: false, reason: 'ending' };
      if (available(node).length) return { ok: false, reason: 'choice-required' };
      if (node.next === null) return { ok: false, reason: 'unavailable' };
      return { ok: true, view: enter(node.next, variables, [], visits) };
    },
    /** @param {string} id @param {number} [expectedRevision] @returns {StoryResult} */
    choose(id, expectedRevision) {
      if (busy) return { ok: false, reason: 'busy' };
      if (expectedRevision !== undefined && expectedRevision !== revision) return { ok: false, reason: 'stale' };
      const node = liveNode();
      if (node.ending) return { ok: false, reason: 'ending' };
      const choice = available(node).find(item => item.id === id);
      if (!choice) return { ok: false, reason: 'unavailable' };
      return { ok: true, view: enter(choice.next, variables, choice.actions, visits) };
    },
    /** Apply external flags without replaying any node actions. @param {StoryVariables} values */
    setVariables(values) {
      if (busy) throw new Error('Cannot change story variables during an event');
      const pending = variableMap(values);
      for (const [key, value] of pending) variables.set(key, value);
      revision++;
      if (current !== null) {
        busy = true;
        try { events.emit({ type: 'variables', node: current, revision }); }
        finally { busy = false; }
      }
    },
    /** @param {string} id @returns {StoryValue | undefined} */
    getVariable(id) { return variables.get(id); },
    /** @param {string} id @returns {number} */
    visitCount(id) { return visits.get(id) ?? 0; },
    /** @returns {StorySnapshot} */
    snapshot() {
      liveNode();
      return { schemaVersion: 1, storyId, node: /** @type {string} */ (current), variables: Object.fromEntries(variables), visits: Object.fromEntries(visits) };
    },
    /** Restore without replaying node actions or signals. @param {StorySnapshot} snapshot @returns {StoryView} */
    restore(snapshot) {
      if (busy) throw new Error('Cannot restore a story during an event');
      if (snapshot?.schemaVersion !== 1 || snapshot.storyId !== storyId || !nodes.has(snapshot.node) ||
        !snapshot.visits || typeof snapshot.visits !== 'object' || Array.isArray(snapshot.visits)) throw new Error('Incompatible story snapshot');
      const pending = variableMap(snapshot.variables);
      const counts = new Map();
      for (const [id, count] of Object.entries(snapshot.visits)) {
        if (!nodes.has(id)) throw new Error('Unknown visited story node: ' + id);
        counts.set(id, positiveInteger(count, 'visit count'));
      }
      if (!counts.has(snapshot.node)) throw new Error('Story snapshot is missing the current visit');
      variables = pending;
      visits = counts;
      current = snapshot.node;
      revision++;
      busy = true;
      try { events.emit({ type: 'restored', node: snapshot.node, revision }); }
      finally { busy = false; }
      return /** @type {StoryView} */ (view());
    },
    /** @type {(listener: (event: StoryEvent) => void) => (() => void)} */
    subscribe: events.subscribe,
  };
}
