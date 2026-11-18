import { build } from 'esbuild';
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

function preloadImports(file, outputs, preload) {
  for (const dependency of outputs[file].imports) {
    if (dependency.kind !== 'import-statement' || dependency.external ||
        !outputs[dependency.path] || preload.has(dependency.path)) continue;
    preload.add(dependency.path);
    preloadImports(dependency.path, outputs, preload);
  }
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

  const result = await build({
    absWorkingDir: projectDir,
    entryPoints: modules,
    outdir: path.join(outputDir, 'assets'),
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
    plugins: [{ name: 'hgame-pixi-entries', setup(build) {
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
        const relative = path.relative(projectDir, file).split(path.sep).join('/');
        if (path.isAbsolute(relative) || /^(?:\.\.\/|src\/|vendor\/hgame\/|node_modules\/)/.test(relative)) return;
        const extension = path.extname(file);
        const loader = assetLoaders[extension] ?? textLoaders[extension];
        if (!loader) return;
        const contents = await readFile(file);
        externalInputs.set(relative, digest(contents));
        return { contents, loader, resolveDir: path.dirname(file) };
      });
    } }],
  });

  const outputs = new Map(Object.entries(result.metafile.outputs)
    .filter(([file, meta]) => meta.entryPoint && file.endsWith('.js'))
    .map(([file, meta]) => [path.basename(file).replace(/-[^-]+\.js$/, ''), { file, css: meta.cssBundle }]));
  for (const { file, html, replacements } of documents) {
    const styles = new Set();
    const preload = new Set();
    let output = '';
    let end = 0;
    for (const { offset, length, attributes, src, entryName } of replacements) {
      const emitted = outputs.get(entryName);
      if (!emitted) throw new Error(`Missing Pixi bundle for ${file} (${entryName})`);
      output += html.slice(end, offset);
      if (emitted.css) styles.add(emitted.css);
      preloadImports(emitted.file, result.metafile.outputs, preload);
      const source = ` src="./assets/${path.basename(emitted.file)}"`;
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
