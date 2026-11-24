import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

export function isMediaType(contentType) {
  return contentType.startsWith('audio/') || contentType.startsWith('video/');
}

function readRange(request, size) {
  // These media routes do not publish validators. If-Range uses the full response.
  if (request.method !== 'GET' || request.headers['if-range'] !== undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(request.headers.range?.trim() ?? '');
  if (!match || (!match[1] && !match[2])) return null;

  const length = BigInt(size);
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (suffix === 0n || length === 0n) return { unsatisfiable: true };
    return { start: Number(suffix >= length ? 0n : length - suffix), end: size - 1 };
  }

  const start = BigInt(match[1]);
  const end = match[2] ? BigInt(match[2]) : length - 1n;
  if (match[2] && end < start) return null;
  if (start >= length) return { unsatisfiable: true };
  return { start: Number(start), end: Number(end < length ? end : length - 1n) };
}

export async function serveMediaFile(request, response, filePath, contentType, extraHeaders = {}) {
  const file = await open(filePath, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    // Size and bytes refer to the same file even if an upload replaces its path.
    const info = await file.stat();
    if (!info.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
    const { size } = info;
    const range = readRange(request, size);
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
      'Accept-Ranges': 'bytes',
    };
    if (range?.unsatisfiable) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
      response.end();
      return;
    }

    if (range) {
      const { start, end } = range;
      response.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
      });
    } else {
      response.writeHead(200, { ...headers, 'Content-Length': size });
    }
    if (request.method === 'HEAD' || size === 0) {
      response.end();
      return;
    }
    await pipeline(file.createReadStream(range ?? { start: 0, end: size - 1 }), response)
      .catch(error => response.destroy(error));
  } finally {
    await file.close();
  }
}
