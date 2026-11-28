import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCharacterSheetPrompt, FILM_FACE_RULE } from '../lib/character-image-prompt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'assets', 'characters', 'index.json');
const outputPath = path.join(root, 'docs', 'CHARACTER_IMAGE_GENERATION_QUEUE.md');

async function loadCharacters() {
  const dbModulePath = path.join(root, 'lib', 'asset-db.mjs');
  const defaultDbPath = process.env.WEBASSET_DB_PATH?.trim()
    ? path.resolve(process.env.WEBASSET_DB_PATH.trim())
    : path.join(root, 'data', 'assets.db');
  if (fs.existsSync(dbModulePath) && fs.existsSync(defaultDbPath)) {
    const { openAssetDb } = await import('../lib/asset-db.mjs');
    const db = openAssetDb(defaultDbPath);
    try {
      const list = db.listCharacters();
      if (list.length > 0) return list;
    } finally {
      db.close();
    }
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  return catalog.characters || [];
}

const characters = await loadCharacters();
const legacyWhiteBackgroundPath = 'characters/daodun-dog/generated/codex-1793853550758-7532b2e9.png';
const forceDefaultRegeneration = new Map(characters
  .filter(character => {
    if (character.id !== 'daodun-dog') return false;
    const defaults = (character.generatedAssets || []).filter(asset =>
      (asset.mode === 'humanoid' ? 'humanoid' : 'default') === 'default'
    );
    return defaults.length > 0 && defaults.every(asset => asset.path === legacyWhiteBackgroundPath);
  })
  .map(character => [character.id, '仍登记原始纯白背景图片，需重新生成。']));

function hasGeneratedMode(character, mode) {
  return (character.generatedAssets || []).some(asset =>
    (asset.mode === 'humanoid' ? 'humanoid' : 'default') === mode
  );
}

function filmImagePath(character) {
  return (character.generatedAssets || []).filter(asset => asset.mode !== 'humanoid').at(-1)?.path;
}

function referenceList(character) {
  return (character.assets || []).map(asset => `\`${asset.path}\``).join('、') || '无参考图';
}

function propsList(character) {
  return (character.props || []).join('、') || '无';
}

function personalityList(character) {
  return (character.personality || []).join('、') || '以参考图为准';
}

const defaultQueue = characters.filter(character =>
  !hasGeneratedMode(character, 'default') || forceDefaultRegeneration.has(character.id)
);
const humanoidQueue = characters.filter(character => !hasGeneratedMode(character, 'humanoid'));

const lines = [
  '# 角色图片生成待办与专属提示词',
  '',
  `> 根据角色库自动生成；更新角色资料或生成状态后，运行 \`npm run prompts:export\` 刷新本文件。`,
  '> **标准传递：** 生成影视图时输入全部原始参考图；生成模型图时只输入当前影视 AI 定稿图，不得混入原始参考图。没有影视图时先生成影视图。',
  `> **影视面孔：** ${FILM_FACE_RULE}`,
  '> 两种形态统一使用纯色哑光深灰背景 RGB(51, 51, 51) / #333333，禁止白色、浅灰、透明背景。',
  '> **纯角色规则：** 所有武器、道具、食物、工具、手持物及周边独立物件均不得进入生成图；角色资料中的道具字段仅供文字设定参考，不参与生图。',
  '',
  '## 待生成概览',
  '',
  `- 默认形态（四栏六视图）：**${defaultQueue.length} 个任务**。`,
  `- 模型参考（前视图 + 严格侧视图）：**${humanoidQueue.length} 个任务**。`,
  `- 合计：**${defaultQueue.length + humanoidQueue.length} 个任务**。`,
  '- 已有生成记录的形态不重复排队；只有仍登记原始白背景图片的刀盾狗需要重生成。',
  '',
  '| 角色 | 默认六视图 | 模型参考双视图 | 道具资料（仅文字） | 性格 |',
  '|---|---|---|---|---|',
  ...characters.map(character => {
    const defaultStatus = forceDefaultRegeneration.has(character.id)
      ? '重生成'
      : hasGeneratedMode(character, 'default') ? '已有' : '待生成';
    const humanoidStatus = hasGeneratedMode(character, 'humanoid') ? '已有' : '待生成';
    return `| ${character.name} | ${defaultStatus} | ${humanoidStatus} | ${propsList(character)} | ${personalityList(character)} |`;
  }),
  '',
  '## 一、默认形态 · 六视图',
  '',
  '> 用于影视角色细节展示。每张图严格 2:1 横向、四栏六视图，统一深灰背景；只展示角色本体，不出现武器或道具。',
  '',
  '### 影视图生成流程',
  '',
  '1. 生图前核对原始参考图和角色设定。人形角色按身份、外貌年龄感和性格，先为该角色定五官，写清脸长与脸宽、颧颊、下颌与下巴、眉眼、鼻型和唇形。没有可靠年龄资料时按原作外貌判断。记录身高感、头身比例和标志性装束。多张参考图一起提供，优先采用重复出现的特征。',
  '2. 使用 WebAsset 影视模式提示词，追加该角色的具体特征。以原始参考图为外观依据，逐角色生成独立六视图，保留原有身高感、体型和服装。',
  '3. 出图后先看正脸和前 3/4 是否还原脸型、眉眼与年龄感。将同批角色和造型相近的已确认样片并排比较，遮住发型和服装后也应能从脸型和五官分辨。再核对严格侧脸及两张全身图的人物一致性、身形和装束。',
  '4. 局部偏差只修相关部位。原始参考图仍决定外观，旧稿仅用于保留已通过的部分。重看修订处和其他视角，影视稿确认后再进入模型图。',
  '',
];

for (const [index, character] of defaultQueue.entries()) {
  const reason = forceDefaultRegeneration.get(character.id) || '尚无默认形态生成图。';
  lines.push(
    `### ${index + 1}. ${character.name}`,
    '',
    `- ID：\`${character.id}\``,
    `- 状态：${reason}`,
    `- 参考图：${referenceList(character)}`,
    `- 道具资料（仅文字记录，不用于生图）：${propsList(character)}`,
    `- 性格：${personalityList(character)}`,
    '',
    '```text',
    buildCharacterSheetPrompt(character, { mode: 'default' }),
    '```',
    '',
  );
}

lines.push(
  '## 二、模型参考 · 双视图',
  '',
  '> 用于 3D 角色建模。只以影视 AI 定稿为唯一外观标准，必要时转换为直立两足人形；左侧全身前视图，右侧严格 90° 侧视图；只展示角色本体，不出现武器或道具。',
  '',
);

for (const [index, character] of humanoidQueue.entries()) {
  lines.push(
    `### ${index + 1}. ${character.name}`,
    '',
    `- ID：\`${character.id}\``,
    '- 状态：尚无模型参考图。',
    `- 影视图：${filmImagePath(character) ? `\`${filmImagePath(character)}\`` : '请先生成影视图（模型图暂不可生成）'}`,
    `- 道具资料（仅文字记录，不用于生图）：${propsList(character)}`,
    `- 性格：${personalityList(character)}`,
    '',
    '```text',
    buildCharacterSheetPrompt(character, { mode: 'humanoid' }),
    '```',
    '',
  );
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${defaultQueue.length} default + ${humanoidQueue.length} humanoid prompts to ${path.relative(root, outputPath)}`);
