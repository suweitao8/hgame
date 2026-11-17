import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
export default defineConfig({ base: './', build: { target: 'esnext', rollupOptions: { input: existsSync('index.source.html') ? 'index.source.html' : ['index.html', 'index.bare.html', 'index.horde.html'] } } });
