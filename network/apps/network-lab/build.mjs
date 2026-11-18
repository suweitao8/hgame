import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const serve = process.argv.includes('--serve');
const project = new URL('./', import.meta.url);
const dist = new URL('dist/', project);
const options = {
  absWorkingDir: fileURLToPath(project),
  entryPoints: ['src/main.ts'],
  outdir: 'dist/assets',
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: !serve,
  legalComments: 'eof',
};

await mkdir(dist, { recursive: true });
await copyFile(new URL('index.html', project), new URL('index.html', dist));

if (serve) {
  const lab = await context(options);
  try {
    await lab.watch();
    await lab.serve({ servedir: fileURLToPath(dist), host: '127.0.0.1', port: 5173 });
    console.log('HGame Network Lab at http://127.0.0.1:5173/');
  } catch (error) {
    await lab.dispose();
    throw error;
  }
} else {
  await build(options);
}
