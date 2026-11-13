#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

// Local preview for standalone generated game projects; listens on loopback only.
const mime = {
  '.html': 'text/html', '.htm': 'text/html',
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm', '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};
const forbidden = new Set(['.git', '.svn', 'node_modules', 'tests', 'tools', 'analysis', 'private', '.env']);

function args(argv) {
  let folder = '';
  let port = 4176;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') port = Number(argv[++i]);
    else if (!argv[i].startsWith('-') && !folder) folder = argv[i];
    else throw new Error('Unknown argument: ' + argv[i]);
  }
  if (!folder) throw new Error('Usage: node preview.mjs <game-folder> [--port 4176]');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer from 1024 to 65535');
  return { folder, port };
}

async function main() {
  const { folder, port } = args(process.argv.slice(2));
  const root = await realpath(path.resolve(folder));
  if (!(await stat(root)).isDirectory()) throw new Error('Not a directory: ' + root);
  const prefix = root.toLowerCase() + path.sep;
  const server = createServer(async (req, res) => {
    const fail = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Method Not Allowed');
    try {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
      const segments = relative.split('/');
      if (segments.some(s => !s || s === '.' || s === '..' || s.startsWith('.') || forbidden.has(s.toLowerCase())) || relative.includes('\\') || relative.includes('\0')) {
        return fail(403, 'Forbidden');
      }
      // Allow only game runtime files, not source analysis or project instructions.
      if (/^(?:AGENTS|README|LICENSE|package(?:-lock)?)\.(?:md|json)$/i.test(relative)) return fail(403, 'Forbidden');
      const candidate = path.join(root, ...segments);
      const real = await realpath(candidate);
      if (!real.toLowerCase().startsWith(prefix)) return fail(403, 'Forbidden');
      if (!(await stat(real)).isFile()) return fail(404, 'Not Found');
      const ext = path.extname(real).toLowerCase();
      if (!mime[ext]) return fail(403, 'Forbidden');
      res.writeHead(200, {
        'Content-Type': mime[ext] + (['.html','.htm','.js','.mjs','.css','.json','.svg'].includes(ext) ? '; charset=utf-8' : ''),
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(real).pipe(res);
    } catch (error) {
      fail(error.code === 'ENOENT' ? 404 : 400, error.code === 'ENOENT' ? 'Not Found' : 'Bad Request');
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('HTML game preview: http://127.0.0.1:' + port + '/');
    console.log('Serving: ' + root);
  });
  server.on('error', error => { console.error('Preview server failed: ' + error.message); process.exitCode = 1; });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
