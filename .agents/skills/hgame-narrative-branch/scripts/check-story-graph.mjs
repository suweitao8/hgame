#!/usr/bin/env node
// Zero-dependency narrative branch graph validator & dialogue length linter.
import fs from 'node:fs';

function parseArgs(argv) {
  let storyPath = '';
  let demo = false;
  let maxChars = 60;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--story' || a === '-s') storyPath = argv[++i] ?? '';
    else if (a === '--demo') demo = true;
    else if (a === '--max-chars') maxChars = Math.max(10, parseInt(argv[++i] ?? '60', 10) || 60);
  }
  return { storyPath, demo, maxChars };
}

function validateStory(story, maxChars) {
  const nodes = story.nodes && !Array.isArray(story.nodes)
    ? story.nodes
    : Object.fromEntries((story.nodes || []).map((n) => [n.id, n]));
  const startId = story.start || Object.keys(nodes)[0];
  if (!startId || !nodes[startId]) {
    throw new Error(`Missing valid start node "${startId}"`);
  }

  const brokenLinks = [];
  const danglingNodes = [];
  const verboseLines = [];
  const allEndings = [];

  for (const [id, node] of Object.entries(nodes)) {
    const text = String(node.text ?? '').trim();
    if (!text) verboseLines.push({ id, reason: 'empty text' });
    else if (text.length > maxChars) verboseLines.push({ id, length: text.length, maxChars });

    const targets = [];
    if (node.next) targets.push(node.next);
    if (Array.isArray(node.choices)) {
      for (const ch of node.choices) {
        if (ch?.next) targets.push(ch.next);
      }
    }

    if (node.ending) {
      allEndings.push(id);
    } else if (targets.length === 0) {
      danglingNodes.push(id);
    }

    for (const t of targets) {
      if (!nodes[t]) brokenLinks.push({ from: id, to: t });
    }
  }

  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const curId = queue.shift();
    const cur = nodes[curId];
    if (!cur) continue;
    const targets = [];
    if (cur.next) targets.push(cur.next);
    if (Array.isArray(cur.choices)) {
      for (const ch of cur.choices) {
        if (ch?.next) targets.push(ch.next);
      }
    }
    for (const t of targets) {
      if (nodes[t] && !visited.has(t)) {
        visited.add(t);
        queue.push(t);
      }
    }
  }

  const unreachableNodes = Object.keys(nodes).filter((id) => !visited.has(id));
  const unreachableEndings = allEndings.filter((id) => !visited.has(id));
  const pass =
    brokenLinks.length === 0 &&
    danglingNodes.length === 0 &&
    unreachableEndings.length === 0 &&
    verboseLines.length === 0;

  return {
    nodeCount: Object.keys(nodes).length,
    endingCount: allEndings.length,
    reachableCount: visited.size,
    brokenLinks,
    danglingNodes,
    unreachableNodes,
    unreachableEndings,
    verboseLines,
    pass,
  };
}

const DEMO_STORY = {
  start: 'camp',
  nodes: {
    camp: {
      text: '篝火微弱，远处传来铁甲踏雪声。',
      choices: [
        { label: '伏击', next: 'ambush' },
        { label: '潜行', next: 'sneak_end' },
      ],
    },
    ambush: {
      text: '一刀断戟，敌将落马！',
      choices: [{ label: '凯旋', next: 'victory_end' }],
    },
    victory_end: { text: '全军振奋，大胜而归！', ending: true },
    sneak_end: { text: '暗影脱身，保全实力。', ending: true },
  },
};

const args = parseArgs(process.argv.slice(2));
const raw = args.storyPath
  ? JSON.parse(fs.readFileSync(args.storyPath, 'utf8'))
  : (args.demo ? DEMO_STORY : null);

if (!raw) {
  console.error('Usage: node check-story-graph.mjs --story <story.json> [--max-chars 60] | --demo');
  process.exit(1);
}

const res = validateStory(raw, args.maxChars);
console.log(JSON.stringify(res, null, 2));
if (!res.pass) process.exit(1);
