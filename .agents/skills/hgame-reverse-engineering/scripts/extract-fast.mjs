#!/usr/bin/env node
import { cp, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveReConfig } from './local-config.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const scannerBin = path.join(skillRoot, 'tools', 'game-reverse-scanner', 'bin', 'game-reverse-scan.mjs');
const ghidraScript = path.join(scriptDir, 'export-ghidra-function-index.ps1');

const RED_PROTECTION_PATTERNS = [
  /easyanticheat/i,
  /battleye/i,
  /denuvo/i,
  /vmprotect/i,
  /themida/i,
  /gameguard/i,
  /nprotect/i,
  /xigncode/i,
  /ace-base/i,
  /vanguard/i,
  /securom/i,
];

function parseArgs(argv) {
  const localConfig = resolveReConfig();
  const opts = {
    source: null,
    slug: null,
    out: null,
    toolchain: localConfig.reToolchainPath,
    deepGhidra: false,
    symbol: null,
    dryRun: false,
    json: false,
    timeoutSec: null,
    maxFiles: 50000,
    workspaceDir: localConfig.reWorkspaceDir,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--slug') opts.slug = argv[++i];
    else if (token === '--out') opts.out = argv[++i];
    else if (token === '--toolchain') opts.toolchain = argv[++i];
    else if (token === '--deep-ghidra') opts.deepGhidra = true;
    else if (token === '--symbol') opts.symbol = argv[++i];
    else if (token === '--dry-run') opts.dryRun = true;
    else if (token === '--json') opts.json = true;
    else if (token === '--timeout-sec') opts.timeoutSec = Number(argv[++i]);
    else if (token === '--max-files') opts.maxFiles = Number(argv[++i]);
    else if (token === '--help' || token === '-h') opts.help = true;
    else if (!token.startsWith('-') && !opts.source) opts.source = token;
    else throw new Error(`Unknown or incomplete argument: ${token}`);
  }
  if (opts.help) return opts;
  if (!opts.source) {
    throw new Error('Usage: node extract-fast.mjs <original-game-dir> --slug <game-slug> [--out <research-dir>] [--toolchain <path>] [--deep-ghidra --symbol <target>] [--timeout-sec <sec>] [--dry-run] [--json]');
  }
  const slug = opts.slug || path.basename(path.resolve(opts.source)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game-target';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(slug)) {
    throw new Error(`Invalid game slug: ${slug}`);
  }
  opts.slug = slug;
  if (!opts.out) opts.out = path.join(opts.workspaceDir, 'projects', slug);
  if (opts.deepGhidra && !opts.symbol) {
    throw new Error('--deep-ghidra requires --symbol <target-symbol-or-formula>');
  }
  return opts;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

async function resolveFuture(target) {
  const tail = [];
  let cur = path.resolve(target);
  while (true) {
    try {
      const real = await realpath(cur);
      return path.resolve(real, ...tail.reverse());
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const up = path.dirname(cur);
      if (up === cur) throw err;
      tail.push(path.basename(cur));
      cur = up;
    }
  }
}

async function loadToolchain(toolchainPath) {
  if (!toolchainPath) {
    return { schemaVersion: 1, tools: {}, pathTools: {} };
  }
  try {
    const raw = await readFile(toolchainPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { schemaVersion: 1, tools: {}, pathTools: {} };
  }
}

function detectProtections(files) {
  const hits = [];
  for (const f of files) {
    const p = f.path || '';
    for (const pattern of RED_PROTECTION_PATTERNS) {
      if (pattern.test(p)) {
        hits.push({ path: p, rule: pattern.source });
        break;
      }
    }
  }
  return hits;
}

const ENGINE_NAME_TO_ID = {
  unity: 'unity',
  godot: 'godot',
  'unreal engine': 'unreal',
  unreal: 'unreal',
  'rpg maker mv': 'rpg-maker-mv',
  'rpg maker mz': 'rpg-maker-mz',
  'rpg maker rgss': 'rpg-maker-rgss',
  gamemaker: 'gamemaker',
  "ren'py": 'renpy',
  'ren’py': 'renpy',
  renpy: 'renpy',
  'web / html5': 'web-html5',
  'electron shell': 'electron',
  'source engine': 'source',
  'source 2': 'source2',
  libgdx: 'libgdx',
};

function resolveEngineId(profile, inventory) {
  if (profile?.engine?.id) return profile.engine.id;
  if (inventory?.engineCandidates?.[0]?.id) return inventory.engineCandidates[0].id;
  const nameKey = String(profile?.engine?.name || '').trim().toLowerCase();
  if (ENGINE_NAME_TO_ID[nameKey]) return ENGINE_NAME_TO_ID[nameKey];
  return 'unknown';
}

function selectChannel(profile, inventory, opts, toolchain) {
  const files = inventory.files || [];
  const protections = detectProtections(files);
  if (protections.length > 0) {
    return {
      channel: 'red',
      timeoutSec: 0,
      reason: `检测到强反作弊/重壳保护特征 (${protections.slice(0, 3).map((x) => x.path).join(', ')})，触发 0 秒红灯熔断`,
      protections,
      steps: [],
      fallbackMode: 'blackbox-observation',
    };
  }

  const engineId = resolveEngineId(profile, inventory);
  const runtimes = (profile?.engine?.runtimes || []).map((r) => String(r.name || '').toLowerCase());
  const tools = toolchain.tools || {};
  const pathTools = toolchain.pathTools || {};

  // Yellow channel: Unity IL2CPP / Unreal / Native
  const hasIl2cpp = runtimes.includes('il2cpp') || files.some((f) => /gameassembly\.dll|global-metadata\.dat/i.test(f.path));
  if (engineId === 'unity' && hasIl2cpp) {
    const timeoutSec = opts.timeoutSec ?? 600;
    const gameAsm = files.find((f) => /(?:^|\/)(?:gameassembly\.dll|libil2cpp\.so)$/i.test(f.path));
    const metadata = files.find((f) => /global-metadata\.dat$/i.test(f.path));
    const steps = [];
    if (gameAsm && metadata && tools.il2cppdumper?.path) {
      steps.push({
        id: 'il2cpp-dump',
        tool: 'Il2CppDumper',
        command: tools.il2cppdumper.path,
        args: [gameAsm.path, metadata.path, 'il2cpp-dump'],
        purpose: '提取 dump.cs 与 script.json（仅查类名/字段常量与配置表 Schema）',
      });
    }
    if (opts.deepGhidra && opts.symbol) {
      const exe = files.find((f) => /\.exe$/i.test(f.path) && !/crashhandler/i.test(f.path));
      if (exe) {
        steps.push({
          id: 'ghidra-sniper',
          tool: 'Ghidra-Headless',
          command: 'powershell',
          args: ['-ExecutionPolicy', 'Bypass', '-File', ghidraScript, '-ResearchRoot', '<researchRoot>', '-ProgramPath', exe.path],
          purpose: `定向狙击关键公式/符号: ${opts.symbol}（禁止全量反编译）`,
        });
      }
    }
    return {
      channel: 'yellow',
      timeoutSec,
      reason: 'Unity IL2CPP 半明文通道：优先提取 dump.cs + script.json，默认禁用耗时 Ghidra 全量反编译',
      steps,
      advisoryTools: tools.assetripper?.path ? [{ tool: 'AssetRipper', path: tools.assetripper.path, note: '仅按需导出 MonoBehaviour/ScriptableObject 数值表' }] : [],
    };
  }

  if (engineId === 'unreal') {
    const timeoutSec = opts.timeoutSec ?? 600;
    const paks = files.filter((f) => /\.pak$/i.test(f.path));
    const utocs = files.filter((f) => /\.utoc$/i.test(f.path));
    const steps = [];
    if (paks.length > 0 && tools.repak?.path) {
      for (const pak of paks.slice(0, 3)) {
        steps.push({
          id: `repak-list-${path.basename(pak.path)}`,
          tool: 'repak',
          command: tools.repak.path,
          args: ['list', pak.path],
          outputFile: `unreal-${path.basename(pak.path)}.list.txt`,
          purpose: '仅列清单筛选 DataTable/CurveTable/StringTable，禁止整包盲解',
        });
      }
    }
    if (opts.deepGhidra && opts.symbol) {
      const shippingExe = files.find((f) => /shipping\.exe$/i.test(f.path) || /\.exe$/i.test(f.path));
      if (shippingExe) {
        steps.push({
          id: 'ghidra-sniper',
          tool: 'Ghidra-Headless',
          command: 'powershell',
          args: ['-ExecutionPolicy', 'Bypass', '-File', ghidraScript, '-ResearchRoot', '<researchRoot>', '-ProgramPath', shippingExe.path],
          purpose: `定向狙击 Unreal 关键公式: ${opts.symbol}`,
        });
      }
    }
    return {
      channel: 'yellow',
      timeoutSec,
      reason: 'Unreal 半明文通道：仅抽 DataTables/CurveTables，不啃 C++ 主程序',
      steps,
      advisoryTools: [
        ...(utocs.length > 0 && tools.fmodel?.path ? [{ tool: 'FModel', path: tools.fmodel.path, note: '存在 IoStore (.utoc/.ucas)，用 FModel 按需导出 DataTable JSON' }] : []),
        ...(tools.uassetgui?.path ? [{ tool: 'UAssetGUI', path: tools.uassetgui.path, note: '将提取出的 .uasset/.uexp DataTable 转为 JSON' }] : []),
      ],
    };
  }

  // Green channel: fast direct extraction (10-15 min cap)
  const timeoutSec = opts.timeoutSec ?? 900;
  if (engineId === 'godot') {
    const pck = files.find((f) => /\.pck$/i.test(f.path)) || { path: '.' };
    return {
      channel: 'green',
      timeoutSec,
      reason: 'Godot 绿灯直出通道：使用 GDRE Tools 恢复 GDScript 与场景/配置',
      steps: tools.gdre?.path ? [{
        id: 'gdre-recover',
        tool: 'GDRE Tools',
        command: tools.gdre.path,
        args: ['--headless', `--recover=${pck.path}`, '--output=godot-recovered'],
        purpose: '解包 PCK 并恢复 GDScript / project.godot / .tscn',
      }] : [],
    };
  }

  if (engineId === 'unity') {
    const asm = files.find((f) => /managed\/assembly-csharp\.dll$/i.test(f.path.replaceAll('\\', '/')));
    const steps = [];
    if (asm && pathTools.ilspycmd?.installed) {
      steps.push({
        id: 'ilspy-mono',
        tool: 'ilspycmd',
        command: pathTools.ilspycmd.source || pathTools.ilspycmd.command || 'ilspycmd',
        args: ['-p', '-o', 'mono-csharp', asm.path],
        purpose: '反编译 Assembly-CSharp.dll 到 raw/mono-csharp（后续用 rg -uu 定向读取玩法与数值类）',
      });
    }
    return {
      channel: 'green',
      timeoutSec,
      reason: 'Unity Mono 绿灯直出通道：定向提取 Assembly-CSharp.dll 与明文配置',
      steps,
      advisoryTools: tools.assetripper?.path ? [{ tool: 'AssetRipper', path: tools.assetripper.path, note: '仅在需要导出 ScriptableObject/Prefab 数值时打开' }] : [],
    };
  }

  if (engineId === 'rpg-maker-mv' || engineId === 'rpg-maker-mz' || engineId === 'rpg-maker-rgss') {
    const jsonData = files.filter((f) => /(?:^|\/)(?:www\/)?data\/[^/]+\.json$/i.test(f.path.replaceAll('\\', '/')));
    const steps = [];
    if (jsonData.length > 0) {
      steps.push({
        id: 'copy-rpgm-json',
        tool: 'built-in-copy',
        command: 'internal:copy-files',
        files: jsonData.map((f) => f.path),
        outSubdir: 'rpgmaker-data',
        purpose: '直接只读复制 RPG Maker 明文 data/*.json 数值表',
      });
    } else if (tools.rpgmakerdecrypter?.path) {
      steps.push({
        id: 'rpgmaker-decrypt',
        tool: 'RPGMakerDecrypter',
        command: tools.rpgmakerdecrypter.path,
        args: ['.', '-o', 'rpgmaker-decrypted', '-p'],
        purpose: '解密 RGSS/加密工程提取 Scripts 与 Data',
      });
    }
    return { channel: 'green', timeoutSec, reason: `${engineId} 绿灯直出通道`, steps };
  }

  if (engineId === 'renpy') {
    const rpaFiles = files.filter((f) => /\.rpa$/i.test(f.path));
    const rpycFiles = files.filter((f) => /\.rpyc$/i.test(f.path));
    const steps = [];
    if (rpaFiles.length > 0 && tools.unrpyc?.unrpaPath) {
      for (const rpa of rpaFiles) {
        steps.push({
          id: `unrpa-${path.basename(rpa.path)}`,
          tool: 'unrpa',
          command: tools.unrpyc.unrpaPath,
          args: ['-mp', 'renpy-rpa-extracted', rpa.path],
          purpose: '解包 .rpa 归档到 raw/renpy-rpa-extracted',
        });
      }
    }
    if (rpycFiles.length > 0 && tools.unrpyc?.path && tools.unrpyc?.python) {
      steps.push({
        id: 'copy-rpyc-for-decompile',
        tool: 'built-in-copy',
        command: 'internal:copy-files',
        files: rpycFiles.map((f) => f.path),
        outSubdir: 'renpy-rpyc-copy',
        purpose: '先复制 .rpyc 到 raw/ 副本，严禁写入原游戏目录',
      });
      steps.push({
        id: 'unrpyc-decompile',
        tool: 'unrpyc',
        command: tools.unrpyc.python,
        args: [tools.unrpyc.path, 'renpy-rpyc-copy'],
        purpose: '在 raw/ 副本上反编译 .rpyc 为可读 .rpy 脚本',
      });
    }
    return { channel: 'green', timeoutSec, reason: "Ren'Py 绿灯直出通道", steps };
  }

  if (engineId === 'gamemaker') {
    const datafile = files.find((f) => /^(?:data\.win|game\.unx)$/i.test(path.basename(f.path)));
    return {
      channel: 'green',
      timeoutSec,
      reason: 'GameMaker 绿灯直出通道：UndertaleModCli 导出 GML 脚本与字符串',
      steps: datafile && tools.undertalemodtool?.path ? [{
        id: 'umt-dump',
        tool: 'UndertaleModTool',
        command: tools.undertalemodtool.path,
        args: ['dump', datafile.path, '-o', 'gamemaker-dump', '-c', 'UMT_DUMP_ALL', '-s'],
        purpose: '导出 GML 代码、对象与字符串表',
      }] : [],
    };
  }

  if (engineId === 'libgdx') {
    const jar = files.find((f) => /\.jar$/i.test(f.path));
    return {
      channel: 'green',
      timeoutSec,
      reason: 'Java / libGDX 绿灯直出通道：Vineflower 反编译 JAR',
      steps: jar && tools.vineflower?.path ? [{
        id: 'vineflower-jar',
        tool: 'Vineflower',
        command: 'java',
        args: ['-jar', tools.vineflower.path, jar.path, 'java-src'],
        purpose: '反编译 JAR 字节码到 raw/java-src',
      }] : [],
    };
  }

  if (engineId === 'electron' || engineId === 'web-html5') {
    const asar = files.find((f) => /app\.asar$/i.test(f.path));
    const webFiles = files.filter((f) => /\.(?:js|mjs|json|html|cfg)$/i.test(f.path) && !/node_modules/i.test(f.path));
    const steps = [];
    if (asar) {
      steps.push({
        id: 'asar-extract',
        tool: '@electron/asar',
        command: 'npx',
        args: ['-y', '@electron/asar', 'extract', asar.path, 'asar-extracted'],
        purpose: '解包 Electron app.asar 到 raw/asar-extracted',
      });
    } else if (webFiles.length > 0) {
      steps.push({
        id: 'copy-web-bundle',
        tool: 'built-in-copy',
        command: 'internal:copy-files',
        files: webFiles.slice(0, 2000).map((f) => f.path),
        outSubdir: 'web-bundle',
        purpose: '只读复制 Web JS/JSON/HTML 源码与配置到 raw/web-bundle',
      });
    }
    return { channel: 'green', timeoutSec, reason: `${engineId} 绿灯直出通道`, steps };
  }

  if (engineId === 'source' || engineId === 'source2') {
    const cfgFiles = files.filter((f) => /\.(?:cfg|txt|vdf|res)$/i.test(f.path));
    return {
      channel: 'green',
      timeoutSec,
      reason: 'Source 明文脚本/配置绿灯通道：提取 .cfg/.txt 与建议 cvarlist',
      steps: cfgFiles.length > 0 ? [{
        id: 'copy-source-cfg',
        tool: 'built-in-copy',
        command: 'internal:copy-files',
        files: cfgFiles.slice(0, 2000).map((f) => f.path),
        outSubdir: 'source-cfg',
        purpose: '复制明文配置与脚本',
      }] : [],
    };
  }

  // Unknown / opaque native -> trigger red-light circuit breaker unless --deep-ghidra explicitly requested
  if (opts.deepGhidra && opts.symbol) {
    const exe = files.find((f) => /\.exe$/i.test(f.path));
    return {
      channel: 'yellow',
      timeoutSec: opts.timeoutSec ?? 600,
      reason: '未知/原生二进制定向狙击通道（用户显式指定 --deep-ghidra）',
      steps: exe ? [{
        id: 'ghidra-sniper',
        tool: 'Ghidra-Headless',
        command: 'powershell',
        args: ['-ExecutionPolicy', 'Bypass', '-File', ghidraScript, '-ResearchRoot', '<researchRoot>', '-ProgramPath', exe.path],
        purpose: `定向狙击公式/符号: ${opts.symbol}`,
      }] : [],
    };
  }

  return {
    channel: 'red',
    timeoutSec: 0,
    reason: `未检测到可快速直出的脚本/半明文容器（引擎候选: ${engineId}），触发 0 秒红灯熔断`,
    protections: [],
    steps: [],
    fallbackMode: 'blackbox-observation',
  };
}

async function executeStep(step, sourceRoot, rawDir, researchRoot, timeoutMs) {
  if (step.command === 'internal:copy-files') {
    const destRoot = path.join(rawDir, step.outSubdir);
    await mkdir(destRoot, { recursive: true });
    let copied = 0;
    for (const relPath of step.files || []) {
      const src = path.join(sourceRoot, relPath);
      const dst = path.join(destRoot, relPath);
      await mkdir(path.dirname(dst), { recursive: true });
      await cp(src, dst, { force: true });
      copied++;
    }
    return { id: step.id, tool: step.tool, status: 'ok', copiedFiles: copied, outDir: destRoot };
  }

  const resolvedArgs = step.args.map((arg) => {
    if (arg === '<researchRoot>') return researchRoot;
    if (['il2cpp-dump', 'godot-recovered', 'mono-csharp', 'rpgmaker-decrypted', 'renpy-rpa-extracted', 'renpy-rpyc-copy', 'gamemaker-dump', 'java-src', 'asar-extracted'].includes(arg)) {
      return path.join(rawDir, arg);
    }
    const candidate = path.join(sourceRoot, arg);
    if (!arg.startsWith('-') && !path.isAbsolute(arg) && arg !== '.' && !arg.startsWith('D:')) {
      return candidate;
    }
    if (arg.startsWith('--recover=')) {
      const target = arg.slice('--recover='.length);
      return `--recover=${target === '.' ? sourceRoot : path.join(sourceRoot, target)}`;
    }
    if (arg.startsWith('--output=')) {
      return `--output=${path.join(rawDir, arg.slice('--output='.length))}`;
    }
    if (arg === '.') return sourceRoot;
    return arg;
  });

  if (step.tool === 'Ghidra-Headless') {
    const idx = resolvedArgs.indexOf('-ProgramPath');
    if (idx >= 0 && resolvedArgs[idx + 1] && !path.isAbsolute(resolvedArgs[idx + 1])) {
      resolvedArgs[idx + 1] = path.join(sourceRoot, resolvedArgs[idx + 1]);
    }
  }

  for (const dirArg of ['il2cpp-dump', 'godot-recovered', 'mono-csharp', 'rpgmaker-decrypted', 'renpy-rpa-extracted', 'gamemaker-dump', 'java-src', 'asar-extracted']) {
    if (step.args.includes(dirArg) || step.args.includes(`--output=${dirArg}`)) {
      await mkdir(path.join(rawDir, dirArg), { recursive: true });
    }
  }

  const res = spawnSync(step.command, resolvedArgs, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    shell: step.command.endsWith('.cmd') || step.command === 'npx',
    input: '\n',
  });

  if (step.outputFile && res.stdout) {
    await writeFile(path.join(rawDir, step.outputFile), res.stdout, 'utf8');
  }

  const timedOut = res.error?.code === 'ETIMEDOUT';
  if (timedOut || res.error || res.status !== 0) {
    return {
      id: step.id,
      tool: step.tool,
      status: timedOut ? 'timeout' : 'failed',
      exitCode: res.status,
      error: res.error?.message || (res.stderr || '').slice(0, 500),
      triggerRedFallback: true,
    };
  }
  return { id: step.id, tool: step.tool, status: 'ok', exitCode: 0 };
}

function buildReportMarkdown(plan, results) {
  const lines = [
    `# Fast Extract Report · ${plan.slug}`,
    '',
    `- **Source (Read-Only)**: \`${plan.source}\``,
    `- **Research Root**: \`${plan.researchRoot}\``,
    `- **Engine Candidate**: \`${plan.engineId}\` (${plan.confidence})`,
    `- **Channel**: \`${plan.channel.toUpperCase()}\` (timeout: ${plan.timeoutSec}s)`,
    `- **Reason**: ${plan.reason}`,
    '',
  ];
  if (plan.channel === 'red' || results.some((r) => r.triggerRedFallback)) {
    lines.push(
      '## 红灯熔断：已切换至黑盒观测模式（0 秒止损）',
      '',
      '1. **立即停止静态解包 / C++ 反编译**，严禁耗时死磕加壳/强反作弊二进制。',
      '2. **黑盒取证三件套**：',
      '   - 录屏 + `ffmpeg` 逐帧抽帧测算技能前后摇/冷却/弹道速度（参考 `references/gameplay-video-evidence.md`）。',
      '   - 公开数值表 / Wiki / HUD 实机采样补齐武器与角色数值。',
      '   - 底层渲染/寻路/物理/骨骼/特效/音频一律标为 `hgame-fallback`，交由 `HGame` 原生模块接管。',
      '',
    );
  }
  if (plan.steps.length > 0) {
    lines.push('## Execution Steps', '');
    for (const step of plan.steps) {
      const r = results.find((x) => x.id === step.id);
      lines.push(`- **${step.id}** (\`${step.tool}\`): ${step.purpose} -> **${r ? r.status : 'planned'}**`);
    }
    lines.push('');
  }
  if (plan.advisoryTools?.length > 0) {
    lines.push('## Advisory Tools (On-Demand)', '');
    for (const adv of plan.advisoryTools) {
      lines.push(`- **${adv.tool}** (\`${adv.path}\`): ${adv.note}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node extract-fast.mjs <original-game-dir> --slug <game-slug> [--out <research-dir>] [--toolchain <path>] [--deep-ghidra --symbol <target>] [--timeout-sec <sec>] [--dry-run] [--json]');
    return;
  }

  const source = await realpath(path.resolve(opts.source));
  if (!(await stat(source)).isDirectory()) throw new Error('Source game path must be a directory');
  const researchRoot = await resolveFuture(opts.out);
  if (isInside(source.toLowerCase(), researchRoot.toLowerCase())) {
    throw new Error('Output directory must be strictly outside the original game directory');
  }

  const rawDir = path.join(researchRoot, 'raw');
  const scannerDir = path.join(rawDir, 'scanner');
  await mkdir(scannerDir, { recursive: true });

  const scan = spawnSync(
    process.execPath,
    [scannerBin, 'scan', source, '--out', scannerDir, '--max-files', String(opts.maxFiles)],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (scan.error || scan.status !== 0) {
    throw new Error(`GameReverseScanner failed: ${scan.stderr || scan.error?.message || scan.stdout}`);
  }

  const profile = JSON.parse(await readFile(path.join(scannerDir, 'engine-profile.json'), 'utf8'));
  const inventory = JSON.parse(await readFile(path.join(scannerDir, 'inventory.json'), 'utf8'));
  const toolchain = await loadToolchain(opts.toolchain);
  const selection = selectChannel(profile, inventory, opts, toolchain);

  const plan = {
    schemaVersion: 1,
    slug: opts.slug,
    source,
    researchRoot,
    rawDir,
    engineId: resolveEngineId(profile, inventory),
    confidence: profile?.engine?.confidence || 'unknown',
    channel: selection.channel,
    timeoutSec: selection.timeoutSec,
    reason: selection.reason,
    protections: selection.protections || [],
    steps: selection.steps,
    advisoryTools: selection.advisoryTools || [],
    dryRun: opts.dryRun,
  };

  const results = [];
  if (!opts.dryRun && selection.channel !== 'red') {
    const timeoutMs = Math.max(1000, selection.timeoutSec * 1000);
    for (const step of selection.steps) {
      const r = await executeStep(step, source, rawDir, researchRoot, timeoutMs);
      results.push(r);
      if (r.triggerRedFallback) {
        plan.channel = 'red';
        plan.fallbackMode = 'blackbox-observation';
        plan.reason = `${plan.reason}; 步骤 ${step.id} 失败或超时 (${r.status})，触发红灯熔断`;
        break;
      }
    }
  }

  await writeFile(path.join(rawDir, 'fast-extract-plan.json'), JSON.stringify({ ...plan, results }, null, 2) + '\n', 'utf8');
  await writeFile(path.join(rawDir, 'fast-extract-report.md'), buildReportMarkdown(plan, results), 'utf8');

  const summary = {
    slug: plan.slug,
    engineId: plan.engineId,
    confidence: plan.confidence,
    channel: plan.channel,
    circuitBreakerTriggered: plan.channel === 'red',
    fallbackMode: plan.channel === 'red' ? 'blackbox-observation' : null,
    researchRoot,
    rawDir,
    stepsPlanned: plan.steps.length,
    results,
  };
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[extract-fast] ${summary.slug} | engine=${summary.engineId} | channel=${summary.channel} | out=${rawDir}`);
    if (summary.circuitBreakerTriggered) {
      console.log('[extract-fast] 红灯熔断触发：已终止静态解包，请切换黑盒观测 + HGame 原生接管。');
    }
  }
}

main().catch((err) => {
  console.error('extract-fast failed: ' + err.message);
  process.exitCode = 1;
});
