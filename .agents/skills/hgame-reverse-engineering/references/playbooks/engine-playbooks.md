# 通用游戏逆向：引擎识别、工具选型与技术 Playbook

> **Status:** 1.1 — 2026-11-07（补充 MonoGame/XNA 与 LayaAir/Egret 专项路线）
> **定位：** 本 Skill 的 `workflow.md` 技术补充，不另立第二套项目流程。
> **适用范围：** `progames/` 原作离线单机逆向研究，以及经批准的其他游戏研究任务。
> **核心原则：** 引擎决定工具，构建版本决定解析兼容性，单机玩法决定研究范围；最终都交付可追溯的程序规则、数据契约、证据和覆盖状态。
> **工具补充：** 各工具用途、局限、版本检查和替代方案见同目录 `tool-catalog.md`；每款游戏的实际工具版本写入 `production/engine-profile.json`。

## 1. 统一原则：工具可以不同，逆向产物必须统一

不同引擎的程序形态可能是源代码、托管字节码、脚本字节码、Blueprint/场景资源、原生机器码或 WebAssembly。不能用一套反编译器强行处理所有游戏，也不能因为提取出了资源包就认为程序已经逆向完成。

所有游戏统一遵循以下研究链：

```text
原始输入与版本基线
  → 引擎 / 运行时 / 平台识别
  → 文件与资源容器索引
  → 选择对应解析器、反编译器和调试工具
  → 程序入口与调用关系
  → 状态机、数据流、条件、公式、时序与持久化
  → 数据驱动内容与资源引用契约
  → 规范化证据、覆盖账本、实现规格
  → 程序完成后提取策划数据
  → 按需提取原作资产与原声
  → HTML 单机装配
  → 集中测试和差分验收
```

**工具选择原则：**

1. 先识别真实文件格式和运行时，不凭文件扩展名、游戏宣传或文件夹名称猜引擎。
2. 先找可用源代码、调试符号、脚本、反射元数据和资源索引；只有缺少更高层证据时才下沉到字节码或机器码。
3. 一个模块优先选择一个主解析工具、一个独立交叉验证手段；不要无目的地安装一堆重叠工具。
4. 引擎大版本、脚本后端、打包格式、平台和补丁版本都可能改变解析方式。先核对工具兼容矩阵，再用一个代表样本校准，校准通过后批量处理。
5. 静态分析负责恢复可重复的规则证据；动态调试只补静态分析无法回答的状态、时序或动态分派问题。动态观察必须在获准的本地离线环境中进行。
6. 资源解包、资产预览、程序反编译和运行时调试是不同工作，不互相替代。
7. 不把原始游戏二进制、整包反编译源码、未经筛选的大型原始资源复制进 Git。保存必要的文件路径、hash、符号、数据 ID、调用锚点和语义结论。

## 2. 第一次接手：识别游戏技术画像

每个游戏只建立一份 `analysis/<Game>/production/engine-profile.json`（已有项目可沿用现有路径），并在源版本变化时更新。新项目从 [`docs/reverse-engineering/templates/engine-profile.template.json`](reverse-engineering/templates/engine-profile.template.json) 复制。至少记录：

| 维度 | 必须识别的内容 | 为什么重要 |
|---|---|---|
| 原始构建 | 游戏版本、补丁、平台、语言、文件 hash | 避免混用不同版本的规则和资源 |
| 容器格式 | EXE、APK、IPA、JAR、PCK、PAK、IoStore、AssetBundle、WASM 等 | 决定第一层解析工具 |
| 引擎 | Unity、Unreal、Godot、Cocos、GameMaker、RPG Maker、Ren'Py、自研等 | 决定场景、对象和资源模型 |
| 脚本后端 | C# Mono、IL2CPP、GDScript、C#/Mono、JS/TS、Lua、Python、Ruby、Java/Kotlin 等 | 决定程序代码的恢复路径 |
| 原生代码 | DLL/SO/dylib、静态库、原生插件、符号文件 | 决定是否需要 Ghidra/IDA 等 |
| 数据驱动 | JSON、XML、CSV、二进制表、Blueprint、ScriptableObject、Resource、Scene 等 | 决定玩法配置和策划数据提取方式 |
| 资源系统 | AssetBundle、Addressables、PAK、PCK、RPA、资源索引/注册表等 | 决定资源引用和批量提取方式 |
| 执行环境 | Windows、Android、iOS、浏览器、Linux；单机入口及存档位置 | 决定可用调试器和验证路径 |

### 2.1 引擎指纹参考

以下只是线索，必须至少由两个相互独立的信号交叉确认；无法确认时写 `unknown`，不要猜。

| 技术路线 | 常见文件/结构线索 | 需要继续确认的分支 |
|---|---|---|
| Unity | `UnityPlayer.dll`、`*_Data/`、`Managed/`、`GameAssembly.dll`、`global-metadata.dat`、`AssetBundle`、`StreamingAssets` | Mono 还是 IL2CPP；Unity 版本；Addressables；平台 |
| Unreal Engine | `.pak`、`.ucas`、`.utoc`、`.uasset`、`.uexp`、`.ubulk`、`DefaultGame.ini`、PDB | UE4/UE5 具体版本；Pak 还是 IoStore；Blueprint/C++ 比例；符号可用性 |
| Godot | `project.godot`、`.pck`、`.tscn`、`.tres`、`.gd`、`.gdc`、`GodotSharp/` | Godot 3/4；GDScript/C#；脚本是否加密或仅字节码 |
| Cocos | `src/`、`assets/`、`settings.*`、`config.*`、`main.js`、`import/`、`native/` | Creator 2.x/3.x；JS/TS、Lua 或 C++；Web/原生构建 |
| LayaAir / Egret | `bin/js/`、`libs/`、`resource/`、`version.json`、`manifest.json`、`.lh`、`.ls`、`.exml` | IDE/运行时版本；JS/TS、字节码或原生扩展；资源/场景序列化版本 |
| GameMaker | `data.win`、`game.unx`、`*.yy`、`options.ini` 等 | VM 字节码还是 YYC 原生编译；GameMaker 版本 |
| RPG Maker | MV/MZ 的 `www/`、`js/`、`data/*.json`；旧版 RGSS/Ruby 文件 | MV/MZ JavaScript 还是 XP/VX/Ace Ruby；NW.js/RGSS 版本 |
| Ren'Py | `renpy/`、`game/`、`.rpa`、`.rpy`、`.rpyc` | Ren'Py/Python 版本；脚本源文件还是编译字节码 |
| Java/JVM | `.jar`、`.class`、`META-INF/`、Android DEX | 桌面 JVM、Android DEX、混合 JNI；具体 Java 版本 |
| MonoGame / XNA | `.exe`、`.dll`、`.xnb`、`Content/`、MonoGame/XNA 程序集 | Content Pipeline 版本、自定义压缩/Content Type、Mono/.NET 运行时 |
| Web | HTML、JS chunk、source map、JSON、WASM、Service Worker | Webpack/Vite/自定义打包；脚本是否压缩/混淆；WASM 模块 |
| 原生/自研 | PE、ELF、Mach-O、DLL/SO/dylib、PDB/dSYM、资源容器 | CPU 架构、编译器、符号、脚本虚拟机和自定义序列化 |

### 2.2 混合引擎不要强行归成单一类别

一个游戏可能同时包含 Unity IL2CPP + Lua、Unreal C++ + Blueprint、Cocos JS + 原生插件、Java + JNI、浏览器 JS + WASM。`engine-profile.json` 的 `engine` 保存主要引擎摘要；混合引擎或自定义运行时在 `engine_components[]` 中逐项记录 `role/name/version/confidence/evidence`，并在 `runtimes[]` 中记录语言、执行后端和职责，明确哪些玩法逻辑实际位于哪一层。单一引擎项目不必重复填多个组件。

## 3. 引擎与工具选型矩阵

工具是候选技术栈，不表示已经安装、验证或保证兼容当前游戏版本。正式批量运行前必须检查官方项目说明、版本支持、许可和安全性，并记录实际使用版本。

| 引擎 / 分支 | 程序分析主工具 | 数据 / 资源工具 | 运行时补充 | 关键注意事项 |
|---|---|---|---|---|
| Unity Mono | ILSpy、dnSpyEx；必要时 dotPeek | AssetRipper、UABEA；按需检查 Addressables catalog | Unity Player 日志、Profiler（可用时） | 优先检查 `Managed/*.dll`；程序集反编译不等于 ScriptableObject/场景数据已提取 |
| Unity IL2CPP | Cpp2IL、Il2CppDumper 或 Il2CppInspector；Ghidra/IDA 辅助原生分析 | AssetRipper、UABEA；Addressables 索引 | Player 日志、受控调试/日志 | 需要匹配 `GameAssembly`/`libil2cpp` 与 `global-metadata.dat`；工具对 Unity 版本支持差异很大，至少交叉验证类型、方法和地址映射 |
| Unreal Blueprint | FModel、UAssetGUI、UAssetAPI；必要时 UE Viewer/umodel | UnrealPak、FModel、UAssetAPI | Unreal 日志、Insights（构建支持时） | Blueprint 资源解析不代表所有图表逻辑都能自动还原；需追踪节点、引用、继承和事件绑定 |
| Unreal C++ | PDB/符号优先；Ghidra、IDA 或 Binary Ninja | UnrealPak、FModel、UAssetGUI/UAssetAPI | Unreal Insights、日志、获准的本地调试 | UE4/UE5、Pak/IoStore、反射布局和符号可用性影响很大；无符号时函数命名与类型恢复要标注置信度 |
| Godot GDScript | 优先读取 `.gd`；GDRE Tools / Godot RE Tools 处理 PCK 与受支持的字节码 | GodotPCKExplorer、GDRE Tools；解析 `.tscn`/`.tres` | Godot Debugger / Profiler（可用时） | `.gdc` 兼容性依赖 Godot 版本；不要把场景资源导出当成脚本逻辑恢复 |
| Godot C# / GDExtension | ILSpy 分析托管程序集；Ghidra 分析原生扩展 | GDRE Tools、PCK/资源解析 | Godot Debugger；本地日志 | C# 与 GDScript、原生扩展可能共同决定一个状态机 |
| Cocos Creator JS/TS | 原始脚本/source map 优先；Chrome DevTools、AST 工具、Prettier（仅格式化） | Creator 版本对应的资源配置/导出解析器 | Chrome DevTools、Cocos DevTools | Creator 2.x/3.x 输出差异大；从 `settings`、`config`、bundle、组件脚本和资源 UUID 建立引用关系 |
| Cocos 原生 / Cocos2d-x | PDB/符号优先；Ghidra、IDA、Binary Ninja | 对应版本的资源包解析器 | Android logcat、原生调试器 | JSB/原生绑定要把脚本 API 与 C++ 实现连接起来 |
| LayaAir / Egret | 原始 JS/TS、source map、AST；对应版本 IDE | 场景/资源 manifest、`.lh/.ls/.exml` 版本化解析 | Chrome DevTools、Android logcat | 不把 Cocos Creator 的 UUID、bundle 或序列化结构套到 Laya/Egret |
| GameMaker VM | UndertaleModTool（针对其支持的版本/格式） | UndertaleModTool 数据/资源查看 | 游戏日志、受控运行观察 | `data.win` 等格式有版本差异；数据提取与脚本语义要分开验收 |
| GameMaker YYC | Ghidra、IDA、Binary Ninja；符号优先 | UndertaleModTool 能解析的资源部分 | x64dbg/WinDbg（仅本地获准环境） | YYC 逻辑已进入原生代码，不能假设 VM 反编译方案适用 |
| RPG Maker MV/MZ | JavaScript 源码、Chrome DevTools、AST/调用关系 | JSON 数据、插件和媒体清单 | NW.js/Chrome DevTools | 玩法常由数据库 JSON + 插件共同决定；需解析 ID 引用和插件覆写顺序 |
| RPG Maker XP/VX/Ace | Ruby/RGSS 脚本；按版本选择兼容解析工具 | RGSS 数据与资源索引 | 对应 RGSS 运行日志/调试 | 不同 RGSS 版本、脚本压缩和运行时差异需先识别；不要套用 MV/MZ 流程 |
| Ren'Py | `.rpy` 源码优先；unrpyc（仅限支持的 `.rpyc` 版本） | RPA 归档解析工具、Ren'Py 资源索引 | Ren'Py 日志/开发控制台（可用时） | 对话、分支、变量、屏幕语言和 Python hook 要一起分析；反编译失败需标记未知 |
| Lua / LuaJIT 嵌入式脚本 | 原始 `.lua` 优先；匹配版本的 `luac -l`、`unluac` 或 LuaJIT 字节码工具 | 引擎脚本包、表格/配置和资源 ID 索引 | 引擎日志、脚本调试器（可用时） | 标准 Lua 与 LuaJIT 字节码不是同一格式；必须识别 Lua 版本、字节码版本和 C/C++ 绑定 |
| Java / JVM | CFR、Vineflower/FernFlower；必要时自建 class-file/字节码解析 | ZIP/JAR、资源索引和数据文件解析 | JVM 日志、受控调试器 | 先分析托管字节码；混淆、反射、invokedynamic、Lambda、动态类加载要独立追踪 |
| MonoGame / XNA | ILSpy/`ilspycmd`、dnSpyEx | 对应版本的 XNB/Content Pipeline 解析器 | Mono/.NET 日志、受控调试器 | XNB 是序列化内容对象，不是通用贴图格式；自定义 Content Type 需追踪读取代码 |
| Android DEX / Kotlin | JADX；必要时 baksmali/smali、Java/Kotlin 反编译器 | apktool、bundletool、APK/OBB/Asset Pack 索引 | adb、logcat、Android Studio 调试（授权环境） | 识别 APK split、ABI、JNI、动态 feature；DEX 反编译与原生 `.so` 分开分析 |
| 浏览器 / HTML5 | DevTools、source map、JS AST、模块/Bundle 分析 | Network/Cache/IndexedDB、JSON、资源 manifest | Chrome/Edge DevTools | 先区分客户端玩法与远端 API；单机目标只研究必要的本地规则，不复刻线上服务 |
| WebAssembly | wasm-tools、wasm2wat、wasm-decompile；Ghidra（支持的模块） | WASM module、配套 JS glue 和数据文件 | 浏览器 DevTools、性能/调用分析 | 必须把 JS glue、导入导出函数、内存布局和 WASM 逻辑一起看 |
| 原生 C/C++ / 自研 | Ghidra、IDA、Binary Ninja、radare2；符号优先 | 自定义 archive/parser、资源 ID/注册表索引 | x64dbg、WinDbg、LLDB、平台调试器 | 先确定架构、ABI、编译器、符号和自定义脚本 VM；函数恢复要保留地址/调用点锚点与置信度 |

### 3.1 工具使用优先级

推荐按以下顺序逐层下沉：

1. **原始源码 / 调试符号 / 配置 / 官方数据导出**：优先使用，避免无意义地反编译。
2. **引擎原生资源索引和反射元数据**：恢复对象类型、资源 ID、继承、序列化字段和脚本绑定。
3. **脚本源码 / 托管程序集 / 字节码反编译**：恢复可读程序逻辑。
4. **调用图、控制流、数据流和跨方法状态分析**：恢复实际规则。
5. **原生反汇编与符号恢复**：仅对原生代码或前面无法解释的部分使用。
6. **动态日志、Profiler、调试器、受控 instrumentation**：仅解决静态证据缺失的动态问题。

不要从第 5 层开始分析一个其实有完整 C#、JS 或 GDScript 的游戏；也不要对每个模块都启动运行时调试。

## 4. 各引擎专项工作方法

### 4.1 Unity

**第一步：判断 Mono / IL2CPP。**

- Mono 常见证据是 `*_Data/Managed/Assembly-CSharp.dll` 及其他托管程序集。先用 ILSpy/dnSpyEx 建立程序集、命名空间、类型、方法和调用关系索引。
- IL2CPP 常见证据是 `GameAssembly.dll`（Windows）或 `libil2cpp.so`（Android/Linux）以及 `global-metadata.dat`。先用与版本兼容的 Cpp2IL / Il2CppDumper / Il2CppInspector 恢复类型、方法和地址映射，再把关键原生函数送入 Ghidra/IDA 分析。
- 不要把 IL2CPP 恢复出来的类型声明误认为原始 C# 源码；方法体可能需要进一步分析机器码。

**第二步：恢复对象和数据。**

- 用 AssetRipper/UABEA 等适配工具查看实际使用的场景、Prefab、ScriptableObject、Animation/Animator 状态、TextAsset、配置和资源引用。
- 追踪 `Resources`、AssetBundle、Addressables catalog、GUID/PathID 和运行时加载入口；以程序引用为准，不对所有美术资源做无目的全量研究。
- Mono 项目重点连接 `MonoBehaviour`/`ScriptableObject` 脚本字段与资源实例；IL2CPP 项目重点连接恢复的类型/字段与序列化对象。

**第三步：恢复行为。**

- 先定位 `Awake/OnEnable/Start/Update/FixedUpdate/LateUpdate`、输入回调、碰撞/触发回调、协程、事件总线和状态机入口。
- 对每个玩法模块追踪：输入 → 组件/系统 → 条件/公式 → 状态变化 → 事件/动画触发 → 存档。
- Unity 的执行顺序、协程等待、FixedUpdate 与 Update 的时序不能仅凭方法名推断；只在关键时序静态证据不足时使用日志或 Profiler 验证。

**常见误区：** 只导出 AssetBundle 就说玩法已逆向；把 Animator 状态机等同于 AI；混淆 Mono 与 IL2CPP；忽略 Addressables、ScriptableObject 覆盖和运行时动态加载。

### 4.2 Unreal Engine

**第一步：识别版本和容器。**

- 识别 UE4/UE5 版本线索、`.pak` 与 IoStore (`.utoc/.ucas`) 的组合、`.uasset/.uexp/.ubulk` 资源结构及可用 PDB/符号。
- 用 UnrealPak/FModel 等兼容工具列出容器和资源索引；版本不匹配时先解决解析兼容性，不要把解析错误当作文件缺失。

**第二步：恢复 Blueprint 和反射关系。**

- 使用 FModel、UAssetGUI/UAssetAPI 等查看 UObject 类型、属性、引用、父类、Blueprint 资源和可解析的图表数据。
- 从 GameMode、GameState、PlayerController、Pawn/Character、Actor、Component、Subsystem、DataTable、DataAsset、GameplayTag、GameplayAbility 等真实入口建立对象图。
- 追踪 Event Graph、Function Graph、Dispatcher/Delegate、Interface、Timer、Latent Action、Gameplay Ability 和蓝图继承覆盖。仅有节点列表而没有执行顺序、输入输出和绑定关系，不算恢复 Blueprint 逻辑。

**第三步：恢复 C++。**

- 有 PDB/符号时先恢复函数和类型；无符号时用 Ghidra/IDA/Binary Ninja，结合 UObject 反射、字符串、调用点和对象布局逐步命名。
- 将 Blueprint 调用的 Native 函数与 C++ 实现关联起来；特别关注 BlueprintNativeEvent、BlueprintImplementableEvent、虚函数和反射调用。

**常见误区：** 把 FModel 导出的资产视为程序逆向；把 Blueprint 事件节点当作完整状态机；忽略 C++ 基类逻辑；混淆 Pak 与 IoStore；没有证据就猜测加密资源内容。遇到不可访问或无授权的加密内容，应登记 `blocked`，不得尝试绕过访问控制。

### 4.3 Godot

- 先识别 Godot 3/4、PCK 格式、GDScript/C# 和原生 GDExtension。
- `.gd` 源码可用时直接读取；PCK 用 GodotPCKExplorer/GDRE Tools 等兼容工具索引；`.gdc` 字节码只有在工具支持对应引擎版本时才尝试解析。
- 把 `.tscn` 场景树、`.tres` Resource、脚本、Autoload/Singleton、Signal、AnimationPlayer、Timer、物理回调和存档一起建立引用图。
- C# 程序集用 ILSpy；GDExtension 的 `.dll/.so` 用符号或 Ghidra 分析。
- 重点追踪 `_ready`、`_process`、`_physics_process`、`_input`、`_unhandled_input`、Signal、SceneTree 切换和 Resource 引用；物理 Tick 与普通帧 Tick 分开记录。

### 4.4 Cocos Creator / Cocos2d-x

- 先识别 Creator 2.x/3.x、Web/原生、JS/TS/Lua/C++ 组合；从 `settings`、`config`、bundle、UUID、import/native 目录建立资源索引。
- 优先使用 source map 和原始 JS/TS；否则对 bundle 做格式化、模块拆分和 AST 分析。格式化只改善可读性，不等于去混淆或恢复原始变量名。
- 从 Component 生命周期、节点事件、Director/Scene、Scheduler、Tween、碰撞回调、事件系统、脚本间引用和资源 UUID 追踪玩法。
- Cocos2d-x 或 JSB 的 C++/原生绑定使用符号和 Ghidra/IDA；将脚本 API 与原生实现连接起来。
- 不同 Creator 大版本的资源序列化和 bundle 布局不同，必须按版本选择解析器。

### 4.5 Java / JVM / Android

- 桌面 JVM：先检查 JAR/模块和 manifest；用 CFR 或 Vineflower 恢复可读源码，必要时使用自建 class-file 解析器提取签名、调用、字段、常量、分支、BootstrapMethods 和 MethodHandle。
- Android：用 JADX 分析 DEX/Kotlin，apktool 检查 Manifest、资源和配置；split APK、Asset Pack、ABI 和 JNI 需要单独登记。
- 原生 JNI 库用 Ghidra/IDA；不要假设 Java 层方法调用就包含了全部逻辑。
- 重点处理混淆、反射、Lambda/invokedynamic、动态类加载、服务端权威规则和资源注册表。
- 示例 JVM 项目的 class-file 解析、方法选择器、静态调用边、字段访问、常量、分支和 Lambda 追踪，可作为本 Playbook 的 JVM 参考做法；但具体实现须按目标版本核对，并非所有 JVM 游戏都适用同一脚本。

### 4.6 Web / HTML5 / WebAssembly

- 首先检查 source map、ES module、Webpack/Vite chunk、动态 import、JSON 配置、IndexedDB/localStorage、Service Worker 和资源 manifest。
- 使用 Chrome/Edge DevTools 的 Sources、Network、Application、Performance；以源映射还原模块边界，缺少 source map 时用 AST 解析和模块依赖图，不要只依赖全文搜索。
- 追踪输入事件、requestAnimationFrame、定时器、状态 Store、事件总线、Worker、Canvas/Pixi/Three 对象与真正玩法状态的边界。
- 对 WASM 同时分析 JS glue、imports/exports、线性内存、调用约定和 WASM 函数；工具可选 wasm-tools、wasm2wat、wasm-decompile、支持 WASM 的 Ghidra。
- 明确区分本地客户端逻辑与远端 API。离线单机重构目标不逆向或实现不必要的线上服务、认证、匹配和云端功能。

### 4.7 GameMaker、RPG Maker、Ren'Py

- **GameMaker：** 识别 VM 字节码还是 YYC 原生编译；对受支持的 `data.win` 等格式可用 UndertaleModTool 查看脚本、对象、房间、事件和资源；YYC 逻辑需要原生反汇编。对象事件顺序和 room 生命周期要恢复。
- **RPG Maker MV/MZ：** 主要研究 JavaScript 引擎、插件覆写顺序、`data/*.json` 数据库、地图事件、公共事件、变量/开关和脚本命令；数据 ID 与插件执行顺序是关键。
- **RPG Maker XP/VX/Ace：** 识别 Ruby/RGSS 版本和脚本存储格式，不能套用 MV/MZ 的 JS/JSON 工具链。
- **Ren'Py：** 优先读取 `.rpy`；归档和编译脚本使用兼容当前 Ren'Py/Python 版本的解析工具。恢复 label/jump/call、变量、条件分支、屏幕、回调和剧情状态；不能只提取对白文本就声称剧情程序完整。

### 4.8 原生 C/C++ 与自研引擎

- 先识别 PE/ELF/Mach-O、CPU 架构、ABI、编译器、导入库、PDB/dSYM、字符串和资源容器；符号存在时优先使用。
- 以 Ghidra/IDA/Binary Ninja/radare2 建立函数、交叉引用、调用图、结构体和全局状态；不要一开始试图给所有函数命名。
- 从主循环、输入、场景/实体管理、碰撞、AI、战斗、资源读取和存档入口开始，沿调用边逐步扩展。
- 动态调试可按平台选择 x64dbg、WinDbg、LLDB 等。只在合法、获准的本地离线样本上使用；记录断点、输入条件、调用栈、内存字段变化和可复现步骤。
- 若游戏内部包含 Lua、Python、JavaScript 或自定义 VM，先恢复脚本装载/绑定接口，再分别分析脚本层和 native 层。

### 4.9 Lua / LuaJIT 嵌入式脚本

- 有 `.lua` 源码时直接建立模块依赖和调用索引；若只有字节码，先确认 Lua 5.x 具体版本还是 LuaJIT，再选对应反汇编/反编译工具。标准 Lua 的 `luac -l`、`unluac` 不能直接套用到任意 LuaJIT 字节码。
- 从 `require`、模块加载器、脚本注册表、全局表、回调注册和 C/C++ binding 开始追踪；脚本逻辑经常由 native 侧驱动，必须连接双方调用边。
- 对状态机、定时器、协程、事件总线和热更新脚本，记录脚本加载顺序、模块覆盖、运行时替换和存档序列化边界。

### 4.10 Source / Source 2

- 区分 Source 1 与 Source 2、具体游戏分支和资源版本；检查 VPK、BSP、VMF（若有）、Source 2 `.vpk`、compiled resource 和 manifest。
- Source 1 可用 VPK/地图/模型专用工具检查资源与实体；Source 2 使用 VRF/VPKEdit 等匹配版本的工具。
- 追踪地图实体、输入输出连接、触发器、spawn、nav、关卡脚本、游戏规则配置和资源引用。
- 地图必须恢复实体逻辑和可玩空间，不能用 BSP 截图或模型导出替代实体/触发图；模型/材质只提取对象识别和必要碰撞/挂点，不做 Shader、粒子或光照复刻。
- Source 1/2 的包格式与资源 schema 不同；版本不匹配时先建立最小样本 parser，不要直接批量转换。

### 4.11 Flash / Adobe AIR

- 识别 SWF/AIR 版本、AS2/AS3、主时间轴、外部 SWF、资源库和原生 AIR 扩展。
- 使用 JPEXS Free Flash Decompiler 等候选工具查看 ActionScript、符号、时间轴和嵌入资源；反编译代码需保留帧/事件顺序。
- 使用 Ruffle 或原运行环境观察启动、输入、计时和状态切换；注意 Ruffle 的兼容性不等于原作运行环境。
- 恢复影片剪辑状态、按钮事件、帧标签、定时器、外部数据和本地存档；不把动画时间轴本身当作完整玩法逻辑。

### 4.12 Defold / LÖVE / libGDX 等脚本型或 JVM 2D 引擎

- **Defold：** 识别 `game.project`、`.arcd`、`.dmanifest`、collection、Lua 脚本和引擎版本；恢复 collection/GO/component 层级、脚本消息、输入绑定、factory/spawn、碰撞对象和资源引用。发布包脚本可能已编译，按 Lua/Defold 版本确认可读性。
- **LÖVE：** `.love` 常为 ZIP 风格包，入口通常是 `main.lua` 和 `conf.lua`；恢复 Lua 模块、`love.update/draw/key/mouse/touch` 回调、资源加载和存档。Lua bytecode 需与 Lua 版本匹配，不将任意 Lua decompiler 用于所有字节码。
- **libGDX：** 识别 JVM 桌面/Android 包、Java/Kotlin 代码、assets、TextureAtlas、地图/关卡文件和 native libraries；使用 JVM/Android 反编译器恢复业务逻辑，原生模块另走 Ghidra/IDA。
- 其他 Lua/JS/Python 游戏框架先识别脚本 VM/解释器版本和 native bridge，再从启动入口、模块注册、事件循环、资源加载和状态持久化向下追踪。

### 4.13 MonoGame / XNA

- 先识别 .NET/Mono 运行时、程序集、Content Pipeline 代际和 XNB 版本；XNB 是序列化内容对象，不是通用图片容器。
- 托管逻辑使用 ILSpy/`ilspycmd` 或 dnSpyEx；资源解析优先使用匹配版本的 XNA/MonoGame Content Pipeline 或针对目标 Content Type 的解析器。
- 追踪 `Game.Update`/`Draw`、输入、实体/组件、碰撞、随机、时间步长、`ContentManager` 加载、关卡状态和存档。
- 对自定义压缩、Content Type 或扩展读取器，记录缺失类型与依赖；不要对不明格式反复套用其他游戏的 XNB 工具。

### 4.14 LayaAir / Egret

- 先确认 LayaAir/Egret 版本、Web/原生发布方式、JS/TS/Lua/C++ 后端和资源压缩方式。常见线索包括 `bin/js/`、`libs/`、`resource/`、`version.json`、`manifest.json`、`.lh`、`.ls`、`.exml`。
- 优先寻找未压缩 JS、source map、场景/Prefab 序列化文件和资源 manifest；用对应版本 IDE 或解析器确认字段含义。
- 压缩 JS 用 source map、模块边界和 AST 分析；`.jsc`、自定义二进制和 WASM 不假设可直接反编译，必要时沿 JS/native 边界追踪。
- 重点追踪 Scene/Node/Component、生命周期、事件总线、输入、物理、计时器、资源异步加载、热更新、存档和关卡状态。
- 不把 Cocos Creator 的 UUID、bundle、资源导入目录和场景 Schema 套用到 LayaAir/Egret。

## 5. 跨引擎统一的程序分析方法

无论工具不同，每个玩法系统都按相同的问题清单研究。

### 5.1 从玩家可见行为找到真实入口

从主菜单/新游戏/载入存档开始，追踪到本地游戏循环，再定位输入、玩法命令、系统调度和存档。每个系统至少标记：入口对象、入口方法/事件、调用目标、数据来源、状态所有者和输出事件。

### 5.2 恢复状态机，而不止列函数

对战斗、AI、关卡、交互、任务、物品、容器、建造、谜题和 UI 操作，整理：

- 状态集合及其拥有者；
- 触发条件、前置条件、分支优先级；
- 状态迁移、计时器、冷却和 Tick/帧顺序；
- 随机源、随机范围、权重和种子；
- 资源/数值消耗与产出；
- 事件通知、回调、动画/音频触发的玩法语义；
- 中断、死亡、重试、读档、切场景后的恢复规则。

### 5.3 恢复数据流和配置覆盖

追踪默认值 → 注册表/配置 → 关卡实例覆盖 → 运行时修改 → 存档字段。记录 ID、字段类型、默认值、单位、范围、空值含义、引用关系、覆盖优先级和读取时机。不要只导出一个 JSON 就忽略代码中的二次修改。

### 5.4 处理动态行为

当静态调用图不完整时，按需分析虚方法/接口分派、事件订阅、反射、脚本绑定、Lambda/闭包、协程、异步任务、消息总线、插件和动态资源加载。动态观察要保存触发输入、存档/初始条件、调用栈或事件序列、字段变化和工具版本。

### 5.5 区分证据等级

| 类型 | 含义 | 使用规则 |
|---|---|---|
| `static` | 源码、字节码、反汇编、配置或资源引用直接支持 | 必须记录精确文件/类/方法/字段/数据 ID |
| `observed` | 原作本地运行、日志或明确录屏直接观察 | 记录版本、初始条件、操作步骤和时间点 |
| `inferred` | 由多条静态/动态证据推导 | 写出推理依据和可证伪条件 |
| `unknown` | 目前无法确认 | 不得猜值补齐；说明影响并继续不受影响的模块 |

工具输出的反编译伪源码不是天然真相。遇到关键规则，优先回到原始字节码/指令、调用点和配置交叉核对。

## 6. 标准研究目录和交付物

沿用项目现有 `analysis/<Game>/production/`；不要为了统一目录名而移动历史证据。新项目建议：

```text
analysis/<Game>/
  baseline/                 # 原始构建、hash、初始条件（只记索引，不复制大文件）
  raw/                      # 允许保留的小型原始解析输出；大文件留在原位置
  normalized/               # 规范化脚本、数据表、引用关系
  production/
    engine-profile.json     # 一份引擎与工具画像
    coverage.csv            # 唯一进度账本
    extractors/              # 可重复运行的提取器
    evidence/                # JSON/CSV 机器证据
    specs/                   # 按需创建的程序语义专题
    reports/                 # 简短阶段报告/交接
```

### 6.1 `engine-profile.json` 最低字段

实际模板以 [`engine-profile.template.json`](reverse-engineering/templates/engine-profile.template.json) 为准，字段结构如下：

```json
{
  "schema_version": 1,
  "game": {"name": "", "version": "", "platform": ""},
  "source": [{"path": "", "sha256": "", "read_only": true}],
  "engine": {"name": "unknown", "version": "unknown", "confidence": "unknown", "evidence": []},
  "engine_components": [{"role": "gameplay-engine|scripting-runtime|hot-update-runtime|native-plugin|other", "name": "unknown", "version": "unknown", "confidence": "unknown", "evidence": []}],
  "runtimes": [{"name": "unknown", "version": "unknown", "backend": "unknown", "role": "unknown"}],
  "containers": [],
  "toolchain": [{"role": "index|decompile|assets|native|runtime", "name": "", "version": "", "command": "", "notes": ""}],
  "offline_scope": {"required": [], "adapter": [], "excluded_online": [], "unknown": []}
}
```

以上是字段示例；实际文件必须是有效 JSON。工具版本、参数和输入 hash 应能让另一位执行者重复生成同一批证据。

### 6.2 每条关键规则的证据最小集

每条关键规则至少包含（新项目可从 [`module-evidence.template.json`](reverse-engineering/templates/module-evidence.template.json) 复制）：

- `module_id`：覆盖账本中的稳定 ID；
- `claim`：明确、可验证的一句话规则；
- `evidence_kind`：`static` / `observed` / `inferred` / `unknown`；
- `source_ref`：文件、类、方法、字段、PC/地址、资源 ID 或场景节点；
- `tool`：解析器/调试器及版本；
- `conditions`：触发条件、初始状态和边界；
- `confidence`：`high` / `medium` / `low`，并说明原因；
- `unknowns`：未覆盖分支、动态目标、数据缺口；
- `target_contract`：目标 HTML 实现需要遵守的接口/数据结构。

**进度仍只写入一份 `production/coverage.csv`。** 不因增加引擎字段另造第二份覆盖率表；已有列结构保持兼容，在需要时增补字段。

## 7. 标准化质量门禁

| 门禁 | 通过条件 | 不通过时的处理 |
|---|---|---|
| G0 源基线 | 版本、平台、文件指纹和输入边界明确 | 暂停依赖该输入的分析，先补齐来源 |
| G1 引擎画像 | 引擎、版本、脚本后端、资源容器至少有交叉证据 | 保持 `unknown`，换指纹/元数据路径，不猜引擎 |
| G2 工具校准 | 代表样本解析成功，方法/资源数量和引用可解释，错误分类清楚 | 修工具/版本适配，只重跑受影响批次 |
| G3 程序语义 | 玩法入口、关键分支、状态机、公式、事件时序、数据流和存档契约可定位 | 标记 `extracted` 或 `unknown`，不能标 `understood` |
| G4 策划数据 | 依据程序 Schema 提取 ID、数量、引用、覆盖和边界 | 修正提取器/数据映射，不用猜测补齐 |
| G5 资源与原声 | 资源引用能映射到可用素材；原声事件、文件和播放语义可追溯 | 登记缺失/授权/格式阻塞；不做近似替代 |
| G6 HTML 装配 | 程序、策划、必要地图、UI、原声和本地存档按接口接入 | 标记 `implemented/unverified`，保留未完成项 |
| G7 集中验收 | 断网主流程、关键分支、边界、存档、音频和内容对照通过 | 按根因修复并回归，只有通过后才标 `verified` |

扫描类数、函数数、解包文件数、提取资源数、文档数量都不是完成率。完成率按**纳入离线范围的功能系统和内容集合**计算；`excluded-online` 不计入分母，`unknown/blocked` 不算完成。

## 8. 批量效率与并行标准

1. 同一源 hash + 同一解析器版本 + 同一参数，结果可缓存；输入未变不重复扫描。
2. 先用一个代表样本校准，再批量提取；批量失败按错误类型汇总，不逐文件手工修复。
3. 一个系统只保留一份权威证据和一条覆盖账本记录；其他文档引用它。
4. 并行任务按引擎子系统或独立数据批次切分，明确单一负责人、源输入、输出目录、验收命令；共享账本、总报告和核心索引单写者。
5. 先完成程序逆向，再提取策划数据，再提取必要资产/原声，再装配 HTML，最后集中验证。工具差异不会改变阶段顺序。
6. 每个独立批次及时在 `personal/<topic>` 分支提交，验收后按 Workspace Git 规则合入本地 `main`；不要积攒数周研究再一次性提交。

## 9. 安全、许可和研究边界

- 原始安装包、存档和资源只读；工具在隔离副本/输出目录运行，保留源 hash。
- 不绕过 DRM、付费访问控制、账号认证、反作弊、联网校验或加密保护；无法合法读取的内容登记 `blocked`，不尝试破解。
- 不把原作联网服务、匹配、云存档、支付、广告、遥测或反作弊复制到 HTML 单机版；仅研究实现单机所需的本地规则。
- 不执行从未知归档中提取的脚本、插件或二进制；解析工具和样本按不可信输入处理，优先使用隔离环境。
- 不将原作代码、受版权保护的整包资源或用户存档直接提交到 Git；保留语义总结、必要元数据、可追溯引用和授权允许的派生结果。
- 原作 Shader、复杂材质/光照、后处理、粒子外观和高保真美术不是净室重构的目标；只保留玩法所需的碰撞、锚点、尺寸、帧时序和语义资源槽位（交由 HGame 原生系统接管）。

## 10. 新游戏启动时的最小检查清单

- [ ] 读取目标工程 `AGENTS.md` 与 `hgame-reverse-engineering/SKILL.md`，确认离线单机范围与 `hgame-fallback` 边界。
- [ ] 检查已有分析、代码、未提交文件、历史分支和已完成提取器，先复用。
- [ ] 固定游戏版本、平台、源文件 hash、初始存档和输入路径。
- [ ] 建立 `engine-profile.json`，识别引擎版本、脚本后端、原生模块和容器格式。
- [ ] 从本 Playbook 选择工具；记录版本、参数、许可和适用限制。
- [ ] 校准一个代表样本，验证数量、字段、引用和错误分类。
- [ ] 建立一次全局索引与唯一 `coverage.csv`，明确 offline-required / adapter / excluded-online / unknown。
- [ ] 从玩家入口开始恢复单机程序调用链、状态机、公式、数据流和存档。
- [ ] 每条关键规则有来源锚点、证据等级、置信度、未知项和目标实现契约。
- [ ] 程序门禁通过后才批量提取策划；之后提取必要资产/原声、装配 HTML、集中验收。
- [ ] 阶段性成果及时提交并合并；交付报告说明真实完成状态、命令、测试和剩余风险。

---

**权威关系：** 本文只回答"识别什么引擎、用什么工具、怎样做该引擎的技术分析"。阶段顺序、范围、进度状态与验收以 [`../../SKILL.md`](../../SKILL.md)、[`workflow.md`](workflow.md) 与工程 `AGENTS.md` 为准。
