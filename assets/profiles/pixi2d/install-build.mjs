import { cp, copyFile, mkdir } from 'node:fs/promises';

// Only replace this build's entry and emitted bundles; preserve game art and saves.
await mkdir('assets', { recursive: true });
await cp('dist/assets', 'assets', { recursive: true, force: true });
await copyFile('dist/index.source.html', 'index.html');
