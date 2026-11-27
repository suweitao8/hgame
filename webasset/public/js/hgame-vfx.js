import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPostPipeline3D } from '/runtime/hgame/integrations/post3d.js';
import { createVfxSystem, VFX_SHAPE } from '/runtime/hgame/vfx/index.js';
import {
  createSidebarSquareCard,
  createThreeViewport,
  disposeObject3D,
  fetchUnrealCatalog,
  normalizeUnrealSceneMaterials,
} from './hgame-shared.js';

const VFX_CATEGORY_ORDER = [
  '刀光斩击',
  '受击命中',
  '投射弹道',
  '范围爆破',
  '光束天降',
  '法阵持续',
  '护盾增益',
  '战斗 · 爆炸',
  '战斗 · 弹道投射',
  '战斗 · 枪口火焰',
  '战斗 · 魔法技能',
  '战斗 · 剑光与近战',
  '战斗 · 命中与状态',
  '环境 · 自然与天气',
  '交互 · 拾取与提示',
  '其他 · 杂项',
  '3D 网格',
  '序列帧贴图',
];

const ETFX_SUBCATEGORY_LABELS = {
  // Explosions
  BubbleExplosion: '气泡爆炸',
  BulletExplosion: '子弹爆炸',
  BulletFatExplosion: '重弹爆炸',
  EnergyExplosion: '能量爆炸',
  FireballRoundExplosion: '火球爆炸·圆',
  FireballSharpExplosion: '火球爆炸·锐',
  FireballSoftExplosion: '火球爆炸·柔',
  FlashExplosion: '闪光爆炸',
  FrostExplosion: '冰霜爆炸',
  FruitExplosion: '水果爆裂',
  GasExplosion: '毒气爆炸',
  GlitterExplosion: '闪粉爆炸',
  GrenadeExplosion: '手雷爆炸',
  LaserExplosion: '激光爆炸',
  LightningExplosion: '闪电爆炸',
  LightningSoftExplosion: '柔雷爆炸',
  LiquidExplosion: '液体飞溅爆',
  MagicExplosion: '魔法爆炸',
  MagicNovaExplosion: '魔法新星爆',
  MagicSoftExplosion: '柔魔爆炸',
  MegaExplosion: '巨型爆炸',
  MysticExplosion: '秘术爆炸',
  NovaExplosion: '新星爆炸',
  NovaSmallExplosion: '小型新星爆',
  NovaSoftExplosion: '柔和新星爆',
  NukeConeExplosion: '锥形核爆',
  NukeExplosion: '蘑菇云核爆',
  NukeVerticalExplosion: '竖向核爆',
  RoundExplosion: '圆形爆炸',
  ShadowExplosion: '暗影爆炸',
  SharpExplosion: '锐利爆炸',
  SmallExplosion: '小型爆炸',
  SnowExplosion: '雪花爆炸',
  SoulExplosion: '灵魂爆炸',
  SparkleExplosion: '星芒爆炸',
  SpikyExplosion: '尖刺爆炸',
  StarExplosion: '星形爆炸',
  StarIntenseExplosion: '强力星爆',
  StarlineExplosion: '星线爆炸',
  StormExplosion: '风暴爆炸',
  'Explosions (Misc)': '杂项爆炸',
  'Explosions (Text)': '文字拟声爆',
  // Missiles
  Bubble: '气泡弹',
  Bullet: '常规子弹',
  Energy: '能量弹',
  FatBullet: '重型子弹',
  Fireball: '火球弹',
  FireballSharp: '锐利火球',
  FireballSoft: '柔和火球',
  Flash: '闪光弹',
  Frost: '冰霜弹',
  Fruit: '水果投掷',
  Gas: '毒气弹',
  Grenade: '手榴弹',
  Laser: '激光束弹',
  Lightning: '闪电弹',
  LightningSoft: '柔雷弹',
  Liquid: '液体弹',
  Magic: '魔法飞弹',
  MagicSoft: '柔魔飞弹',
  Mystic: '秘术飞弹',
  NovaMissile: '新星飞弹',
  NovaMissileSoft: '柔和星弹',
  NovaSmall: '小型星弹',
  Nuke: '核弹头',
  Rocket: '火箭弹',
  Shadow: '暗影弹',
  Sharp: '锐刺飞弹',
  Snow: '雪球弹',
  Soul: '灵魂弹',
  Sparkle: '星芒弹',
  Storm: '风暴弹',
  // Muzzleflash
  '- Misc': '杂项枪口焰',
  BubbleMuzzle: '气泡枪口',
  BulletFatMuzzle: '重弹枪口',
  BulletMuzzle: '常规枪口',
  EnergyMuzzle: '能量枪口',
  EnergyNovaMuzzle: '新星枪口',
  EnergyNovaSmallMuzzle: '小新星枪口',
  FireballMuzzle: '火球枪口',
  FireballSoftMuzzle: '柔火枪口',
  FrostMuzzle: '冰霜枪口',
  GrenadeMuzzle: '榴弹枪口',
  LaserMuzzle: '激光枪口',
  LightningMuzzle: '闪电枪口',
  LiquidMuzzle: '液体枪口',
  MagicMuzzle: '魔法枪口',
  MagicSoftMuzzle: '柔魔枪口',
  MysticMuzzle: '秘术枪口',
  NukeMuzzle: '核爆枪口',
  RocketMuzzle: '火箭枪口',
  ShadowMuzzle: '暗影枪口',
  SharpMuzzle: '锐利枪口',
  SoulMuzzle: '灵魂枪口',
  SparkleMuzzle: '星芒枪口',
  StormMuzzle: '风暴枪口',
  // Magic
  Aura: '魔法光环',
  'Aura Soft': '柔和光环',
  Buff: '增益光效',
  Charge: '蓄力聚能',
  Circle: '魔法法阵',
  'Circle Simple': '简约法阵',
  Enchant: '武器附魔',
  Field: '领域力场',
  PillarBlast: '光柱爆发',
  // Sword & Brawling
  '- Legacy': '经典剑光',
  Hit: '剑击命中',
  Slash: '刀剑斩击',
  Spin: '旋转斩',
  Wave: '剑气波',
  Whirlwind: '旋风斩',
  RoundHit: '圆形打击',
  Soft: '柔和打击',
  Stun: '眩晕状态',
  Toon: '卡通打击',
  // Combat other
  Blood: '血液飞溅',
  BombFuse: '炸弹引信',
  Death: '死亡灵魂',
  Decals: '弹孔贴花',
  Flamethrower: '火焰喷射',
  Giblets: '碎片飞溅',
  Nova: '元素新星',
  Shield: '护盾屏障',
  // Environment
  Bubbles: '气泡漂浮',
  Confetti: '彩带礼花',
  Dust: '尘埃微粒',
  Fire: '环境火焰',
  Fireflies: '萤火虫',
  Firework: '烟花绽放',
  Fog: '雾气弥漫',
  Smoke: '烟雾升腾',
  Sparks: '火星飞溅',
  Stars: '星空星云',
  Underwater: '水下环境',
  Water: '水流波纹',
  Weather: '天气现象',
  // Interactive
  Cards: '卡牌特效',
  Emojis: '情绪气泡',
  Feathers: '羽毛飘落',
  Flares: '镜头光晕',
  Healing: '治疗回血',
  Hearts: '爱心特效',
  'Level Up': '升级光效',
  Loot: '掉落宝箱',
  Money: '金币钞票',
  Portals: '传送门',
  Powerups: '能量道具',
  Sparkle: '闪烁星光',
  Trails: '拖尾轨迹',
  Warning: '预警提示',
  Zone: '区域光圈',
};

function formatFolderSubcategory(seg) {
  if (!seg) return '通用';
  if (ETFX_SUBCATEGORY_LABELS[seg]) return ETFX_SUBCATEGORY_LABELS[seg];
  return String(seg).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
}

function classifyPilotoSubcategory(item, category) {
  const s = `${item?.name || ''} ${item?.effectId || item?.id || ''} ${item?.relSource || ''}`.toLowerCase();
  if (category === '刀光斩击') {
    if (/(combo|three_?stage)/.test(s)) return '连击组合';
    if (/(whirlwind|spin|swirl)/.test(s)) return '旋风回旋';
    if (/(stab|lunge|puncture|drill)/.test(s)) return '突刺穿刺';
    if (/(scythe|hammer|claw)/.test(s)) return '重武与爪击';
    if (/(dash)/.test(s)) return '冲锋位移斩';
    return '弧光斩击';
  }
  if (category === '受击命中') {
    if (/(muzzle)/.test(s)) return '枪口闪光';
    if (/(splatter|blood)/.test(s)) return '飞溅受击';
    if (/(spark|snap|fizzle|clap)/.test(s)) return '火花爆点';
    return '打击命中';
  }
  if (category === '投射弹道') {
    if (/(arrow|spear|dagger)/.test(s)) return '箭矢矛刃';
    if (/(homing)/.test(s)) return '追踪弹道';
    if (/(barrage|rain|shooting)/.test(s)) return '弹幕齐射';
    if (/(fireball|iceball|orb|comet)/.test(s)) return '元素法球';
    if (/(trail)/.test(s)) return '弹道拖尾';
    return '直射投射物';
  }
  if (category === '光束天降') {
    if (/(tornado|vortex|vortrex|twister|cyclone|waterspout|storm)/.test(s)) return '龙卷风暴';
    if (/(rain|falling|skybloom|godssight|poseidon)/.test(s)) return '天降降雨';
    if (/(lightning|thunder|flashlightning|lightningwrath|shock_calling)/.test(s)) return '天雷落雷';
    return '聚能光束';
  }
  if (category === '护盾增益') {
    if (/(shield|barrier|protection|ward|dome)/.test(s)) return '护盾屏障';
    if (/(heal|revive|blessing|empower)/.test(s)) return '治疗强化';
    if (/(curse|debuff|cage|prison)/.test(s)) return '诅咒禁锢';
    if (/(pickup|chest|loot|item|potion|coin)/.test(s)) return '掉落拾取';
    if (/(charge|charging|recharge|release)/.test(s)) return '蓄力释放';
    return '角色附着与增益';
  }
  if (category === '法阵持续') {
    if (/(circle|rune|sigil|ritual|altar|totem)/.test(s)) return '符文法阵';
    if (/(aura|mark|telegraph|brand)/.test(s)) return '光环预警';
    if (/(ground|pool|zone|area|field|mine)/.test(s)) return '持续地面域';
    if (/(fire|flames|embers|campfire|torch|smoke|mist|fog)/.test(s)) return '火焰烟雾';
    if (/(water|fountain|waterfall|splash|wave|stream|bubble)/.test(s)) return '水流波涛';
    return '持续环境效果';
  }
  if (category === '范围爆破') {
    if (/(slam|groundslam|stomp|quake|crush)/.test(s)) return '重击砸地';
    if (/(nova|shockwave|ring)/.test(s)) return '新星冲击波';
    if (/(spike|crack|fissure|sunder|rock|boulder|crystal|eruption)/.test(s)) return '地刺裂隙与岩石';
    if (/(cone|frontal)/.test(s)) return '扇形锥面爆';
    if (/(shatter|cluster|bomb)/.test(s)) return '爆裂碎裂';
    return '范围爆炸';
  }
  return category || '通用';
}

function classifyVfxHierarchy(item) {
  const bundleId = item?.bundleId || '';
  const pathParts = Array.isArray(item?.categoryPath) ? item.categoryPath : [];

  if (bundleId === 'epic_toon_fx' && pathParts.length > 0) {
    const [top, second, third] = pathParts;
    if (top === 'Combat') {
      if (second === 'Explosions' || second === 'Explosions (Misc)' || second === 'Explosions (Text)') {
        const sub = third ? formatFolderSubcategory(third) : formatFolderSubcategory(second);
        return { category: '战斗 · 爆炸', subCategory: sub };
      }
      if (second === 'Missiles') {
        return { category: '战斗 · 弹道投射', subCategory: third ? formatFolderSubcategory(third) : '弹道' };
      }
      if (second === 'Muzzleflash') {
        return { category: '战斗 · 枪口火焰', subCategory: third ? formatFolderSubcategory(third) : '枪口焰' };
      }
      if (second === 'Magic') {
        return { category: '战斗 · 魔法技能', subCategory: third ? formatFolderSubcategory(third) : '魔法' };
      }
      if (second === 'Sword' || second === 'Brawling') {
        const prefix = second === 'Sword' ? '剑术' : '格斗';
        const sub = third ? `${prefix} · ${formatFolderSubcategory(third)}` : prefix;
        return { category: '战斗 · 剑光与近战', subCategory: sub };
      }
      const sub = third
        ? `${formatFolderSubcategory(second)} · ${formatFolderSubcategory(third)}`
        : formatFolderSubcategory(second || '其他战斗');
      return { category: '战斗 · 命中与状态', subCategory: sub };
    }
    if (top === 'Environment') {
      const sub = third
        ? `${formatFolderSubcategory(second)} · ${formatFolderSubcategory(third)}`
        : formatFolderSubcategory(second || '环境');
      return { category: '环境 · 自然与天气', subCategory: sub };
    }
    if (top === 'Interactive') {
      const sub = third
        ? `${formatFolderSubcategory(second)} · ${formatFolderSubcategory(third)}`
        : formatFolderSubcategory(second || '交互');
      return { category: '交互 · 拾取与提示', subCategory: sub };
    }
    if (top === 'Misc') {
      const sub = second ? formatFolderSubcategory(second) : '杂项特效';
      return { category: '其他 · 杂项', subCategory: sub };
    }
  }

  if (bundleId && bundleId !== 'piloto_studio' && pathParts.length > 0) {
    const category = formatFolderSubcategory(pathParts[0]);
    const subCategory = pathParts.length > 1
      ? pathParts.slice(1).map(formatFolderSubcategory).join(' · ')
      : classifyPilotoSubcategory(item, category);
    return { category, subCategory };
  }

  const category = classifyVfxSystem(item);
  const subCategory = classifyPilotoSubcategory(item, category);
  return { category, subCategory };
}

function classifyVfxSystem(item) {
  const s = `${item?.name || ''} ${item?.effectId || item?.id || ''} ${item?.relSource || ''}`.toLowerCase();
  if (/(slash|swing|blade|cleave|stab|lunge|combo|swipe|cut|claw|scythe|whirlwind|spin_attack|sword_swirl|sword_shock|hammer_combo|punch|puncture|frontal_attack|dash|drill)/.test(s)) {
    return '刀光斩击';
  }
  if (/(\bhit\b|_hit|hit_|impact|splatter|muzzle|spark|fizzle|snap|clap|pain)/.test(s)) {
    return '受击命中';
  }
  if (/(projectile|projetil|missile|arrow|fireball|iceball|orb|throw|bullet|bolt|spear|dagger|homing|shooting|comet|barrage|trail)/.test(s) && !/(orb_nova|orb_explosion)/.test(s)) {
    return '投射弹道';
  }
  if (/(beam|ray|laser|shock_calling|rain|falling|strike|thunder|smite|pillar|column|tornado|vortex|vortrex|twister|cyclone|waterspout|storm|vertical_lightning|vertical\s+lightning|flashlightning|lightningwrath|skybloom|godssight|poseidon)/.test(s)) {
    return '光束天降';
  }
  if (/(shield|barrier|protection|ward|dome|buff|debuff|curse|heal|revive|empower|blessing|recharge|charge|charging|release|character|body_fx|hand_attach|wings|pickup|chest|loot|item|potion|coin|portal|cage|prison|skulls_rotation|enrust|clockback|egg|diamond|trifecta|mesh_fx)/.test(s)) {
    return '护盾增益';
  }
  if (/(aura|circle|ring|rune|sigil|mark|telegraph|zone|area|pool|ground_magic|frozen_ground|shocking_ground|holy_ground|burning_ground|field|mine|brand|ritual|altar|totem|ambient|embers|mist|fog|flames|smoke|fire|campfire|torch|fountain|waterfall|splash|wave|stream|flux|lotus|bubble|vein)/.test(s)) {
    return '法阵持续';
  }
  if (/(explosion|explotion|nova|slam|groundslam|burst|crack|fissure|sunder|shockwave|spike|eruption|blast|shatter|quake|stomp|crush|cone|aoe|rock|boulder|crystal|cluster|bomb|spread|ocean\s*call|bloom|sphere|clogs|aureate)/.test(s)) {
    return '范围爆破';
  }
  return item?.loop ? '法阵持续' : '范围爆破';
}

const viewEl = document.querySelector('#vfx-view');
const searchInput = document.querySelector('#hgame-vfx-search');
const bundleTabsEl = document.querySelector('#hgame-vfx-bundle-tabs');
const typeFilter = document.querySelector('#hgame-vfx-type-filter');
const subtypeFilter = document.querySelector('#hgame-vfx-subtype-filter');
const listEl = document.querySelector('#hgame-vfx-list');
const titleEl = document.querySelector('#hgame-vfx-title');
const variantWrap = document.querySelector('#hgame-vfx-variant-wrap');
const variantSelect = document.querySelector('#hgame-vfx-variant-select');
const downloadEl = document.querySelector('#hgame-vfx-download');
const modeTabsWrap = document.querySelector('#hgame-vfx-mode-tabs');
const modeTabEls = [...document.querySelectorAll('.hgame-vfx-mode-tab')];
const copyCodeBtn = document.querySelector('#hgame-vfx-copy-code');
const emptyEl = document.querySelector('#hgame-vfx-empty');
const vfxStage = document.querySelector('#hgame-vfx-stage');
const playBtn = document.querySelector('#hgame-vfx-play-button');
const replayBtn = document.querySelector('#hgame-vfx-replay-button');
const speedWrap = document.querySelector('#hgame-vfx-speed-wrap');
const speedSelect = document.querySelector('#hgame-vfx-speed');
const reviewWrap = document.querySelector('#hgame-vfx-review-wrap');
const reviewToggle = document.querySelector('#hgame-vfx-review-toggle');
const qualityWrap = document.querySelector('#hgame-vfx-quality-wrap');
const qualitySelect = document.querySelector('#hgame-vfx-quality');
const gridToggleWrap = document.querySelector('#hgame-vfx-grid-toggle-wrap');
const gridToggle = document.querySelector('#hgame-vfx-grid-toggle');
const bloomToggleWrap = document.querySelector('#hgame-vfx-bloom-toggle-wrap');
const bloomToggle = document.querySelector('#hgame-vfx-bloom-toggle');
const seqGroupEl = document.querySelector('#hgame-vfx-seq-group');
const planeModeWrap = document.querySelector('#hgame-vfx-plane-mode-wrap');
const planeModeSelect = document.querySelector('#hgame-vfx-plane-mode');
const gridWrap = document.querySelector('#hgame-vfx-grid-wrap');
const gridSelect = document.querySelector('#hgame-vfx-grid');
const fpsWrap = document.querySelector('#hgame-vfx-fps-wrap');
const fpsInput = document.querySelector('#hgame-vfx-fps');
const blendWrap = document.querySelector('#hgame-vfx-blend-wrap');
const blendSelect = document.querySelector('#hgame-vfx-blend');
const colorInput = document.querySelector('#hgame-vfx-color');
const spinInput = document.querySelector('#hgame-vfx-spin');
const statusEl = document.querySelector('#hgame-vfx-status');

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

let initialized = false;
let vfxBundles = [];
let activeBundleId = '';
let vfxSystems = [];
let shurikenBenchSystems = [];
let vfxMeshes = [];
let vfxTextures = [];
let activeSelection = { kind: '', id: '' };
let activeRenderMode = 'source'; // 'source' | 'hgame'
let viewport = null;
let stageRoot = null;
let activeTexture = null;
let activeTextureMaterial = null;
let activeTexturePlane = null;
let activeTextureMode = 'billboard';
let loadToken = 0;
let isPlaying = true;
let animTimer = 0;
let currentFrame = 0;

// Active particle system simulation
let simEmitters = [];
let simElapsed = 0;
let simLoopCooldown = 0;
const simTexCache = new Map();
const simProcTexCache = new Map();
const simMeshCache = new Map();

// HGame runtime VFX state
let hgameVfx = null;
let hgameVfxIsBench = false;
let hgameFireTimer = 0;
let hgameMeshPreview = null;

// Piloto Pack 1:1 HGame VFX pipeline state & shared caches
const benchRecipeCache = new Map();
const benchPackCache = new Map();
const benchGlbCache = new Map();
const benchGlbInflight = new Map();
const registeredBenchAliases = new Set();
const vfxPacksById = new Map();
const reviewedIds = new Set();
const activeVariantByBaseId = new Map();
let vfxMeshIndex = {};
let vfxBaseUrl = '/files/hgame-vfx';
let activeBenchPackId = '';
let activeBenchAtlasPackId = '';
let activeBenchHandle = null;
let activeBenchRecipe = null;
let activeBenchItem = null;
let benchReplayCooldown = 0;
let benchFrameCount = 0;
let benchMsAccum = 0;
let benchLastDrawCalls = 0;
let benchLastFrameMs = 0;
let benchDepthRT = null;
let benchDepthFloor = null;
let benchStudioGrid = null;
let benchStudioAmbient = null;
let benchStudioDir = null;
let benchStageActive = false;
let benchPostPipeline = null;
let benchSimDt = 0.016;

const VFX_ARPG_THEME_LABELS = {
  paladin: ['圣光', 1],
  arcane: ['奥术', 2],
  blood: ['猩红', 3],
  necromancy: ['亡灵', 4],
  ice: ['寒冰', 5],
  water: ['水系', 6],
  earth: ['大地', 7],
  lightning: ['雷电', 8],
  fire: ['火焰', 9],
  poison: ['剧毒', 10],
  nature: ['自然', 11],
  holy: ['神圣', 12],
  demon: ['恶魔', 13],
};

const VFX_COLOR_SUFFIX_LABELS = {
  green: ['绿色', 2],
  blue: ['蓝色', 3],
  purple: ['紫色', 4],
  red: ['红色', 5],
  yellow: ['黄色', 6],
  orange: ['橙色', 7],
  cyan: ['青色', 8],
  teal: ['青绿', 8],
  white: ['纯白', 9],
  pink: ['粉色', 10],
  magenta: ['洋红', 10],
  black: ['玄黑', 11],
  dark: ['暗色', 11],
  shadow: ['暗影', 11],
  gold: ['金色', 12],
  golden: ['金色', 12],
  silver: ['银色', 13],
  fire: ['火焰', 14],
  frost: ['寒冰', 15],
  ice: ['冰晶', 15],
  water: ['水系', 16],
  poison: ['剧毒', 17],
  acid: ['酸液', 17],
  lightning: ['雷电', 18],
  electric: ['电弧', 18],
  arcane: ['奥术', 19],
  holy: ['神圣', 20],
  light: ['圣光', 20],
  void: ['虚空', 21],
  blood: ['猩红', 22],
  nature: ['自然', 23],
  plasma: ['等离子', 24],
  rainbow: ['彩虹', 25],
  grey: ['灰色', 26],
  gray: ['灰色', 26],
  brown: ['棕色', 27],
};

const VFX_PICKUP_TIER_LABELS = {
  common: ['普通·白', 1],
  uncommon: ['精良·绿', 2],
  rare: ['稀有·蓝', 3],
  mythic: ['神话·紫', 4],
  epic: ['史诗·红', 5],
  legendary: ['传说·黄', 6],
  artifact: ['神器·黑绿', 7],
  relic: ['遗物·蓝橙', 8],
  ancient: ['远古·黑金', 9],
};

function collapseBenchColorVariants(items) {
  const normalizeStem = s => String(s || '')
    .replace(/\s+(?:Thingy|Stuff)$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const groups = new Map();
  const put = (key, entry) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  };

  for (const it of items) {
    const name = String(it.name || it.effectId || '').trim();
    const lc = Number(it.layerCount || 0);
    let m;

    if (it.packId === 'arpg_realistic_golden_spells') {
      const isSilver = /^Silver_/i.test(name);
      const base = name.replace(/^Silver_/i, '');
      put(`silver:${normalizeStem(base)}`, { it, baseName: base, variantLabel: isSilver ? '银色' : '金色', prio: isSilver ? 2 : 1 });
      continue;
    }

    if (it.packId === 'arpg_realistic_pickups_auras_and_buffs') {
      const cm = name.match(/^Chest\s+([A-Za-z]+)\s+[A-Za-z]+$/i);
      if (cm && VFX_PICKUP_TIER_LABELS[cm[1].toLowerCase()]) {
        const [label, prio] = VFX_PICKUP_TIER_LABELS[cm[1].toLowerCase()];
        put('pickup_chest', { it, baseName: 'Chest Loot', variantLabel: label, prio });
        continue;
      }
      const pm = name.match(/^\d+\)\s+([A-Za-z]+)\s+[A-Za-z]+$/);
      if (pm && VFX_PICKUP_TIER_LABELS[pm[1].toLowerCase()]) {
        const [label, prio] = VFX_PICKUP_TIER_LABELS[pm[1].toLowerCase()];
        put('pickup_orb', { it, baseName: 'Pickup Loot', variantLabel: label, prio });
        continue;
      }
    }

    if ((m = name.match(/^ARPG_([A-Za-z]+)_+(.+)$/)) && VFX_ARPG_THEME_LABELS[m[1].toLowerCase()]) {
      const themeKey = m[1].toLowerCase();
      const skill = m[2];
      const [label, prio] = VFX_ARPG_THEME_LABELS[themeKey];
      const isDouble = m[0].includes('__');
      const key = isDouble
        ? `essentials_or_arcane:${normalizeStem(skill)}:${lc}`
        : `arpg:${normalizeStem(skill)}:${lc}`;
      put(key, { it, baseName: isDouble ? skill : `ARPG_${skill}`, variantLabel: label, prio });
      continue;
    }

    if (it.packId === 'arpg_realistic_essentials_fire') {
      const gm = name.match(/^(.+?)_green$/i);
      const skill = gm ? gm[1] : name;
      put(`essentials_or_arcane:${normalizeStem(skill)}:${lc}`, {
        it,
        baseName: skill,
        variantLabel: gm ? '绿色' : '火焰',
        prio: gm ? 3 : 1,
      });
      continue;
    }

    if ((it.packId === 'arpg_realistic_ice_and_water_pack' || it.packId === 'arpg_realistic_demon_vs_angels')
      && (m = name.match(/^(Ice|Water|Holy|Demon)[_ ]+(.+)$/i))) {
      const [label, prio] = VFX_ARPG_THEME_LABELS[m[1].toLowerCase()];
      put(`packtheme:${it.packId}:${normalizeStem(m[2])}`, {
        it,
        baseName: m[2],
        variantLabel: label,
        prio,
      });
      continue;
    }

    if (it.bundleId && it.bundleId !== 'piloto_studio') {
      const relDir = String(it.relSource || '').split('/').slice(0, -1).join('/');
      if ((m = name.match(/^(.+?)[_ -]+([A-Za-z]+)$/)) && VFX_COLOR_SUFFIX_LABELS[m[2].toLowerCase()]) {
        const [label, prio] = VFX_COLOR_SUFFIX_LABELS[m[2].toLowerCase()];
        put(`bnd:${it.packId}:${relDir}:${normalizeStem(m[1])}:${lc}`, {
          it,
          baseName: m[1].trim(),
          variantLabel: label,
          prio,
        });
        continue;
      }
      if ((m = name.match(/^(.+?)([A-Z][a-z]+)$/)) && m[1].length >= 3 && VFX_COLOR_SUFFIX_LABELS[m[2].toLowerCase()]) {
        const [label, prio] = VFX_COLOR_SUFFIX_LABELS[m[2].toLowerCase()];
        put(`bnd:${it.packId}:${relDir}:${normalizeStem(m[1])}:${lc}`, {
          it,
          baseName: m[1].trim(),
          variantLabel: label,
          prio,
        });
        continue;
      }
      put(`bnd:${it.packId}:${relDir}:${normalizeStem(name)}:${lc}`, {
        it,
        baseName: name,
        variantLabel: '默认',
        prio: 1,
      });
      continue;
    }

    if ((m = name.match(/^(.+?)[_ -]+([A-Za-z]+)$/)) && VFX_COLOR_SUFFIX_LABELS[m[2].toLowerCase()]) {
      const [label, prio] = VFX_COLOR_SUFFIX_LABELS[m[2].toLowerCase()];
      put(`suf:${it.packId}:${normalizeStem(m[1])}:${lc}`, {
        it,
        baseName: m[1].replace(/\s+(?:Thingy|Stuff)$/i, '').trim(),
        variantLabel: label,
        prio,
      });
      continue;
    }

    put(`suf:${it.packId}:${normalizeStem(name)}:${lc}`, {
      it,
      baseName: name,
      variantLabel: '默认',
      prio: 1,
    });
  }

  const collapsed = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => (a.prio - b.prio) || String(a.it.name || '').localeCompare(String(b.it.name || '')));
    if (arr.length === 1) {
      const only = arr[0].it;
      collapsed.push({
        ...only,
        variants: [{ ...only, variantLabel: arr[0].variantLabel }],
      });
      continue;
    }
    const head = arr[0];
    collapsed.push({
      ...head.it,
      name: head.baseName,
      variants: arr.map(entry => ({ ...entry.it, variantLabel: entry.variantLabel })),
    });
  }
  return collapsed;
}

function getActiveVariant(item) {
  if (!item) return null;
  const list = Array.isArray(item.variants) ? item.variants : null;
  if (!list || list.length <= 1) return list?.[0] || item;
  const chosenId = activeVariantByBaseId.get(item.id);
  return (chosenId && list.find(v => v.id === chosenId)) || list[0];
}

function isItemReviewed(item) {
  if (!item) return false;
  if (reviewedIds.has(item.id)) return true;
  return Array.isArray(item.variants) && item.variants.some(v => reviewedIds.has(v.id));
}

function compareByReviewThenName(a, b) {
  const ra = isItemReviewed(a) ? 1 : 0;
  const rb = isItemReviewed(b) ? 1 : 0;
  if (ra !== rb) return ra - rb;
  return String(a.name || a.id).localeCompare(String(b.name || b.id));
}

function getCategoryRank(cat) {
  const idx = VFX_CATEGORY_ORDER.indexOf(cat);
  return idx >= 0 ? idx : VFX_CATEGORY_ORDER.length;
}

function getAllItems() {
  const defaultBundleId = vfxBundles[0]?.id || 'piloto_studio';
  return [
    ...shurikenBenchSystems.map(item => ({ ...item, kind: 'system' })),
    ...vfxSystems.map(item => ({ ...item, kind: 'system', bundleId: item.bundleId || defaultBundleId })),
    ...vfxMeshes.map(item => ({
      ...item,
      kind: 'mesh',
      bundleId: item.bundleId || defaultBundleId,
      category: item.category || '3D 网格',
      subCategory: item.subCategory || item.pack || '3D 网格',
    })),
    ...vfxTextures.map(item => ({
      ...item,
      kind: 'texture',
      bundleId: item.bundleId || defaultBundleId,
      category: item.category || '序列帧贴图',
      subCategory: item.subCategory || item.pack || '序列帧贴图',
    })),
  ];
}

function getActiveBundleItems() {
  const all = getAllItems();
  if (!activeBundleId) return all;
  return all.filter(item => (item.bundleId || 'piloto_studio') === activeBundleId);
}

function matchesTypeFilter(item, filterVal) {
  if (!filterVal || filterVal === 'all') return true;
  if (filterVal === 'review:pending') return !isItemReviewed(item);
  if (filterVal === 'review:approved') return isItemReviewed(item);
  if (filterVal.startsWith('kind:')) return item.kind === filterVal.slice(5);
  if (filterVal.startsWith('cat:')) return (item.category || '') === filterVal.slice(4);
  return (item.category || '') === filterVal;
}

function getFilteredItems({ ignoreSubtype = false } = {}) {
  const query = searchInput.value.trim().toLowerCase();
  const filterVal = typeFilter?.value || 'all';
  const subVal = ignoreSubtype ? 'all' : (subtypeFilter?.value || 'all');
  const filtered = getActiveBundleItems().filter(item => {
    if (!matchesTypeFilter(item, filterVal)) return false;
    if (subVal.startsWith('sub:') && (item.subCategory || item.category || '') !== subVal.slice(4)) return false;
    if (!query) return true;
    return (item.name || '').toLowerCase().includes(query)
      || (item.assetName || '').toLowerCase().includes(query)
      || (item.pack || '').toLowerCase().includes(query)
      || (item.id || '').toLowerCase().includes(query)
      || (item.category || '').toLowerCase().includes(query)
      || (item.subCategory || '').toLowerCase().includes(query)
      || (item.relSource || '').toLowerCase().includes(query)
      || (Array.isArray(item.variants) && item.variants.some(v =>
        (v.name || '').toLowerCase().includes(query)
        || (v.id || '').toLowerCase().includes(query)
        || (v.variantLabel || '').toLowerCase().includes(query)));
  });
  const catHasPending = new Map();
  for (const item of filtered) {
    const cat = item.category || (item.kind === 'mesh' ? '3D 网格' : '序列帧贴图');
    if (!catHasPending.has(cat)) catHasPending.set(cat, false);
    if (!isItemReviewed(item)) catHasPending.set(cat, true);
  }
  return filtered.sort((a, b) => {
    const ca = a.category || (a.kind === 'mesh' ? '3D 网格' : '序列帧贴图');
    const cb = b.category || (b.kind === 'mesh' ? '3D 网格' : '序列帧贴图');
    const pa = catHasPending.get(ca) ? 0 : 1;
    const pb = catHasPending.get(cb) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const rankDiff = getCategoryRank(ca) - getCategoryRank(cb);
    if (rankDiff !== 0) return rankDiff;
    const catDiff = ca.localeCompare(cb);
    if (catDiff !== 0) return catDiff;
    const subDiff = String(a.subCategory || '').localeCompare(String(b.subCategory || ''), 'zh-Hans-CN');
    if (subDiff !== 0) return subDiff;
    return compareByReviewThenName(a, b);
  });
}

function renderBundleTabs() {
  if (!bundleTabsEl) return;
  const all = getAllItems();
  const countsByBundle = new Map();
  for (const item of all) {
    const bId = item.bundleId || 'piloto_studio';
    countsByBundle.set(bId, (countsByBundle.get(bId) || 0) + 1);
  }
  bundleTabsEl.replaceChildren();
  if (vfxBundles.length === 0) {
    bundleTabsEl.hidden = true;
    return;
  }
  for (const bundle of vfxBundles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hgame-vfx-bundle-tab';
    btn.setAttribute('role', 'tab');
    btn.dataset.bundleId = bundle.id;
    const isSel = bundle.id === activeBundleId;
    btn.setAttribute('aria-selected', String(isSel));
    btn.tabIndex = isSel ? 0 : -1;
    const cnt = countsByBundle.get(bundle.id) ?? bundle.effectCount ?? 0;
    btn.textContent = `${bundle.name} (${cnt})`;
    btn.title = `${bundle.name} · ${cnt} 组特效`;
    btn.addEventListener('click', () => {
      if (bundle.id === activeBundleId) return;
      void switchBundle(bundle.id);
    });
    bundleTabsEl.appendChild(btn);
  }
  bundleTabsEl.hidden = false;
}

async function switchBundle(bundleId) {
  if (!bundleId || bundleId === activeBundleId) return;
  activeBundleId = bundleId;
  if (typeFilter) typeFilter.value = 'all';
  if (subtypeFilter) subtypeFilter.value = 'all';
  renderBundleTabs();
  populateCategoryFilter();
  populateSubtypeFilter();
  const filtered = getFilteredItems();
  if (filtered.length > 0) {
    const firstPending = filtered.find(it => !isItemReviewed(it)) || filtered[0];
    activeSelection = { kind: firstPending.kind, id: firstPending.id };
    applyItemDefaults(firstPending);
  } else {
    activeSelection = { kind: '', id: '' };
  }
  renderList();
  await loadCurrentVfx();
}

function populateCategoryFilter() {
  const pool = getActiveBundleItems();
  const counts = new Map();
  let pendingCnt = 0;
  let approvedCnt = 0;
  let meshCnt = 0;
  let texCnt = 0;
  for (const item of pool) {
    if (isItemReviewed(item)) approvedCnt++;
    else pendingCnt++;
    if (item.kind === 'mesh') meshCnt++;
    else if (item.kind === 'texture') texCnt++;
    const cat = item.category || '范围爆破';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  const prev = typeFilter.value || 'all';
  typeFilter.replaceChildren();
  const addOpt = (val, text) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    typeFilter.appendChild(opt);
  };
  addOpt('all', `全部大类 (${pool.length})`);
  addOpt('review:pending', `待审核 (${pendingCnt})`);
  addOpt('review:approved', `已通过 (${approvedCnt})`);
  if (meshCnt > 0) addOpt('kind:mesh', `3D 网格 (${meshCnt})`);
  if (texCnt > 0) addOpt('kind:texture', `序列帧贴图 (${texCnt})`);
  const ordered = [
    ...VFX_CATEGORY_ORDER.filter(c => counts.has(c)),
    ...[...counts.keys()].filter(c => !VFX_CATEGORY_ORDER.includes(c)).sort(),
  ];
  for (const cat of ordered) {
    addOpt(`cat:${cat}`, `${cat} (${counts.get(cat)})`);
  }
  const hasPrev = [...typeFilter.options].some(o => o.value === prev);
  typeFilter.value = hasPrev ? prev : 'all';
}

function populateSubtypeFilter() {
  if (!subtypeFilter) return;
  const filterVal = typeFilter?.value || 'all';
  const pool = getActiveBundleItems().filter(item => matchesTypeFilter(item, filterVal));
  const counts = new Map();
  for (const item of pool) {
    const sub = item.subCategory || item.category || '通用';
    counts.set(sub, (counts.get(sub) || 0) + 1);
  }
  const prev = subtypeFilter.value || 'all';
  subtypeFilter.replaceChildren();
  const addOpt = (val, text) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    subtypeFilter.appendChild(opt);
  };
  addOpt('all', `全部细分 (${pool.length})`);
  const sortedSubs = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  for (const sub of sortedSubs) {
    addOpt(`sub:${sub}`, `${sub} (${counts.get(sub)})`);
  }
  const hasPrev = [...subtypeFilter.options].some(o => o.value === prev);
  subtypeFilter.value = hasPrev ? prev : 'all';
}

function getCurrentItem() {
  const all = getAllItems();
  return all.find(item => item.kind === activeSelection.kind && item.id === activeSelection.id)
    || getFilteredItems()[0]
    || all[0]
    || null;
}

function inferGridForItem(item) {
  if (!item || item.kind !== 'texture') return [1, 1];
  const val = gridSelect.value || 'auto';
  if (val !== 'auto') {
    const [c, r] = val.split('x').map(n => Math.max(1, Number.parseInt(n, 10) || 1));
    return [c, r];
  }
  const cols = Number(item.columns ?? item.cols);
  const rows = Number(item.rows);
  if (cols >= 1 && rows >= 1 && (cols > 1 || rows > 1)) return [cols, rows];
  const text = `${item.id || ''} ${item.name || ''}`;
  if (/6x3/i.test(text)) return [6, 3];
  if (/8x8|64f/i.test(text)) return [8, 8];
  if (/5x5|25f/i.test(text)) return [5, 5];
  if (/4seq|4sequence|4x4|16f|flipbook/i.test(text)) return [4, 4];
  if (/4x1/i.test(text)) return [4, 1];
  if (/2x2|4f/i.test(text)) return [2, 2];
  return [1, 1];
}

function inferPlaneModeForItem(item) {
  const selected = planeModeSelect?.value || 'auto';
  if (selected !== 'auto') return selected;
  const text = `${item?.id || ''} ${item?.name || ''} ${item?.category || ''}`;
  if (/(circle|ring|aura|shockwave|ground|runecircle|法阵|光环)/i.test(text)) return 'ground';
  return 'billboard';
}

function suggestBlendForItem(item) {
  if (item?.blend === 'normal' || item?.blend === 'additive') return item.blend;
  const text = `${item?.id || ''} ${item?.name || ''}`;
  return /(smoke|mist|cloud|dust|blood|ink|noise|alpha|debris|_ab)/i.test(text) ? 'normal' : 'additive';
}

function applyItemDefaults(item) {
  if (!item) return;
  if (item.kind === 'system') {
    const primaryColor = item.hgamePreset?.color || '#ffffff';
    colorInput.value = /^#[0-9a-f]{6}$/i.test(primaryColor) ? primaryColor : '#ffffff';
    return;
  }
  if (item.kind === 'mesh') {
    colorInput.value = '#ffffff';
    return;
  }
  gridSelect.value = 'auto';
  if (planeModeSelect) planeModeSelect.value = 'auto';
  fpsInput.value = String(item.fps || 12);
  blendSelect.value = suggestBlendForItem(item);
  colorInput.value = '#ffffff';
}

function getActiveFrameCount(item, cols, rows) {
  const gridTotal = Math.max(1, cols * rows);
  if (gridSelect.value === 'auto' && Number(item?.frameCount) > 0) {
    return Math.min(gridTotal, Number(item.frameCount));
  }
  return gridTotal;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function renderList() {
  const items = getFilteredItems();
  listEl.replaceChildren();

  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'hgame-list-empty';
    p.textContent = getAllItems().length === 0 ? '暂无特效资产。' : '没有匹配的特效资源。';
    listEl.append(p);
    return;
  }

  if (!items.some(item => item.kind === activeSelection.kind && item.id === activeSelection.id)) {
    activeSelection = { kind: items[0].kind, id: items[0].id };
    applyItemDefaults(items[0]);
  }

  const byGroup = new Map();
  const filterVal = typeFilter?.value || 'all';
  const showSubOnlyHeading = filterVal.startsWith('cat:');
  for (const item of items) {
    const cat = item.category || (item.kind === 'mesh' ? '3D 网格' : '序列帧贴图');
    const sub = item.subCategory || '';
    const groupKey = showSubOnlyHeading && sub
      ? sub
      : (sub && sub !== cat ? `${cat} · ${sub}` : cat);
    if (!byGroup.has(groupKey)) byGroup.set(groupKey, { cat, sub, items: [] });
    byGroup.get(groupKey).items.push(item);
  }

  for (const grp of byGroup.values()) {
    grp.items.sort(compareByReviewThenName);
  }

  const groupKeys = [...byGroup.keys()].sort((a, b) => {
    const ga = byGroup.get(a);
    const gb = byGroup.get(b);
    const aPending = ga.items.some(it => !isItemReviewed(it)) ? 0 : 1;
    const bPending = gb.items.some(it => !isItemReviewed(it)) ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    const rankDiff = getCategoryRank(ga.cat) - getCategoryRank(gb.cat);
    if (rankDiff !== 0) return rankDiff;
    const catDiff = ga.cat.localeCompare(gb.cat);
    if (catDiff !== 0) return catDiff;
    return a.localeCompare(b, 'zh-Hans-CN');
  });

  for (const key of groupKeys) {
    const groupItems = byGroup.get(key).items;
    const heading = document.createElement('div');
    heading.className = 'hgame-list-heading';
    heading.textContent = `${key} (${groupItems.length})`;
    listEl.append(heading);

    for (const item of groupItems) {
      const selected = item.kind === activeSelection.kind && item.id === activeSelection.id;
      const reviewed = isItemReviewed(item);
      const baseBadge = item.kind === 'system'
        ? (item.sourceType === 'niagara' ? 'NS' : 'VFX')
        : (item.kind === 'mesh' ? '3D' : 'TEX');
      const { button } = createSidebarSquareCard({
        name: item.name || item.id,
        thumbUrl: item.kind === 'texture' ? item.url : (item.thumbnail || ''),
        badge: reviewed ? '✓' : baseBadge,
        accentColor: reviewed ? '#4ade80' : (item.kind === 'system' ? (item.hgamePreset?.color || '#d5e4b4') : ''),
        active: selected,
        className: reviewed ? 'hgame-list-item is-reviewed' : 'hgame-list-item',
        onClick: () => {
          activeSelection = { kind: item.kind, id: item.id };
          applyItemDefaults(item);
          renderList();
          void loadCurrentVfx();
        },
      });
      listEl.append(button);
    }
  }
}

function ensureViewport() {
  if (!viewport) {
    viewport = createThreeViewport(vfxStage, { background: 0x0f140f, grid: true, shadows: false });
    viewport.camera.position.set(3.2, 2.5, 4.2);
    viewport.controls.target.set(0, 0.7, 0);
    viewport.controls.update();
  }
  return viewport;
}

const benchDepthSizeVec = new THREE.Vector2();
const benchPostSizeVec = new THREE.Vector2();

function ensureBenchStage(vp, enabled) {
  const sc = vp.scene;
  if (!sc.userData._vfxOrigSaved) {
    sc.userData._vfxOrigSaved = {
      bg: sc.background ? sc.background.clone() : new THREE.Color(0x0f140f),
      gridVis: vp.gridHelper ? vp.gridHelper.visible : true,
      lights: sc.children.filter(c => c.isLight).map(l => ({ light: l, intensity: l.intensity })),
    };
  }
  const orig = sc.userData._vfxOrigSaved;
  if (enabled) {
    if (!benchStageActive) {
      sc.background = new THREE.Color(0x585c64);
      for (const entry of orig.lights) entry.light.intensity = 0;
      if (!benchStudioAmbient) {
        benchStudioAmbient = new THREE.AmbientLight(0xffffff, 1.0);
        sc.add(benchStudioAmbient);
      }
      if (!benchStudioDir) {
        benchStudioDir = new THREE.DirectionalLight(0xffffff, 0.75);
        benchStudioDir.position.set(8, 16, 10);
        sc.add(benchStudioDir);
      }
      benchStudioAmbient.visible = true;
      benchStudioDir.visible = true;
      if (vp.gridHelper) vp.gridHelper.visible = false;
      if (!benchStudioGrid) {
        benchStudioGrid = new THREE.GridHelper(64, 64, 0x82868e, 0x686c74);
        benchStudioGrid.position.y = 0.005;
        if (benchStudioGrid.material) benchStudioGrid.material.depthWrite = false;
        sc.add(benchStudioGrid);
      }
      if (!benchDepthFloor) {
        benchDepthFloor = new THREE.Mesh(
          new THREE.PlaneGeometry(64, 64),
          new THREE.MeshBasicMaterial({ color: 0x000000 }),
        );
        benchDepthFloor.rotation.x = -Math.PI * 0.5;
        benchDepthFloor.position.y = -0.35;
        benchDepthFloor.layers.set(1);
        sc.add(benchDepthFloor);
      }
      benchStageActive = true;
    }
    if (benchStudioGrid) benchStudioGrid.visible = gridToggle ? gridToggle.checked : true;
  } else if (benchStageActive) {
    sc.background = orig.bg.clone();
    for (const entry of orig.lights) entry.light.intensity = entry.intensity;
    if (benchStudioAmbient) benchStudioAmbient.visible = false;
    if (benchStudioDir) benchStudioDir.visible = false;
    if (benchStudioGrid) benchStudioGrid.visible = false;
    if (vp.gridHelper) vp.gridHelper.visible = orig.gridVis;
    benchStageActive = false;
  }
}

function ensureBenchDepthRT(vp) {
  vp.renderer.getDrawingBufferSize(benchDepthSizeVec);
  const w = Math.max(1, benchDepthSizeVec.x | 0);
  const h = Math.max(1, benchDepthSizeVec.y | 0);
  if (!benchDepthRT || benchDepthRT.width !== w || benchDepthRT.height !== h) {
    benchDepthRT?.dispose?.();
    benchDepthRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    benchDepthRT.depthTexture = new THREE.DepthTexture(w, h);
    benchDepthRT.depthTexture.type = THREE.UnsignedIntType;
  }
  return { rt: benchDepthRT, w, h };
}

function ensureBenchPostPipeline(vp) {
  vp.renderer.getDrawingBufferSize(benchPostSizeVec);
  const w = Math.max(1, benchPostSizeVec.x | 0);
  const h = Math.max(1, benchPostSizeVec.y | 0);
  if (!benchPostPipeline) {
    benchPostPipeline = createPostPipeline3D({
      THREE,
      renderer: vp.renderer,
      width: w,
      height: h,
      preset: {
        bloom: true,
        ssao: false,
        ssr: false,
        gi: false,
        volumetric: false,
        contactShadows: false,
        fxaa: true,
        sharpness: 0,
        vignette: 0,
      },
      toneMapping: 'agx',
      exposure: 0.95,
      bloomStrength: 0.18,
      bloomThreshold: 1.0,
      bloomSoftKnee: 0.5,
      saturation: 0.85,
      vignette: 0,
      sharpness: 0,
    });
    vp.setOnResize(() => {
      vp.renderer.getDrawingBufferSize(benchPostSizeVec);
      benchPostPipeline?.resize?.(Math.max(1, benchPostSizeVec.x | 0), Math.max(1, benchPostSizeVec.y | 0));
    });
  }
  return benchPostPipeline;
}

const benchExtraPasses = {
  before: [{ id: 'vfx-warp-prep', execute: () => hgameVfx?.prepareDistortionBeforeWorld?.() }],
  afterWorld: [{ id: 'vfx-warp-pass', execute: () => hgameVfx?.renderDistortionPass?.(viewport?.renderer, viewport?.scene, viewport?.camera) }],
};

function normalizeBenchQuality(raw) {
  if (raw === 'med') return 'medium';
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  return 'high';
}

function renderBenchScene(vp) {
  const qTier = normalizeBenchQuality(qualitySelect?.value || 'high');
  if (qTier !== 'low' && hgameVfx) {
    const { rt, w, h } = ensureBenchDepthRT(vp);
    const prevMask = vp.camera.layers.mask;
    vp.camera.layers.set(1);
    vp.renderer.setRenderTarget(rt);
    vp.renderer.clear();
    vp.renderer.render(vp.scene, vp.camera);
    vp.renderer.setRenderTarget(null);
    vp.camera.layers.mask = prevMask;
    hgameVfx.setDepthTexture(rt.depthTexture, {
      near: vp.camera.near,
      far: vp.camera.far,
      width: w,
      height: h,
      softFade: 0.45,
    });
  } else {
    hgameVfx?.setDepthTexture?.(null);
  }

  const pipe = qTier !== 'low' ? ensureBenchPostPipeline(vp) : null;
  const prevAutoReset = vp.renderer.info.autoReset;
  vp.renderer.info.autoReset = false;
  vp.renderer.info.reset();
  if (pipe?.supported) {
    vp.renderer.toneMapping = THREE.NoToneMapping;
    pipe.setState({
      toneMapping: 'agx',
      exposure: 0.95,
      saturation: 0.85,
      bloom: bloomToggle ? bloomToggle.checked : true,
      bloomStrength: qTier === 'high' ? 0.18 : 0.12,
      bloomThreshold: 1.0,
      bloomSoftKnee: 0.5,
      fxaa: qTier === 'high',
    });
    pipe.render(vp.scene, vp.camera, { dt: benchSimDt, extraPasses: benchExtraPasses });
  } else {
    vp.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if (hgameVfx?.renderWithDistortion) {
      hgameVfx.renderWithDistortion(vp.renderer, vp.scene, vp.camera);
    } else {
      vp.renderer.render(vp.scene, vp.camera);
    }
  }
  benchLastDrawCalls = vp.renderer.info.render.calls;
  vp.renderer.info.autoReset = prevAutoReset;
}

function disposeSimulation({ keepBench = false } = {}) {
  for (const em of simEmitters) {
    for (const p of em.pool) {
      if (p.mesh) {
        em.group.remove(p.mesh);
        if (!p.isSharedGeo && p.mesh.geometry) p.mesh.geometry.dispose();
        p.material?.dispose?.();
      }
    }
    em.sharedGeo?.dispose?.();
    em.ownedTexture?.dispose?.();
    stageRoot?.remove(em.group);
  }
  simEmitters = [];
  simElapsed = 0;
  simLoopCooldown = 0;
  activeBenchHandle = null;
  activeBenchRecipe = null;
  benchReplayCooldown = 0;
  benchFrameCount = 0;
  benchMsAccum = 0;
  benchLastDrawCalls = 0;

  if (hgameMeshPreview) {
    stageRoot?.remove(hgameMeshPreview);
    disposeObject3D(hgameMeshPreview);
    hgameMeshPreview = null;
  }
  if (keepBench) {
    hgameVfx?.reset?.();
    if (viewport) ensureBenchStage(viewport, true);
  } else {
    viewport?.setRenderOverride(null);
    if (viewport) {
      ensureBenchStage(viewport, false);
      viewport.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    if (hgameVfx) {
      hgameVfx.dispose();
      hgameVfx = null;
    }
    hgameVfxIsBench = false;
    registeredBenchAliases.clear();
    activeBenchAtlasPackId = '';
  }
  hgameFireTimer = 0;
}

function clearStageRoot({ keepBench = false } = {}) {
  disposeSimulation({ keepBench });
  if (stageRoot && viewport) {
    viewport.scene.remove(stageRoot);
    disposeObject3D(stageRoot);
  }
  stageRoot = null;
  if (activeTexture) {
    activeTexture.dispose();
    activeTexture = null;
  }
  activeTextureMaterial = null;
  activeTexturePlane = null;
  animTimer = 0;
  currentFrame = 0;
}

function updateTextureUv(item) {
  if (!activeTexture || !item || item.kind === 'mesh' || item.kind === 'system') return;
  const [cols, rows] = inferGridForItem(item);
  const total = getActiveFrameCount(item, cols, rows);
  const frame = ((currentFrame % total) + total) % total;
  const col = frame % cols;
  const row = Math.floor(frame / cols);
  activeTexture.repeat.set(1 / cols, 1 / rows);
  activeTexture.offset.set(col / cols, 1 - (row + 1) / rows);
}

function getProceduralTexture(shape) {
  if (simProcTexCache.has(shape)) return simProcTexCache.get(shape);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const cx = 64;
  const cy = 64;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.68)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  simProcTexCache.set(shape, tex);
  return tex;
}

async function loadTextureCached(url) {
  if (!url) return null;
  if (simTexCache.has(url)) return simTexCache.get(url);
  const tex = await texLoader.loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  simTexCache.set(url, tex);
  return tex;
}

async function loadVfxMeshCached(url) {
  if (!url) return null;
  if (simMeshCache.has(url)) return simMeshCache.get(url);
  const gltf = await gltfLoader.loadAsync(url);
  normalizeUnrealSceneMaterials(gltf.scene);
  simMeshCache.set(url, gltf.scene);
  return gltf.scene;
}

function applyAppearanceToStage() {
  const tint = new THREE.Color(colorInput.value || '#ffffff');
  if (activeTextureMaterial) {
    activeTextureMaterial.color.copy(tint);
    activeTextureMaterial.blending = blendSelect.value === 'normal'
      ? THREE.NormalBlending
      : THREE.AdditiveBlending;
    activeTextureMaterial.needsUpdate = true;
  } else if (stageRoot) {
    const item = getCurrentItem();
    if (item?.kind === 'mesh') {
      stageRoot.traverse(child => {
        if (!child.isMesh || !child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (m.color) m.color.copy(tint);
          if (m.emissive && m.emissive.getHex() > 0) m.emissive.copy(tint);
        }
      });
    }
  }
}

function pickSubmeshGeometry(gltfScene, aliasName) {
  const meshes = [];
  gltfScene.traverse((c) => {
    if (c.isMesh && c.geometry) meshes.push({ name: c.name || '', geo: c.geometry });
  });
  if (meshes.length === 0) return null;
  if (meshes.length === 1) return meshes[0].geo;
  const lowAlias = String(aliasName || '').toLowerCase();
  const subIdx = lowAlias.indexOf('__sub_');
  if (subIdx !== -1) {
    const wantSub = lowAlias.slice(subIdx + 6);
    const subMatch = meshes.find((x) => x.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') === wantSub);
    if (subMatch) return subMatch.geo;
  }
  if (lowAlias.includes('floordust') && !lowAlias.includes('low')) {
    const m = meshes.find((x) => /floor/i.test(x.name));
    if (m) return m.geo;
  }
  if (lowAlias.includes('low')) {
    const m = meshes.find((x) => /sphere/i.test(x.name));
    if (m) return m.geo;
  }
  if (lowAlias.includes('wind') || lowAlias.includes('burst')) {
    const m = meshes.find((x) => /burst/i.test(x.name));
    if (m) return m.geo;
  }
  if (lowAlias.includes('body') || lowAlias.includes('warpbeam')) {
    const m = meshes.find((x) => /body/i.test(x.name));
    if (m) return m.geo;
  }
  if (lowAlias.includes('head')) {
    const m = meshes.find((x) => /head/i.test(x.name));
    if (m) return m.geo;
  }
  if (lowAlias.includes('base')) {
    const m = meshes.find((x) => /base/i.test(x.name));
    if (m) return m.geo;
  }
  return meshes[0].geo;
}

function loadBenchAtlasTexture(url) {
  return new Promise((resolve, reject) => {
    texLoader.load(
      url,
      (t) => {
        t.colorSpace = THREE.NoColorSpace;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.generateMipmaps = false;
        t.needsUpdate = true;
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}

async function ensureBenchPackAssets(packId) {
  const pack = vfxPacksById.get(packId);
  if (!pack) throw new Error(`未知特效包: ${packId}`);
  if (benchPackCache.has(packId)) return benchPackCache.get(packId);
  const atlasImgUrl = `${vfxBaseUrl}/${pack.atlasImage}`;
  const atlasMetaUrl = `${vfxBaseUrl}/${pack.atlasMeta}`;
  const [atlasMeta, atlasTex] = await Promise.all([
    fetch(atlasMetaUrl).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    loadBenchAtlasTexture(atlasImgUrl),
  ]);
  const entry = { pack, atlasMeta, atlasTex };
  benchPackCache.set(packId, entry);
  return entry;
}

async function ensureBenchMeshesLoaded(vfxSys, meshAliases) {
  if (!registeredBenchAliases.has('conesmall_tophat')) {
    let cached = benchGlbCache.get('conesmall_tophat');
    if (!cached) {
      const tophatGeo = new THREE.CylinderGeometry(0.35, 0.84, 0.34, 24, 1, true);
      tophatGeo.translate(0, -0.15, 0);
      cached = { geo: tophatGeo };
      benchGlbCache.set('conesmall_tophat', cached);
    }
    vfxSys.registerMesh('conesmall_tophat', cached.geo);
    registeredBenchAliases.add('conesmall_tophat');
  }
  const neededBase = new Set(Object.values(meshAliases || {}));
  const pending = Object.entries(vfxMeshIndex).filter(([k]) => neededBase.has(k) && !benchGlbCache.has(k));
  if (pending.length > 0) {
    await Promise.all(pending.map(async ([mkey, info]) => {
      if (!benchGlbInflight.has(mkey)) {
        const url = `${vfxBaseUrl}/${info.file}`;
        benchGlbInflight.set(
          mkey,
          fetch(url)
            .then((r) => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.arrayBuffer();
            })
            .then((buf) => gltfLoader.parseAsync(buf, ''))
            .then((gltf) => {
              benchGlbCache.set(mkey, { gltf, info });
              const geo = pickSubmeshGeometry(gltf.scene, mkey);
              if (geo) vfxSys.registerMesh(mkey, geo, { topDownUv: true });
              return benchGlbCache.get(mkey);
            })
            .finally(() => {
              benchGlbInflight.delete(mkey);
            }),
        );
      }
      await benchGlbInflight.get(mkey);
    }));
  }
  for (const baseKey of neededBase) {
    if (registeredBenchAliases.has(baseKey)) continue;
    const cached = benchGlbCache.get(baseKey);
    if (cached?.gltf) {
      const geo = pickSubmeshGeometry(cached.gltf.scene, baseKey);
      if (geo) {
        vfxSys.registerMesh(baseKey, geo, { topDownUv: true });
        registeredBenchAliases.add(baseKey);
      }
    }
  }
  for (const [alias, baseKey] of Object.entries(meshAliases || {})) {
    if (registeredBenchAliases.has(alias)) continue;
    const cached = benchGlbCache.get(baseKey);
    if (cached?.gltf) {
      const geo = pickSubmeshGeometry(cached.gltf.scene, alias);
      if (geo) {
        vfxSys.registerMesh(alias, geo, { topDownUv: true });
        registeredBenchAliases.add(alias);
      }
    }
  }
}

function getEffectiveActiveEnd(r) {
  let maxEnd = 0;
  for (const l of r?.layers || []) {
    const delay = Array.isArray(l.delay) ? Number(l.delay[1] ?? l.delay[0] ?? 0) : Number(l.delay ?? 0);
    const life = Array.isArray(l.life) ? Number(l.life[1] ?? l.life[0] ?? 0.5) : Number(l.life ?? 0.5);
    const spd = Math.max(0.05, Number(l.simulationSpeed ?? 1));
    let burstMax = 0;
    for (const b of l.bursts || []) {
      const bt = Number(b.time ?? 0) + Math.max(0, (Number(b.cycles ?? 1) - 1) * Number(b.interval ?? 0));
      if (bt > burstMax) burstMax = bt;
    }
    const end = delay + (burstMax + life) / spd;
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd > 0 ? Math.min(r.duration || maxEnd, maxEnd) : (r.duration || 3);
}

function frameBenchCamera(vp, effectId) {
  let dist = 12.5;
  let pitch = 0.45;
  let yaw = 0.65;
  let targetY = 1.2;
  if (effectId === 'arpg_arcane_aura') {
    dist = 6.2; pitch = 0.58; yaw = 0.45; targetY = 0.9;
  } else if (effectId === 'arpg_arcane_circle') {
    dist = 11.5; pitch = 0.55; yaw = 0.65; targetY = 1.0;
  } else if (effectId === 'arpg_arcane_cage') {
    dist = 18.0; pitch = 0.50; yaw = 0.65; targetY = 1.8;
  } else if (effectId === 'arpg_arcane_curse') {
    dist = 14.5; pitch = 0.56; yaw = 0.65; targetY = 1.4;
  } else if (effectId === 'bones_spikes') {
    dist = 30.0; pitch = 0.48; yaw = 0.65; targetY = 2.2;
  } else if (effectId === 'deathice_arena_rain_spikes_combo') {
    dist = 18.0; pitch = 0.48; yaw = 0.65; targetY = 1.8;
  }
  const cp = Math.cos(pitch);
  vp.controls.target.set(0, targetY, 0);
  vp.camera.position.set(
    Math.sin(yaw) * cp * dist,
    targetY + Math.sin(pitch) * dist,
    Math.cos(yaw) * cp * dist,
  );
  vp.controls.update();
}

function computeBenchPlayY(recipe, effectId) {
  let yOff = 0.05;
  if (effectId === 'arpg_arcane_cage' || effectId === 'arpg_arcane_circle') {
    let minOffY = 0;
    for (const l of recipe?.layers || []) {
      const oy = Number(l?.offset?.[1] ?? 0);
      if (Number.isFinite(oy) && oy < minOffY) minOffY = oy;
    }
    yOff = Math.max(0.05, -minOffY + 0.05);
  }
  return yOff;
}

function getBenchTelemetryTotals(st) {
  const ap = st?.atlasParticles || {};
  const atlasActive = (ap.normalTotal || 0)
    + (ap.additiveTotal || 0)
    + (ap.multiplyTotal || 0)
    + (ap.premultiplyTotal || 0)
    + (ap.distortionTotal || 0)
    + (ap.renderStateTotal || 0);
  const shurikenActive = st?.shuriken?.activeParticles || 0;
  const meshActive = st?.meshVfx?.activeCount || 0;
  const trailActive = st?.trails?.activeTrails || 0;
  return {
    atlasActive: atlasActive + shurikenActive,
    shurikenActive,
    meshActive,
    trailActive,
    totalActive: atlasActive + shurikenActive + meshActive + trailActive,
    batches: (st?.meshVfx?.instancedBatches || 0) + (st?.shuriken?.activeDrawCalls || 0),
  };
}

function syncControlsVisibility(item) {
  const isTexture = item?.kind === 'texture';
  const isSystem = item?.kind === 'system';
  const isBench = Boolean(item?.isShurikenBench);
  const isEmitterTex = isTexture && activeTextureMode === 'emitter';
  if (modeTabsWrap) modeTabsWrap.hidden = !isSystem || isBench;
  if (copyCodeBtn) copyCodeBtn.hidden = !isSystem;
  if (speedWrap) speedWrap.hidden = !isBench;
  if (reviewWrap) reviewWrap.hidden = !item;
  if (reviewToggle) reviewToggle.checked = isItemReviewed(item);
  if (variantWrap && variantSelect) {
    const variants = Array.isArray(item?.variants) ? item.variants : [];
    if (variants.length > 1) {
      const activeVar = getActiveVariant(item);
      variantSelect.replaceChildren();
      for (const v of variants) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.variantLabel || v.name || v.id;
        variantSelect.appendChild(opt);
      }
      variantSelect.value = activeVar?.id || variants[0].id;
      variantWrap.hidden = false;
    } else {
      variantSelect.replaceChildren();
      variantWrap.hidden = true;
    }
  }
  if (qualityWrap) qualityWrap.hidden = !isBench;
  if (gridToggleWrap) gridToggleWrap.hidden = !isBench;
  if (bloomToggleWrap) bloomToggleWrap.hidden = !isBench;
  if (seqGroupEl) seqGroupEl.hidden = !isTexture;
  if (planeModeWrap) planeModeWrap.hidden = !isTexture;
  gridWrap.hidden = !isTexture || isEmitterTex;
  fpsWrap.hidden = !isTexture || isEmitterTex;
  blendWrap.hidden = !isTexture;
  if (replayBtn) replayBtn.hidden = !(isSystem || isEmitterTex);
  playBtn.textContent = isPlaying ? '暂停' : '播放';

  for (const tab of modeTabEls) {
    const selected = tab.dataset.hgameVfxMode === activeRenderMode;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.tabIndex = selected ? 0 : -1;
  }
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function sampleCurve(curve, t) {
  if (!curve) return 1.0;
  const keys = curve.keys;
  let kVal = 1.0;
  if (Array.isArray(keys) && keys.length > 0) {
    if (t <= keys[0][0]) {
      kVal = keys[0][1];
    } else if (t >= keys[keys.length - 1][0]) {
      kVal = keys[keys.length - 1][1];
    } else {
      for (let i = 0; i < keys.length - 1; i++) {
        const [t0, v0] = keys[i];
        const [t1, v1] = keys[i + 1];
        if (t >= t0 && t <= t1) {
          const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
          kVal = v0 + (v1 - v0) * u;
          break;
        }
      }
    }
  }
  return kVal;
}

function sampleMinMaxCurve(curve, t, randFactor = 0.5) {
  if (!curve) return 0;
  const base = curve.min + (curve.max - curve.min) * randFactor;
  if (curve.mode === 1 || curve.mode === 2) {
    return base * sampleCurve(curve, t);
  }
  return base;
}

function sampleGradientColor(grad, t, outColor) {
  if (!grad) {
    outColor.setRGB(1, 1, 1);
    return 1;
  }
  const cks = grad.colorKeys || [[0, [1, 1, 1]], [1, [1, 1, 1]]];
  let r = 1;
  let g = 1;
  let b = 1;
  if (t <= cks[0][0]) {
    [r, g, b] = cks[0][1];
  } else if (t >= cks[cks.length - 1][0]) {
    [r, g, b] = cks[cks.length - 1][1];
  } else {
    for (let i = 0; i < cks.length - 1; i++) {
      const [t0, c0] = cks[i];
      const [t1, c1] = cks[i + 1];
      if (t >= t0 && t <= t1) {
        const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        r = c0[0] + (c1[0] - c0[0]) * u;
        g = c0[1] + (c1[1] - c0[1]) * u;
        b = c0[2] + (c1[2] - c0[2]) * u;
        break;
      }
    }
  }
  outColor.setRGB(r, g, b, THREE.SRGBColorSpace);

  const aks = grad.alphaKeys || [[0, 1], [1, 1]];
  let a = 1;
  if (t <= aks[0][0]) {
    a = aks[0][1];
  } else if (t >= aks[aks.length - 1][0]) {
    a = aks[aks.length - 1][1];
  } else {
    for (let i = 0; i < aks.length - 1; i++) {
      const [t0, a0] = aks[i];
      const [t1, a1] = aks[i + 1];
      if (t >= t0 && t <= t1) {
        const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        a = a0 + (a1 - a0) * u;
        break;
      }
    }
  }
  return a;
}

function sampleShapeSpawn(shape) {
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3(0, 0, 1);
  if (!shape || !shape.enabled) return { pos, dir };

  const rad = shape.radius ?? 0.5;
  const arcRad = THREE.MathUtils.degToRad(shape.arc ?? 360);

  if (shape.type === 0 || shape.type === 2) {
    // Sphere (0) or Hemisphere (2) in local space (Z+ up)
    const theta = Math.random() * arcRad;
    const zMin = shape.type === 2 ? 0 : -1;
    const z = zMin + Math.random() * (1 - zMin);
    const rXY = Math.sqrt(Math.max(0, 1 - z * z));
    dir.set(rXY * Math.cos(theta), rXY * Math.sin(theta), z).normalize();
    const r = rad * Math.cbrt(Math.random());
    pos.copy(dir).multiplyScalar(r);
  } else if (shape.type === 4) {
    // Cone emitting along +Z
    const halfAngle = THREE.MathUtils.degToRad(shape.angle ?? 25);
    const phi = Math.random() * arcRad;
    const baseR = rad * Math.sqrt(Math.random());
    pos.set(baseR * Math.cos(phi), baseR * Math.sin(phi), 0);
    const tilt = halfAngle * Math.sqrt(Math.random());
    dir.set(Math.sin(tilt) * Math.cos(phi), Math.sin(tilt) * Math.sin(phi), Math.cos(tilt)).normalize();
  } else if (shape.type === 10) {
    // Circle in XY
    const phi = Math.random() * arcRad;
    const r = rad * Math.sqrt(Math.random());
    pos.set(r * Math.cos(phi), r * Math.sin(phi), 0);
    dir.set(Math.cos(phi), Math.sin(phi), 0).normalize();
  } else if (shape.type === 5) {
    // Box
    const sx = shape.scale?.[0] ?? 1;
    const sy = shape.scale?.[1] ?? 1;
    const sz = shape.scale?.[2] ?? 1;
    pos.set((Math.random() - 0.5) * sx, (Math.random() - 0.5) * sy, (Math.random() - 0.5) * sz);
    dir.set(0, 0, 1);
  }

  if (shape.randomDirectionAmount > 0) {
    const rnd = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    dir.lerp(rnd, shape.randomDirectionAmount).normalize();
  }
  return { pos, dir };
}

function spawnVfxParticle(em) {
  const slot = em.pool.find(p => !p.alive);
  if (!slot) return;
  const cfg = em.cfg;

  slot.alive = true;
  slot.age = 0;
  slot.life = Math.max(0.05, randRange(cfg.lifetime?.min ?? 0.5, cfg.lifetime?.max ?? 0.5));
  slot.sizeBase = randRange(cfg.startSize?.min ?? 1, cfg.startSize?.max ?? 1);
  slot.sizeRand = Math.random();
  slot.rotRand = Math.random();
  slot.rotZ = randRange(cfg.startRotation?.min ?? 0, cfg.startRotation?.max ?? 0);

  const { pos, dir } = sampleShapeSpawn(cfg.shape);
  slot.pos.copy(pos);
  const spd = randRange(cfg.startSpeed?.min ?? 0, cfg.startSpeed?.max ?? 0);
  slot.vel.copy(dir).multiplyScalar(spd);

  // Start color
  const sc = cfg.startColor;
  if (sc && sc.mode === 2) {
    const f = Math.random();
    slot.startRgb.setRGB(
      THREE.MathUtils.lerp(sc.colorMin[0], sc.colorMax[0], f),
      THREE.MathUtils.lerp(sc.colorMin[1], sc.colorMax[1], f),
      THREE.MathUtils.lerp(sc.colorMin[2], sc.colorMax[2], f),
      THREE.SRGBColorSpace,
    );
    slot.startAlpha = THREE.MathUtils.lerp(sc.colorMin[3], sc.colorMax[3], f);
  } else if (sc?.colorMax) {
    slot.startRgb.setRGB(sc.colorMax[0], sc.colorMax[1], sc.colorMax[2], THREE.SRGBColorSpace);
    slot.startAlpha = sc.colorMax[3] ?? 1;
  } else {
    slot.startRgb.setRGB(1, 1, 1);
    slot.startAlpha = 1;
  }

  slot.mesh.position.copy(slot.pos);
  slot.mesh.visible = true;
}

function resetEmitterTimers(em) {
  em.emTime = 0;
  em.spawnAcc = 0;
  em.burstStates = (em.cfg.bursts || []).map(b => ({
    ...b,
    fired: 0,
    nextTime: b.time || 0,
  }));
}

async function buildVfxSimulation(emitters, targetRoot) {
  for (const cfg of emitters) {
    const group = new THREE.Group();
    if (cfg.transform) {
      group.position.set(...(cfg.transform.position || [0, 0, 0]));
      group.quaternion.set(...(cfg.transform.quaternion || [0, 0, 0, 1]));
      group.scale.set(...(cfg.transform.scale || [1, 1, 1]));
    }
    targetRoot.add(group);

    const rd = cfg.renderer || {};
    const uv = cfg.uvAnimation;
    const subCols = uv?.tilesX || 1;
    const subRows = uv?.tilesY || 1;

    let tex = null;
    let ownedTexture = null;
    if (rd.textureUrl) {
      try {
        const baseTex = await loadTextureCached(rd.textureUrl);
        if (subCols > 1 || subRows > 1) {
          tex = baseTex.clone();
          tex.needsUpdate = true;
          tex.repeat.set(1 / subCols, 1 / subRows);
          ownedTexture = tex;
        } else {
          tex = baseTex;
        }
      } catch {
        tex = getProceduralTexture('glow');
      }
    } else if (rd.mode !== 4) {
      tex = getProceduralTexture('glow');
    }

    let meshTemplate = null;
    if (rd.mode === 4 && rd.meshKind === 'glb' && rd.meshUrl) {
      try {
        meshTemplate = await loadVfxMeshCached(rd.meshUrl);
      } catch {
        meshTemplate = null;
      }
    }

    const burstTotal = (cfg.bursts || []).reduce((acc, b) => acc + (b.maxCount || 1) * (b.cycles || 1), 0);
    const rateMax = cfg.rateOverTime?.max || 0;
    const ltMax = cfg.lifetime?.max || 1;
    const poolCap = Math.min(96, Math.max(4, Math.ceil(rateMax * ltMax * 1.4) + burstTotal + 2));

    const sharedGeo = meshTemplate ? null : new THREE.PlaneGeometry(1, 1);
    const isAdditive = rd.blend !== 'normal';
    const matTint = rd.tint
      ? new THREE.Color().setRGB(rd.tint[0], rd.tint[1], rd.tint[2], THREE.SRGBColorSpace)
      : new THREE.Color(1, 1, 1);
    const matAlpha = rd.tint?.[3] ?? 1;

    const pool = [];
    for (let i = 0; i < poolCap; i++) {
      let mesh;
      let mat = null;
      if (meshTemplate) {
        mesh = meshTemplate.clone();
        mesh.traverse(ch => {
          if (!ch.isMesh) return;
          const m = new THREE.MeshBasicMaterial({
            map: tex || null,
            color: matTint.clone(),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: isAdditive ? THREE.AdditiveBlending : THREE.NormalBlending,
          });
          ch.material = m;
          mat = m;
        });
      } else {
        mat = new THREE.MeshBasicMaterial({
          map: tex,
          color: matTint.clone(),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: isAdditive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        mesh = new THREE.Mesh(sharedGeo, mat);
      }
      mesh.visible = false;
      group.add(mesh);
      pool.push({
        alive: false,
        age: 0,
        life: 0.5,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        sizeBase: 1,
        sizeRand: 0.5,
        rotRand: 0.5,
        rotZ: 0,
        startRgb: new THREE.Color(1, 1, 1),
        startAlpha: 1,
        mesh,
        material: mat,
        isSharedGeo: !meshTemplate,
      });
    }

    const em = {
      cfg,
      group,
      pool,
      sharedGeo,
      ownedTexture,
      matTint,
      matAlpha,
      subCols,
      subRows,
      hasMeshTemplate: Boolean(meshTemplate),
      emTime: 0,
      spawnAcc: 0,
      burstStates: [],
    };
    resetEmitterTimers(em);
    simEmitters.push(em);

    // Fire t=0 bursts immediately
    stepEmitterEmission(em, 0);
  }
}

function stepEmitterEmission(em, dt) {
  const cfg = em.cfg;
  const delay = cfg.startDelay?.min || 0;
  em.emTime += dt * (cfg.simulationSpeed || 1);
  if (em.emTime < delay) return;
  const localT = em.emTime - delay;
  const dur = cfg.duration || 1.0;

  if (!cfg.looping && localT > dur + 0.001) return;
  const cycleT = cfg.looping ? (localT % dur) : localT;

  // Handle bursts
  for (const b of em.burstStates) {
    const maxCycles = b.cycles || 1;
    while (b.fired < maxCycles && localT >= b.nextTime - 1e-5) {
      const count = Math.round(randRange(b.minCount || 0, b.maxCount || 0));
      for (let i = 0; i < count; i++) spawnVfxParticle(em);
      b.fired += 1;
      b.nextTime += Math.max(0.01, b.interval || 0.01);
    }
  }

  // Handle rateOverTime
  const rate = cfg.rateOverTime?.max || 0;
  if (rate > 0) {
    em.spawnAcc += sampleMinMaxCurve(cfg.rateOverTime, Math.min(1, cycleT / dur), 0.5) * dt;
    while (em.spawnAcc >= 1) {
      em.spawnAcc -= 1;
      spawnVfxParticle(em);
    }
  }
}

const _tmpVec = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpInvQuat = new THREE.Quaternion();
const _tmpMat4 = new THREE.Matrix4();
const _axisX = new THREE.Vector3();
const _axisY = new THREE.Vector3();
const _axisZ = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _worldVel = new THREE.Vector3();
const _colGrad = new THREE.Color();
const _colWork = new THREE.Color();
const _eulerZ = new THREE.Euler(0, 0, 0, 'XYZ');

function tickVfxEmitters(dt, item) {
  const userTint = new THREE.Color(colorInput.value || '#ffffff');
  const useTintOverride = colorInput.value && colorInput.value.toLowerCase() !== '#ffffff';
  const simLooping = Boolean(item?.loop);

  let anyAlive = false;
  let anyActiveEmission = false;

  for (const em of simEmitters) {
    const cfg = em.cfg;
    const rd = cfg.renderer || {};
    stepEmitterEmission(em, dt);

    if (cfg.looping || em.emTime <= (cfg.startDelay?.min || 0) + (cfg.duration || 1)) {
      anyActiveEmission = true;
    }

    // World gravity transformed into emitter local space
    const gravMod = cfg.gravityModifier?.max || 0;
    if (gravMod !== 0) {
      _tmpInvQuat.copy(em.group.quaternion).invert();
      _tmpVec.set(0, -9.81 * gravMod, 0).applyQuaternion(_tmpInvQuat);
    }

    const totalSub = em.subCols * em.subRows;
    const worldQuat = em.group.getWorldQuaternion(_tmpQuat);
    const invWorldQuat = worldQuat.clone().invert();

    for (const p of em.pool) {
      if (!p.alive) continue;
      p.age += dt * (cfg.simulationSpeed || 1);
      if (p.age >= p.life) {
        p.alive = false;
        p.mesh.visible = false;
        continue;
      }
      anyAlive = true;
      const t = Math.min(1, p.age / p.life);

      // Forces / Gravity
      if (gravMod !== 0) {
        p.vel.addScaledVector(_tmpVec, dt);
      }
      if (cfg.forceOverLifetime) {
        const fx = sampleMinMaxCurve(cfg.forceOverLifetime.x, t, 0.5);
        const fy = sampleMinMaxCurve(cfg.forceOverLifetime.y, t, 0.5);
        const fz = -sampleMinMaxCurve(cfg.forceOverLifetime.z, t, 0.5);
        p.vel.x += fx * dt;
        p.vel.y += fy * dt;
        p.vel.z += fz * dt;
      }

      // Integrate velocity
      p.pos.addScaledVector(p.vel, dt);
      if (cfg.velocityOverLifetime) {
        const vx = sampleMinMaxCurve(cfg.velocityOverLifetime.x, t, 0.5);
        const vy = sampleMinMaxCurve(cfg.velocityOverLifetime.y, t, 0.5);
        const vz = -sampleMinMaxCurve(cfg.velocityOverLifetime.z, t, 0.5);
        p.pos.x += vx * dt;
        p.pos.y += vy * dt;
        p.pos.z += vz * dt;
      }
      p.mesh.position.copy(p.pos);

      // Rotation over lifetime (local Z spin around emitter Z)
      if (cfg.rotationOverLifetime?.z) {
        const rotRate = sampleMinMaxCurve(cfg.rotationOverLifetime.z, t, p.rotRand);
        p.rotZ += rotRate * dt;
      }

      // Size over lifetime
      let sx = p.sizeBase;
      let sy = p.sizeBase;
      let sz = p.sizeBase;
      if (cfg.sizeOverLifetime) {
        sx *= sampleMinMaxCurve(cfg.sizeOverLifetime.x, t, p.sizeRand);
        sy *= sampleMinMaxCurve(cfg.sizeOverLifetime.y, t, p.sizeRand);
        sz *= sampleMinMaxCurve(cfg.sizeOverLifetime.z, t, p.sizeRand);
      }

      if (em.hasMeshTemplate) {
        const gs = rd.meshGlobalScale || 1.0;
        p.mesh.scale.set(Math.max(0.005, sx * gs), Math.max(0.005, sy * gs), Math.max(0.005, sz * gs));
        p.mesh.rotation.set(0, 0, -p.rotZ);
      } else if (rd.mode === 4) {
        // Mesh Quad in emitter local XY plane
        p.mesh.scale.set(Math.max(0.005, sx), Math.max(0.005, sy), 1);
        p.mesh.rotation.set(0, 0, -p.rotZ);
      } else if (rd.mode === 1 && viewport?.camera) {
        // StretchedBillboard: align quad X along velocity in view plane
        _worldVel.copy(p.vel).applyQuaternion(worldQuat);
        const speed = _worldVel.length();
        if (speed > 1e-4) {
          p.mesh.getWorldPosition(_worldPos);
          _toCam.copy(viewport.camera.position).sub(_worldPos).normalize();
          _axisX.copy(_worldVel).normalize();
          _axisY.crossVectors(_toCam, _axisX);
          if (_axisY.lengthSq() < 1e-5) _axisY.set(0, 1, 0);
          _axisY.normalize();
          _axisZ.crossVectors(_axisX, _axisY).normalize();
          _tmpMat4.makeBasis(_axisX, _axisY, _axisZ);
          p.mesh.quaternion.setFromRotationMatrix(_tmpMat4).premultiply(invWorldQuat);
        } else {
          p.mesh.quaternion.copy(viewport.camera.quaternion).premultiply(invWorldQuat);
        }
        const stretchLen = sx * (rd.lengthScale ?? 1) + speed * (rd.velocityScale ?? 0) * 0.25;
        p.mesh.scale.set(Math.max(0.01, stretchLen), Math.max(0.01, sy), 1);
      } else if (viewport?.camera) {
        // Standard Billboard (mode 0) facing camera + local Z spin
        _eulerZ.set(0, 0, -p.rotZ);
        _tmpMat4.makeRotationFromEuler(_eulerZ);
        p.mesh.quaternion
          .copy(viewport.camera.quaternion)
          .premultiply(invWorldQuat)
          .multiply(new THREE.Quaternion().setFromRotationMatrix(_tmpMat4));
        p.mesh.scale.set(Math.max(0.005, sx), Math.max(0.005, sy), 1);
      }

      // Color = startColor * colorOverLifetime * matTint
      const lifeAlpha = cfg.colorOverLifetime ? sampleGradientColor(cfg.colorOverLifetime.gradient, t, _colGrad) : 1;
      if (!cfg.colorOverLifetime) _colGrad.setRGB(1, 1, 1);

      _colWork.copy(p.startRgb).multiply(_colGrad).multiply(em.matTint);
      if (useTintOverride) _colWork.lerp(userTint, 0.75);
      const finalAlpha = Math.max(0, Math.min(1, p.startAlpha * lifeAlpha * em.matAlpha));

      p.mesh.traverse?.(ch => {
        if (ch.material) {
          ch.material.color?.copy(_colWork);
          ch.material.opacity = finalAlpha;
        }
      });
      if (p.material) {
        p.material.color.copy(_colWork);
        p.material.opacity = finalAlpha;
        if (totalSub > 1 && p.material.map) {
          const cycles = cfg.uvAnimation?.cycles || 1;
          const u = (t * cycles) % 1;
          const frame = Math.min(totalSub - 1, Math.floor(u * totalSub));
          const col = frame % em.subCols;
          const row = Math.floor(frame / em.subCols);
          p.material.map.offset.set(col / em.subCols, 1 - (row + 1) / em.subRows);
        }
      }
    }
  }

  // Auto-replay one-shot bursts smoothly for preview inspection
  if (!simLooping && !anyAlive && !anyActiveEmission) {
    simLoopCooldown += dt;
    if (simLoopCooldown >= 0.45) {
      simLoopCooldown = 0;
      for (const em of simEmitters) {
        resetEmitterTimers(em);
        stepEmitterEmission(em, 0);
      }
      tickVfxEmitters(0.016, item);
    }
  }
}

function triggerHGamePreset(item) {
  if (!hgameVfx || !item?.hgamePreset) return;
  const p = item.hgamePreset;
  const tintHex = colorInput.value && colorInput.value !== '#ffffff'
    ? Number.parseInt(colorInput.value.slice(1), 16)
    : (p.colorInt ?? 0xfb923c);

  if (p.recipe === 'slash') {
    hgameVfx.slashArc({
      x: 0, y: 0.9, z: 0,
      yawRad: (simElapsed * 1.4) % (Math.PI * 2),
      sweepRad: 2.3,
      radius: 1.9,
      color: tintHex,
      duration: 0.28,
    });
  } else if (p.recipe === 'telegraph') {
    hgameVfx.spawnTelegraph({
      shape: 'ring',
      x: 0, y: 0.04, z: 0,
      radius: 1.65,
      innerRatio: 0.65,
      color: tintHex,
      duration: Math.max(0.8, p.durationMax || 1.0),
    });
  }

  hgameVfx.burstParticles({
    x: 0,
    y: p.recipe === 'telegraph' ? 0.2 : 0.9,
    z: 0,
    count: p.count || 20,
    color: tintHex,
    shape: p.shapeId ?? VFX_SHAPE.GLOW_ORB,
    speedMin: p.speedMin || 2.0,
    speedMax: p.speedMax || 6.5,
    sizeStart: p.sizeStart || 0.35,
    sizeEnd: p.sizeEnd || 0.05,
    durationMin: p.durationMin || 0.25,
    durationMax: p.durationMax || 0.65,
    gravity: p.gravity ?? 2.0,
    drag: p.drag ?? 2.2,
    stretch: p.shapeId === VFX_SHAPE.HIT_SPARK ? 1.1 : 0.35,
    additive: p.additive !== false,
  });
}

function replayActiveVfx() {
  const item = getCurrentItem();
  if (!item) return;
  if (item.isShurikenBench && hgameVfx && activeBenchRecipe) {
    const activeVar = getActiveVariant(item) || item;
    hgameVfx.reset();
    benchReplayCooldown = 0;
    const playY = computeBenchPlayY(activeBenchRecipe, activeVar.effectId || activeVar.id);
    activeBenchHandle = hgameVfx.playEffect(activeBenchRecipe.id, { x: 0, y: playY, z: 0, scale: 1 });
    if (viewport?.camera) hgameVfx.setCamera?.(viewport.camera);
    hgameVfx.update(0.016);
    const st = hgameVfx.getStats();
    const totals = getBenchTelemetryTotals(st);
    const qVal = qualitySelect?.value || 'high';
    window.__HGAME_VFX_BENCH__ = {
      id: item.id,
      variantId: activeVar.id,
      effectId: activeBenchRecipe.id,
      packId: activeVar.packId,
      qualityTier: qVal,
      speed: Math.max(0.1, Number(speedSelect?.value || 1.0)),
      activeParticles: totals.atlasActive,
      activeMeshes: totals.meshActive,
      activeTrails: totals.trailActive,
      activeDrawCalls: benchLastDrawCalls,
      hasDistortion: Boolean(hgameVfx.hasActiveDistortion?.()),
      simMs: 0,
      isActive: Boolean(activeBenchHandle?.isActive?.()),
    };
    return;
  }
  if (item.kind === 'system' && activeRenderMode === 'hgame') {
    triggerHGamePreset(item);
    hgameFireTimer = 0;
    return;
  }
  for (const em of simEmitters) {
    for (const p of em.pool) {
      p.alive = false;
      p.mesh.visible = false;
    }
    resetEmitterTimers(em);
    stepEmitterEmission(em, 0);
  }
  simLoopCooldown = 0;
  tickVfxEmitters(0.016, item);
}

function buildHGameSnippet(item) {
  if (item?.isShurikenBench) {
    const activeVar = getActiveVariant(item) || item;
    const eid = activeVar.effectId || activeVar.id;
    return [
      `// Piloto Studio 特效配方: ${activeVar.name || item.name} (${item.category || activeVar.packId})`,
      `import { createVfxSystem } from '../vendor/hgame/vfx/index.js';`,
      ``,
      `const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE, maxAtlasParticles: 4096, maxMeshVfx: 256 });`,
      `// 需提前通过 vfx.setAtlas(packAtlasTex, packAtlasMeta.regions) 与 registerMesh 加载该包依赖`,
      `const recipe = await fetch('${activeVar.recipeUrl}').then(r => r.json());`,
      `vfx.registerEffect(recipe);`,
      `vfx.playEffect('${eid}', { x: 0, y: 0, z: 0, scale: 1 });`,
    ].join('\n');
  }
  const p = item?.hgamePreset || {};
  const colorLit = `0x${(p.color || '#fb923c').replace('#', '')}`;
  const shapeKey = Object.keys(VFX_SHAPE).find(k => VFX_SHAPE[k] === (p.shapeId ?? 0)) || 'GLOW_ORB';
  const lines = [
    `// 来源 Unreal VFX: ${item.assetName || item.id}`,
    `import { createVfxSystem, VFX_SHAPE } from '../vendor/hgame/index.js';`,
    ``,
    `const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE });`,
  ];
  if (p.recipe === 'slash') {
    lines.push(`vfx.slashArc({ x: 0, y: 0.9, z: 0, yawRad: 0, sweepRad: 2.3, radius: 1.9, color: ${colorLit}, duration: 0.28 });`);
  } else if (p.recipe === 'telegraph') {
    lines.push(`vfx.spawnTelegraph({ shape: 'ring', x: 0, y: 0.04, z: 0, radius: 1.65, innerRatio: 0.65, color: ${colorLit}, duration: ${(p.durationMax || 1.0).toFixed(2)} });`);
  }
  lines.push(
    `vfx.burstParticles({`,
    `  x: 0, y: 0.9, z: 0,`,
    `  count: ${p.count || 20},`,
    `  color: ${colorLit},`,
    `  shape: VFX_SHAPE.${shapeKey},`,
    `  speedMin: ${p.speedMin ?? 2.5}, speedMax: ${p.speedMax ?? 7.5},`,
    `  sizeStart: ${p.sizeStart ?? 0.35}, sizeEnd: ${p.sizeEnd ?? 0.05},`,
    `  durationMin: ${p.durationMin ?? 0.25}, durationMax: ${p.durationMax ?? 0.65},`,
    `  gravity: ${p.gravity ?? 0}, drag: ${p.drag ?? 2.2}, additive: ${p.additive !== false}`,
    `});`,
  );
  return lines.join('\n');
}

function tickVfx(dt) {
  const item = getCurrentItem();
  if (!item || !stageRoot || !isPlaying) return;

  simElapsed += dt;

  if (spinInput.checked) {
    stageRoot.rotation.y += dt * 0.65;
  }

  if (item.isShurikenBench && hgameVfx) {
    const t0 = performance.now();
    const speedMul = Math.max(0.1, Number(speedSelect?.value || 1.0));
    const simDt = dt * speedMul;
    benchSimDt = simDt;
    if (viewport?.camera) hgameVfx.setCamera?.(viewport.camera);
    hgameVfx.update(simDt);
    if (!activeBenchRecipe?.loop && activeBenchRecipe) {
      benchReplayCooldown += simDt;
      const cycleLimit = Math.max(1.8, getEffectiveActiveEnd(activeBenchRecipe) + 0.6);
      if (benchReplayCooldown >= cycleLimit) {
        replayActiveVfx();
      }
    }
    const elapsedMs = performance.now() - t0;
    benchLastFrameMs = elapsedMs;
    const st = hgameVfx.getStats();
    const totals = getBenchTelemetryTotals(st);
    const qVal = normalizeBenchQuality(qualitySelect?.value || 'high');
    const activeVar = getActiveVariant(item) || item;
    window.__HGAME_VFX_BENCH__ = {
      id: item.id,
      variantId: activeVar.id,
      effectId: activeBenchRecipe?.id || activeVar.effectId || activeVar.id,
      packId: activeVar.packId,
      qualityTier: qVal,
      speed: speedMul,
      activeParticles: totals.atlasActive,
      activeMeshes: totals.meshActive,
      activeTrails: totals.trailActive,
      activeDrawCalls: benchLastDrawCalls,
      hasDistortion: Boolean(hgameVfx.hasActiveDistortion?.()),
      simMs: Number(elapsedMs.toFixed(3)),
      isActive: Boolean(activeBenchHandle?.isActive?.()),
    };
    benchFrameCount += 1;
    benchMsAccum += elapsedMs;
    if (benchFrameCount >= 12) {
      const avgMs = benchMsAccum / benchFrameCount;
      const distLabel = window.__HGAME_VFX_BENCH__.hasDistortion ? ' · 扭曲ON' : '';
      statusEl.textContent = `${item.category || 'Piloto'} (${qVal.toUpperCase()}) · ${activeBenchRecipe?.layers?.length || item.layerCount || 0} 层 · 粒子 ${totals.atlasActive} · 网格 ${totals.meshActive} · DrawCalls ${benchLastDrawCalls}${distLabel} · ${avgMs.toFixed(2)}ms`;
      window.__HGAME_VFX_BENCH__.simMs = Number(avgMs.toFixed(3));
      benchFrameCount = 0;
      benchMsAccum = 0;
    }
    return;
  }

  if (item.kind === 'system') {
    if (activeRenderMode === 'hgame' && hgameVfx) {
      hgameVfx.update(dt);
      const interval = Math.max(0.45, Math.min(1.5, (item.duration || 0.7) * 0.85));
      hgameFireTimer += dt;
      if (hgameFireTimer >= interval) {
        hgameFireTimer = 0;
        triggerHGamePreset(item);
      }
      if (hgameMeshPreview) {
        hgameMeshPreview.rotation.y += dt * 1.1;
      }
    } else {
      tickVfxEmitters(dt, item);
    }
    return;
  }

  if (item.kind === 'texture') {
    if (activeTextureMode === 'emitter') {
      tickVfxEmitters(dt, item);
      return;
    }
    if (activeTexturePlane) {
      if (activeTextureMode === 'billboard' && viewport?.camera) {
        activeTexturePlane.quaternion.copy(viewport.camera.quaternion);
      } else if (activeTextureMode === 'ground') {
        activeTexturePlane.rotation.set(-Math.PI * 0.5, 0, simElapsed * 0.35);
      }
    }
    if (activeTexture) {
      const [cols, rows] = inferGridForItem(item);
      const total = getActiveFrameCount(item, cols, rows);
      if (total > 1) {
        const fps = Math.max(1, Math.min(60, Number(fpsInput.value) || 12));
        animTimer += dt;
        const stepDur = 1 / fps;
        if (animTimer >= stepDur) {
          const steps = Math.floor(animTimer / stepDur);
          animTimer -= steps * stepDur;
          currentFrame = (currentFrame + steps) % total;
          updateTextureUv(item);
        }
      }
    }
  }
}

async function loadCurrentVfx() {
  const item = getCurrentItem();
  if (!item) {
    clearStageRoot();
    emptyEl.hidden = false;
    titleEl.textContent = '特效';
    downloadEl.hidden = true;
    syncControlsVisibility(null);
    statusEl.textContent = '未检测到特效资源';
    return;
  }

  emptyEl.hidden = true;
  const activeVar = getActiveVariant(item) || item;
  titleEl.textContent = item.name || item.id;

  if (item.kind === 'texture') {
    activeTextureMode = inferPlaneModeForItem(item);
  }
  syncControlsVisibility(item);

  if (item.isShurikenBench && activeVar.recipeUrl) {
    const fileName = `${activeVar.effectId || activeVar.id}.vfx.json`;
    downloadEl.href = activeVar.recipeUrl;
    downloadEl.download = fileName;
    downloadEl.textContent = `下载 ${fileName}`;
    downloadEl.hidden = false;
  } else if (item.url) {
    const fileName = item.url.split('/').pop() || `${item.id}.${item.kind === 'mesh' ? 'glb' : 'png'}`;
    downloadEl.href = item.url;
    downloadEl.download = fileName;
    downloadEl.textContent = `下载 ${fileName}`;
    downloadEl.hidden = false;
  } else if (item.hgamePreset?.meshUrl) {
    const fileName = item.hgamePreset.meshUrl.split('/').pop();
    downloadEl.href = item.hgamePreset.meshUrl;
    downloadEl.download = fileName;
    downloadEl.textContent = `网格 ${fileName}`;
    downloadEl.hidden = false;
  } else {
    downloadEl.hidden = true;
  }

  const vp = ensureViewport();
  if (!viewEl.hidden) {
    vp.resize();
    vp.start(tickVfx);
  }
  const token = ++loadToken;
  statusEl.textContent = `正在加载 ${activeVar.name || item.name}...`;

  try {
    if (item.isShurikenBench) {
      clearStageRoot({ keepBench: Boolean(hgameVfx && hgameVfxIsBench) });
      stageRoot = new THREE.Group();
      vp.scene.add(stageRoot);
      ensureBenchStage(vp, true);

      if (!hgameVfx) {
        hgameVfxIsBench = true;
        hgameVfx = createVfxSystem({
          mode: '3d',
          sceneOrAdapter: vp.scene,
          THREE,
          maxAtlasParticles: 8192,
          maxMeshVfx: 512,
          trailNodes: 40,
        });
      }

      const [packBundle, recipe] = await Promise.all([
        ensureBenchPackAssets(activeVar.packId),
        benchRecipeCache.has(activeVar.id)
          ? Promise.resolve(benchRecipeCache.get(activeVar.id))
          : fetch(activeVar.recipeUrl).then((r) => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.json();
            }).then((json) => {
              benchRecipeCache.set(activeVar.id, json);
              return json;
            }),
      ]);
      if (token !== loadToken) return;

      if (activeBenchAtlasPackId !== activeVar.packId) {
        hgameVfx.setAtlas(packBundle.atlasTex, packBundle.atlasMeta.regions);
        hgameVfx.setTrailTexture(packBundle.atlasTex, [0, 0, 0, 0]);
        activeBenchAtlasPackId = activeVar.packId;
      }
      await ensureBenchMeshesLoaded(hgameVfx, packBundle.pack.meshAliases);
      if (token !== loadToken) return;

      const qTier = normalizeBenchQuality(qualitySelect?.value || 'high');
      hgameVfx.setQualityTier(qTier);
      hgameVfx.registerEffect(recipe);
      activeBenchItem = item;
      activeBenchRecipe = recipe;
      activeBenchPackId = activeVar.packId;

      const effectId = activeVar.effectId || recipe.id;
      const playY = computeBenchPlayY(recipe, effectId);
      activeBenchHandle = hgameVfx.playEffect(recipe.id, { x: 0, y: playY, z: 0, scale: 1 });
      if (viewport?.camera) hgameVfx.setCamera?.(viewport.camera);
    hgameVfx.update(0.016);

      vp.setRenderOverride(() => renderBenchScene(vp));
      frameBenchCamera(vp, effectId);
      renderBenchScene(vp);

      const st = hgameVfx.getStats();
      const totals = getBenchTelemetryTotals(st);
      statusEl.textContent = `${item.category || 'Piloto'} · ${recipe.layers.length} 层 · 粒子 ${totals.atlasActive} · 网格 ${totals.meshActive} · DrawCalls ${benchLastDrawCalls}`;
      window.__HGAME_VFX_BENCH__ = {
        id: item.id,
        variantId: activeVar.id,
        effectId: recipe.id,
        packId: activeVar.packId,
        qualityTier: qTier,
        speed: Number(speedSelect?.value || 1.0),
        activeParticles: totals.atlasActive,
        activeMeshes: totals.meshActive,
        activeTrails: totals.trailActive,
        activeDrawCalls: benchLastDrawCalls,
        hasDistortion: Boolean(hgameVfx.hasActiveDistortion?.()),
        simMs: 0,
        isActive: Boolean(activeBenchHandle?.isActive?.()),
      };
    } else if (item.kind === 'system') {
      clearStageRoot();
      stageRoot = new THREE.Group();
      stageRoot.position.y = item.category === '法阵光环' ? 0.03 : 0.85;
      vp.scene.add(stageRoot);

      if (activeRenderMode === 'hgame') {
        hgameVfx = createVfxSystem({
          mode: '3d',
          sceneOrAdapter: vp.scene,
          THREE,
          maxParticles: 4096,
          maxFloatingGlyphs: 128,
        });
        if (item.hgamePreset?.meshUrl) {
          const tpl = await loadVfxMeshCached(item.hgamePreset.meshUrl);
          if (token !== loadToken) return;
          hgameMeshPreview = tpl.clone();
          hgameMeshPreview.position.y = item.category === '法阵光环' ? 0.04 : 0.9;
          hgameMeshPreview.rotation.x = -Math.PI * 0.5;
          hgameMeshPreview.scale.setScalar(item.category === '法阵光环' ? 2.5 : 4.2);
          const col = new THREE.Color(item.hgamePreset.color || '#ffffff');
          hgameMeshPreview.traverse(ch => {
            if (!ch.isMesh) return;
            ch.material = new THREE.MeshBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.7,
              depthWrite: false,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending,
            });
          });
          stageRoot.add(hgameMeshPreview);
        }
        triggerHGamePreset(item);
        vp.camera.position.set(3.2, 2.6, 4.2);
        vp.controls.target.set(0, item.category === '法阵光环' ? 0.1 : 0.8, 0);
        vp.controls.update();
        statusEl.textContent = `HGame 原生还原 (${item.hgamePreset?.recipe || 'burst'}) · 映射自 ${item.assetName}`;
      } else {
        await buildVfxSimulation(item.emitters || [], stageRoot);
        if (token !== loadToken) {
          clearStageRoot();
          return;
        }
        if (item.category === '法阵光环') {
          vp.camera.position.set(0, 3.8, 3.6);
          vp.controls.target.set(0, 0.05, 0);
        } else {
          vp.camera.position.set(3.4, 2.5, 4.2);
          vp.controls.target.set(0, 0.85, 0);
        }
        vp.controls.update();
        tickVfxEmitters(0.04, item);
        const meshCnt = (item.emitters || []).filter(e => e.renderer?.mode === 4).length;
        const texCnt = new Set((item.emitters || []).map(e => e.renderer?.textureUrl).filter(Boolean)).size;
        statusEl.textContent = `Unreal VFX · ${item.emitterCount || 0} 发射器 · ${meshCnt} 网格/面片层 · ${texCnt} 贴图`;
      }
    } else if (item.kind === 'mesh') {
      const gltf = await gltfLoader.loadAsync(item.url);
      if (token !== loadToken) {
        disposeObject3D(gltf.scene);
        return;
      }
      clearStageRoot();
      normalizeUnrealSceneMaterials(gltf.scene);
      let meshCount = 0;
      gltf.scene.traverse(child => {
        if (!child.isMesh) return;
        meshCount += 1;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          m.side = THREE.DoubleSide;
        }
      });
      stageRoot = new THREE.Group();
      stageRoot.add(gltf.scene);
      vp.scene.add(stageRoot);
      applyAppearanceToStage();
      vp.frameObject(stageRoot);
      statusEl.textContent = `Unreal 3D 特效网格 · ${meshCount} 网格 · ${formatBytes(item.bytes)}`;
    } else {
      const tex = await texLoader.loadAsync(item.url);
      if (token !== loadToken) {
        tex.dispose();
        return;
      }
      clearStageRoot();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      activeTexture = tex;

      const [cols, rows] = inferGridForItem(item);
      const mode = inferPlaneModeForItem(item);
      activeTextureMode = mode;
      syncControlsVisibility(item);

      stageRoot = new THREE.Group();
      vp.scene.add(stageRoot);

      if (mode === 'emitter') {
        await buildVfxSimulation([{
          name: item.name,
          transform: { position: [0, 0.5, 0], quaternion: [0.70711, 0, 0, 0.70711], scale: [1, 1, 1] },
          duration: 1.0,
          simulationSpeed: 1.0,
          looping: true,
          startDelay: { min: 0, max: 0 },
          lifetime: { min: 0.55, max: 0.95 },
          startSpeed: { min: 0.8, max: 1.8 },
          startSize: { min: 0.5, max: 0.85 },
          startRotation: { min: 0, max: 6.283 },
          gravityModifier: { min: 0, max: 0 },
          startColor: { mode: 0, colorMax: [1, 1, 1, 1] },
          rateOverTime: { mode: 0, min: 14, max: 14 },
          bursts: [],
          shape: { enabled: true, type: 4, angle: 22, radius: 0.2, arc: 360 },
          uvAnimation: (cols > 1 || rows > 1) ? { tilesX: cols, tilesY: rows, cycles: 1 } : null,
          renderer: {
            mode: 0,
            blend: blendSelect.value === 'normal' ? 'normal' : 'additive',
            tint: [1, 1, 1, 1],
            textureUrl: item.url,
          },
        }], stageRoot);
        if (token !== loadToken) {
          clearStageRoot();
          return;
        }
        vp.camera.position.set(2.8, 2.0, 3.4);
        vp.controls.target.set(0, 1.0, 0);
        vp.controls.update();
        statusEl.textContent = `粒子喷射预览 · ${cols}×${rows} · ${item.name}`;
      } else {
        activeTextureMaterial = new THREE.MeshBasicMaterial({
          map: tex,
          color: new THREE.Color(colorInput.value || '#ffffff'),
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: blendSelect.value === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending,
        });

        const img = tex.image;
        const cellW = img ? img.width / cols : 1;
        const cellH = img ? img.height / rows : 1;
        const aspect = cellH > 0 ? Math.max(0.25, Math.min(3.2, cellW / cellH)) : 1;
        const planeH = 2.0;
        const planeW = planeH * aspect;
        const geo = new THREE.PlaneGeometry(planeW, planeH);
        const plane = new THREE.Mesh(geo, activeTextureMaterial);
        if (mode === 'ground') {
          plane.position.y = 0.04;
          plane.rotation.x = -Math.PI * 0.5;
          vp.camera.position.set(0, 3.2, 2.4);
          vp.controls.target.set(0, 0.05, 0);
        } else {
          plane.position.y = 1.05;
          plane.quaternion.copy(vp.camera.quaternion);
          vp.camera.position.set(0, 1.35, 3.2);
          vp.controls.target.set(0, 1.05, 0);
        }
        vp.controls.update();
        activeTexturePlane = plane;
        stageRoot.add(plane);
        updateTextureUv(item);

        const dim = img ? `${img.width}×${img.height}` : '';
        const activeTotal = getActiveFrameCount(item, cols, rows);
        const modeLabel = mode === 'ground' ? '贴地水平' : '朝向相机';
        const seqLabel = activeTotal > 1 ? `序列帧 ${cols}×${rows} (${activeTotal}帧)` : '单帧贴图';
        statusEl.textContent = `${modeLabel} · ${seqLabel}${dim ? ` · ${dim}` : ''} · ${formatBytes(item.bytes)}`;
      }
    }

    if (!viewEl.hidden) {
      vp.start(tickVfx);
      vp.resize();
    }
  } catch (error) {
    if (token !== loadToken) return;
    statusEl.textContent = error.message || '特效资源加载失败';
  }
}

async function applyVfxReviewStatus(item, approved) {
  if (!item?.id) return false;
  const allFamilyIds = Array.isArray(item.variants) && item.variants.length > 0
    ? [...new Set([item.id, ...item.variants.map(v => v.id)])]
    : [item.id];
  const prevPresent = allFamilyIds.filter(id => reviewedIds.has(id));
  const nextApproved = Boolean(approved);
  const targetIds = nextApproved ? [item.id] : prevPresent;
  if (targetIds.length === 0) targetIds.push(item.id);
  for (const tid of targetIds) {
    if (nextApproved) reviewedIds.add(tid);
    else reviewedIds.delete(tid);
  }

  const prevSelectedId = activeSelection.id;
  renderBundleTabs();
  populateCategoryFilter();
  populateSubtypeFilter();
  renderList();
  if (reviewToggle && getCurrentItem()?.id === item.id) {
    reviewToggle.checked = nextApproved;
  }
  if (activeSelection.id && activeSelection.id !== prevSelectedId) {
    void loadCurrentVfx();
  }

  try {
    let lastData = null;
    for (const tid of targetIds) {
      const res = await fetch('/api/hgame/vfx/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tid, approved: nextApproved }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      lastData = data;
    }
    if (Array.isArray(lastData?.reviewedIds)) {
      reviewedIds.clear();
      for (const rid of lastData.reviewedIds) reviewedIds.add(rid);
      renderBundleTabs();
      populateCategoryFilter();
      populateSubtypeFilter();
      renderList();
      if (reviewToggle) reviewToggle.checked = isItemReviewed(getCurrentItem());
    }
    return true;
  } catch (err) {
    for (const id of allFamilyIds) reviewedIds.delete(id);
    for (const id of prevPresent) reviewedIds.add(id);
    renderBundleTabs();
    populateCategoryFilter();
    populateSubtypeFilter();
    renderList();
    if (reviewToggle) reviewToggle.checked = isItemReviewed(getCurrentItem());
    statusEl.textContent = err?.message || '保存审核状态失败';
    return false;
  }
}

async function initVfxView() {
  if (!initialized) {
    initialized = true;
    searchInput.addEventListener('input', renderList);
    reviewToggle?.addEventListener('change', () => {
      const item = getCurrentItem();
      if (!item) return;
      void applyVfxReviewStatus(item, reviewToggle.checked);
    });
    variantSelect?.addEventListener('change', () => {
      const item = getCurrentItem();
      if (!item) return;
      activeVariantByBaseId.set(item.id, variantSelect.value);
      void loadCurrentVfx();
    });
    typeFilter.addEventListener('change', () => {
      if (subtypeFilter) subtypeFilter.value = 'all';
      populateSubtypeFilter();
      const filtered = getFilteredItems();
      if (filtered.length > 0 && !filtered.some(it => it.kind === activeSelection.kind && it.id === activeSelection.id)) {
        activeSelection = { kind: filtered[0].kind, id: filtered[0].id };
        applyItemDefaults(filtered[0]);
      }
      renderList();
      void loadCurrentVfx();
    });
    subtypeFilter?.addEventListener('change', () => {
      const filtered = getFilteredItems();
      if (filtered.length > 0 && !filtered.some(it => it.kind === activeSelection.kind && it.id === activeSelection.id)) {
        activeSelection = { kind: filtered[0].kind, id: filtered[0].id };
        applyItemDefaults(filtered[0]);
      }
      renderList();
      void loadCurrentVfx();
    });
    for (const tab of modeTabEls) {
      tab.addEventListener('click', () => {
        const nextMode = tab.dataset.hgameVfxMode || 'source';
        if (nextMode === activeRenderMode) return;
        activeRenderMode = nextMode;
        void loadCurrentVfx();
      });
    }
    copyCodeBtn?.addEventListener('click', async () => {
      const item = getCurrentItem();
      if (!item || item.kind !== 'system') return;
      const code = buildHGameSnippet(item);
      try {
        await navigator.clipboard.writeText(code);
        statusEl.textContent = `已复制 ${item.name} 的 HGame createVfxSystem 调用代码`;
      } catch {
        statusEl.textContent = '剪贴板不可用，请检查浏览器权限';
      }
    });
    playBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      playBtn.textContent = isPlaying ? '暂停' : '播放';
    });
    replayBtn?.addEventListener('click', replayActiveVfx);
    qualitySelect?.addEventListener('change', () => {
      if (hgameVfx?.setQualityTier) {
        hgameVfx.setQualityTier(normalizeBenchQuality(qualitySelect.value || 'high'));
      }
    });
    gridToggle?.addEventListener('change', () => {
      if (benchStudioGrid && benchStageActive) benchStudioGrid.visible = gridToggle.checked;
      else if (viewport?.gridHelper) viewport.gridHelper.visible = gridToggle.checked;
    });
    bloomToggle?.addEventListener('change', () => {
      if (benchPostPipeline) benchPostPipeline.setState({ bloom: bloomToggle.checked });
    });
    planeModeSelect?.addEventListener('change', () => {
      void loadCurrentVfx();
    });
    gridSelect.addEventListener('change', () => {
      currentFrame = 0;
      const item = getCurrentItem();
      if (item) {
        updateTextureUv(item);
        const [cols, rows] = inferGridForItem(item);
        statusEl.textContent = `${cols * rows > 1 ? `序列帧 ${cols}×${rows}` : '单帧'} · ${item.name}`;
      }
    });
    blendSelect.addEventListener('change', () => {
      if (activeTextureMode === 'emitter') void loadCurrentVfx();
      else applyAppearanceToStage();
    });
    colorInput.addEventListener('input', applyAppearanceToStage);
  }

  const vp = ensureViewport();
  if (!viewEl.hidden) {
    vp.resize();
    vp.start(tickVfx);
  }
  try {
    const [unrealRes, vfxBenchRes] = await Promise.all([
      fetchUnrealCatalog().catch(() => ({})),
      fetch('/api/hgame/vfx/catalog').then(r => (r.ok ? r.json() : { available: false })).catch(() => ({ available: false })),
    ]);
    const unrealCatalog = unrealRes || {};
    vfxPacksById.clear();
    reviewedIds.clear();
    for (const rid of Array.isArray(vfxBenchRes?.reviewedIds) ? vfxBenchRes.reviewedIds : []) {
      reviewedIds.add(rid);
    }
    vfxMeshIndex = vfxBenchRes?.meshIndex || {};
    vfxBaseUrl = vfxBenchRes?.baseUrl || '/files/hgame-vfx';
    vfxBundles = [];
    if (vfxBenchRes?.available && Array.isArray(vfxBenchRes.packs)) {
      const nextBenchSystems = [];
      const bundleMap = new Map();
      for (const b of Array.isArray(vfxBenchRes.bundles) ? vfxBenchRes.bundles : []) {
        if (b?.id) bundleMap.set(b.id, { id: b.id, name: b.name || b.id, packCount: b.packCount || 0, effectCount: b.effectCount || 0 });
      }
      for (const pack of vfxBenchRes.packs) {
        if (pack.id === 'flagship_bench') continue;
        const bId = pack.bundleId || 'piloto_studio';
        const bName = pack.bundleName || 'Piloto Studio';
        if (!bundleMap.has(bId)) {
          bundleMap.set(bId, { id: bId, name: bName, packCount: 0, effectCount: 0 });
        }
        vfxPacksById.set(pack.id, pack);
        for (const ef of Array.isArray(pack.effects) ? pack.effects : []) {
          const itemName = ef.name || ef.id;
          const catPath = Array.isArray(ef.categoryPath)
            ? ef.categoryPath
            : String(ef.relSource || '').split('/').filter(Boolean).slice(0, -1);
          const { category: catTitle, subCategory: subTitle } = classifyVfxHierarchy({
            name: itemName,
            effectId: ef.id,
            id: `${pack.id}__${ef.id}`,
            bundleId: bId,
            bundleName: bName,
            relSource: ef.relSource || '',
            categoryPath: catPath,
            loop: Boolean(ef.loop),
          });
          nextBenchSystems.push({
            id: `${pack.id}__${ef.id}`,
            effectId: ef.id,
            packId: pack.id,
            bundleId: bId,
            bundleName: bName,
            name: itemName,
            relSource: ef.relSource || '',
            categoryPath: catPath,
            category: catTitle,
            subCategory: subTitle,
            group: pack.name,
            layerCount: ef.layerCount,
            duration: ef.duration,
            loop: Boolean(ef.loop),
            isShurikenBench: true,
            recipeUrl: `${vfxBaseUrl}/${ef.file}`,
            hgamePreset: { color: '#ff944d' },
          });
        }
      }
      vfxBundles = [...bundleMap.values()];
      shurikenBenchSystems = collapseBenchColorVariants(nextBenchSystems);
    } else if (vfxBenchRes?.available && Array.isArray(vfxBenchRes.effects)) {
      // Legacy fallback when catalog.json v1 is used
      vfxBundles = [{ id: 'legacy_v1', name: '默认特效包', packCount: 1, effectCount: vfxBenchRes.effects.length }];
      shurikenBenchSystems = collapseBenchColorVariants(vfxBenchRes.effects.map(ef => {
        const { category, subCategory } = classifyVfxHierarchy({ name: ef.name, effectId: ef.id, id: ef.id, bundleId: 'legacy_v1', loop: Boolean(ef.loop) });
        return {
          id: ef.id,
          effectId: ef.id,
          packId: 'legacy_v1',
          bundleId: 'legacy_v1',
          bundleName: '默认特效包',
          name: ef.name,
          category,
          subCategory,
          group: ef.name,
          layerCount: ef.layerCount,
          duration: ef.duration,
          loop: ef.loop,
          isShurikenBench: true,
          recipeUrl: `${vfxBaseUrl}/${ef.recipeFile}`,
          hgamePreset: { color: '#ff944d' },
        };
      }));
    } else {
      shurikenBenchSystems = [];
    }
    vfxSystems = Array.isArray(unrealCatalog.vfxSystems)
      ? unrealCatalog.vfxSystems.map(sys => {
        const { category, subCategory } = classifyVfxHierarchy(sys);
        return { ...sys, category, subCategory };
      })
      : [];
    vfxMeshes = Array.isArray(unrealCatalog.vfxMeshes) ? unrealCatalog.vfxMeshes : [];
    vfxTextures = Array.isArray(unrealCatalog.vfxTextures) ? unrealCatalog.vfxTextures : [];
    if (vfxBundles.length === 0 && (vfxSystems.length + vfxMeshes.length + vfxTextures.length) > 0) {
      vfxBundles = [{ id: 'unreal_export', name: 'Unreal 特效', packCount: 1, effectCount: vfxSystems.length + vfxMeshes.length + vfxTextures.length }];
    }
  } catch (error) {
    vfxBundles = [];
    shurikenBenchSystems = [];
    vfxSystems = [];
    vfxMeshes = [];
    vfxTextures = [];
    statusEl.textContent = error.message || '读取特效目录失败';
  }

  const findItemOrVariant = (all, key) => {
    if (!key) return null;
    for (const it of all) {
      if (it.id === key || it.effectId === key) return { item: it, variant: null };
      const matchedVar = Array.isArray(it.variants)
        ? it.variants.find(v => v.id === key || v.effectId === key)
        : null;
      if (matchedVar) return { item: it, variant: matchedVar };
    }
    return null;
  };
  const params = new URLSearchParams(window.location.search);
  const reqBundle = params.get('bundle');
  const reqVfx = params.get('vfx');
  const reqEff = params.get('effect');
  const allItems = getAllItems();
  const deepMatch = findItemOrVariant(allItems, reqVfx) || findItemOrVariant(allItems, reqEff);
  const deepLinked = deepMatch ? deepMatch.item : null;
  if (deepMatch?.variant) activeVariantByBaseId.set(deepMatch.item.id, deepMatch.variant.id);

  if (deepLinked?.bundleId && vfxBundles.some(b => b.id === deepLinked.bundleId)) {
    activeBundleId = deepLinked.bundleId;
  } else if (reqBundle && vfxBundles.some(b => b.id === reqBundle)) {
    activeBundleId = reqBundle;
  } else if (!activeBundleId || !vfxBundles.some(b => b.id === activeBundleId)) {
    activeBundleId = vfxBundles[0]?.id || '';
  }

  renderBundleTabs();
  populateCategoryFilter();
  populateSubtypeFilter();

  const bundlePool = getActiveBundleItems();
  const filteredItems = getFilteredItems();
  const currentExisting = bundlePool.find(it => it.kind === activeSelection.kind && it.id === activeSelection.id) || null;
  const firstUnreviewed = filteredItems.find(it => !isItemReviewed(it)) || bundlePool.find(it => !isItemReviewed(it)) || null;
  const initialItem = deepLinked || currentExisting || firstUnreviewed || filteredItems[0] || bundlePool[0] || allItems[0] || null;
  if (initialItem) {
    activeSelection = { kind: initialItem.kind, id: initialItem.id };
    applyItemDefaults(initialItem);
  }
  renderList();
  ensureViewport();
  await loadCurrentVfx();
}

window.__WEBASSET_VFX_TEST__ = {
  listIds: () => getAllItems().map(it => it.id),
  listBundles: () => vfxBundles.map(b => ({ ...b })),
  getActiveBundle: () => activeBundleId,
  selectBundle: async (bundleId) => {
    if (!vfxBundles.some(b => b.id === bundleId)) return false;
    await switchBundle(bundleId);
    return true;
  },
  isReviewed: (id) => {
    const match = getAllItems().find(it => it.id === id || it.effectId === id || it.variants?.some(v => v.id === id || v.effectId === id));
    return match ? isItemReviewed(match) : reviewedIds.has(id);
  },
  setReviewed: async (id, approved) => {
    const match = getAllItems().find(it => it.id === id || it.effectId === id || it.variants?.some(v => v.id === id || v.effectId === id));
    if (!match) return false;
    return applyVfxReviewStatus(match, approved);
  },
  setPlaying: (playing) => {
    isPlaying = Boolean(playing);
    if (playBtn) playBtn.textContent = isPlaying ? '暂停' : '播放';
  },
  async select(id) {
    const all = getAllItems();
    let match = all.find(it => it.id === id || it.effectId === id);
    if (!match) {
      for (const it of all) {
        const mv = it.variants?.find(v => v.id === id || v.effectId === id);
        if (mv) {
          match = it;
          activeVariantByBaseId.set(it.id, mv.id);
          break;
        }
      }
    }
    if (!match) return false;
    const matchBundle = match.bundleId || 'piloto_studio';
    if (activeBundleId && matchBundle !== activeBundleId && vfxBundles.some(b => b.id === matchBundle)) {
      activeBundleId = matchBundle;
      if (typeFilter) typeFilter.value = 'all';
      if (subtypeFilter) subtypeFilter.value = 'all';
      renderBundleTabs();
      populateCategoryFilter();
      populateSubtypeFilter();
    }
    activeSelection = { kind: match.kind, id: match.id };
    applyItemDefaults(match);
    renderList();
    await loadCurrentVfx();
    return true;
  },
  step(dt = 1 / 60, doRender = true) {
    const vp = viewport;
    if (!vp) return null;
    if (activeBenchItem?.isShurikenBench && hgameVfx) {
      const speedMul = Math.max(0.1, Number(speedSelect?.value || 1.0));
      const simDt = dt * speedMul;
      benchSimDt = simDt;
      hgameVfx.update(simDt);
      if (doRender) renderBenchScene(vp);
      const st = hgameVfx.getStats();
      const totals = getBenchTelemetryTotals(st);
      return {
        id: activeBenchItem.id,
        effectId: activeBenchRecipe?.id,
        ...totals,
        drawCalls: benchLastDrawCalls,
        hasDistortion: Boolean(hgameVfx.hasActiveDistortion?.()),
      };
    }
    tickVfx(dt);
    return null;
  },
  getTelemetry: () => (hgameVfx ? {
    id: activeBenchItem?.id || activeSelection.id,
    effectId: activeBenchRecipe?.id,
    ...getBenchTelemetryTotals(hgameVfx.getStats()),
    drawCalls: benchLastDrawCalls,
    hasDistortion: Boolean(hgameVfx.hasActiveDistortion?.()),
  } : null),
};

window.addEventListener('webasset:workspace-change', event => {
  if (event.detail?.workspace === 'vfx') {
    void initVfxView();
  } else {
    viewport?.stop();
  }
});

if (viewEl && !viewEl.hidden) {
  void initVfxView();
}
