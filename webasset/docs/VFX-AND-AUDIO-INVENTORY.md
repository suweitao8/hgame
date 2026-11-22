# HGame / Unreal 特效与音效资产总览盘点

> 盘点范围：Unreal 工程 `Anim58` 的 `/Game/` 内容库（含 `/Game/_Effects` 23 个子包、新增独立特效与配套视觉包 10 个、以及新增独立音效包 16 个），盘点时间 `2026-11-22`。  
> 用途：全面梳理当前可用的 Niagara / Cascade 特效、贴花与音效资产分布，识别重复包与冗余内容，作为后续向 WebAsset 导出与 HGame 游戏管线映射的依据。

---

## 一、全局统计总览

| 资产大类 | 包数量 | 文件总数 | 总体积 | 说明 |
|---|---:|---:|---:|---|
| 原有特效库（`/Game/_Effects/*`） | 23 | 4,267 | 3,664.6 MB（3.58 GB） | 魔法、ARPG 战斗、爆炸火焰、护盾、推进器、传送门、水效等（含 `FireworksWithSounds` 14 个音频文件） |
| 新增独立 VFX 特效包 | 5 | 1,393 | 1,644.8 MB（1.61 GB） | `RealisticBlood`、`Realistic_Starter_VFX_Pack` 系列（Cascade + Niagara）、`Vefects/Water`（含 47 组水声音效） |
| 配套视觉 / 纹理 / LUT / 玻璃 / 贴花 | 5 | 1,559 | 2,278.8 MB（2.23 GB） | `VFXNoiseTexPack`、`AdvancedGlassPack`、`AmplifyLUTPack`、`UWC_Bullet_Holes`、`RealisticBloodDecals` |
| 新增独立音效资产包 | 16 | 11,672 | 5,171.7 MB（5.05 GB） | 武器挥砍/枪械、RPG 技能、脚步、丧尸怪物、门窗、拾取/UI、生存建造、恐怖/暗黑氛围音轨、V10 引擎声 |
| **合计（以上四类）** | **49** | **18,891** | **12,759.9 MB（12.46 GB）** | 另：历史 `/Game/_Decals` 已存在 1,615 文件 / 4,464.3 MB（其中 236 张贴花已接入 WebAsset） |

> 注：目前 `Saved/WebAssetExport/catalog.json` 中 `vfxSystems` / `vfxMeshes` / `vfxTextures` 仍为 `0`，`audio` 仅导出 22 条旧音效；本清单所列新增特效与音效均位于 Unreal `Content/` 源目录，待按需清洗并导出至 WebAsset。

---

## 二、特效资产全览（VFX，共 28 个特效包 + 5 个视觉配套包）

### 2.1 新增独立 VFX 特效包（5 个）

| # | 包名（Unreal 路径） | 文件数 | 体积 | 粒子系统数 | 核心内容与代表资产 |
|---:|---|---:|---:|---:|---|
| 1 | `RealisticBlood`（`/Game/RealisticBlood`） | 350 | 704.9 MB | 39 Niagara + 8 BP | 写实血液与断肢特效：`NS_BulletHit_*`、`NS_Slash_*`、`NS_Stab_*`、`NS_BloodBurst_*`、`NS_Artery_*`、`NS_Dripping_*`、`NS_BrainBurst`、`NS_AmputatedHead/Limbs`、`NS_Splatter_*_Decal`、`NS_SphericalDecalSplatter*` |
| 2 | `Realistic_Starter_VFX_Pack`（`/Game/Realistic_Starter_VFX_Pack`） | 253 | 218.1 MB | 61 Cascade | 通用写实基础特效（Cascade）：爆炸（`P_Explosion_Big_A/B`、`Grenade`、`rocket`）、火焰（`P_Fire_Big/Small/Floor`、`P_Jet`）、枪口焰（`P_MuzzleFlash_A/B/C`）、12 种材质受击（血/电/布/玻璃/草/金属/泥/石/沙/雪/水/木）、烟雾蒸汽火花、环境天气（雨/雪/闪电/落叶/虫群/雾） |
| 3 | `Realistic_Starter_VFX_Pack_Niagara_Vol2`（`/Game/Realistic_Starter_VFX_Pack_Niagara_Vol2`） | 224 | 420.3 MB | 60 Niagara | Vol2 Niagara 重制版：破坏（混凝土/瓷砖/玻璃/木/石 `NS_Destruction_*`）、环境（风暴/碎片/冷烟/落叶/耀斑 `NS_Environment_*`）、火焰（篝火/火把/墙火/窗火 `NS_Fire_*`）、闪电（`NS_Lightning_1~8`）、烟雾（龙卷/酸雾/蒸汽 `NS_Smoke_*`）、火花（`NS_Sparks_1~11`）、水效（`NS_Water_1~8`） |
| 4 | `Realistic_Starter_VFX_Pack_Vol2`（`/Game/Realistic_Starter_VFX_Pack_Vol2`） | 188 | 110.2 MB | 56 Cascade | Vol2 Cascade 版：建筑/陶瓷/玻璃/金属/木头破坏（`P_Destruction_*`）、生物/环境（蝴蝶/萤火虫/鱼/蒲公英/落叶漩涡）、爆炸/燃烧瓶/喷火器（`P_Molotov`、`P_flamethrower`）、11 种表面受击、烟雾/余烬/火花/气泡水滴 |
| 5 | `Vefects`（`/Game/Vefects/Water`） | 378 | 191.3 MB | 23 Niagara + 12 BP | 高质量水体交互 Niagara 特效：**含 47 组配套水声音效**；`NS_Splash_Ground_Small/Medium/Large`、`NS_Splash_Dripping`、`NS_FireHydrantSplashes`、`NS_GardenHoseStream`、`NS_PressureWasherImpact`、`NS_RainDrops/Splashes`、`NS_Waterfall_Top/Base`、`NS_UnderwaterBubbles`、`NS_WaterPump` |

### 2.2 原有 `/Game/_Effects` 特效子包（23 个）

| 分类方向 | 包名（`/Game/_Effects/*`） | 文件数 | 体积 | 系统/蓝图数 | 核心内容与代表资产 |
|---|---|---:|---:|---:|---|
| 元素法术 | `Air_Wind_Spell_VFX_Pack` | 131 | 60.9 MB | 15 | 风暴/重力法术：`NS_Wind_Tornado`、`NS_Air_Slash`、`NS_Wind_Shield`、`NS_Gravity_AOE`、`NS_Strong_Wind_Wave` |
| 元素法术 | `Dark_Element_Spell_VFX` | 171 | 87.3 MB | 17 | 暗影/恶魔技能：`NS_Attack_of_Spirits`、`NS_Cursed_Mark`、`NS_Devils_Spear`、`NS_Devil_Transform`、`NS_Soul_Destroyer` |
| 元素法术 | `Ice_Element_VFX_Pack` | 151 | 100.4 MB | 15 | 冰霜法术：`NS_Hail_Storm`、`NS_Ice_Rain_AOE`、`NS_Sharp_Ice_AOE`、`NS_Ice_Shield`、`NS_Ice_Slash`、`NS_Ice_Projectile_*` |
| 元素法术 | `Lightning_Element_VFX` | 167 | 105.9 MB | 25 + 1 BP | 雷电技能：`NS_Lightning_Strike*`、`NS_Lightning_Tornado*`、`NS_Lightning_Spears*`、`NS_Lightning_AOE_Slash/Stun` |
| 元素法术 | `Electric_VFX` | 216 | 145.2 MB | 27 + 19 BP | 电弧/激光/手雷：`NS_AirCrack_Electric`、`NS_Laser_Electric`、`NS_MeshLaser`、`NS_Slash_Electric`、`NS_LightningSpear` |
| 元素法术 | `Wizard` | 362 | 385.7 MB | 22 Cascade + 15 BP | 法师火冰雷水技能与镜头特效：`PS_FireBall_*`、`PS_LavaBurst`、`PS_Ice_Rain/Spikes`、`PS_Lightning_beam`、`PS_Water_Shield/Wave`、`BP_CameraShake_*`、`BP_RadialBlur` |
| 近战/ARPG | `ARPGVFXPack02` | 290 | 65.4 MB | 12 + 2 BP | ARPG 招式：`NS_Blast*`、`NS_Buff`、`NS_Impack`、`NS_Orb`、`NS_Slash*`、`NS_Ultimate1/3` |
| 近战/ARPG | `TrailMaster` | 208 | 80.7 MB | 52 Cascade | 刀光与粒子拖尾：`P_Trail_001`~`025`、`P_Particle_001`~`025` |
| 受击/护盾 | `Shield_FX_Niagara` | 248 | 163.7 MB | 34 + 18 BP | 多种受击反馈与力场护盾：`NS_Hit_*`（Blood/Electric/Fire/Gold/Poison/Ripple/Soul 等）、`NS_Shield_*`、`BP_FF_Niagara_*` |
| 受击/护盾 | `Shields_VFX_Vol_1` | 319 | 219.3 MB | 6 + 24 BP | 能量护盾体积包：`NS_Effect_01~06`、`BP_Shield_01~20`、`BP_Hit`、`BP_Projectile` |
| 火焰/爆炸 | `UltimateFirePackVol1` | 236 | 215.4 MB | 12 + 6 BP | 写实火焰与烟雾：`NS_FireHero`、`NS_FireLarge~Tiny`、`NS_ExplosionGas_01_Gallery`、`NS_SmallRisingSmoke_*`、`NS_SmokeThickDark` |
| 火焰/爆炸 | `NiagaraExplosion01` | 350 | 428.2 MB | 20 | 空中与地面爆炸：`N_ExplosionAir_001~010`、`N_ExplosionGround_001~010` |
| 烟花 | `FireworksWithSounds` | 54 | 68.8 MB | 23 + 1 BP | **含 14 个烟花音频**：`NS_Brocade`、`NS_Chrysanthemum`、`NS_Comet`、`NS_Peony`、`NS_Rings`、`NS_Willow` 等 |
| 水体 | `WaterVFXNiagara` | 122 | 57.4 MB | 14 | 喷泉/雨/气泡/瀑布：`P_Fountain1~3_Converted`、`P_rain*_Converted`、`P_Waterfall*_Converted`、`P_AirBubble*_Converted` |
| 水体 | `SplashPack` | 294 | 295.5 MB | 21 BP | VAT 水花喷溅与波纹：`BP_Splash_Small/Mid/XL`、`BP_Breach_*`（含 VAT 网格与位置贴图） |
| 传送/变身 | `Cinematic_Portal_Pack` | 66 | 414.9 MB | 12 Cascade | 12 套电影级传送门：`P_Portal1`~`P_Portal12` |
| 传送/变身 | `WarpsPack` | 82 | 46.9 MB | 9 + 9 BP | 9 色星尘跃迁：`P_*Stars` + `BP_*Warp` |
| 传送/变身 | `AbsorbtionFX` | 67 | 120.7 MB | 15 | 10 色能量吸收：`NS_Absorption_*` + 5 个 `NE_*` 发射器 |
| 传送/变身 | `TransformationVFX` | 236 | 239.5 MB | 34 + 35 BP | 网格/骨骼消散变身：`NS_Attractor/Basic/Burst/Curl/Wave` 等（`_SKM`/`_SM`/`_SKM-SM`） |
| 推进器 | `RocketThrusterExhaustFX` | 32 | 45.8 MB | 16 | 12 款火箭尾焰：`NS_RocketExhaust_*` + 4 个 `NE_*` |
| 推进器 | `ThrusterVFX` | 132 | 54.6 MB | 25 + 8 BP | 科幻/火焰/水流推进器：`NS_Thruster*`、`NS_Thruster_Loop*`、`NS_Thruster_Start*` |
| 交互/纹理 | `InteractFx` | 159 | 57.0 MB | 25 | 25 套场景交互高亮/引导 Niagara：`NS_Fx_Interact01`~`25` |
| 交互/纹理 | `Textures` | 174 | 205.6 MB | — | 通用粒子贴图库：Cell、Crack、Dust、Energy、Fire、Flare、Glow、Distort 等 `T_*` |

### 2.3 配套视觉、噪声贴图、LUT 与贴花包（5 个新增）

| # | 包名（Unreal 路径） | 文件数 | 体积 | 核心用途与内容 |
|---:|---|---:|---:|---|
| 1 | `VFXNoiseTexPack`（`/Game/VFXNoiseTexPack`） | 626 | 1,078.7 MB | 特效母纹理与材质库：139 张噪声图、86 张法线噪声、31 张通道合并遮罩、42 张 Sprite 图及 297 个材质实例（可直接导出纹理供 HGame 2D/3D 着色器与粒子使用） |
| 2 | `UWC_Bullet_Holes`（`/Game/UWC_Bullet_Holes`） | 564 | 1,095.6 MB | 弹孔与爆炸破损贴花：176 个材质实例 + 382 张贴花纹理（沥青、砖墙、混凝土、金属、玻璃、木材、POM 炸坑网格等） |
| 3 | `RealisticBloodDecals`（`/Game/RealisticBloodDecals`） | 44 | 12.5 MB | 20 组写实血迹贴花（`MI_BloodSplatter_1`~`20` + 20 张贴图） |
| 4 | `AdvancedGlassPack`（`/Game/AdvancedGlassPack`） | 118 | 89.3 MB | 玻璃材质与碎裂网格：洁净/脏污/冰霜/碎裂/雨湿 5 套玻璃材质 + `GlassBrick`/`GlassPieces` 静态网格 |
| 5 | `AmplifyLUTPack`（`/Game/AmplifyLUTPack`） | 207 | 2.8 MB | 207 张后处理调色 LUT（胶片、复古、黑白、风格化、色盲辅助等） |

---

## 三、音效资产全览（Audio / SFX，共 16 个独立音效包 + 2 个内置音效的特效包）

### 3.1 按功能域分类总表

| 业务域 | 包名 | 文件数 | 体积 | SoundCue 数（约） | 核心内容与代表命名 |
|---|---|---:|---:|---:|---|
| 近战武器 | `MeleeWeaponsSoundEffectsPack1` | 2,490 | 596.3 MB | 1,245 | **最大战斗音效包**：挥砍（`SWSH_Swing` 180、`SWSH_Designed` 162、`SWSH_Sword` 59）、金属碰撞/格挡（`METLImpt_*`、`METLFric_*`）、血肉刺穿/劈砍（`GOREStab_*` 85、`GOREFlsh_*` 43、`GORESqsh_*` 37）、木盾撞击（`WOODImpt/Crsh`）、火焰挥舞、UI Glitch |
| 近战武器 | `SwordPackUE` | 276 | 37.3 MB | 138 | 剑类专项：刺击（`Sword_Stab` 33）、轻/中/重斩（`Light/Medium/Heavy_Sword` 65）、挥舞（25）、格挡弹反（`Sword_Parry` 11）、拔剑/收剑（`Sheathe/Unsheathe` 4） |
| 枪械射击 | `GunSoundPack` | 838 | 76.7 MB | 418 | 手枪（64）、步枪（54）、半自动（40）、冲锋枪（33）、左轮（28）、霰弹（25）、机枪（14）、衣物战术 Foley（30）、爆炸（远/近/深沉）、FPS 播报（`headshot`/`killingspree`/`frenzy`）、环境鸟鸣/蝉鸣/引擎 |
| RPG 技能/综合 | `RPGSkillSound` | 133 | 12.5 MB | 66 | 奇幻技能音效：圣盾/祝福/治疗/净化（`Sanctuary`、`Shield_of_faith`、`Chain_Heal`、`Healing_Light`）、重击/碎地/突进/旋风（`Mighty_Blow`、`Land_Sunder`、`Dash_crushing`）、弓箭齐射 |
| RPG 技能/综合 | `SoundPackRPGGames` | 1,410 | 83.1 MB | 940 | RPG 综合库：Actions(35)、Attacks(60)、Crafting(25)、人类脚步(100 Cue/200 Wav)、怪物脚步(100 Cue/200 Wav)、Magic(60)、MagicElixir(30)、Voices(60)，含弓箭命中、门、金币、炸药桶/水爆、工坊制作 |
| 奖励/拾取/UI | `RewardsLootsAudioPack` | 458 | 79.7 MB | 229 | 开宝箱（`Open_Chest_01~05` 31）、魔法战利品（26）、拾取金币/道具/卡片/药水/武器（`Found_Money`、`Find_Item`、`Find_Epic_Item`）、升级/入队/交任务、砸罐子/木箱（`Break_Jar`、`Break_Wood`） |
| 奖励/拾取/UI | `Coin_And_Gem_SFX` | 168 | 42.3 MB | 84 | 硬币/宝石专项：`Coins`（25）、`Coin_Drop`（16）、`Coin_Pile`（16）、投掷/零钱/宝石袋/铁盒钱币 |
| 脚步与人声 | `FootstepsSoundPack` | 1,375 | 213.1 MB | 145 | 14 类材质/风格脚步：地毯、水泥、牛仔靴、草地、碎石、落叶、金属、怪物、复古、机械、沙地、雪地、水与泥地、木板，含盔甲轻/重 Foley（88~154/组）及男女人声喘息/受击/跳跃发力（20 Cue） |
| 门窗交互 | `Doorssfx` | 503 | 16.2 MB | 324 | 开关门（`op_cl` 52、`v2_op` 18）、门把手（`handle_strong/separete/misc` 96）、门轴吱呀（`sq_0/1/2/4` 86）、锁门/木门噪声 |
| 生存建造 | `Survival_SFX` | 481 | 70.0 MB | 241 | 采集（砍树倒地、镐敲矿、碎石、铲土、钓鱼、采摘）、制造（铁砧、锤击、手锯、木工/布艺、建造/拆除）、生存（生火烹饪、急救包扎、浇水种植）、移动与 UI |
| 科幻碰撞 | `Futuristic_Impacts` | 116 | 5.5 MB | 58 | 科幻与机械打击：`Game_Futuristic`（37）、`Game_Small`（13）、`Game_Robot`（5）、`Game_Sci`（2）、`Game_Alien`（1） |
| 丧尸怪物 | `Zombie_Sound_Effects_Bundle` | 1,322 | 182.7 MB | 661 | 完整丧尸合集：攻击/死亡/啃食/受击/待机/吼叫/压碎（`UI_Zombies` 260、`UI_Crushing` 130、`UI_Classic` 129、`UI_Vicious` 112、`UI_Big` 26）+ 4 条紧张生存环境音 |
| 丧尸怪物 | `ClassicZombieSFXv2` | 534 | 51.4 MB | 267 | 经典丧尸子集（`UI_Classic` 129、`UI_Vicious` 112、`UI_Big` 26） |
| 恐怖/氛围音轨 | `MegaBundleSoundPack` | 1,106 | 2,936.2 MB | 553 | 7 合 1 大包：`DarkAmbientSoundtracks`（58 Cue，含 20 轨音轨）、`MystickSoundtracks`（142 Cue，含追逐/神秘音轨）、`GameReadySounds`（69）、`GameReadySounds2`（66）、`HorrorSoundPack`（66）、`HorrorSoundPack2`（74）、`PhobiaSoundPack`（78） |
| 恐怖/氛围音轨 | `HorrorSoundPack2` | 198 | 724.4 MB | 37 | 恐怖氛围音与噪声（含部分未封装 `.wav`/`.uasset` 源文件） |
| 载具引擎 | `V10_German` | 264 | 44.3 MB | 40 | V10 跑车引擎（怠速/低中高转速/启动/激进模式 + 内嵌 FMOD Bank 资源 `Fmod_V10_German` 144 文件） |
| 附带音效（特效包内） | `Vefects` + `FireworksWithSounds` | — | — | 47+ | `Vefects/Water/Audio`（47 Cue：滴水/水龙头/喷泉/水流循环）；`FireworksWithSounds/Audio`（14 个烟花爆炸/升空音效） |

---

## 四、重叠包排查与清理建议

1. **音效包重复（建议去重后再导出）**
   - `ClassicZombieSFXv2`（267 Cue）的命名分布与 `Zombie_Sound_Effects_Bundle`（661 Cue）中的 `UI_Classic` / `UI_Vicious` / `UI_Big`（共 267 Cue）完全一致，属于子集重复；导出时以 `Zombie_Sound_Effects_Bundle` 为准即可。
   - `HorrorSoundPack2`（根目录，198 文件 / 724.4 MB）与 `MegaBundleSoundPack/HorrorSoundPack2`（148 文件 / 74 Cue）存在重叠；可按体积与源文件完整度二选一保留。
2. **VFX Cascade vs Niagara 双版本**
   - `Realistic_Starter_VFX_Pack_Vol2`（56 个 Cascade `P_*`）与 `Realistic_Starter_VFX_Pack_Niagara_Vol2`（60 个 Niagara `NS_*`）为同系列两个版本；若后续统一导出到 WebAsset / HGame，优先解析 **Niagara（`NS_*`）**，Cascade 版可作备用或参考。
3. **非粒子辅助包区分处理**
   - `AmplifyLUTPack`（207 张调色 LUT）和 `VFXNoiseTexPack`（噪声/序列帧纹理）最适合直接导出为 WebAsset 贴图资源，供 `hgame-vfx.js` 与游戏后处理直接复用。
   - `UWC_Bullet_Holes` 与 `RealisticBloodDecals` 属于贴花（Decals），适合并入现有的 `/api/hgame/unreal/catalog` `decals` 通道，与 `/Game/_Decals`（混凝土/弹坑/路面/血迹）统一管理。
   - `V10_German/External_Content/Fmod_V10_German`（144 个 FMOD 文件）无法直接作为 `.wav` 导出，导出时应仅读取其 `Wavs/` 或 `Cues/`。

---

## 五、后续接入 WebAsset / HGame 建议优先级

1. **第一批高性价比导出（可直接落地到 HGame 游戏）**
   - **音效（最易无损直出 `.wav` / `.ogg`）**：`MeleeWeaponsSoundEffectsPack1`、`SwordPackUE`、`GunSoundPack`、`RPGSkillSound`、`RewardsLootsAudioPack`、`Coin_And_Gem_SFX`、`FootstepsSoundPack`、`Zombie_Sound_Effects_Bundle`、`Survival_SFX`、`Vefects/Water/Audio`。
   - **贴花与纹理（可直接导出 `.png` / `.webp`）**：`RealisticBloodDecals`、`UWC_Bullet_Holes`、`VFXNoiseTexPack/Textures/Sprites`、`AmplifyLUTPack`。
2. **第二批特效导出（Niagara / 序列帧 / 网格映射）**
   - 优先从 `Realistic_Starter_VFX_Pack_Niagara_Vol2`、`RealisticBlood`、`Vefects/Water`、`ARPGVFXPack02`、`Air_Wind_Spell_VFX_Pack`、`Ice_Element_VFX_Pack`、`Lightning_Element_VFX`、`UltimateFirePackVol1` 提取发射器参数、粒子网格（`.glb`）与 Flipbook 序列帧（`.png`），接入 `catalog.json` 的 `vfxSystems` / `vfxMeshes` / `vfxTextures`，即可直接在当前已清理好的 WebAsset「特效」工作区预览并生成 HGame `createVfxSystem` 调用代码。
