#!/usr/bin/env node
import { readdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Bounded, read-only file metadata scan. Never unpacks or modifies the source. */
function parse(argv) {
  const args = { root: '', json: false, maxFiles: 25000, maxDepth: 9 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--max-files') args.maxFiles = Number(argv[++i]);
    else if (arg === '--max-depth') args.maxDepth = Number(argv[++i]);
    else if (!arg.startsWith('-') && !args.root) args.root = arg;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (!args.root) throw new Error('Usage: node inventory.mjs <game-folder> [--json] [--max-files N] [--max-depth N]');
  if (!Number.isInteger(args.maxFiles) || args.maxFiles < 1 || args.maxFiles > 500000) throw new Error('--max-files must be 1..500000');
  if (!Number.isInteger(args.maxDepth) || args.maxDepth < 0 || args.maxDepth > 30) throw new Error('--max-depth must be 0..30');
  return args;
}

async function scan(folder, maxFiles, maxDepth) {
  const root = await realpath(path.resolve(folder));
  if (!(await lstat(root)).isDirectory()) throw new Error('Source must be a directory');
  const result = {
    root, filesScanned: 0, directoriesScanned: 0, totalBytes: 0,
    symlinksSkipped: 0, inaccessible: 0, truncated: false,
    extensions: {}, likelyEngines: [], evidence: [], notableFiles: [],
  };
  const found = new Set();
  const rules = [
    ['unity-mono', /(?:^|\/)managed\/assembly-csharp\.dll$/i],
    ['unity-core', /(?:^|\/)unityplayer\.dll$/i],
    ['unity-il2cpp', /(?:^|\/)(?:gameassembly\.dll|global-metadata\.dat)$/i],
    ['unreal', /(?:\.uproject$|\/content\/paks\/.*\.pak$|\/engine\/binaries\/)/i],
    ['godot', /(?:^|\/)(?:project\.godot|[^/]+\.pck)$/i],
    ['gamemaker', /(?:^|\/)(?:data\.win|[^/]+\.yyp)$/i],
    ['renpy', /(?:^|\/)(?:renpy\/|[^/]+\.rpa$|[^/]+\.rpy$)/i],
    ['web', /(?:^|\/)(?:index\.html|package\.json|[^/]+\.wasm)$/i],
  ];
  async function walk(dir, depth) {
    if (result.filesScanned >= maxFiles) { result.truncated = true; return; }
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { result.inaccessible++; return; }
    result.directoriesScanned++;
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (result.filesScanned >= maxFiles) { result.truncated = true; return; }
      if (entry.isSymbolicLink()) { result.symlinksSkipped++; continue; }
      const file = path.join(dir, entry.name);
      const relative = path.relative(root, file).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        for (const [label, test] of rules) {
          if (test.test(relative + '/')) {
            found.add(label);
            if (result.evidence.length < 60) result.evidence.push({ label, path: relative + '/' });
          }
        }
        if (depth < maxDepth) await walk(file, depth + 1);
        else result.truncated = true;
        continue;
      }
      if (!entry.isFile()) continue;
      result.filesScanned++;
      let size = 0;
      try { size = (await lstat(file)).size; } catch { result.inaccessible++; }
      result.totalBytes += size;
      const ext = (path.extname(entry.name).toLowerCase() || '(none)').slice(0, 30);
      const summary = result.extensions[ext] || { count: 0, bytes: 0 };
      summary.count++; summary.bytes += size;
      result.extensions[ext] = summary;
      for (const [label, test] of rules) {
        if (test.test(relative)) {
          found.add(label);
          if (result.evidence.length < 60) result.evidence.push({ label, path: relative });
        }
      }
      if (result.notableFiles.length < 40 &&
          /(?:^|\/)(?:[^/]+\.exe|index\.html|data\.win|gameassembly\.dll|unityplayer\.dll|project\.godot|[^/]+\.uproject)$/i.test(relative)) {
        result.notableFiles.push(relative);
      }
    }
  }
  await walk(root, 0);
  if (found.has('unity-mono') || found.has('unity-il2cpp') || found.has('unity-core')) {
    result.likelyEngines.push(found.has('unity-il2cpp') ? 'Unity IL2CPP' : found.has('unity-mono') ? 'Unity Mono' : 'Unity (backend unknown)');
  }
  for (const [key, name] of [['unreal','Unreal Engine'],['godot','Godot'],['gamemaker','GameMaker'],['renpy',"Ren'Py"],['web','Web / JavaScript / WASM']]) {
    if (found.has(key)) result.likelyEngines.push(name);
  }
  if (!result.likelyEngines.length) result.likelyEngines.push('Unknown / custom');
  result.extensions = Object.fromEntries(Object.entries(result.extensions).sort((a,b)=>b[1].bytes-a[1].bytes));
  return result;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const data = await scan(args.root, args.maxFiles, args.maxDepth);
  if (args.json) console.log(JSON.stringify(data, null, 2));
  else {
    console.log('Directory: ' + data.root);
    console.log('Read-only scan: ' + data.filesScanned + ' files, ' + data.directoriesScanned + ' directories, ' + data.totalBytes + ' bytes');
    console.log('Engine candidates: ' + data.likelyEngines.join(', '));
    console.log('Incomplete scan: ' + (data.truncated ? 'yes' : 'no'));
    console.log('Evidence:\n' + (data.evidence.map(e => '- ' + e.label + ': ' + e.path).join('\n') || '(none)'));
    console.log('Top extensions:\n' + Object.entries(data.extensions).slice(0, 12).map(([ext, value]) => '- ' + ext + ': ' + value.count + ' files, ' + value.bytes + ' bytes').join('\n'));
  }
}

main().catch(error => { console.error('Read-only game inventory failed: ' + error.message); process.exitCode = 1; });
