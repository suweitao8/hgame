import {
  STYLE_PRIORITY,
  normalizeRedDotPath,
  splitRedDotAncestors,
  formatRedDotBadge,
  statesEqual,
} from './helpers.js';

/**
 * Builds an inactive/empty frozen state snapshot for a node path.
 * @param {string} path
 * @param {boolean} [unlocked=true]
 * @param {boolean} [muted=false]
 * @returns {import('./helpers.js').RedDotState}
 */
export function buildEmptyState(path, unlocked = true, muted = false) {
  return Object.freeze({
    path,
    active: false,
    count: 0,
    numberCount: 0,
    style: 'none',
    text: '',
    unlocked,
    muted,
  });
}

/**
 * Graph and dirty-propagation engine for RedDotSystem.
 * @param {object} ctx Shared mutable system state.
 */
export function createRedDotGraph(ctx) {
  const { nodes, dirtySet, dailyAckMap, maxCount, newLabel } = ctx;

  function createNode(path, segment, depth, treeParent) {
    const effectiveUnlocked = treeParent ? treeParent.effectiveUnlocked : true;
    const initialState = buildEmptyState(path, effectiveUnlocked, false);
    const node = {
      path,
      segment,
      depth,
      treeParent,
      treeChildren: new Map(),
      dagParents: new Set(),
      dagChildren: new Set(),
      unlocked: true,
      effectiveUnlocked,
      muted: false,
      displayMode: 'auto',
      maxCount: null,
      newLabel: null,
      valueSource: null,
      ruleSource: null,
      unreadStyle: null,
      dailySource: null,
      readySource: null,
      ownCount: 0,
      ownNumberCount: 0,
      ownStyle: 'none',
      contributors: null,
      state: initialState,
      lastEmittedState: initialState,
      dirty: false,
    };
    nodes.set(path, node);
    return node;
  }

  function ensureNode(rawPath) {
    const normalized = normalizeRedDotPath(rawPath);
    const existing = nodes.get(normalized);
    if (existing) return existing;

    const segments = normalized.split('/');
    let parent = null;
    let prefix = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      prefix = i === 0 ? seg : `${prefix}/${seg}`;
      let node = nodes.get(prefix);
      if (!node) {
        node = createNode(prefix, seg, i, parent);
        if (parent) {
          parent.treeChildren.set(seg, node);
        }
      }
      parent = node;
    }
    return parent;
  }

  function markDirtyUp(startNode) {
    if (!startNode || startNode.dirty) return;
    const stack = [startNode];
    while (stack.length > 0) {
      const curr = stack.pop();
      if (!curr || curr.dirty) continue;
      curr.dirty = true;
      dirtySet.add(curr);
      if (curr.treeParent && !curr.treeParent.dirty) {
        stack.push(curr.treeParent);
      }
      for (const dp of curr.dagParents) {
        if (!dp.dirty) stack.push(dp);
      }
    }
  }

  function markAllDirty() {
    for (const node of nodes.values()) {
      node.dirty = true;
      dirtySet.add(node);
    }
  }

  function isReachable(fromNode, targetNode) {
    if (fromNode === targetNode) return true;
    const visited = new Set([fromNode]);
    const stack = [fromNode];
    while (stack.length > 0) {
      const curr = stack.pop();
      for (const child of curr.treeChildren.values()) {
        if (child === targetNode) return true;
        if (!visited.has(child)) {
          visited.add(child);
          stack.push(child);
        }
      }
      for (const child of curr.dagChildren) {
        if (child === targetNode) return true;
        if (!visited.has(child)) {
          visited.add(child);
          stack.push(child);
        }
      }
    }
    return false;
  }

  function computeOwnContribution(node) {
    let count = 0;
    let numberCount = 0;
    let bestStyle = 'none';
    let bestPriority = 0;

    const addSource = (srcCount, srcStyle) => {
      if (srcCount <= 0) return;
      count += srcCount;
      if (srcStyle === 'number') numberCount += srcCount;
      const p = STYLE_PRIORITY[srcStyle] ?? 0;
      if (p > bestPriority) {
        bestPriority = p;
        bestStyle = srcStyle;
      }
    };

    if (node.valueSource && node.valueSource.count > 0) {
      addSource(node.valueSource.count, node.valueSource.style);
    }
    if (node.ruleSource && node.ruleSource.count > 0) {
      addSource(node.ruleSource.count, node.ruleSource.activeStyle);
    }
    if (node.unreadStyle) {
      addSource(1, node.unreadStyle);
    }
    if (
      node.dailySource &&
      node.dailySource.enabled &&
      (!node.dailySource.condition || Boolean(node.dailySource.condition(ctx.lastContext))) &&
      dailyAckMap.get(node.path) !== ctx.cachedDayKey
    ) {
      addSource(1, node.dailySource.style);
    }
    if (
      node.readySource &&
      node.readySource.readyAtMs !== null &&
      ctx.cachedClockMs >= node.readySource.readyAtMs
    ) {
      addSource(1, node.readySource.style);
    }

    node.ownCount = count;
    node.ownNumberCount = numberCount;
    node.ownStyle = bestStyle;
  }

  function recomputeNode(node, changedNodes) {
    computeOwnContribution(node);

    if (!node.effectiveUnlocked || node.muted) {
      node.contributors = null;
      const next = buildEmptyState(node.path, node.effectiveUnlocked, node.muted);
      node.state = next;
      if (!statesEqual(next, node.lastEmittedState)) {
        node.lastEmittedState = next;
        changedNodes.push(node);
      }
      return;
    }

    let count = 0;
    let numberCount = 0;
    let resolvedBestStyle = node.ownStyle;
    let resolvedBestPriority = STYLE_PRIORITY[resolvedBestStyle] ?? 0;

    const considerChildStyle = (childStyle) => {
      const p = STYLE_PRIORITY[childStyle] ?? 0;
      if (p > resolvedBestPriority) {
        resolvedBestPriority = p;
        resolvedBestStyle = childStyle;
      }
    };

    if (ctx.dagLinkCount === 0) {
      node.contributors = null;
      count = node.ownCount;
      numberCount = node.ownNumberCount;
      for (const child of node.treeChildren.values()) {
        if (!child.state.active) continue;
        count += child.state.count;
        numberCount += child.state.numberCount;
        considerChildStyle(child.state.style);
      }
    } else {
      const contrib = new Set();
      if (node.ownCount > 0) {
        contrib.add(node);
      }
      for (const child of node.treeChildren.values()) {
        if (!child.effectiveUnlocked || child.muted) continue;
        if (child.contributors) {
          for (const leaf of child.contributors) contrib.add(leaf);
        }
        if (child.state.active) {
          considerChildStyle(child.state.style);
        }
      }
      for (const child of node.dagChildren) {
        if (!child.effectiveUnlocked || child.muted) continue;
        if (child.contributors) {
          for (const leaf of child.contributors) contrib.add(leaf);
        }
        if (child.state.active) {
          considerChildStyle(child.state.style);
        }
      }
      node.contributors = contrib.size > 0 ? contrib : null;
      for (const leaf of contrib) {
        count += leaf.ownCount;
        numberCount += leaf.ownNumberCount;
      }
    }

    const active = count > 0;
    let finalStyle = 'none';
    if (active) {
      finalStyle = node.displayMode === 'auto' ? resolvedBestStyle : node.displayMode;
    }

    let text = '';
    if (active && finalStyle !== 'none') {
      let badgeValue = count;
      if (node.displayMode === 'auto' && finalStyle === 'number') {
        badgeValue = numberCount > 0 ? numberCount : count;
      }
      text = formatRedDotBadge(badgeValue, {
        style: finalStyle,
        maxCount: node.maxCount ?? maxCount,
        newLabel: node.newLabel ?? newLabel,
      });
    }

    const next = Object.freeze({
      path: node.path,
      active,
      count,
      numberCount,
      style: finalStyle,
      text,
      unlocked: node.effectiveUnlocked,
      muted: node.muted,
    });
    node.state = next;
    if (!statesEqual(next, node.lastEmittedState)) {
      node.lastEmittedState = next;
      changedNodes.push(node);
    }
  }

  function ensureClean(node, changedNodes, visiting = new Set()) {
    if (!node.dirty) return;
    if (visiting.has(node)) return;
    visiting.add(node);
    for (const child of node.treeChildren.values()) {
      if (child.dirty) ensureClean(child, changedNodes, visiting);
    }
    for (const child of node.dagChildren) {
      if (child.dirty) ensureClean(child, changedNodes, visiting);
    }
    visiting.delete(node);
    recomputeNode(node, changedNodes);
    node.dirty = false;
    dirtySet.delete(node);
  }

  function updateSubtreeUnlock(rootNode) {
    const stack = [rootNode];
    while (stack.length > 0) {
      const curr = stack.pop();
      curr.effectiveUnlocked = curr.unlocked && (curr.treeParent ? curr.treeParent.effectiveUnlocked : true);
      markDirtyUp(curr);
      for (const child of curr.treeChildren.values()) {
        stack.push(child);
      }
    }
  }

  function explainPath(normalized) {
    const ancestors = splitRedDotAncestors(normalized);
    let blockedByUnlock = null;
    for (const anc of ancestors) {
      const ancNode = nodes.get(anc);
      if (ancNode && !ancNode.unlocked) {
        blockedByUnlock = anc;
        break;
      }
    }

    const node = nodes.get(normalized);
    const state = node ? node.state : buildEmptyState(normalized, blockedByUnlock === null, false);
    const activeSources = [];

    if (node && node.effectiveUnlocked && !node.muted) {
      const visited = new Set([node]);
      const stack = [node];
      while (stack.length > 0) {
        const curr = stack.pop();
        if (!curr.effectiveUnlocked || curr.muted) continue;
        if (curr.ownCount > 0) {
          const reasons = [];
          if (curr.valueSource && curr.valueSource.count > 0) reasons.push('value');
          if (curr.ruleSource && curr.ruleSource.count > 0) reasons.push('rule');
          if (curr.unreadStyle) reasons.push('unread');
          if (
            curr.dailySource &&
            curr.dailySource.enabled &&
            (!curr.dailySource.condition || Boolean(curr.dailySource.condition(ctx.lastContext))) &&
            dailyAckMap.get(curr.path) !== ctx.cachedDayKey
          ) {
            reasons.push('daily');
          }
          if (
            curr.readySource &&
            curr.readySource.readyAtMs !== null &&
            ctx.cachedClockMs >= curr.readySource.readyAtMs
          ) {
            reasons.push('ready');
          }
          activeSources.push({
            path: curr.path,
            count: curr.ownCount,
            style: curr.ownStyle,
            reasons,
          });
        }
        for (const child of curr.treeChildren.values()) {
          if (!visited.has(child)) {
            visited.add(child);
            stack.push(child);
          }
        }
        for (const child of curr.dagChildren) {
          if (!visited.has(child)) {
            visited.add(child);
            stack.push(child);
          }
        }
      }
      activeSources.sort((a, b) => a.path.localeCompare(b.path));
    }

    return {
      path: normalized,
      state,
      blockedByUnlock,
      muted: Boolean(node?.muted),
      activeSources,
    };
  }

  return {
    ensureNode,
    markDirtyUp,
    markAllDirty,
    isReachable,
    recomputeNode,
    ensureClean,
    updateSubtreeUnlock,
    explainPath,
  };
}
