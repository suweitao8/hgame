// Bare-CDP one-character generate: reopen dialog, set files, click 立即生成, capture creationId.
// usage: node _rawcdp-gen-one.mjs <frontPng> <leftPng> <beforeShot> <afterShot>
import WebSocket from 'ws';
import { writeFile } from 'node:fs/promises';

const [FRONT, LEFT, BEFORE, AFTER] = process.argv.slice(2);
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const t = targets.find((x) => x.type === 'page' && x.url.includes('3d.hunyuan.tencent.com/creation'));
if (!t) throw new Error('creation tab not found');

const ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
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
    m.error ? reject(new Error(method2(m))) : resolve(m.result);
  }
});
const method2 = (m) => `cdp error: ${JSON.stringify(m.error)}`;
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

await send('Page.enable');
await send('DOM.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Page.bringToFront', {});
const ev = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true });

const inputCount = async () => (await ev("document.querySelectorAll('input[type=file]').length")).result.value;
let n = await inputCount();
if (n !== 8) {
  // reload resets the subtab to 单张图片 — switch to 多张图片 first, then open the dialog
  const hasTrigger = (await ev("!!document.querySelector('button.hy-multiple-views-upload-v2')")).result.value;
  if (!hasTrigger) {
    const clicked = (await ev("(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.childElementCount===0&&e.textContent.trim()==='多张图片'&&e.offsetParent!==null);if(!els.length)return false;els[0].click();return true})()")).result.value;
    if (!clicked) throw new Error('多张图片 subtab not found');
    await new Promise((r) => setTimeout(r, 1200));
  }
  const clicked2 = (await ev("(()=>{const b=document.querySelector('button.hy-multiple-views-upload-v2');if(!b)return false;b.click();return true})()")).result.value;
  if (!clicked2) throw new Error('multiview trigger button not found');
  await new Promise((r) => setTimeout(r, 1500));
  n = await inputCount();
  if (n !== 8) throw new Error(`dialog reopen failed: ${n} inputs`);
}

// fresh nodeIds each time: uploads can re-render the cards and invalidate old nodeIds
const getInputs = async () => {
  const root = (await send('DOM.getDocument', { depth: 1 })).root.nodeId;
  const ids = (await send('DOM.querySelectorAll', { nodeId: root, selector: 'input[type=file]' })).nodeIds;
  if (ids.length !== 8) throw new Error(`expected 8 inputs, got ${ids.length}`);
  return ids;
};
const waitSuccess = async (slot, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = (await ev(`(() => { const c = document.querySelector('.hy-upload-card--${slot}'); return !!(c && c.classList.contains('isSuccess')); })()`)).result.value;
    if (s) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 800));
  }
};

let inputs = await getInputs();
await send('DOM.setFileInputFiles', { files: [FRONT], nodeId: inputs[2] });
if (!(await waitSuccess('front'))) {
  // one retry with fresh nodes
  inputs = await getInputs();
  await send('DOM.setFileInputFiles', { files: [FRONT], nodeId: inputs[2] });
  if (!(await waitSuccess('front'))) throw new Error('front upload failed to reach isSuccess');
}
// front upload may re-render cards: re-query nodes for the left slot
inputs = await getInputs();
await send('DOM.setFileInputFiles', { files: [LEFT], nodeId: inputs[4] });
if (!(await waitSuccess('left'))) {
  inputs = await getInputs();
  await send('DOM.setFileInputFiles', { files: [LEFT], nodeId: inputs[4] });
  if (!(await waitSuccess('left'))) throw new Error('left upload failed to reach isSuccess');
}
const ok = { front: true, left: true };

const shot = async (path) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path, Buffer.from(data, 'base64'));
};
await shot(BEFORE);

const detailIds = new Set();
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === 'Network.responseReceived') {
    const u = m.params?.response?.url || '';
    const match = u.match(/creations\/detail\?creationsId=([0-9a-f-]+)/);
    if (match) detailIds.add(match[1]);
  }
});

const btnBox = (await ev("(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='立即生成');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")).result.value;
if (!btnBox) throw new Error('立即生成 button not found');
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: btnBox.x, y: btnBox.y, button: 'left', clickCount: 1 });
}

const deadline = Date.now() + 45000;
while (detailIds.size === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
await new Promise((r) => setTimeout(r, 3000));
await shot(AFTER);
console.log(JSON.stringify({ detailIds: [...detailIds], verified: ok }));
ws.close();
process.exit(0);
