import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isMediaType, serveMediaFile } from './media-file.mjs';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.pck': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.hdr': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function createStaticHandler(rootDirectory, { basePath = '/' } = {}) {
  const root = path.resolve(rootDirectory);
  const rootReal = realpath(root);
  const mount = basePath === '/' ? '/' : `/${basePath.split('/').filter(Boolean).join('/')}`;

  return async (request, response, next = () => {}) => {
    let decodedPath;
    let search = '';
    try {
      const requestUrl = request.url || '/';
      const separator = requestUrl.indexOf('?');
      const rawPath = separator < 0 ? requestUrl : requestUrl.slice(0, separator);
      search = separator < 0 ? '' : requestUrl.slice(separator);
      decodedPath = decodeURIComponent(rawPath).replaceAll('\\', '/');
    } catch {
      response.writeHead(400);
      response.end('Bad Request');
      return;
    }

    const isMountedPath = mount === '/' || decodedPath === mount || decodedPath.startsWith(`${mount}/`);
    if (isMountedPath && request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method Not Allowed');
      return;
    }
    if (!isMountedPath) {
      next();
      return;
    }

    if (decodedPath.includes('\0')) {
      response.writeHead(400);
      response.end('Bad Request');
      return;
    }

    if (mount !== '/') {
      if (decodedPath === mount) {
        response.writeHead(308, { Location: `${mount}/${search}` });
        response.end();
        return;
      }
      if (!decodedPath.startsWith(`${mount}/`)) {
        next();
        return;
      }
      decodedPath = decodedPath.slice(mount.length) || '/';
    }

    const segments = decodedPath.split('/').filter(segment => segment && segment !== '.');
    if (segments.includes('..')) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    let target = path.resolve(root, ...segments);
    if (!isInside(root, target)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    try {
      let info = await stat(target);
      if (info.isDirectory()) {
        target = path.join(target, 'index.html');
        info = await stat(target);
      }
      if (!info.isFile()) throw new Error('Not a file');

      const canonicalTarget = await realpath(target);
      if (!isInside(await rootReal, canonicalTarget)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const contentType = MIME[path.extname(canonicalTarget).toLowerCase()] || 'application/octet-stream';
      if (isMediaType(contentType)) {
        await serveMediaFile(request, response, canonicalTarget, contentType);
        return;
      }
      const body = await readFile(canonicalTarget);
      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      next();
    }
  };
}

export function createStaticServer(rootDirectory) {
  const handler = createStaticHandler(rootDirectory);
  return createServer((request, response) => handler(request, response, () => {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('404 Not Found');
  }));
}
