// Bare WebSocket CDP: reload page, capture creations/list response, download GLB+preview.
// usage: node _rawcdp-collect.mjs <creationId> <outGlb> <outPreview>
import WebSocket from 'ws';
import { get } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const [TARGET_ID, OUT_GLB, OUT_PNG] = process.argv.slice(2);
const listUrl = 'http://127.0.0.1:9222/json/list';

const targets = await (await fetch(listUrl)).json();
const t = targets.find((x) => x.type === 'page' && x.url.includes('3d.hunyuan.tencent.com/creation'));
if (!t) throw new Error('creation tab not found');

const ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  }
});

await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
await send('Network.enable', { maxTotalBufferSize: 256 * 1024 * 1024 });
await send('Page.enable');

let listBody = null;
let listReqId = null;
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === 'Network.responseReceived') {
    const u = m.params?.response?.url || '';
    if (u.includes('creations/list')) listReqId = m.params.requestId;
  }
  if (m.method === 'Network.loadingFinished' && listReqId && m.params?.requestId === listReqId && !listBody) {
    send('Network.getResponseBody', { requestId: listReqId }).then((r) => {
      listBody = JSON.parse(r.body);
    }).catch(() => {});
  }
});

await send('Page.reload', { ignoreCache: false });
const deadline = Date.now() + 40000;
while (!listBody && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
if (!listBody) throw new Error('no creations/list captured');
const c = (listBody.creations || []).find((x) => x.id === TARGET_ID);
if (!c) throw new Error(`creation ${TARGET_ID} not in list (totalCount=${listBody.totalCount})`);
const r = c.result?.[0];
if (c.status !== 'success' || !r?.urlResult?.glb) {
  console.log(JSON.stringify({ status: c.status, hasResult: !!r }));
  process.exit(2);
}

const dl = (url, path) => new Promise((resolve, reject) => {
  get(url, (res) => {
    const chunks = [];
    res.on('data', (ch) => chunks.push(ch));
    res.on('end', async () => {
      const buf = Buffer.concat(chunks);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buf);
      resolve({ path, bytes: buf.length, status: res.statusCode });
    });
  }).on('error', reject);
});

const glb = await dl(r.urlResult.glb, OUT_GLB);
const png = r.urlResult.image_url ? await dl(r.urlResult.image_url, OUT_PNG) : null;
console.log(JSON.stringify({
  status: c.status, faceCount: c.faceCount ?? null,
  assetId: r.assetId, taskId: r.taskId,
  glb, preview: png ?? 'none',
}));
ws.close();
process.exit(0);
