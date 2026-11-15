# 原生游戏二进制与脚本快速分析

本模块吸收原 leanrea Skill 中与游戏相关的本地 CLI 方法。它不是通用软件/网站逆向指南；只在目标游戏的脚本、资源容器或可执行文件需要更深入分析时加载。优先用源码、符号和元数据；机器码分析是最后一层，不把字符串命中或反编译伪代码当成事实。

## 通用取证顺序

1. 对原始游戏目录只读盘点，记录版本、文件大小、时间戳和关键文件 SHA-256；所有导出放在独立研究目录。
2. 用文件签名/头部确认格式；Windows 可用 Format-Hex、Get-FileHash、7-Zip、Detect It Easy/TrID。file、xxd、strings、rg -uu 等命令仅在实际安装时使用。
3. 先列目录/容器，再提取最小代表样本；校准版本、字段、数量和引用关系后才批量处理。
4. 有源代码/符号/脚本时先分析调用链、数据 Schema 和状态转换；没有时再用反编译/反汇编。
5. 每个结论保留源文件 hash、偏移/类/方法/资源 ID、工具版本和证据等级。

## 按游戏类型选择工具

| 目标 | 优先路线 | 注意事项 |
|---|---|---|
| Unity Mono | Assembly-CSharp.dll、ILSpy/ILSpycmd、dnSpyEx、Mono.Cecil | 核对 Unity/Mono 版本和程序集依赖；导出类名不代表行为已恢复 |
| Unity IL2CPP | global-metadata.dat、GameAssembly.dll、Cpp2IL/Il2CppDumper、Ghidra/IDA | 元数据与原生调用点必须互相验证；不要混用不同版本的 metadata |
| Unreal | Pak/IoStore 清单、CUE4Parse/FModel、版本匹配的 UnrealPak、Ghidra/IDA | .utoc 与 .ucas 成套；Cooked 资源通常不能还原完整 Blueprint 原始图 |
| Godot | PCK 盘点、GDRE Tools/gdsdecomp、GDScript/资源索引 | 先确定 Godot 主版本、PCK 版本和脚本是否加密 |
| RPG Maker MV/MZ/RGSS | JSON/事件数据、插件顺序、Ruby/RGSS 版本工具 | 按代际区分 .json、.rxdata、.rvdata、.rvdata2 |
| GameMaker/Cocos/Ren'Py | UndertaleModTool、版本匹配的 Creator 解析器、unrpyc/rpatool | VM/YYC、Creator 2.x/3.x、RPA 版本不可混用 |
| Electron/HTML5 游戏 | @electron/asar、source map、Chrome DevTools/Playwright、WABT/wasm-tools | 先找原始 JS/TS 和 source map；WAT/反混淆输出不是原始源码 |
| Android APK 游戏 | JADX、Apktool、ADB/logcat，再识别 APK 内部引擎 | 先识别包和引擎；不绕过签名、DRM、账号或反作弊 |
| Go/Rust/C++ 游戏 | go version -m、nm、objdump/llvm-objdump、readelf、Ghidra | 确认二进制格式和符号保留情况；按需分析游戏相关模块 |
| WebAssembly 游戏 | WABT (wasm-objdump/wasm2wat)、wasm-tools | 结合 JS glue、资源包和运行时调用；不能只凭 WAT 断定游戏逻辑 |

## 存档和数据

- SQLite/本地数据库先复制到研究目录；若存在 -wal / -shm，在同一时间点一并保留，再以只读方式检查。
- 识别版本迁移、主键、引用关系、默认值、覆盖顺序和损坏/空值行为。
- 不直接修改原作存档；测试用副本，并记录修改前后 hash。
- 网络抓包仅在用户明确要求分析获准的游戏联机协议时使用；离线单机重构范围排除在线服务，不研究账号、支付、反作弊或认证绕过。

## 工具纪律

- 先检查工具是否存在、版本和 --help；工具清单中的建议不等于本机已安装。
- 批量操作前用一个代表样本校准解析器，记录成功/失败/未知分类。
- 只在能回答具体游戏问题时调用 Ghidra/IDA 等重型工具；避免无目标地全量反编译。
- 对已授权研究的 Windows 游戏 EXE，可用 scripts/export-ghidra-function-index.ps1 在 research/raw/ 中建立隔离的 Ghidra Headless 项目，并导出规范化函数/直接调用索引；用 scripts/merge-function-index.mjs 非覆盖合并到人工维护的 production/function-index.json，再由 audit-function-index.mjs 检查。导出仅含 Ghidra 当前识别到的函数与直接静态 call 引用，外部导入符号单独标记；间接调用、虚分派和运行时调用仍需补证。
- 本模块不覆盖 GameReverseScanner 的容器索引、跨引擎指纹、证据账本和覆盖审计；两者互补。
- **This is not a general software reverse guide.** 不扩展到网站、办公软件、固件、智能合约或与游戏无关的应用。
