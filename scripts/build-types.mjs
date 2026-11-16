#!/usr/bin/env node
// Generate (or --check) public .d.ts declarations for assets/runtime into types/.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, cpSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const typesDir = path.join(root, 'types');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

function listSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name === 'vendor' ? []
    : e.isDirectory() ? listSources(path.join(dir, e.name)) : /\.m?js$/.test(e.name) ? [path.join(dir, e.name)] : []);
}
function emit(outDir) {
  const r = spawnSync(process.execPath, [tsc, '--allowJs', '--declaration', '--emitDeclarationOnly', '--skipLibCheck', '--strictNullChecks',
    '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler',
    '--outDir', outDir, '--rootDir', path.join(root, 'assets', 'runtime'),
    ...listSources(path.join(root, 'assets', 'runtime'))], { encoding: 'utf8' });
  if (r.status !== 0) { process.stderr.write(r.stdout + r.stderr); process.exit(r.status || 1); }
  rmSync(path.join(outDir, 'vendor'), { recursive: true, force: true }); // vendored WASM typings are not ours
  preserveTypeQueryImports(outDir);
}

function importNames(clause) {
  const names = clause?.name ? [clause.name.text] : [];
  const bindings = clause?.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
  if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.map(element => element.name.text));
  return names;
}

// JS declaration emit can elide a binding that is both imported and independently re-exported,
// even when an inferred facade still refers to `typeof binding`. Preserve those referenced imports.
function preserveTypeQueryImports(outDir) {
  for (const [relative, text] of walk(outDir)) {
    const sourcePath = path.join(root, 'assets/runtime', relative.replace(/\.d\.ts$/, '.js'));
    if (!existsSync(sourcePath)) continue;
    const declaration = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const bound = new Set();
    const queried = new Set();
    for (const statement of declaration.statements) {
      if (ts.isImportDeclaration(statement)) importNames(statement.importClause).forEach(name => bound.add(name));
    }
    function visit(node) {
      if (ts.isTypeQueryNode(node)) {
        let name = node.exprName;
        while (ts.isQualifiedName(name)) name = name.left;
        if (ts.isIdentifier(name)) queried.add(name.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(declaration);
    const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imports = [];
    const needed = name => queried.has(name) && !bound.has(name);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
      const clause = statement.importClause;
      const parts = [];
      if (clause.name && needed(clause.name.text)) parts.push(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings) && needed(bindings.name.text)) parts.push(`* as ${bindings.name.text}`);
      if (bindings && ts.isNamedImports(bindings)) {
        const elements = bindings.elements.filter(element => needed(element.name.text));
        if (elements.length) parts.push(`{ ${elements.map(element => element.getText(source)).join(', ')} }`);
      }
      if (parts.length) imports.push(`import ${parts.join(', ')} from ${JSON.stringify(statement.moduleSpecifier.text)};`);
    }
    if (imports.length) writeFileSync(path.join(outDir, relative), imports.join('\n') + '\n' + text);
  }
}
function walk(dir, base = dir, out = new Map()) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.set(path.relative(base, p).replaceAll('\\', '/'), readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
  }
  return out;
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'hgame-types-'));
try {
  emit(tmp);
  if (check) {
    const a = walk(tmp), b = existsSync(typesDir) ? walk(typesDir) : new Map();
    const diff = [...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k));
    if (diff.length) { console.error(`types/ is stale (${diff.length} files): ${diff.slice(0, 5).join(', ')}\nRun: npm run build:types`); process.exit(1); }
    console.log(`types/ up to date (${a.size} files)`);
  } else {
    rmSync(typesDir, { recursive: true, force: true });
    mkdirSync(typesDir, { recursive: true });
    cpSync(tmp, typesDir, { recursive: true });
    console.log(`wrote ${walk(typesDir).size} declaration files to types/`);
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

