import { build } from 'esbuild';
import { rolldown } from 'rolldown';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptTag = /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const assetLoaders = Object.fromEntries(
  ['avif', 'gif', 'glb', 'gltf', 'ico', 'jpeg', 'jpg', 'mp3', 'ogg', 'png', 'svg', 'ttf', 'wasm', 'wav', 'webp', 'woff', 'woff2']
    .map(extension => ['.' + extension, 'file']),
);
const textLoaders = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx', '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.css': 'css', '.json': 'json' };
const digest = content => createHash('sha256').update(content).digest('hex');

function attribute(name) {
  return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
}

function valueOf(match) {
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function collectImports(file, imports, visited) {
  for (const dependency of imports.get(file) ?? []) {
    if (visited.has(dependency)) continue;
    visited.add(dependency);
    collectImports(dependency, imports, visited);
  }
}

function authoredPath(projectDir, file) {
  const relative = path.relative(projectDir, file).split(path.sep).join('/');
  if (relative && !path.isAbsolute(relative) && !/^(?:\.\.\/|src\/|vendor\/hgame\/|node_modules\/)/.test(relative)) return relative;
}

async function compileScripts({ projectDir, modules, inlineModules, runtimeRoot, track }) {
  const runtimePrefix = '../vendor/hgame/';
  const inlinePrefix = '\0hgame-inline:';
  const moduleTypes = Object.fromEntries(Object.keys(assetLoaders).map(extension => [extension, 'asset']));
  let css = false;
  let cssModules = false;
  const bundle = await rolldown({
    cwd: projectDir,
    input: Object.fromEntries(modules.map(({ in: source, out: name }) => [name, source])),
    platform: 'browser',
    moduleTypes,
    plugins: [{
      name: 'hgame-pixi-entries',
      resolveId(source, importer) {
        if (runtimeRoot && source.startsWith(runtimePrefix)) return path.join(runtimeRoot, source.slice(runtimePrefix.length));
        if (inlineModules.has(source)) return '\0' + source;
        if (importer?.startsWith(inlinePrefix)) return this.resolve(source, path.join(projectDir, 'index.source.html'), { skipSelf: true });
      },
      async load(file) {
        if (file.startsWith(inlinePrefix)) return inlineModules.get(file.slice(1));
        if (!path.isAbsolute(file)) return;
        if (path.extname(file) === '.css') {
          css = true;
          cssModules ||= file.endsWith('.module.css');
          return { code: 'export {};', moduleType: 'js' };
        }
        if (authoredPath(projectDir, file)) track(file, await readFile(file));
      },
    }],
  });
  try {
    const { output } = await bundle.generate({
      format: 'es',
      minify: true,
      entryFileNames: '[name]-[hash].js',
      chunkFileNames: 'chunk-[hash].js',
      assetFileNames: 'asset-[hash][extname]',
      hashCharacters: 'hex',
      comments: { legal: true, annotation: false, jsdoc: false },
    });
    if (cssModules) return { cssModules };
    const files = new Map(output.map(file => [file.fileName, file.type === 'chunk' ? file.code : file.source]));
    const entries = new Map(output.filter(file => file.type === 'chunk' && file.isEntry)
      .map(file => [file.name, file.fileName]));
    const imports = new Map(output.filter(file => file.type === 'chunk')
      .map(file => [file.fileName, file.imports.filter(dependency => files.has(dependency))]));
    return { css, files, entries, imports };
  } catch (error) {
    // Keep esbuild's class-name exports for CSS modules.
    if (cssModules) return { cssModules };
    throw error;
  } finally {
    await bundle.close();
  }
}

async function compileStyles({ projectDir, modules, inlineModules, runtimeRoot, track, assetDir }) {
  const result = await build({
    absWorkingDir: projectDir,
    entryPoints: modules,
    outdir: assetDir,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    assetNames: 'asset-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'esnext',
    minify: true,
    legalComments: 'eof',
    loader: assetLoaders,
    metafile: true,
    write: false,
    plugins: [{ name: 'hgame-pixi-styles', setup(build) {
      if (runtimeRoot) {
        build.onResolve({ filter: /^\.\.\/vendor\/hgame\// }, ({ path: specifier }) => ({
          path: path.join(runtimeRoot, specifier.slice('../vendor/hgame/'.length)),
        }));
      }
      build.onResolve({ filter: /^hgame-inline:/ }, ({ path }) => ({ path, namespace: 'hgame-inline' }));
      build.onLoad({ filter: /.*/, namespace: 'hgame-inline' }, ({ path }) => ({
        contents: inlineModules.get(path), resolveDir: projectDir,
      }));
      build.onLoad({ filter: /.*/, namespace: 'file' }, async ({ path: file }) => {
        if (!authoredPath(projectDir, file)) return;
        const extension = path.extname(file);
        const loader = file.endsWith('.module.css') ? 'local-css' : assetLoaders[extension] ?? textLoaders[extension];
        if (!loader) return;
        const contents = await readFile(file);
        track(file, contents);
        return { contents, loader, resolveDir: path.dirname(file) };
      });
    } }],
  });

  const metadata = Object.entries(result.metafile.outputs);
  const files = new Map(result.outputFiles.map(file => [path.basename(file.path), file.contents]));
  const entries = new Map();
  const imports = new Map();
  const styles = new Map();
  const styleFiles = new Set();
  for (const [file, meta] of metadata) {
    const name = path.basename(file);
    imports.set(name, meta.imports.filter(dependency => !dependency.external && dependency.kind === 'import-statement')
      .map(dependency => path.basename(dependency.path)).filter(dependency => files.has(dependency)));
    if (!meta.entryPoint || !name.endsWith('.js')) continue;
    const entryName = name.replace(/-[^-]+\.js$/, '');
    entries.set(entryName, name);
    if (!meta.cssBundle) continue;
    styles.set(entryName, path.basename(meta.cssBundle));
    styleFiles.add(meta.cssBundle);
  }
  for (const file of styleFiles) {
    for (const dependency of result.metafile.outputs[file].imports) {
      if (!dependency.external && result.metafile.outputs[dependency.path]) styleFiles.add(dependency.path);
    }
  }
  return { entries, imports, styles, files, styleFiles };
}

export async function buildPixi({ projectDir, htmlEntries, outputDir, runtimeRoot }) {
  const modules = [];
  const documents = [];
  const inlineModules = new Map();
  const externalInputs = new Map();
  for (const file of htmlEntries) {
    const html = await readFile(path.join(projectDir, file), 'utf8');
    const replacements = [];
    for (const match of html.matchAll(scriptTag)) {
      const [tag, attributes, inline] = match;
      if (attributes === undefined) continue;
      if (valueOf(attributes.match(attribute('type')))?.toLowerCase() !== 'module') continue;
      const src = attributes.match(attribute('src'));
      const source = valueOf(src);
      if (source && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source)) continue;
      const entryName = path.basename(file, '.html') + (replacements.length ? `-${replacements.length + 1}` : '');
      const entry = source ? path.resolve(projectDir, source.replace(/^\/+/, '')) : `hgame-inline:${entryName}`;
      if (!source) inlineModules.set(entry, inline);
      modules.push({ in: entry, out: entryName });
      replacements.push({ offset: match.index, length: tag.length, attributes, src, entryName });
    }
    if (!replacements.length) throw new Error(`No local module script in ${file}`);
    documents.push({ file, html, replacements });
  }

  const assetDir = path.join(outputDir, 'assets');
  function track(file, contents) {
    const relative = authoredPath(projectDir, file);
    const hash = digest(contents);
    if (externalInputs.has(relative) && externalInputs.get(relative) !== hash) {
      throw new Error(`Pixi build input changed during compilation: ${relative}`);
    }
    externalInputs.set(relative, hash);
  }
  const options = { projectDir, modules, inlineModules, runtimeRoot, track, assetDir };
  const scripts = await compileScripts(options);
  const css = scripts.css || scripts.cssModules ? await compileStyles(options) : undefined;
  const { files, entries, imports } = scripts.cssModules ? css : scripts;
  if (css && !scripts.cssModules) {
    for (const file of css.styleFiles) files.set(path.basename(file), css.files.get(path.basename(file)));
  }
  await mkdir(assetDir, { recursive: true });
  await Promise.all([...files].map(([file, data]) => writeFile(path.join(assetDir, file), data)));

  for (const { file, html, replacements } of documents) {
    const styles = new Set();
    const preload = new Set();
    let output = '';
    let end = 0;
    for (const { offset, length, attributes, src, entryName } of replacements) {
      const emitted = entries.get(entryName);
      if (!emitted) throw new Error(`Missing Pixi bundle for ${file} (${entryName})`);
      output += html.slice(end, offset);
      const style = css?.styles.get(entryName);
      if (style) styles.add(style);
      collectImports(emitted, imports, preload);
      preload.delete(emitted);
      const source = ` src="./assets/${emitted}"`;
      output += `<script${src ? attributes.replace(src[0], source) : attributes + source}></script>`;
      end = offset + length;
    }
    output += html.slice(end);
    const links = [
      ...[...styles].map(css => `<link rel="stylesheet" href="./assets/${path.basename(css)}">`),
      ...[...preload].map(module => `<link rel="modulepreload" href="./assets/${path.basename(module)}">`),
    ].join('\n');
    const headEnd = /<\/head\s*>/i;
    const document = !links ? output : headEnd.test(output)
      ? output.replace(headEnd, end => `${links}\n${end}`) : `${links}\n${output}`;
    await writeFile(path.join(outputDir, file), document);
  }
  for (const [file, expected] of externalInputs) {
    if (digest(await readFile(path.join(projectDir, file))) !== expected) {
      throw new Error(`Pixi build input changed during compilation: ${file}`);
    }
  }
  return [...externalInputs.keys()].sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectDir = fileURLToPath(new URL('./', import.meta.url));
  const outputDir = path.join(projectDir, 'dist');
  const htmlEntries = ['index.html', 'index.bare.html', 'index.horde.html'];
  await mkdir(outputDir, { recursive: true });
  const staging = await mkdtemp(path.join(outputDir, '.pixi-'));
  try {
    await buildPixi({ projectDir, htmlEntries, outputDir: staging, runtimeRoot: path.resolve(projectDir, '../../runtime') });
    const assetDir = path.join(outputDir, 'assets');
    await mkdir(assetDir, { recursive: true });
    const assets = new Set(await readdir(path.join(staging, 'assets')));
    for (const file of assets) await copyFile(path.join(staging, 'assets', file), path.join(assetDir, file));
    for (const file of htmlEntries) await copyFile(path.join(staging, file), path.join(outputDir, file));
    for (const previous of await readdir(assetDir, { withFileTypes: true })) {
      if (previous.isFile() && !assets.has(previous.name)) await unlink(path.join(assetDir, previous.name));
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
