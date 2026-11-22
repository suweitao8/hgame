/**
 * L0 Standard Archetype Kits (9 kits) and L1 Curated AI Index builder/query helpers.
 */

const DIRECTION_KEYS_8 = ['f', 'b', 'l', 'r', 'fl', 'fr', 'bl', 'br'];
const DIRECTION_KEYS_4 = ['f', 'b', 'l', 'r'];

export const L0_KIT_SPECS = [
  {
    kitId: 'kit_realistic_civilian',
    style: 'realistic',
    description: '写实都市/沙盒/通用主角移动底座',
    allowedPacks: ['MaleLocomotionSet', 'MC_Idles_Pack', 'RollDodgeDashSet', 'ClimbingAnimationSet'],
    slots: {
      locomotion: {
        idle: ['A_INP_Idle', 'am_ArmsCrossed_Idle_01'],
        sprint_f: ['A_INP_RunFwd_Loop'],
        strafe_walk: {
          f: ['A_INP_WalkFwd_Loop'],
          b: ['A_INP_WalkBwd_Loop'],
          l: ['A_INP_WalkFwdLt_90_Loop'],
          r: ['A_INP_WalkFwdRt_90_Loop'],
          fl: ['A_INP_WalkFwdLt_45_Loop'],
          fr: ['A_INP_WalkFwdRt_45_Loop'],
          bl: ['A_INP_WalkBwdLt_45_Loop'],
          br: ['A_INP_WalkBwdRt_45_Loop'],
        },
        strafe_run: {
          f: ['A_INP_JogFwd_Loop'],
          b: ['A_INP_JogBwd_Loop'],
          l: ['A_INP_JogFwdLt_90_Loop'],
          r: ['A_INP_JogFwdRt_90_Loop'],
          fl: ['A_INP_JogFwdLt_45_Loop'],
          fr: ['A_INP_JogFwdRt_45_Loop'],
          bl: ['A_INP_JogBwdLt_45_Loop'],
          br: ['A_INP_JogBwdRt_45_Loop'],
        },
        crouch_idle: ['A_INP_Crouch_Idle'],
        crouch_walk: {
          f: ['A_INP_CrouchFwd_Loop'],
          b: ['A_INP_CrouchBwd_Loop'],
          l: ['A_INP_CrouchFwdLt_90_Loop'],
          r: ['A_INP_CrouchFwdRt_90_Loop'],
        },
        jump_start: ['A_INP_JumpIdle_Start'],
        jump_loop: ['A_INP_Falling_Loop', 'A_INP_JumpIdle_inAir'],
        jump_land: ['A_INP_JumpIdle_Land'],
        dodge_f: ['A_INP_Roll_IdleFwd', 'A_INP_Dash_IdleFwd'],
        dodge_b: ['A_INP_Dodge_01_IdleBwd_toLeft', 'A_INP_Roll_IdleBwd', 'A_INP_Dash_IdleBwd'],
        dodge_l: ['A_INP_Dodge_01_IdleFwdLt_90', 'A_INP_Roll_IdleFwdLt_90', 'A_INP_Dash_IdleFwdLt_90'],
        dodge_r: ['A_INP_Dodge_01_IdleFwdRt_90', 'A_INP_Roll_IdleFwdRt_90', 'A_INP_Dash_IdleFwdRt_90'],
      },
      upperBody: {
        aim_idle: null,
        fire: null,
        reload: null,
        equip: null,
        unequip: null,
      },
      combat: {
        attack_1: null,
        attack_2: null,
        attack_3: null,
        block_loop: null,
        hit_f: null,
        hit_b: null,
        death_1: null,
        death_2: null,
      },
    },
  },
  {
    kitId: 'kit_tps_pistol',
    style: 'realistic',
    description: '第三人称射击（手枪 8 向平移底座 + 上下半身遮罩模板）',
    allowedPacks: ['PistolAnimsetPro', 'MaleLocomotionSet'],
    slots: {
      locomotion: {
        idle: ['Pistol_Idle', 'Pistol_Lowered_Idle'],
        sprint_f: ['Pistol_SprintLoop', 'A_INP_RunFwd_Loop'],
        strafe_walk: {
          f: ['Pistol_WalkFwdLoop', 'A_INP_WalkFwd_Loop'],
          b: ['Pistol_WalkBwdLoop', 'A_INP_WalkBwd_Loop'],
          l: ['Pistol_StrafeLeftLoop', 'A_INP_WalkFwdLt_90_Loop'],
          r: ['Pistol_StrafeRightLoop', 'A_INP_WalkFwdRt_90_Loop'],
          fl: ['Pistol_StrafeLeft45Loop', 'A_INP_WalkFwdLt_45_Loop'],
          fr: ['Pistol_StrafeRight45Loop', 'A_INP_WalkFwdRt_45_Loop'],
          bl: ['Pistol_StrafeLeft135Loop', 'A_INP_WalkBwdLt_45_Loop'],
          br: ['Pistol_StrafeRight135Loop', 'A_INP_WalkBwdRt_45_Loop'],
        },
        strafe_run: {
          f: ['Pistol_RunFwdLoop', 'Pistol_Lowered_RunFwdLoop'],
          b: ['Pistol_RunBwdLoop', 'Pistol_Lowered_RunBwdLoop'],
          l: ['Pistol_StrafeRunLeftLoop', 'Pistol_Lowered_StrafeLeftLoop'],
          r: ['Pistol_StrafeRunRightLoop', 'Pistol_Lowered_StrafeRightLoop'],
          fl: ['Pistol_StrafeRun45LeftLoop', 'Pistol_Lowered_StrafeRun45LeftLoop'],
          fr: ['Pistol_StrafeRun45RightLoop', 'Pistol_Lowered_StrafeRun45RightLoop'],
          bl: ['Pistol_StrafeRun135LeftLoop', 'Pistol_Lowered_StrafeRun135LeftLoop'],
          br: ['Pistol_StrafeRun135RightLoop', 'Pistol_Lowered_StrafeRun135RightLoop'],
        },
        crouch_idle: ['Pistol_CrouchLoop', 'A_INP_Crouch_Idle'],
        crouch_walk: {
          f: ['Pistol_Crouch_WalkFwd'],
          b: ['Pistol_Crouch_WalkBwd'],
          l: ['Pistol_Crouch_WalkLt'],
          r: ['Pistol_Crouch_WalkRt'],
        },
        jump_start: ['Pistol_Jump_Platformer_Start', 'A_INP_JumpIdle_Start'],
        jump_loop: ['Pistol_FallingLoop', 'Pistol_Jump_Platformer_Fall'],
        jump_land: ['Pistol_Land_Generic', 'Pistol_Jump_Platformer_Land'],
        dodge_f: null,
        dodge_b: null,
        dodge_l: null,
        dodge_r: null,
      },
      upperBody: {
        aim_idle: ['Pistol_Idle'],
        fire: ['Pistol_ShootOnce', 'Pistol_ShootPowerful'],
        reload: ['Pistol_Reload_2', 'Pistol_Reload_3'],
        equip: ['Pistol_Equip'],
        unequip: ['Pistol_UnEquip'],
      },
      combat: {
        attack_1: ['Pistol_Melee_Hard'],
        attack_2: ['Pistol_Melee_Kick'],
        attack_3: null,
        block_loop: null,
        hit_f: ['Pistol_Hit_C_1'],
        hit_b: ['Pistol_Hit_L_1', 'Pistol_Hit_R_2'],
        death_1: ['Pistol_Death_L'],
        death_2: null,
      },
    },
  },
  {
    kitId: 'kit_samurai_katana',
    style: 'realistic',
    description: '写实武士、太刀近战与潜行弓箭套件',
    allowedPacks: ['GhostSamurai_Bundle', 'Katana_Animations'],
    slots: {
      locomotion: {
        idle: ['GhostSamurai_APose_Idle', 'AS_Idle_Combat_Seq'],
        sprint_f: ['GhostSamurai_APose_Strafe_Run_F_Sprint_Inplace', 'AS_Run_Fast_Loop_Seq'],
        strafe_walk: {
          f: ['GhostSamurai_APose_Strafe_Walk_F_Loop_Inplace'],
          b: ['GhostSamurai_APose_Strafe_Walk_B_Inplace'],
          l: ['GhostSamurai_APose_Strafe_Walk_L_Inplace'],
          r: ['GhostSamurai_APose_Strafe_Walk_R_Inplace'],
          fl: ['GhostSamurai_APose_Strafe_Walk_FL_Inplace'],
          fr: ['GhostSamurai_APose_Strafe_Walk_FR_Inplace'],
          bl: ['GhostSamurai_APose_Strafe_Walk_BL_Inplace'],
          br: ['GhostSamurai_APose_Strafe_Walk_BR_Inplace'],
        },
        strafe_run: {
          f: ['GhostSamurai_APose_Strafe_Run_F_Loop_Inplace'],
          b: ['GhostSamurai_APose_Strafe_Run_B_Inplace'],
          l: ['GhostSamurai_APose_Strafe_Run_L_Inplace'],
          r: ['GhostSamurai_APose_Strafe_Run_R_Inplace'],
          fl: ['GhostSamurai_APose_Strafe_Run_FL_Inplace'],
          fr: ['GhostSamurai_APose_Strafe_Run_FR_Inplace'],
          bl: ['GhostSamurai_APose_Strafe_Run_BL_Inplace'],
          br: ['GhostSamurai_APose_Strafe_Run_BR_Inplace'],
        },
        crouch_idle: null,
        crouch_walk: { f: null, b: null, l: null, r: null },
        jump_start: ['GhostSamurai_APose_Jump_Start_Inplace', 'AS_Jump_Start_0_Seq'],
        jump_loop: ['GhostSamurai_APose_Jump_Loop_Inplace', 'AS_Jump_Loop_0_Seq'],
        jump_land: ['GhostSamurai_APose_Jump_End_Inplace', 'AS_Jump_End_F_0_Seq'],
        dodge_f: ['GhostSamurai_APose_Dodge_F_Inplace', 'AS_Dodge_F_0_Seq'],
        dodge_b: ['GhostSamurai_APose_Dodge_B_Inplace', 'AS_Dodge_B_180_Seq'],
        dodge_l: ['GhostSamurai_APose_Dodge_L_Inplace', 'AS_Dodge_L_90_Seq'],
        dodge_r: ['GhostSamurai_APose_Dodge_R_Inplace', 'AS_Dodge_R_90_Seq'],
      },
      upperBody: {
        aim_idle: ['GhostSamurai_Bow_Idle_Inplace'],
        fire: ['GhostSamurai_Bow_Shoot_Loop_Inplace'],
        reload: null,
        equip: ['GhostSamurai_APose_Equip01_Inplace'],
        unequip: ['GhostSamurai_APose_Equip02_Inplace'],
      },
      combat: {
        attack_1: ['GhostSamurai_APose_Attack01_1_ALL_Inplace', 'AS_Combo_Attack_01_01_V02_Seq'],
        attack_2: ['GhostSamurai_APose_Attack01_2_Inplace', 'AS_Combo_Attack_01_02_V02_Seq'],
        attack_3: ['GhostSamurai_APose_Attack01_3_Inplace', 'AS_Combo_Attack_01_03_V02_Seq'],
        block_loop: ['GhostSamurai_DefenseL_Loop_Inplace', 'AS_Block_Loop_Seq'],
        hit_f: ['GhostSamurai_APose_Hit_F_Inplace'],
        hit_b: ['GhostSamurai_APose_Hit_B_Inplace'],
        death_1: ['GhostSamurai_APose_Die01_Inplace'],
        death_2: ['GhostSamurai_APose_Die02_Inplace'],
      },
    },
  },
  {
    kitId: 'kit_wuxia_sword',
    style: 'wuxia',
    description: '国风武侠、武当长剑收鞘与双刀流套件',
    allowedPacks: ['WudangSword_Animset', 'Sword_sheath_AnimSet', 'Orientalism_Dual_Blade_Anim_Set'],
    slots: {
      locomotion: {
        idle: ['idle', 'anim_idle', 'MM_Idle'],
        sprint_f: ['MM_Run_Fwd', 'anim_sprint'],
        strafe_walk: {
          f: ['move_walk_front', 'anim_walk_front'],
          b: ['move_walk_back', 'anim_walk_back'],
          l: ['move_walk_left', 'anim_walk_left'],
          r: ['move_walk_right', 'anim_walk_right'],
          fl: ['move_walk_frontL45', 'anim_walk_frontL45'],
          fr: ['move_walk_frontR45', 'anim_walk_frontR45'],
          bl: ['move_walk_backL45', 'anim_walk_backL45'],
          br: ['move_walk_backR45', 'anim_walk_backR45'],
        },
        strafe_run: {
          f: ['move_run_front', 'anim_run_front'],
          b: ['move_run_back', 'anim_run_back'],
          l: ['move_run_left', 'anim_run_left'],
          r: ['move_run_right', 'anim_run_right'],
          fl: ['move_run_frontL45', 'anim_run_frontL45'],
          fr: ['move_run_frontR45', 'anim_run_frontR45'],
          bl: ['move_run_backL45', 'anim_run_backL45'],
          br: ['move_run_backR45', 'anim_run_backR45'],
        },
        crouch_idle: null,
        crouch_walk: { f: null, b: null, l: null, r: null },
        jump_start: ['Jump_start', 'MM_Jump'],
        jump_loop: ['jump_falling_loop', 'MM_Fall_Loop'],
        jump_land: ['jump_landing', 'MM_Land'],
        dodge_f: ['roll_front'],
        dodge_b: ['roll_back'],
        dodge_l: ['roll_left'],
        dodge_r: ['roll_right'],
      },
      upperBody: {
        aim_idle: null,
        fire: null,
        reload: null,
        equip: ['ANIM_equip_equip01', 'ANIM_equip01'],
        unequip: ['anim_unequip_01', 'ANIM_equip_unequip01'],
      },
      combat: {
        attack_1: ['Combo01_1', 'attack_Slice01', 'anim_attack_01'],
        attack_2: ['Combo01_2', 'attack_Stabbing01', 'anim_attack_02'],
        attack_3: ['Combo01_3', 'anim_attack_03'],
        block_loop: ['Defense_Blocking_L', 'Defense_Blocking_R'],
        hit_f: ['hit_front', 'anim_body_front_hit'],
        hit_b: ['hit_back', 'anim_body_back_hit'],
        death_1: ['dead01', 'anim_dead_01'],
        death_2: ['dead02', 'anim_dead_02'],
      },
    },
  },
  {
    kitId: 'kit_heavy_polearm',
    style: 'realistic',
    description: '长枪大戟、重锤与死神镰刀长兵器套件',
    allowedPacks: ['SpearAndHalberdAnimset', 'HeavyHammer', 'GrimReaperSet'],
    slots: {
      locomotion: {
        idle: ['Spear_Idle', 'Anim_Idle', 'Ground_idle'],
        sprint_f: ['Spear_RP_RunFwd', 'Ground_strafe_run_F'],
        strafe_walk: {
          f: ['Spear_WalkFwd', 'Spear_RP_WalkFwd', 'Ground_strafe_walk_F'],
          b: ['Spear_WalkBwd', 'Spear_RP_WalkBwd', 'Ground_strafe_walk_B'],
          l: ['Spear_WalkLeft', 'Spear_RP_WalkLeft', 'Ground_strafe_walk_L'],
          r: ['Spear_WalkRight', 'Spear_RP_WalkRight', 'Ground_strafe_walk_R'],
          fl: ['Spear_WalkLeft_45', 'Spear_RP_WalkLeft45', 'Ground_strafe_walk_L45'],
          fr: ['Spear_WalkRight_45', 'Spear_RP_WalkRight45', 'Ground_strafe_walk_R45'],
          bl: ['Spear_WalkLeft_135', 'Spear_RP_WalkLeft135', 'Ground_strafe_walk_L135'],
          br: ['Spear_WalkRight_135', 'Spear_RP_WalkRight135', 'Ground_strafe_walk_R135'],
        },
        strafe_run: {
          f: ['Spear_RP_RunFwd', 'Ground_strafe_run_F'],
          b: ['Spear_RP_RunBwd', 'Ground_strafe_run_B'],
          l: ['Spear_RP_RunLeft', 'Ground_strafe_run_L'],
          r: ['Spear_RP_RunRight', 'Ground_strafe_run_R'],
          fl: ['Spear_RP_RunLeft45', 'Ground_strafe_run_L45'],
          fr: ['Spear_RP_RunRight45', 'Ground_strafe_run_R45'],
          bl: ['Spear_RP_RunLeft135', 'Ground_strafe_run_L135'],
          br: ['Spear_RP_RunRight135', 'Ground_strafe_run_R135'],
        },
        crouch_idle: null,
        crouch_walk: { f: null, b: null, l: null, r: null },
        jump_start: ['Spear_Jump_Start'],
        jump_loop: ['Spear_FallingLoop', 'Spear_Jump_Air', 'Anim_Jump_Loop'],
        jump_land: ['Spear_Jump_Land', 'Anim_Jump_End'],
        dodge_f: ['Spear_Dodge_Fwd', 'Anim_Dodge_F'],
        dodge_b: ['Spear_Dodge_Back', 'Anim_Dodge_B'],
        dodge_l: ['Spear_Dodge_Left', 'Anim_Dodge_L'],
        dodge_r: ['Spear_Dodge_Right', 'Anim_Dodge_R'],
      },
      upperBody: {
        aim_idle: null,
        fire: null,
        reload: null,
        equip: ['Spear_Equip', 'equip'],
        unequip: null,
      },
      combat: {
        attack_1: ['Spear_AttackFwdCombo1_A', 'Anim_Combo01_01', 'Ground_attack01'],
        attack_2: ['Spear_AttackFwdCombo1_B', 'Anim_Combo01_02', 'Ground_attack10'],
        attack_3: ['Spear_AttackFwdCombo1_C', 'Anim_Combo01_03', 'Ground_attack12'],
        block_loop: ['Spear_BlockLoop', 'Spear_RP_BlockLoop'],
        hit_f: ['Spear_Hit_1', 'Anim_Hit01_F'],
        hit_b: ['Spear_Hit_2', 'Anim_Hit01_B', 'hit_back'],
        death_1: ['Spear_Death1', 'Anim_Die', 'dead1'],
        death_2: ['Spear_Death2', 'dead2'],
      },
    },
  },
  {
    kitId: 'kit_anime_action',
    style: 'anime',
    description: '二次元高速连击与可爱风格小游戏套件',
    allowedPacks: ['Lucy', 'KawaiiAnimations', 'CLazyAnimpack'],
    slots: {
      locomotion: {
        idle: ['Lucy_Idle', 'Anim_KA_Idle01_breathing', 'MM_Idle'],
        sprint_f: ['Lucy_Sprint_1_Inplace', 'Anim_KA_Run01'],
        strafe_walk: {
          f: ['Lucy_Walk_F_Inplace', 'Anim_KA_Walk01'],
          b: ['Lucy_Walk_B_Inplace'],
          l: ['Lucy_Walk_L_Inplace'],
          r: ['Lucy_Walk_R_Inplace'],
          fl: ['Lucy_Walk_FL_Inplace'],
          fr: ['Lucy_Walk_FR_Inplace'],
          bl: ['Lucy_Walk_BL_Inplace'],
          br: ['Lucy_Walk_BR_Inplace'],
        },
        strafe_run: {
          f: ['Lucy_Run_F_Inplace', 'Anim_KA_Run01'],
          b: ['Lucy_Run_B_Inplace'],
          l: ['Lucy_Run_L_Inplace'],
          r: ['Lucy_Run_R_Inplace'],
          fl: ['Lucy_Run_FL_Inplace'],
          fr: ['Lucy_Run_FR_Inplace'],
          bl: ['Lucy_Run_BL_Inplace'],
          br: ['Lucy_Run_BR_Inplace'],
        },
        crouch_idle: ['Lucy_CrouchIdle_Inplace'],
        crouch_walk: {
          f: ['Lucy_Crouch_F_Inplace'],
          b: ['Lucy_Crouch_B_Inplace'],
          l: ['Lucy_Crouch_L_Inplace'],
          r: ['Lucy_Crouch_R_Inplace'],
        },
        jump_start: ['Lucy_Jump_Start_Inplace'],
        jump_loop: ['Lucy_Jump_Loop_Inplace'],
        jump_land: ['Lucy_Jump_End_Inplace'],
        dodge_f: ['Lucy_Dodge_F_Inplace'],
        dodge_b: ['Lucy_Dodge_B_Inplace'],
        dodge_l: ['Lucy_Dodge_L_Inplace'],
        dodge_r: ['Lucy_Dodge_R_Inplace'],
      },
      upperBody: {
        aim_idle: null,
        fire: null,
        reload: null,
        equip: null,
        unequip: null,
      },
      combat: {
        attack_1: ['Lucy_Kick_Combo01_1_Inplace', 'Anim_KA_Combat_BareHands_Combo1'],
        attack_2: ['Lucy_Kick_Combo01_2_Inplace', 'Anim_KA_Combat_BareHands_Combo2'],
        attack_3: ['Lucy_Kick_Combo01_3_Inplace', 'Anim_KA_Combat_BareHands_Combo3'],
        block_loop: null,
        hit_f: ['Lucy_Hit_F_Inplace', 'Lucy_Hit_FL_Inplace', 'Lucy_Hit_FD_Inplace', 'Lucy_Large_Hit_Inplace'],
        hit_b: ['Lucy_Hit_B_Inplace'],
        death_1: ['Lucy_Die01_Inplace'],
        death_2: ['Lucy_Die02_Inplace'],
      },
    },
  },
  {
    kitId: 'kit_martial_arts',
    style: 'realistic',
    description: '现代徒手格斗、拳击、泰拳与咏春套件',
    allowedPacks: ['Unleashed_Boxer', 'MuayThai_AnimSet', 'wingchun_Animset'],
    slots: {
      locomotion: {
        idle: ['idle01', 'idle02_combat', 'idle'],
        sprint_f: ['move_run_front', 'MF_Run_Fwd'],
        strafe_walk: {
          f: ['move_walk_front'],
          b: ['move_walk_back'],
          l: ['move_walk_left'],
          r: ['move_walk_right'],
          fl: ['move_walk_frontL45'],
          fr: ['move_walk_frontR45'],
          bl: ['move_walk_backL45'],
          br: ['move_walk_backR45'],
        },
        strafe_run: {
          f: ['move_run_front'],
          b: ['move_run_back'],
          l: ['move_run_left'],
          r: ['move_run_right'],
          fl: ['move_run_frontL45'],
          fr: ['move_run_frontR45'],
          bl: ['move_run_backL45'],
          br: ['move_run_backR45'],
        },
        crouch_idle: null,
        crouch_walk: { f: null, b: null, l: null, r: null },
        jump_start: ['jump_start'],
        jump_loop: ['jump_falling_loop'],
        jump_land: ['jump_landing'],
        dodge_f: ['roll_front'],
        dodge_b: ['roll_back'],
        dodge_l: ['roll_left'],
        dodge_r: ['roll_right'],
      },
      upperBody: {
        aim_idle: null,
        fire: null,
        reload: null,
        equip: null,
        unequip: null,
      },
      combat: {
        attack_1: ['combo_01_1', 'combo01_1', 'attack_01'],
        attack_2: ['combo_01_2', 'combo01_2', 'attack_02'],
        attack_3: ['combo_01_3', 'combo01_3', 'attack_03'],
        block_loop: ['guard_L', 'guard_R'],
        hit_f: ['hit_front'],
        hit_b: ['hit_back'],
        death_1: ['dead_01', 'dead01'],
        death_2: ['dead_02', 'dead02'],
      },
    },
  },
  {
    kitId: 'kit_mage_energy',
    style: 'fantasy',
    description: '奇幻法师、浮空施法与气功能量必杀技套件',
    allowedPacks: ['Mage', 'FlyingMageAnimSet', 'SpecialMoves_Energy'],
    slots: {
      locomotion: {
        idle: ['AS_Idle_Combat_Seq', 'idle_Ground', 'idle_Flying'],
        sprint_f: ['AS_Run_Fast_Loop_Seq', 'AS_Run_F_0_Loop_Seq'],
        strafe_walk: {
          f: ['AS_Run_F_0_Loop_Seq'],
          b: ['AS_Run_B_180_Loop_Seq'],
          l: ['AS_Run_F_L_90_Loop_Seq'],
          r: ['AS_Run_F_R_90_Loop_Seq'],
          fl: ['AS_Run_F_L_45_Loop_Seq'],
          fr: ['AS_Run_F_R_45_Loop_Seq'],
          bl: ['AS_Run_B_L_45_Loop_Seq'],
          br: ['AS_Run_B_R_45_Loop_Seq'],
        },
        strafe_run: {
          f: ['AS_Run_F_0_Loop_Seq'],
          b: ['AS_Run_B_180_Loop_Seq'],
          l: ['AS_Run_F_L_90_Loop_Seq'],
          r: ['AS_Run_F_R_90_Loop_Seq'],
          fl: ['AS_Run_F_L_45_Loop_Seq'],
          fr: ['AS_Run_F_R_45_Loop_Seq'],
          bl: ['AS_Run_B_L_45_Loop_Seq'],
          br: ['AS_Run_B_R_45_Loop_Seq'],
        },
        crouch_idle: null,
        crouch_walk: { f: null, b: null, l: null, r: null },
        jump_start: ['AS_Jump_Start_0_Seq', 'SpecialMove_002_02_Jump_IP'],
        jump_loop: ['AS_Jump_Loop_0_Seq', 'SpecialMove_002_03_Fall_IP'],
        jump_land: ['AS_Jump_End_F_0_Seq', 'landing'],
        dodge_f: ['AS_Dodge_Combat_F_0_Seq'],
        dodge_b: ['AS_Dodge_Combat_B_180_Seq'],
        dodge_l: ['AS_Dodge_Combat_L_90_Seq'],
        dodge_r: ['AS_Dodge_Combat_R_90_Seq'],
      },
      upperBody: {
        aim_idle: ['AS_Idle_Combat_Seq', 'SpecialMoveIdle_M'],
        fire: ['attack_FlyingAtk01_short', 'attack_GroundAtk01_short'],
        reload: ['buff_Flying'],
        equip: null,
        unequip: null,
      },
      combat: {
        attack_1: ['AS_Combo_Attack_01_01_Seq', 'attack_GroundAtk01'],
        attack_2: ['AS_Combo_Attack_01_02_Seq', 'attack_GroundAtk02'],
        attack_3: ['AS_Combo_Attack_01_03_Seq', 'attack_FlyingAtk01'],
        block_loop: ['AS_Block_Loop_Seq'],
        hit_f: ['AS_Hit_Air_F_Seq', 'attacked_Ground_Front'],
        hit_b: ['AS_Hit_B_Seq', 'attacked_Ground_Back'],
        death_1: ['AS_Hit_Death_Seq', 'dead_Ground'],
        death_2: ['AS_Hit_Combat_Death_Seq', 'dead_Flying'],
      },
    },
  },
  {
    kitId: 'kit_monster_horde',
    style: 'monster',
    description: '丧尸/恶魔刷怪敌人与 Bone-VAT 群集渲染套件',
    allowedPacks: ['Zombie_Anims', 'Demon_Anims'],
    slots: {
      locomotion: {
        idle: ['Zombie_Idle_01', 'AnimSeq_Demon_Idle'],
        sprint_f: ['Zombie_Sprint_01_Forward_InPlace'],
        strafe_walk: {
          f: ['Zombie_Walk_01_Forward_InPlace'],
          b: ['Zombie_Walk_01_Back_InPlace'],
          l: ['Zombie_Walk_01_Left_InPlace'],
          r: ['Zombie_Walk_01_Right_InPlace'],
          fl: ['Zombie_Walk_01_ForwardLeft_InPlace'],
          fr: ['Zombie_Walk_01_ForwardRight_InPlace'],
          bl: ['Zombie_Walk_01_BackLeft_InPlace'],
          br: ['Zombie_Walk_01_BackRight_InPlace'],
        },
        strafe_run: {
          f: ['Zombie_Run_01_Forward_InPlace'],
          b: ['Zombie_Run_01_Back_InPlace'],
          l: ['Zombie_Run_01_Left_InPlace'],
          r: ['Zombie_Run_01_Right_InPlace'],
          fl: ['Zombie_Run_01_ForwardLeft_InPlace'],
          fr: ['Zombie_Run_01_ForwardRight_InPlace'],
          bl: ['Zombie_Run_01_BackLeft_InPlace'],
          br: ['Zombie_Run_01_BackRight_InPlace'],
        },
        crouch_idle: ['Zombie_Crawl_Idle'],
        crouch_walk: {
          f: ['AnimSeq_Demon_FloorCrawl_SprintForward', 'Zombie_Crawl_Forward_InPlace'],
          b: ['Zombie_Crawl_Back', 'AnimSeq_Demon_FloorCrawl_Back'],
          l: ['AnimSeq_Demon_FloorCrawl_Left'],
          r: ['AnimSeq_Demon_FloorCrawl_Right'],
        },
        jump_start: ['Zombie_Idle_Jump_Start'],
        jump_loop: ['Zombie_Idle_Jump_Loop'],
        jump_land: ['Zombie_Idle_Jump_End'],
        dodge_f: null,
        dodge_b: null,
        dodge_l: null,
        dodge_r: null,
      },
      upperBody: {
        aim_idle: null,
        fire: null,
        reload: null,
        equip: null,
        unequip: null,
      },
      combat: {
        attack_1: ['Zombie_Attack_01', 'AnimSeq_Demon_FloorCrawl_Attack_LHand'],
        attack_2: ['Zombie_Attack_02', 'AnimSeq_Demon_FloorCrawl_Attack_RHand'],
        attack_3: ['Zombie_Attack_03'],
        block_loop: null,
        hit_f: ['Zombie_HitReact_Head'],
        hit_b: ['Zombie_HitReact_LeftArm'],
        death_1: ['Zombie_Idle_Death', 'AnimSeq_Demon_Idle_Death'],
        death_2: null,
      },
    },
  },
];

/**
 * Flatten every slot path from a kit's slot tree into { slotPath, candidates, forceInPlace }.
 */
export function flattenKitSlotSpecs(kitSpec) {
  const result = [];
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      const slotPath = prefix ? `${prefix}.${k}` : k;
      if (v === null || Array.isArray(v)) {
        const forceInPlace = slotPath.startsWith('locomotion.');
        result.push({ slotPath, candidates: v, forceInPlace });
      } else if (v && typeof v === 'object') {
        walk(v, slotPath);
      }
    }
  };
  walk(kitSpec.slots, '');
  return result;
}

/**
 * Resolve each kit spec's slots against available catalog records (by pack + assetName).
 * Returns { kits, slotAssignmentsById, missingSlots }.
 */
export function resolveAllL0Kits(records) {
  const byPackAndName = new Map();
  for (const r of records) {
    if (r.excludedReason) continue;
    const key = `${r.pack}::${r.assetName}`;
    if (!byPackAndName.has(key)) byPackAndName.set(key, r);
  }

  const slotAssignmentsById = new Map();
  const kits = [];

  for (const spec of L0_KIT_SPECS) {
    const flat = flattenKitSlotSpecs(spec);
    const outSlots = JSON.parse(JSON.stringify(spec.slots));
    let filled = 0;
    let total = 0;
    const missing = [];

    const setNested = (rootObj, dotPath, value) => {
      const parts = dotPath.split('.');
      let cur = rootObj;
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
      cur[parts[parts.length - 1]] = value;
    };

    for (const { slotPath, candidates, forceInPlace } of flat) {
      total++;
      if (!candidates || candidates.length === 0) {
        setNested(outSlots, slotPath, null);
        missing.push(slotPath);
        continue;
      }

      let picked = null;
      for (const candName of candidates) {
        for (const pack of spec.allowedPacks) {
          const hit = byPackAndName.get(`${pack}::${candName}`);
          if (hit) {
            picked = hit;
            break;
          }
        }
        if (picked) break;
      }

      if (!picked) {
        setNested(outSlots, slotPath, null);
        missing.push(slotPath);
      } else {
        filled++;
        setNested(outSlots, slotPath, picked.path);
        if (!slotAssignmentsById.has(picked.id)) {
          slotAssignmentsById.set(picked.id, {
            kit: spec.kitId,
            slot: slotPath,
            forceInPlace,
          });
        }
      }
    }

    kits.push({
      kitId: spec.kitId,
      style: spec.style,
      rig: 'humanoid_23',
      description: spec.description,
      allowedPacks: spec.allowedPacks,
      filledSlots: filled,
      totalSlots: total,
      missingSlots: missing,
      ...outSlots,
    });
  }

  return { kits, slotAssignmentsById };
}

/**
 * Curate L1 AI index (<= 1,300 entries total: all L0 kit clips + deduplicated high-signal L1 clips).
 */
export function buildCuratedL1Index(records, slotAssignmentsById, { maxTotal = 1150 } = {}) {
  const selected = [];
  const seenIds = new Set();
  const seenBaseNamePerPack = new Set();

  const normalizeBase = (assetName) => String(assetName || '')
    .replace(/(_Inplace|_In_Place|_IP|_Root|_RM|_Seq)$/i, '')
    .toLowerCase();

  // 1. All L0 kit clips go in first
  for (const r of records) {
    if (r.excludedReason || r.clipType !== 'action' || r.rig !== 'humanoid_23') continue;
    const assign = slotAssignmentsById.get(r.id);
    if (!assign) continue;
    seenIds.add(r.id);
    seenBaseNamePerPack.add(`${r.pack}::${normalizeBase(r.assetName)}`);
    selected.push({ r, kit: assign.kit, slot: assign.slot });
  }

  // 2. Prioritize diverse L1 non-L0 action clips across categories (deduped Inplace-first, <= maxTotal)
  const candidates = records.filter((r) => (
    !seenIds.has(r.id)
    && !r.excludedReason
    && r.clipType === 'action'
    && r.rig === 'humanoid_23'
    && !/_Root$/i.test(r.assetName)
  ));

  // Score candidates so interactive/social/combat/finisher/idle variety gets balanced representation
  const catBuckets = new Map();
  for (const r of candidates) {
    const baseKey = `${r.pack}::${normalizeBase(r.assetName)}`;
    if (seenBaseNamePerPack.has(baseKey)) continue;
    seenBaseNamePerPack.add(baseKey);
    if (!catBuckets.has(r.category)) catBuckets.set(r.category, []);
    catBuckets.get(r.category).push(r);
  }

  // Round-robin pick across categories until reaching maxTotal
  const bucketLists = [...catBuckets.values()];
  let cursor = 0;
  let progressed = true;
  while (selected.length < maxTotal && progressed) {
    progressed = false;
    for (const list of bucketLists) {
      if (cursor < list.length && selected.length < maxTotal) {
        const r = list[cursor];
        selected.push({ r, kit: null, slot: null });
        seenIds.add(r.id);
        progressed = true;
      }
    }
    cursor++;
  }

  return selected.map(({ r, kit, slot }) => ({
    id: r.id,
    pack: r.pack,
    kit,
    slot,
    category: r.category,
    style: r.style,
    rig: r.rig,
    motionType: r.motionType,
    rootDisplacement: r.rootDisplacement,
    loop: r.loop,
    duration: r.duration,
    clipType: r.clipType,
    upperBodySafe: r.upperBodySafe,
    ...(r.hitWindow ? { hitWindow: r.hitWindow } : {}),
    tags: r.tags,
    path: r.path,
    sizeKB: r.sizeKB,
  }));
}

/**
 * Search L1 AI index with strict filters and Top-N cap.
 */
export function searchAiIndex(entries, {
  style = '',
  category = '',
  motion = '',
  loop = null,
  maxDuration = null,
  q = '',
  limit = 10,
} = {}) {
  const qLower = String(q || '').trim().toLowerCase();
  const styleLower = String(style || '').trim().toLowerCase();
  const catLower = String(category || '').trim().toLowerCase();
  const motionUpper = String(motion || '').trim().toUpperCase();

  const matches = entries.filter((e) => {
    if (e.clipType === 'pose') return false;
    if (styleLower && String(e.style || '').toLowerCase() !== styleLower) return false;
    if (catLower && !String(e.category || '').toLowerCase().includes(catLower)) return false;
    if (motionUpper && String(e.motionType || '').toUpperCase() !== motionUpper) return false;
    if (loop !== null && Boolean(e.loop) !== Boolean(loop)) return false;
    if (maxDuration !== null && Number.isFinite(maxDuration) && Number(e.duration) > maxDuration) return false;
    if (qLower) {
      const hay = [e.id, e.pack, e.category, e.slot, ...(e.tags || []), e.path].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  // Rank L0 kit-mapped clips slightly higher when querying
  matches.sort((a, b) => (b.kit ? 1 : 0) - (a.kit ? 1 : 0));
  return matches.slice(0, Math.max(1, Math.min(50, limit)));
}
