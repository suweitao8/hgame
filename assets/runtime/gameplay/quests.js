import { identifier, positiveInteger, publisher } from '../internal/gameplay.js';

/** @typedef {import('./story.js').StoryVariables} SignalData */
/** @typedef {{id: string, signal: string, count?: number, match?: SignalData}} QuestObjective */
/** @typedef {{id: string, objectives: readonly QuestObjective[]}} QuestStage */
/** @typedef {{id: string, amount?: number}} QuestReward */
/** @typedef {{title?: string, requires?: readonly string[], stages: readonly QuestStage[], rewards?: readonly QuestReward[]}} QuestDefinition */
/** @typedef {'locked' | 'available' | 'active' | 'complete' | 'claimed'} QuestStatus */
/** @typedef {{id: string, title: string, status: QuestStatus, stageId: string | null, objectives: {id: string, count: number, target: number}[]}} QuestView */
/** @typedef {{status: 'active' | 'complete' | 'claimed', stage: number, counts: number[]}} QuestProgress */
/** @typedef {{status: 'active', stageId: string, objectives: Record<string, number>} | {status: 'complete' | 'claimed'}} SavedQuest */
/** @typedef {{schemaVersion: 1, quests: Record<string, SavedQuest>}} QuestSnapshot */
/** @typedef {{type: 'accepted' | 'progress' | 'stage' | 'completed', quest: QuestView} | {type: 'restored'}} QuestEvent */
/** @typedef {{id: string, signal: string, target: number, match: readonly [string, SignalData[string]][]}} CompiledObjective */
/** @typedef {{id: string, title: string, requires: string[], stages: {id: string, objectives: CompiledObjective[]}[], rewards: {id: string, amount: number}[]}} CompiledQuest */

/** @param {SignalData} data @returns {[string, SignalData[string]][]} */
function scalarEntries(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Expected signal data object');
  return Object.entries(data).map(([key, value]) => {
    const scalar = value === null || typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);
    if (!scalar) throw new TypeError('Signal values must be JSON scalars');
    return [identifier(key, 'signal field'), value];
  });
}

/** @param {string} id @param {QuestDefinition} source @returns {CompiledQuest} */
function compileQuest(id, source) {
  identifier(id, 'quest id');
  if (!source.stages.length) throw new Error('Quest needs a stage: ' + id);
  const stageIds = new Set();
  const objectiveIds = new Set();
  const stages = source.stages.map(stage => {
    const stageId = identifier(stage.id, 'stage id');
    if (stageIds.has(stageId) || !stage.objectives.length) throw new Error('Duplicate or empty stage: ' + stageId);
    stageIds.add(stageId);
    const objectives = stage.objectives.map(objective => {
      const objectiveId = identifier(objective.id, 'objective id');
      if (objectiveIds.has(objectiveId)) throw new Error('Duplicate objective: ' + objectiveId);
      objectiveIds.add(objectiveId);
      return { id: objectiveId, signal: identifier(objective.signal, 'signal'), target: positiveInteger(objective.count ?? 1, 'objective count'),
        match: scalarEntries(objective.match ?? {}) };
    });
    return { id: stageId, objectives };
  });
  return { id, title: source.title ?? id, requires: [...new Set(source.requires ?? [])], stages,
    rewards: (source.rewards ?? []).map(reward => ({ id: identifier(reward.id, 'reward id'), amount: positiveInteger(reward.amount ?? 1, 'reward amount') })) };
}

/**
 * Track staged quests from game signals. The caller owns acceptance UI and reward delivery.
 * An incoming signal counts once per matching objective in the current stage, then advances the stage.
 * @param {Record<string, QuestDefinition>} definitions
 * @param {{onEvent?: (event: QuestEvent) => void}} [options]
 */
export function createQuestLog(definitions, { onEvent } = {}) {
  /** @type {Map<string, CompiledQuest>} */
  const catalog = new Map(Object.entries(definitions).map(([id, source]) => [id, compileQuest(id, source)]));
  const sorted = new Set();
  const visiting = new Set();
  /** @param {string} id */
  function resolve(id) {
    if (sorted.has(id)) return;
    const def = catalog.get(id);
    if (!def) throw new Error('Unknown prerequisite quest: ' + id);
    if (visiting.has(id)) throw new Error('Cyclic quest prerequisite: ' + id);
    visiting.add(id);
    for (const required of def.requires) resolve(required);
    visiting.delete(id);
    sorted.add(id);
  }
  for (const id of catalog.keys()) resolve(id);

  /** @type {Map<string, QuestProgress>} */
  let progress = new Map();
  /** @type {Map<string, Set<string>>} */
  const bySignal = new Map();
  const events = publisher(onEvent);
  let dispatching = false;

  /** @param {string} id @param {number} stage @param {boolean} add */
  function indexStage(id, stage, add) {
    for (const { signal } of catalog.get(id).stages[stage].objectives) {
      let quests = bySignal.get(signal);
      if (add) {
        if (!quests) bySignal.set(signal, quests = new Set());
        quests.add(id);
      } else if (quests?.delete(id) && quests.size === 0) bySignal.delete(signal);
    }
  }

  /** @param {CompiledQuest} def @param {Map<string, QuestProgress>} states */
  function unlocked(def, states) {
    return def.requires.every(id => {
      const status = states.get(id)?.status;
      return status === 'complete' || status === 'claimed';
    });
  }

  /** @param {string} id @returns {QuestView | null} */
  function get(id) {
    const def = catalog.get(id);
    if (!def) return null;
    const state = progress.get(id);
    const stage = state?.status === 'active' ? def.stages[state.stage] : null;
    return { id, title: def.title, status: state?.status ?? (unlocked(def, progress) ? 'available' : 'locked'),
      stageId: stage?.id ?? null, objectives: stage ? stage.objectives.map((objective, index) => ({
        id: objective.id, count: state.counts[index], target: objective.target,
      })) : [] };
  }
  /** @param {QuestEvent[]} batch */
  function publish(batch) {
    dispatching = true;
    try { for (const event of batch) events.emit(event); }
    finally { dispatching = false; }
  }
  function writable() { if (dispatching) throw new Error('Quest commands cannot run during quest events'); }

  return {
    get,
    /** @param {QuestStatus} [status] @returns {QuestView[]} */
    list(status) {
      const views = [];
      for (const id of catalog.keys()) {
        const quest = /** @type {QuestView} */ (get(id));
        if (status === undefined || quest.status === status) views.push(quest);
      }
      return views;
    },
    /** @param {string} id @returns {boolean} */
    accept(id) {
      writable();
      if (get(id)?.status !== 'available') return false;
      progress.set(id, { status: 'active', stage: 0, counts: catalog.get(id).stages[0].objectives.map(() => 0) });
      indexStage(id, 0, true);
      publish([{ type: 'accepted', quest: /** @type {QuestView} */ (get(id)) }]);
      return true;
    },
    /** Record a signal. Returns the number of active quests that advanced. @param {string} signal @param {{amount?: number, data?: SignalData}} [options] */
    record(signal, { amount = 1, data = {} } = {}) {
      writable();
      identifier(signal, 'signal');
      positiveInteger(amount, 'signal amount');
      const indexed = bySignal.get(signal);
      if (!indexed?.size) return 0;
      const payload = new Map(scalarEntries(data));
      /** @type {QuestEvent[]} */
      const batch = [];
      for (const id of [...indexed]) {
        const state = progress.get(id);
        const def = catalog.get(id);
        const objectives = def.stages[state.stage].objectives;
        let changed = false;
        let completed = true;
        for (const [index, objective] of objectives.entries()) {
          const previous = state.counts[index];
          if (previous < objective.target && objective.signal === signal && objective.match.every(([key, value]) => payload.get(key) === value)) {
            state.counts[index] = previous + Math.min(amount, objective.target - previous);
            changed = true;
          }
          if (state.counts[index] < objective.target) completed = false;
        }
        if (!changed) continue;
        /** @type {'progress' | 'stage' | 'completed'} */
        let type = 'progress';
        if (completed) {
          indexStage(id, state.stage, false);
          state.stage++;
          if (state.stage === def.stages.length) {
            state.status = 'complete';
            state.counts = [];
            type = 'completed';
          } else {
            state.counts = def.stages[state.stage].objectives.map(() => 0);
            indexStage(id, state.stage, true);
            type = 'stage';
          }
        }
        batch.push({ type, quest: /** @type {QuestView} */ (get(id)) });
      }
      if (batch.length) publish(batch);
      return batch.length;
    },
    /** Mark rewards as claimed and return their descriptors once. @param {string} id @returns {{id: string, amount: number}[] | null} */
    claim(id) {
      writable();
      const state = progress.get(id);
      if (state?.status !== 'complete') return null;
      const rewards = catalog.get(id).rewards.map(reward => ({ ...reward }));
      state.status = 'claimed';
      return rewards;
    },
    /** @returns {QuestSnapshot} */
    snapshot() {
      /** @type {Record<string, SavedQuest>} */
      const saved = Object.create(null);
      for (const [id, state] of progress) {
        if (state.status === 'active') {
          const stage = catalog.get(id).stages[state.stage];
          saved[id] = { status: 'active', stageId: stage.id,
            objectives: Object.fromEntries(stage.objectives.map((objective, index) => [objective.id, state.counts[index]])) };
        } else saved[id] = { status: state.status };
      }
      return { schemaVersion: 1, quests: saved };
    },
    /** Restore progress and signal routing without emitting rewards or completion events. @param {QuestSnapshot} snapshot */
    restore(snapshot) {
      writable();
      if (snapshot?.schemaVersion !== 1 || !snapshot.quests || typeof snapshot.quests !== 'object' || Array.isArray(snapshot.quests)) throw new Error('Invalid quest snapshot');
      /** @type {Map<string, QuestProgress>} */
      const pending = new Map();
      for (const [id, state] of Object.entries(snapshot.quests)) {
        const def = catalog.get(id);
        if (!def || !state) throw new Error('Invalid saved quest: ' + id);
        if (state.status === 'active') {
          const index = def.stages.findIndex(stage => stage.id === state.stageId);
          const stage = def.stages[index];
          if (!stage || !state.objectives || typeof state.objectives !== 'object' || Array.isArray(state.objectives) ||
            Object.keys(state.objectives).length !== stage.objectives.length) throw new Error('Invalid saved quest stage: ' + id);
          const counts = stage.objectives.map(objective => {
            const count = state.objectives[objective.id];
            if (!Object.hasOwn(state.objectives, objective.id) || !Number.isSafeInteger(count) || count < 0 || count > objective.target) {
              throw new Error('Invalid saved objective: ' + objective.id);
            }
            return count;
          });
          if (counts.every((count, i) => count === stage.objectives[i].target)) throw new Error('Saved active stage is already complete: ' + id);
          pending.set(id, { status: 'active', stage: index, counts });
        } else if (state.status === 'complete' || state.status === 'claimed') {
          pending.set(id, { status: state.status, stage: def.stages.length, counts: [] });
        } else throw new Error('Invalid saved quest status: ' + id);
      }
      for (const id of pending.keys()) {
        if (!unlocked(catalog.get(id), pending)) throw new Error('Saved quest lacks its prerequisites: ' + id);
      }
      progress = pending;
      bySignal.clear();
      for (const [id, state] of progress) if (state.status === 'active') indexStage(id, state.stage, true);
      publish([{ type: 'restored' }]);
    },
    /** @type {(listener: (event: QuestEvent) => void) => (() => void)} */
    subscribe: events.subscribe,
  };
}
