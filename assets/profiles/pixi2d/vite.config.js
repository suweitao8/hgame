import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const generated = existsSync('index.source.html');
export default defineConfig({
  base: './',
  // Use the generator's normal vendor import in starter source as well.
  resolve: generated ? undefined : {
    alias: [{ find: /^\.\.\/vendor\/hgame\//, replacement: resolve('../../runtime').replaceAll('\\', '/') + '/' }],
  },
  build: {
    target: 'esnext',
    rollupOptions: { input: generated ? 'index.source.html' : ['index.html', 'index.bare.html', 'index.horde.html'] },
  },
});
