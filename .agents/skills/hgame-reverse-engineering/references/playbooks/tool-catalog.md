# LeanRea 游戏逆向工具目录

> 本目录是唯一的游戏工具选型表，不是安装清单。范围只包含游戏程序、数据、资源容器和必要的运行时取证。2026-11-13 本机工具盘点；版本和路径在每个游戏项目开始时重新核实。

## 0. 轻量原则

- **LeanRea 是唯一逆向入口。** 本 Skill 只研究游戏，不扩展为通用软件、网站、办公、固件或设备逆向。
- **不安装、不启动、不连接 Craft Anything 完整 CLI/MCP。** Craft Anything 只作为上游技术参考；下表中的工具名是能力对照，不代表本机存在这些 MCP 工具。
- 不启动常驻分析服务。优先使用已有本地 CLI、源码、解析器和浏览器 CDP；需要时才启动 Ghidra、FModel 等 GUI/重型工具，完成后关闭。
- 不自动安装缺失工具、不修改全局 PATH。工具缺失时先用现有替代方案；确实阻塞且需要新增依赖时再请用户决定。
- 一个问题优先选择一个主工具和一个交叉验证来源。先源码/配置/元数据，再脚本或托管字节码，最后才是原生反汇编和动态调试。
- 先用一个代表样本校准解析器，确认版本、数量、字段、引用和异常，再批量处理。只导出实现所需的内容，不全量解包大型游戏包。
- 把同一目标的独立低成本探针合并为少量批次；输出设置上限，只读取命中附近的代码/反汇编切片，不整文件打印大型或压缩文件。
- 在提取副本中工作并复用已有输出；对提取目录搜索时使用包含隐藏/忽略文件的方式（如 rg -uu），避免漏掉打包器生成的目录。

## 1. 固定取证顺序

1. **初筛：** GameReverseScanner 只读建立文件清单、魔数/容器识别、ZIP 成员索引和引擎候选。它不是 Pak、IoStore 或 Unity SerializedFile 的完整解析器。
2. **程序：** 从入口、生命周期、调用点、状态转换、公式、AI、事件和存档追踪实际玩法。资源能导出不代表玩法已还原。
3. **数据：** 以程序实际读取的 Schema 为准，批量提取关卡、角色、敌人、物品、数值和事件；保留 ID、数量、引用和覆盖关系。
4. **资源：** 只提取程序/关卡实际引用的图片、模型、动画片段和原声；不研究 Shader、复杂材质、光照或美术渲染技巧。
5. **动态验证：** 仅当静态证据回答不了状态、时序或动态分派时，才运行原作、调试器或 Playwright/CDP。
6. **账本：** 每个结论标记 static / observed / inferred / unknown；唯一进度表是 production/coverage.csv，分别记录 reverse / implementation / verification。

## 2. Craft Anything 游戏能力：吸收状态与本地替代

Craft Anything 上游工具目录有大量通用工具；这里只借鉴游戏相关的少数能力。**没有把其 Rust 解析器或 MCP 服务复制到 LeanRea。** 目前采用本地工具替代或吸收工作方法，状态如下：

| 能力 | Craft 上游代表工具 | LeanRea 当前状态 | 本地路线与边界 |
|---|---|---|---|
| 游戏容器发现 | game_archives_list | **已有轻量部分** | GameReverseScanner 识别常见容器、魔数和文件清单；ZIP 可列成员。不会深度列出 Pak / IoStore / Unity Bundle 内部对象。 |
| Unreal Pak 列表/提取 | game_pak_list、game_pak_extract | **已有本地替代，非代码移植** | 使用已安装的 repak 或 FModel；按目标版本检查命令和支持格式。只提取目标文件/目录，不整包解包。 |
| Unreal IoStore | game_iostore_list | **部分替代，未内置** | 本机有 FModel；未检测到 retoc。先验证 FModel 对目标 UE 版本、TOC、加密和分区的支持；不能解析就记录 blocked/unknown，不假设已支持。 |
| Unity SerializedFile / Bundle | game_unity_list、game_unity_bundle_list | **已有本地替代，非代码移植** | 使用 AssetRipper；先确认 Unity 版本和 Bundle 结构，按需导出。LeanRea 没有独立的完整 UnityFS/SerializedFile 解析器。 |
| Unity 资源导出 | game_unity_asset_export | **已有本地替代，非代码移植** | AssetRipper 可作为现有导出路线；先验证目标资源类型、外部数据文件和导出完整性，不把导出成功当作玩法逆向完成。 |
| Unreal / Unity 纹理解码 | game_unreal_texture_export、formats::pixels | **未移植专用解码器** | 优先用 FModel / AssetRipper 现有导出。Craft 上游的 BC、浮点和其他纹理格式解码仅作为候选参考；遇到真实项目确实需要且现有工具失败时，才单独实现对应格式并做样本测试。 |
| Unity IL2CPP 元数据 | game_unity_code_names_show | **已有本地替代，非代码移植** | 本机有 Il2CppDumper；先匹配 Unity/metadata 版本。恢复类型名不等于恢复方法体；只有关键逻辑缺失时才进一步使用 Ghidra。 |
| 功能定位 / 函数研究 | core_feature_find、native_function_study | **Ghidra Headless 直接调用导出已实现并实测** | export-ghidra-function-index.ps1 + tools/ghidra/ExportGameFunctionIndex.java 可将 PE 游戏 EXE 的函数、外部导入符号和直接 call 引用导出为规范化索引；本机 Boomerang Fu EXE 实测 397 个内部函数、58 个外部符号。ILSpy/其他格式仍按目标工具导入。 |
| 调用链 / 代码与行为关联 | app_call_path_find、app_runtime_correlate | **调用图导出、合并、审计已实现；动态关联仍需适配** | merge-function-index.mjs 将 Ghidra/手工索引非覆盖合并；audit-function-index.mjs 检查入口可达性、调用路径、未解析边和 confirmed 边证据。Ghidra 导出不包含间接调用、虚分派或运行时调用。 |
| 数据表完整度 / 引用关系 | app_data_schema_extract、app_data_reference_audit | **JSON/CSV 统计与 Schema 引用审计已实现** | analyze-data-tables.mjs 核对 SHA-256、记录数、ID 重复/缺失和显式配置的跨表引用。Schema 必须按程序真实读取方式定义；二进制表、YAML、SQLite、自定义容器仍需先用对应工具导出。 |
| 运行时流程录制 / 对比 | runtime_walkthrough_record、runtime_captures_compare | **HGame Runtime recorder + 通用 JSONL 对比已实现** | HGame.createTraceRecorder() 负责无调度器的逻辑事件记录；其他引擎使用 assets/game-trace-recorder.template.mjs。compare-game-traces.mjs 按事件键比较原版/HTML 字段容差；compare-tick-traces.mjs 仍专用于同一 CanonicalState/Hash Schema 的锁步轨迹。 |
| 证据账本 / 覆盖率 / 重建声明 | app_ledger_build、app_coverage_evaluate、app_rebuild_claim_check | **本地已实现同类能力与综合门禁** | start-research.mjs、production/coverage.csv、verification-plan.json、audit-coverage.mjs、audit-research.mjs、validate-packet.mjs；分别核对逆向、实现、验证，空账本不能报 100%。 |

### 2.1 哪些是真正移植，哪些不是

- **已实现：** GameReverseScanner、独立研究初始化、引擎画像、coverage 账本、覆盖率审计、可配置综合研究门禁、研究包结构校验、Ghidra Headless PE 函数/直接调用导出、函数索引合并与审计、JSON/CSV 数据表统计与引用核对、JSONL 事件轨迹对比。
- **已吸收为方法：** 功能定位、函数档案整理、调用链证据导入、静态与运行时证据关联、未知项管理。
- **使用本地现成工具替代：** Unity 资源、Unreal Pak、IL2CPP 元数据、Godot PCK、GameMaker 数据。
- **尚未移植：** Craft 自带的 Unity / Unreal 二进制解析器、专用纹理解码器、自动动态插桩、通用运行时关联引擎。Ghidra 原生函数导出仅覆盖支持格式的静态直接调用，不代表所有原生格式均已支持。不要把上游 MCP 工具名写成 LeanRea 已有命令。

Craft 上游实现与支持范围会变化，尤其纹理格式按增量方式加入。需要参考时查看官方 [工具目录](https://github.com/storytold/craft-anything/blob/main/docs/tools.md)、[工具状态](https://github.com/storytold/craft-anything/blob/main/docs/tool-status.md) 和 [路线图](https://github.com/storytold/craft-anything/blob/main/docs/ROADMAP.md)，只提取具体格式的技术说明，不引入完整服务。

## 3. 本机外部逆向工具清单规范（通过 `.hgame.local.json` 的 `reToolchainPath` 或 `HGAME_RE_TOOLCHAIN` 指定）

建议将本机反编译/解包二进制统一放置在独立的工具目录 `<RE_TOOLS_ROOT>`，并通过机器可读 `toolchain.json` 注册，由 `scripts/extract-fast.mjs` 自动调度（严禁将本机路径硬编码提交到仓库）：

| 工具 | 参考版本 | 相对路径 / 命令 | 用途 |
|---|---:|---|---|
| AssetRipper | 2.0+ | `<RE_TOOLS_ROOT>/AssetRipper/AssetRipper.GUI.Free.exe` | Unity 资源 / Bundle 导出（按需） |
| FModel | 4.4+ | `<RE_TOOLS_ROOT>/FModel/FModel.exe` | Unreal Pak / IoStore 资源浏览 |
| repak | 0.2+ | `<RE_TOOLS_ROOT>/repak/repak.exe` | Unreal Pak 列表与选择性提取 |
| UAssetGUI | 1.1+ | `<RE_TOOLS_ROOT>/UAssetGUI/UAssetGUI.exe` | Unreal `.uasset/.uexp` DataTable 转 JSON |
| GDRE Tools | 2.7+ | `<RE_TOOLS_ROOT>/gdre/gdre_tools.exe` | Godot PCK / GDScript 项目恢复 |
| Il2CppDumper | 6.7+ | `<RE_TOOLS_ROOT>/Il2CppDumper/Il2CppDumper.exe` | Unity IL2CPP `dump.cs` 与 `script.json` 提取 |
| Ghidra | 12.2+ | `<RE_TOOLS_ROOT>/ghidra/<version>` | 仅在 `--deep-ghidra --symbol` 定向狙击核心公式时启用 |
| UndertaleModTool | 0.9+ | `<RE_TOOLS_ROOT>/UndertaleModTool/cli/UndertaleModCli.exe` | GameMaker `data.win` 脚本与数据导出 |
| RPGMakerDecrypter | 3.0+ | `<RE_TOOLS_ROOT>/RPGMakerDecrypter/RPGMakerDecrypter-cli.exe` | RPG Maker RGSS/MV/MZ 工程恢复与解密 |
| unrpyc + unrpa | local / venv | `<RE_TOOLS_ROOT>/unrpyc/unrpyc.py` / `unrpa` | Ren'Py `.rpa` 解包与 `.rpyc` 反编译（必须在 `raw/` 副本运行） |
| Vineflower | 1.12+ | `<RE_TOOLS_ROOT>/vineflower/vineflower.jar` | Java / JVM / libGDX JAR 字节码反编译 |
| RE Python venv | 3.12+ | `<RE_TOOLS_ROOT>/pyenv` | 逆向专用 Python 环境 |
| ilspycmd | 11.x | PATH (`ilspycmd`) | Unity Mono / Godot C# 定向反编译 |

如果未配置外部 `toolchain.json`，`extract-fast.mjs` 仍会自动降级为 PATH 可用工具与只读结构扫描；Frida / JADX / 7z 等工具需通过 `where.exe` / `Get-Command` 实测确认。

## 4. 按游戏引擎选择最小工具组

| 目标 | 默认主路线 | 只在必要时追加 |
|---|---|---|
| Unity Mono | ILSpy + AssetRipper | Mono.Cecil / 运行时日志 |
| Unity IL2CPP | Il2CppDumper + AssetRipper | Ghidra；Cpp2IL 仅在已安装且版本兼容时 |
| Unreal Blueprint / C++ | repak + FModel | IoStore 专项解析、Ghidra / 符号 |
| Godot GDScript | GDRE Tools | 版本匹配的字节码分析 |
| Godot C# | GDRE Tools + ILSpy | Ghidra 分析原生扩展 |
| RPG Maker MV/MZ | JS / JSON / 插件 / 事件数据 | 仅在资源加密且合法持有密钥时解密 |
| GameMaker VM | UndertaleModTool | 版本匹配的数据解析 |
| HTML5 / Electron 游戏 | 原始 JS / source map / Playwright CDP | WASM 工具、ASAR 解包 |
| Java / MonoGame | Vineflower / ILSpy | XNB 或自定义 Content Pipeline 解析 |
| 原生 C/C++ 游戏 | 文件格式、符号、导入表、字符串 | Ghidra / WinDbg；只分析确有必要的玩法模块 |

## 5. 每次调用前的检查

1. 使用 where.exe / Get-Command / 完整路径确认真正执行的工具；不要只看旧文档。
2. 读取版本、帮助和目标格式支持；工具推荐不等于已安装或兼容。
3. 先对一个代表文件做只读测试，核对版本、数量、字段、引用和错误分类。
4. 输出写入独立研究目录；保留源文件 hash、工具版本、命令和输出路径。
5. 加密、版本不匹配、解析器不支持或输入不完整时明确记录 unknown / blocked；不得猜测内容，也不得绕过 DRM、账号、付费或反作弊保护。
6. 一项工具不能回答具体问题时及时切换到已存在的替代工具；不重复执行同一失败命令，不为单个目标启动整套重型工具链。
