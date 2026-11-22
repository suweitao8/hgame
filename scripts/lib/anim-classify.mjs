/**
 * Clean-room animation classification, Turn-clip filtering, Pose/LongSequence isolation,
 * and WebAsset category cleanup rules.
 */

export const ANIM_CATEGORY_ORDER = Object.freeze([
  '待机站姿',
  '步行与潜行',
  '跑步与冲刺',
  '跳跃与浮空',
  '闪避翻滚与滑步',
  '攀爬跑酷与游泳',
  '太刀与武士刀',
  '长剑与双刃',
  '长枪重锤与镰刀',
  '弓箭',
  '枪械射击',
  '法术与能量技',
  '拳击泰拳与咏春',
  '空手格斗招式',
  '高速连击 (Lucy)',
  '处决与暗杀',
  '格挡与防御',
  '受击与硬直',
  '死亡与倒地起身',
  '椅坐与吧台',
  '席地盘坐与台沿坐',
  '躺卧与睡眠',
  '生活劳作与职业行为',
  '拾取搬运与机关交互',
  '载具驾驶与上下车',
  '对话与社交情绪',
  '双人互动',
  '舞蹈与演唱',
  '怪物移动与爬行',
  '怪物攻击与受击',
  '怪物待机与行为',
  '其他动作',
]);

const TURN_CLIP_RE = /(^|[_\-\s])(turn|turninplace|turn_in_place|turn_?90|turn_?180|turn_?l|turn_?r|pivot_?180|bank_?[lr])([_\-\s]|$)|turn(?:90|180)?(?:left|right|l|r)\b|(?:left|right)_?turn/i;
const STRAFE_LOCO_RE = /(strafe|_(?:f|b|l|r|fl|fr|bl|br|fwd|bwd|left|right|fwdleft|fwdright|bwdleft|bwdright|lt|rt)(?:_?(?:loop|start|stop|ip|rm|inplace|root|45|90|135))?$)/i;
const LOCO_CONTEXT_RE = /(walk|run|jog|crouch|sprint|strafe)/i;
const COMBAT_SPIN_WHITELIST_RE = /(attack|atk|slash|kick|spin|whirlwind|combo|skill|finisher|dodge|roll|die|death|hit|stumble)/i;

const PACK_STYLE_MAP = new Map([
  ['lucy', 'anime'],
  ['kawaiianimations', 'anime'],
  ['clazyanimpack', 'anime'],
  ['wudangsword_animset', 'wuxia'],
  ['sword_sheath_animset', 'wuxia'],
  ['orientalism_dual_blade_anim_set', 'wuxia'],
  ['mage', 'fantasy'],
  ['flyingmageanimset', 'fantasy'],
  ['magicalanimset', 'fantasy'],
  ['specialmoves_energy', 'fantasy'],
  ['grimreaperset', 'fantasy'],
  ['zombie_anims', 'monster'],
  ['demon_anims', 'monster'],
  ['classicfemaleghost', 'monster'],
  ['ghost_creature_anims', 'monster'],
  ['creatures_animations', 'monster'],
  ['animations_creature', 'monster'],
  ['41_animations_monsters', 'monster'],
]);

function hasAnimToken(str, words) {
  return new RegExp(`(?:^|[_\\-\\s])(?:${words})(?:$|[_\\-\\s\\d])`, 'i').test(str);
}

/**
 * Determine if an animation clip is a Turn-in-Place / rotational turn clip to exclude.
 * Strictly preserves 8-way Strafe locomotion and spinning combat attacks.
 */
export function isTurnClip(assetName = '') {
  const s = String(assetName || '');
  if (!TURN_CLIP_RE.test(s)) return false;
  const hasTurnWord = /turn|pivot/i.test(s);
  if (!hasTurnWord && STRAFE_LOCO_RE.test(s) && LOCO_CONTEXT_RE.test(s)) {
    return false;
  }
  if (/strafe/i.test(s) && !/turn/i.test(s)) return false;
  if (COMBAT_SPIN_WHITELIST_RE.test(s)) return false;
  return true;
}

/**
 * Resolve unified style tag (`realistic` | `wuxia` | `anime` | `fantasy` | `monster`).
 */
export function resolvePackStyle(pack = '') {
  return PACK_STYLE_MAP.get(String(pack || '').toLowerCase()) || 'realistic';
}

/**
 * Classify a clip into one of the 32 cleaned WebAsset categories.
 */
export function classifyCleanCategory(entry) {
  const raw = entry.assetName || entry.name || '';
  const p = String(entry.pack || '').toLowerCase();

  // 1. Monster packs
  if (/(zombie|demon|ghost_creature|classicfemaleghost|41_animations_monsters|creatures_animations|animations_creature)/.test(p)) {
    const low = raw.toLowerCase();
    if (/(walk|run|crawl|sprint|move|float)/.test(low)) return '怪物移动与爬行';
    if (/(attack|atk|bite|claw|scare|hit|block|stun|die|dead)/.test(low)) return '怪物攻击与受击';
    return '怪物待机与行为';
  }

  // 2. Fix SittingAnimations AimSpace poses (move AIM_* out of sitting into 枪械射击)
  if (p === 'sittinganimations' && /^AIM_/i.test(raw)) {
    return '枪械射击';
  }

  // 3. Sleep & Sitting
  if (p === 'sleepanimpack' || hasAnimToken(raw, 'sleep|sleeping|lie|lying|lay_down|bed')) {
    return '躺卧与睡眠';
  }
  if (p === 'sittinganimations') {
    return /(chair|stool|bench|sofa|bonus)/i.test(raw) ? '椅坐与吧台' : '席地盘坐与台沿坐';
  }
  if ((hasAnimToken(raw, 'sit|sitting|stool|chair|bench|ledgesit|seat') || /(?:Sit|Sitting|Stool|Chair)/.test(raw)) && !/(attack|combat)/i.test(raw)) {
    return /(floor|ground|ledge)/i.test(raw) ? '席地盘坐与台沿坐' : '椅坐与吧台';
  }

  // 4. Dance & Singing
  if (/^(morromotion|sing_ue5)$/.test(p) || hasAnimToken(raw, 'dance|dancing|sing|singing|waltz') || /Dance|Waltz/i.test(raw)) {
    return '舞蹈与演唱';
  }

  // 5. Vehicles
  if (/^carinteractanimations/.test(p)) return '载具驾驶与上下车';

  // 6. Daily / Occupational / Survival / Interaction
  if (/^(vendors_and_customers|npcsbundle|survival_anims|drinkinganimations|itempickupset|activations_mocap|feminteractanimset|phoenyxanimpack3)$/.test(p)) {
    if (hasAnimToken(raw, 'talk|chat|convo|wave|cheer|greet|point') || /(TalkGesture|WaveOver|Cheer|FriendlyConvo)/i.test(raw)) return '对话与社交情绪';
    if (hasAnimToken(raw, 'pickup|pick_up|button|lever|door|push|pull|card|carry|carryload') || /(ItemPickup|CarryLoad|Push|Pull|Button|Lever|Door)/i.test(raw)) return '拾取搬运与机关交互';
    if (p === 'npcsbundle' && /^A_Idle/i.test(raw)) return '待机站姿';
    if (/swim/i.test(raw)) return '攀爬跑酷与游泳';
    return '生活劳作与职业行为';
  }

  // 7. Block / Hit / Death
  if (hasAnimToken(raw, 'dead|die|death|knock|knocked|revive|stumble|stun|hit|get_hit|damage|dam|block|parry|guard|defend|ambushed') || /(BlockHit|JumpDie|StandDie|SlideDie|TurnDie|JumpFail|SlideFail|Block_Break)/i.test(raw)) {
    if (hasAnimToken(raw, 'block|parry|guard|defend') || /Block/i.test(raw)) return '格挡与防御';
    if (hasAnimToken(raw, 'dead|die|death|knock|revive') || /(Die|Dead)/i.test(raw)) return '死亡与倒地起身';
    return '受击与硬直';
  }

  // 8. Finishers & Stealth
  if (/^(finisher_animations|stealthfinishers_knifeandhand)$/.test(p) || /(finisher|execute|execution|assassinate|stealth)/i.test(raw) || hasAnimToken(raw, 'counter')) {
    return '处决与暗杀';
  }

  // 9. Split Bow vs Firearms (Task 4.3)
  if (hasAnimToken(raw, 'bow|arrow|quiver') || /(RainShoot|AirShoot|AimTheTarget|Aim_The_Target)/i.test(raw)) {
    return '弓箭';
  }
  if (p === 'pistolanimsetpro' || hasAnimToken(raw, 'pistol|gun|rifle|shotgun|sniper|revolver|reload|shoot|firearm')) {
    return '枪械射击';
  }

  // 10. Magic & Energy
  if (/^(mage|flyingmageanimset|magicalanimset|specialmoves_energy)$/.test(p) || hasAnimToken(raw, 'spell|magic|cast|mage|fireball|buff|heal|teleport|beam|energy')) {
    return '法术与能量技';
  }

  // 11. Polearm, Hammer & Scythe
  if (/^(spearandhalberdanimset|heavyhammer|grimreaperset)$/.test(p) || hasAnimToken(raw, 'spear|halberd|hammer|scythe|axe|polearm')) {
    return '长枪重锤与镰刀';
  }

  // 12. CLazyAnimpack explicit cleanup (Task 4.3 - eliminates 其他动作)
  if (p === 'clazyanimpack') {
    if (/^(?:LoWall_|Wall_)/i.test(raw)) return '攀爬跑酷与游泳';
    if (/^(?:Esc_StandRoll|Esc_.*Dodge|Tum_)/i.test(raw)) return '闪避翻滚与滑步';
    if (/^(?:Mvm_Idle|Esc_Spawn)/i.test(raw)) return '待机站姿';
    if (/^(?:Mvm_Walk)/i.test(raw)) return '步行与潜行';
    if (/^(?:Mvm_Jog|Mvm_Run|Esc_.*Move)/i.test(raw)) return '跑步与冲刺';
  }

  // 13. Locomotion, Dodge, Jump, Parkour
  const isWeaponAttack = /(attack|atk|combo|slash|strike|cut|stab|swing|chop|slice|chopping|pressing|flicking|sheath|unsheathe|equip|unequip|punch|kick|jab|hook|uppercut)/i.test(raw) || hasAnimToken(raw, 'elbow|knee|spin');
  if (!isWeaponAttack) {
    if (/^(climbinganimationset|stairsset|parkouranimations)$/.test(p) || /(climb|vault|mantle|stairs|ledge|wallrun|wall_jump|hiwall|swim|lowall|bootjump)/i.test(raw)) {
      if (hasAnimToken(raw, 'walk|run|jog|sprint') && !/(climb|vault|mantle|stairs|wall|swim|balance)/i.test(raw)) {
        return /walk/i.test(raw) ? '步行与潜行' : '跑步与冲刺';
      }
      return '攀爬跑酷与游泳';
    }
    if (p === 'rolldodgedashset' || hasAnimToken(raw, 'dodge|roll|dash|slide|evade|avoid|handspring|weaving') || /(BoostDash|JumpDodge|WallSlide|StandRoll)/i.test(raw)) return '闪避翻滚与滑步';
    if (hasAnimToken(raw, 'jump|jmp|fall|falling|land|landing|air') || /(JumpStart|JumpEnd|JumpLoop|InAir)/i.test(raw)) return '跳跃与浮空';
    if (hasAnimToken(raw, 'run|jog|sprint') || /(JogFwd|RunFwd|PowerRun|FastRun|Sprint|StrafeRun)/i.test(raw)) return '跑步与冲刺';
    if (hasAnimToken(raw, 'walk|crawl|sneak|stealth|crouch') || /(CrouchWalk|CrouchFwd|WalkFwd|StrafeLeft|StrafeRight)/i.test(raw)) return '步行与潜行';
  }

  // 14. Katana & Swords
  if (/^(katana_animations|ghostsamurai_bundle)$/.test(p) || hasAnimToken(raw, 'katana|samurai|iaijutsu|unsheathe|sheath')) {
    return '太刀与武士刀';
  }
  if (/^(sword_animations|swordanimsetpro|sword_sheath_animset|wudangsword_animset|orientalism_dual_blade_anim_set|rapier_animset)$/.test(p) || hasAnimToken(raw, 'sword|rapier|blade|slash|stab')) {
    return '长剑与双刃';
  }

  // 15. Unarmed & Martial Arts
  if (/^(unleashed_boxer|muaythai_animset|wingchun_animset)$/.test(p)) return '拳击泰拳与咏春';
  if (p === 'lucy') return '高速连击 (Lucy)';
  if (/^(fightanimations|fighter_animations|ninja_animset)$/.test(p) && !hasAnimToken(raw, 'idle|pose')) return '空手格斗招式';
  if (isWeaponAttack) return '空手格斗招式';

  // 16. Couples / Dialogue / Idles
  if (p === 'couples_anim_pack') return '双人互动';
  if (/^(dialogue_mocap|pedestrian_convo_01|preacheranimations|tauntspack|crowdanimations|suppoter_motion|scared_01|morbidmotions_pack|irap)$/.test(p) || hasAnimToken(raw, 'talk|convo|whisper|taunt|cheer|wave|scared|beg|cry|furious')) {
    if (hasAnimToken(raw, 'idle|stand|breathe|pose') && !hasAnimToken(raw, 'talk|convo|taunt|cheer|wave|scared|beg|cry|furious')) return '待机站姿';
    return '对话与社交情绪';
  }
  if (hasAnimToken(raw, 'idle|stand|pose|breathe|break') || /^(mc_idles_pack|kawaiianimations|female_animations|malelocomotionset|fightanimations)$/.test(p)) {
    return '待机站姿';
  }
  if (p === 'pedestrian_walks_01') return '步行与潜行';
  return '其他动作';
}

/**
 * Derive semantic tags from assetName & category for AI search.
 */
export function extractSemanticTags(entry, category) {
  const raw = String(entry.assetName || entry.name || '').toLowerCase();
  const tags = new Set();
  const checks = [
    ['idle', /\bidle\b/],
    ['walk', /walk/],
    ['run', /run|jog/],
    ['sprint', /sprint/],
    ['strafe', /strafe|fwd|bwd/],
    ['crouch', /crouch/],
    ['jump', /jump|jmp/],
    ['dodge', /dodge|roll|dash|evade/],
    ['katana', /katana|samurai/],
    ['sword', /sword|wudang|rapier|dual_blade/],
    ['spear', /spear|halberd/],
    ['hammer', /hammer/],
    ['scythe', /scythe|reaper/],
    ['bow', /\bbow\b|arrow/],
    ['pistol', /pistol|revolver/],
    ['shoot', /shoot|fire/],
    ['reload', /reload/],
    ['aim', /\baim\b/],
    ['slash', /slash|cut/],
    ['combo', /combo/],
    ['block', /block|guard|parry/],
    ['hit', /\bhit\b|damage|dam|stumble/],
    ['death', /die|dead|death/],
    ['magic', /magic|mage|spell|cast|energy|buff/],
    ['finisher', /finisher|execute|stealth/],
    ['sit', /sit|chair|stool|bench/],
    ['sleep', /sleep|lie|bed/],
    ['interact', /pickup|button|lever|door|push|pull|card|carry/],
    ['work', /mine|chop|hammer|saw|fish|craft|bartender|sweep/],
    ['social', /talk|convo|wave|cheer|taunt|hug|dance|sing/],
    ['monster', /zombie|demon|ghost|monster|creature/],
  ];
  for (const [tag, rx] of checks) {
    if (rx.test(raw) || rx.test(String(entry.pack || '').toLowerCase())) tags.add(tag);
  }
  if (category === '弓箭') tags.add('bow');
  if (category === '枪械射击') tags.add('pistol');
  return [...tags].slice(0, 6);
}

/**
 * Full cleaning classification for an animation entry.
 */
export function classifyCleanAnimation(entry, { ueEntry = null, bakeMetrics = null } = {}) {
  const assetName = String(entry.assetName || entry.name || '');
  const duration = Number(bakeMetrics?.duration ?? entry.duration ?? 0);
  const rigType = bakeMetrics?.rigType || 'humanoid_23';
  const isTurn = isTurnClip(assetName);
  const isAdditive = Boolean(ueEntry?.additive_anim_type && ueEntry.additive_anim_type !== 'AAT_None');
  const isAimOffsetPose = /^(?:BindPose|t-pose)$/i.test(assetName)
    || /_APose$/i.test(assetName)
    || (String(entry.pack || '').toLowerCase() === 'sittinganimations' && /^AIM_/i.test(assetName));
  const isPose = duration <= 0.10 || isAdditive || isAimOffsetPose;
  const isLong = duration > 10.0;

  let clipType = 'action';
  if (isPose) clipType = 'pose';
  else if (isLong) clipType = 'long_sequence';

  const category = classifyCleanCategory(entry);
  const style = resolvePackStyle(entry.pack);

  let excludedReason = null;
  if (isTurn) excludedReason = 'turn_clip';
  else if (isAdditive) excludedReason = 'additive_clip';
  else if (isPose) excludedReason = 'pose_clip';
  else if (rigType !== 'humanoid_23') excludedReason = 'non_humanoid_rig';

  const upperBodySafe = /(shoot|fire|reload|aim|equip|unequip|pistol|bow|cast|wave|greet|point|block|guard)/i.test(assetName)
    && !/(crouch|sit|sleep|lie|crawl|die|dead|fall|jump|roll|dodge|slide)/i.test(assetName);

  return {
    category,
    style,
    rig: rigType,
    clipType,
    excludedReason,
    upperBodySafe,
    tags: extractSemanticTags(entry, category),
  };
}
