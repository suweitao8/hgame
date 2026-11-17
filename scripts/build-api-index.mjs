#!/usr/bin/env node
// Build (or --check) docs/api/API-INDEX.json: a compact, machine-readable index of every public
// export of assets/runtime (module, kind, signature, one-line summary, class members, stability tier).
// Agents should query this file instead of reading runtime sources.
import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const rt = path.join(root, 'assets', 'runtime');
const rtPosix = rt.replaceAll('\\', '/').replace(/\/+$/, '');
const rtPrefixRe = new RegExp(rtPosix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?', 'gi');
const stripRuntimeRoot = s => s.replace(rtPrefixRe, './');
const outFile = path.join(root, 'docs', 'api', 'API-INDEX.json');
const check = process.argv.includes('--check');

const tiers = [
  [/^platform\/asset-catalog\.js$/, 'experimental'],
  [/^(index|core\/|platform\/|animation\/|time\/|ui\/|world\/(tilemap|spatial2d|swarm-ecs|gpu-swarm-webgl2))/, 'stable'],
  [/^integrations\/(canvas2d|webgl2d|three|camera3d|quality3d|touch-controls|trace)/, 'stable'],
  [/^physics\//, 'stable'],
];
const tierOf = rel => (tiers.find(([re]) => re.test(rel)) || [0, 'experimental'])[1];

function listJs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name === 'vendor' ? []
    : e.isDirectory() ? listJs(path.join(dir, e.name)) : /\.m?js$/.test(e.name) ? [path.join(dir, e.name)] : []);
}
// Only top-level modules are public; files inside sub-folders (post3d/, model3d/, input/...) are internal.
const files = listJs(rt);
const program = ts.createProgram(files, { allowJs: true, checkJs: false, noEmit: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true });
const checker = program.getTypeChecker();
const rel = f => path.relative(rt, f).replaceAll('\\', '/');
const isInternal = r => r.startsWith('internal/') || (r.split('/').length > 2 && !/^(core|platform|integrations|physics|world|time|animation|ui|lockstep)\/[^/]+$/.test(r));
const oneLine = s => s.replace(/\s+/g, ' ').trim();
const summaryOf = sym => oneLine(ts.displayPartsToString(sym.getDocumentationComment(checker))).slice(0, 160);

// Destructured option bags are opaque to the type checker; read their keys + defaults from the source.
function paramText(p) {
  const clip = t => oneLine(t).length > 24 ? oneLine(t).slice(0, 21) + '...' : oneLine(t);
  const init = p.initializer ? '=' + clip(p.initializer.getText()) : '';
  if (ts.isObjectBindingPattern(p.name)) {
    const keys = p.name.elements.map(e => (e.dotDotDotToken ? '...' : '') + (e.propertyName ? e.propertyName.getText() : e.name.getText()) + (e.initializer ? '=' + clip(e.initializer.getText()) : ''));
    return '{' + keys.join(', ') + '}' + (p.initializer ? '=' + clip(p.initializer.getText()) : '');
  }
  return (p.dotDotDotToken ? '...' : '') + p.name.getText() + (p.questionToken ? '?' : '') + init;
}
const signatureText = (decl, prefix = '') => decl?.parameters ? `${prefix}(${decl.parameters.map(paramText).join(', ')})` : null;

function describe(sym, decl) {
  const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  const d = target.valueDeclaration || target.declarations?.[0] || decl;
  const type = checker.getTypeOfSymbolAtLocation(target, d);
  const declaredIn = rel(d.getSourceFile().fileName);
  // Nested implementation files inherit the public parent integration's contract.
  const publicOrigin = isInternal(declaredIn) ? declaredIn.split('/').slice(0, 2).join('/') + '.js' : declaredIn;
  const entry = { name: sym.name, tier: tierOf(publicOrigin), declaredIn, summary: summaryOf(target) };
  if (target.flags & ts.SymbolFlags.Class) {
    entry.kind = 'class';
    const ctor = type.getConstructSignatures()[0];
    if (ctor) entry.signature = signatureText(ctor.declaration, 'new') || 'new()';
    const proto = checker.getTypeOfSymbolAtLocation(target, d).getProperty('prototype');
    const inst = proto ? checker.getTypeOfSymbolAtLocation(proto, d) : null;
    entry.members = inst ? inst.getProperties().map(p => p.name).filter(n => n !== 'constructor' && !n.startsWith('_') && !n.startsWith('#')).sort() : [];
    const statics = type.getProperties().map(p => p.name).filter(n => !['prototype', 'length', 'name'].includes(n) && !n.startsWith('_'));
    if (statics.length) entry.static = statics.sort();
  } else if (type.getCallSignatures().length) {
    entry.kind = 'function';
    const sig = type.getCallSignatures()[0];
    entry.signature = stripRuntimeRoot(signatureText(sig.declaration) || checker.signatureToString(sig).replace(/\s+/g, ' '));
    if (entry.signature.length > 320) entry.signature = entry.signature.slice(0, 317) + '...';
    const ret = sig.getReturnType();
    const rk = (ret.flags & ts.TypeFlags.Object) && !ret.getCallSignatures().length ? ret.getProperties().map(p => p.name).filter(n => !n.startsWith('_')) : [];
    if (rk.length && rk.length <= 60) entry.returns = rk.sort();
  } else {
    entry.kind = 'const';
    const t = stripRuntimeRoot(checker.typeToString(type, d, ts.TypeFormatFlags.NoTruncation));
    entry.type = t.length > 100 ? t.slice(0, 97) + '...' : t;
    if (type.getProperties().length && type.getProperties().length <= 40 && !(type.flags & ts.TypeFlags.StringLike))
      entry.keys = type.getProperties().map(p => p.name).sort();
  }
  return entry;
}

const modules = {};
for (const f of files.sort()) {
  const r = rel(f);
  if (isInternal(r)) continue;
  const sf = program.getSourceFile(f);
  const mod = checker.getSymbolAtLocation(sf);
  if (!mod) continue;
  const exps = checker.getExportsOfModule(mod).filter(s => ((s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s).flags & ts.SymbolFlags.Value) !== 0).map(s => describe(s, sf)).sort((a, b) => a.name.localeCompare(b.name));
  if (exps.length) modules[r] = { tier: tierOf(r), exports: exps };
}
const version = readFileSync(path.join(rt, 'VERSION'), 'utf8').trim();
const index = { generatedFor: version, note: 'Generated by scripts/build-api-index.mjs. Import the module path under vendor/hgame/ in a game project.', modules };
// One export per line: grep/jq friendly and ~3x smaller in context than pretty-printed JSON.
const text = '{"generatedFor":' + JSON.stringify(version) + ',"note":' + JSON.stringify(index.note) + ',"modules":{\n' +
  Object.entries(modules).map(([m, v]) => ` ${JSON.stringify(m)}:{"tier":"${v.tier}","exports":[\n` +
    v.exports.map(e => '  ' + JSON.stringify(e)).join(',\n') + '\n ]}').join(',\n') + '\n}}\n';
JSON.parse(text);

if (check) {
  const cur = existsSync(outFile) ? readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== text) { console.error('docs/api/API-INDEX.json is stale. Run: npm run build:api-index'); process.exit(1); }
  console.log(`API index up to date (${Object.keys(modules).length} modules)`);
} else {
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, text);
  console.log(`wrote ${path.relative(root, outFile)}: ${Object.keys(modules).length} modules, ${Object.values(modules).reduce((n, m) => n + m.exports.length, 0)} exports, ${(text.length / 1024).toFixed(0)} KB`);
}



