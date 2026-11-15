// recommendations.mjs — tool recommendations for the Game Reverse Scanner.
//
// buildRecommendations(candidates) maps engine candidates onto the maintained
// Canonical game-only tool catalog under the consolidated game-development Skill.
// Every tool entry reports availability: "not_checked" —
// the scanner never probes, installs, or executes recommended tools.

const RECOMMENDATIONS_SCHEMA_VERSION = 1;

const NOT_CHECKED = 'not_checked';

const TOOL_CATALOG_REFERENCE = '.agents/skills/hgame-reverse-engineering/references/playbooks/tool-catalog.md';

function tool(name, purpose, section) {
  return { name, purpose, availability: NOT_CHECKED, reference: `${TOOL_CATALOG_REFERENCE}#${section}` };
}

const GENERIC_TOOLS = () => [
  tool('file / xxd / hexdump', 'Confirm magic bytes, headers and encodings before deeper parsing.', '2-通用文件识别与容器盘点'),
  tool('7-Zip (7z)', 'List and unpack common archives; custom wrappers still need dedicated identification.', '2-通用文件识别与容器盘点'),
  tool('strings / ripgrep (rg -uu)', 'Search class names, paths, resource IDs and version strings; strings may be dead code.', '2-通用文件识别与容器盘点'),
  tool('Detect It Easy (DIE) / TrID', 'Candidate file-type and packer hints; cross-check with runtime and package structure.', '2-通用文件识别与容器盘点'),
  tool('Kaitai Struct / ImHex / 010 Editor', 'Describe and validate custom binary formats with version-bound schemas.', '2-通用文件识别与容器盘点'),
];

const ENGINE_TOOLS = {
  unity: (candidate) => {
    const tools = [
      tool('UnityPy / AssetRipper', 'Extract Unity serialized assets and bundles; exports do not prove gameplay rules are recovered.', '4-按引擎选择的专用工具'),
    ];
    if (candidate.runtimes?.some(runtime => runtime.name === 'IL2CPP')) {
      tools.push(tool('Cpp2IL / Il2CppDumper / Il2CppInspector', 'Recover IL2CPP type/method mappings; outputs need cross-validation against native call sites.', '4-按引擎选择的专用工具'));
      tools.push(tool('Ghidra / IDA', 'Analyze the IL2CPP native binary and plugins alongside recovered metadata.', '3-程序代码、反编译与原生分析'));
    }
    if (candidate.runtimes?.some(runtime => runtime.name === 'Mono')) {
      tools.push(tool('ILSpy / dnSpyEx / Mono.Cecil', 'Decompile and audit Mono assemblies such as Assembly-CSharp.dll.', '4-按引擎选择的专用工具'));
    }
    return tools;
  },
  unreal: () => [
    tool('CUE4Parse / FModel', 'Explore Unreal Pak/IoStore containers and cooked assets; .utoc/.ucas must be handled as a set.', '4-按引擎选择的专用工具'),
    tool('UnrealPak (version-matched) / UAssetGUI / UAssetAPI', 'Inspect pak contents and serialized uassets; unversioned cooks need matching mappings.', '4-按引擎选择的专用工具'),
    tool('Ghidra / IDA', 'Native analysis of Unreal executables and modules when binaries are needed.', '3-程序代码、反编译与原生分析'),
  ],
  godot: () => [
    tool('GDRE Tools (gdsdecomp)', 'Extract Godot PCK contents and decompile GDScript for the matching engine version.', '4-按引擎选择的专用工具'),
    tool('GodotPCKExplorer / version-matched PCK parser', 'Alternative PCK listing when GDRE does not support the PCK version.', '4-按引擎选择的专用工具'),
  ],
  'rpg-maker-mv': () => [
    tool('Node.js JSON analysis (built-in scripts)', 'RPG Maker MV data files are plain JSON under www/data; analyze events, switches and plugin order directly.', '4-按引擎选择的专用工具'),
    tool('Browser DevTools', 'Run and inspect the MV game layer in a browser environment.', '4-按引擎选择的专用工具'),
  ],
  'rpg-maker-mz': () => [
    tool('Node.js JSON analysis (built-in scripts)', 'RPG Maker MZ data files are plain JSON under data; analyze events and plugin order directly.', '4-按引擎选择的专用工具'),
    tool('Browser DevTools', 'Run and inspect the MZ game layer in a browser environment.', '4-按引擎选择的专用工具'),
  ],
  'rpg-maker-rgss': () => [
    tool('RGSS archive/data parsers for the matching generation', 'RGSS archives and .rxdata/.rvdata/.rvdata2 databases differ per generation; do not mix parsers.', '4-按引擎选择的专用工具'),
    tool('Ruby bytecode/script analysis tools', 'Analyze RGSS scripts after identifying the Ruby/RGSS version.', '4-按引擎选择的专用工具'),
  ],
  gamemaker: () => [
    tool('UndertaleModTool', 'Inspect GameMaker data.win bytecode, resources and code entries; YYC builds differ from VM builds.', '4-按引擎选择的专用工具'),
    tool('Ghidra / IDA', 'Analyze YYC-compiled native builds where original GML is not recoverable.', '4-按引擎选择的专用工具'),
  ],
  'cocos-creator': () => [
    tool('JS/TS bundle analysis with source maps', 'Creator bundles are JavaScript; analyze settings, manifests and scripts with DevTools/AST tooling.', '4-按引擎选择的专用工具'),
    tool('Creator-version-matched asset parser', 'Creator 2.x and 3.x asset protocols differ; match the detected version.', '4-按引擎选择的专用工具'),
  ],
  'cocos2d-x': () => [
    tool('Ghidra / IDA', 'Analyze cocos2d-x native libraries; encrypted/compressed assets are usually project-custom.', '4-按引擎选择的专用工具'),
    tool('Custom asset parser (Python/Node)', 'cocos2d-x resource formats are project-specific; bind parsers to observed schemas.', '4-按引擎选择的专用工具'),
  ],
  renpy: () => [
    tool('unrpyc', 'Decompile Ren’Py .rpyc scripts while preserving labels and control flow.', '4-按引擎选择的专用工具'),
    tool('rpatool', 'List and extract RPA archives for the matching RPA version.', '4-按引擎选择的专用工具'),
  ],
  electron: () => [
    tool('@electron/asar', 'List/extract app.asar to reach the underlying HTML/JS game layer.', '5-容器与平台工具（不是引擎识别替代品）'),
    tool('Chrome DevTools / Playwright', 'Inspect main/preload/renderer layers and runtime behavior of the Electron shell.', '4-按引擎选择的专用工具'),
  ],
  'web-html5': () => [
    tool('Chrome DevTools / Playwright', 'Inspect bundles, network, storage and runtime behavior of the HTML5 app.', '4-按引擎选择的专用工具'),
    tool('webcrack / source-map tooling', 'Unpack minified bundles when source maps or bundles are present.', '4-按引擎选择的专用工具'),
    tool('WABT / wasm-tools', 'Analyze WebAssembly modules next to the web app; WAT is not original source.', '5-容器与平台工具（不是引擎识别替代品）'),
  ],
  source: () => [
    tool('VRF (ValveResourceFormat) / VPKEdit', 'Inspect Source VPK/BSP assets; Source 1 and Source 2 formats differ.', '4-按引擎选择的专用工具'),
    tool('Crowbar / BSPSource (bspsrc)', 'Decompile Source 1 maps and models where applicable.', '4-按引擎选择的专用工具'),
  ],
  source2: () => [
    tool('VRF (ValveResourceFormat)', 'Inspect Source 2 compiled resources and VPK containers.', '4-按引擎选择的专用工具'),
  ],
  'flash-air': () => [
    tool('JPEXS Free Flash Decompiler (FFDec)', 'Decompile SWF/ActionScript and inspect frames and scripts.', '4-按引擎选择的专用工具'),
    tool('Ruffle', 'Observe Flash content behavior where supported; not a decompiler.', '4-按引擎选择的专用工具'),
  ],
  defold: () => [
    tool('Defold arci/arcd index parsers', 'Defold resource archives need version-aware custom parsing of the archive index.', '4-按引擎选择的专用工具'),
    tool('ImHex / Kaitai Struct', 'Model the Defold container formats before bulk extraction.', '2-通用文件识别与容器盘点'),
  ],
  love: () => [
    tool('7-Zip / unzip', '.love files are ZIP archives; list members read-only before extracting to a separate directory.', '2-通用文件识别与容器盘点'),
    tool('Lua analysis tooling', 'Analyze main.lua/conf.lua and game scripts once extracted.', '4-按引擎选择的专用工具'),
  ],
  libgdx: () => [
    tool('JADX / unzip', 'Decompile JAR/APK Java code and list class members for libGDX games.', '5-容器与平台工具（不是引擎识别替代品）'),
  ],
};

const CONTAINER_HINTS = [
  {
    matches: candidate => (candidate.containers || []).includes('ASAR'),
    candidate: 'electron',
    tools: () => [tool('@electron/asar', 'List/extract ASAR containers found by the scanner.', '5-容器与平台工具（不是引擎识别替代品）')],
  },
  {
    matches: candidate => (candidate.containers || []).includes('APK') || (candidate.platforms || []).includes('Android'),
    candidate: 'android-apk',
    tools: () => [
      tool('JADX / Apktool', 'Analyze Android packaging first, then identify the engine inside the APK.', '5-容器与平台工具（不是引擎识别替代品）'),
    ],
  },
];

/** Map engine candidates onto catalog-backed tool recommendations (availability always "not_checked"). */
export function buildRecommendations(candidates = []) {
  const recommendationGroups = [];
  const listedCandidates = [];

  for (const candidate of candidates) {
    listedCandidates.push({ id: candidate.id, name: candidate.name, confidence: candidate.confidence || 'unknown' });
    const builder = ENGINE_TOOLS[candidate.id];
    const tools = builder ? builder(candidate) : [];
    if (tools.length) {
      recommendationGroups.push({ candidate: candidate.id, engine: candidate.name, tools });
    }
  }

  for (const hint of CONTAINER_HINTS) {
    if (!candidates.some(hint.matches)) continue;
    if (recommendationGroups.some(group => group.candidate === hint.candidate)) continue;
    recommendationGroups.push({ candidate: hint.candidate, engine: hint.candidate, tools: hint.tools() });
  }

  if (!recommendationGroups.length) {
    recommendationGroups.push({ candidate: 'generic', engine: 'Unknown engine', tools: GENERIC_TOOLS() });
  } else {
    recommendationGroups.push({ candidate: 'generic', engine: 'All candidates', tools: GENERIC_TOOLS() });
  }

  return {
    schema_version: RECOMMENDATIONS_SCHEMA_VERSION,
    candidates: listedCandidates,
    recommendations: recommendationGroups,
  };
}
