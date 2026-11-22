#!/usr/bin/env node
// Check Hunyuan 3D remaining quota + page status via bare WebSocket CDP.
// usage: node check-quota.mjs
import WebSocket from 'ws';

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const t = targets.find((x) => x.type === 'page' && x.url.includes('3d.hunyuan.tencent.com'));
if (!t) { console.error('hunyuan tab not found — is the CDP Chrome running and logged in?'); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
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
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
await send('Runtime.enable');
const { result } = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const text = document.body.innerText || '';
    const hits = ['排队', '生成中', '生成完成', '加载中'].map(k => (text.match(new RegExp('.{0,20}' + k + '.{0,30}')) || [])[0]).filter(Boolean);
    // quota renders as a standalone 1-2 digit element in the top bar (y < 100)
    const cands = [...document.querySelectorAll('body *')]
      .filter(e => e.childElementCount === 0 && /^\\d{1,2}$/.test(e.textContent.trim()))
      .filter(e => { const r = e.getBoundingClientRect(); return r.y >= 0 && r.y < 100 && r.width > 0; })
      .map(e => Number(e.textContent.trim()));
    return { hits, quota: [...new Set(cands)] };
  })()`,
});
console.log(JSON.stringify(result.value, null, 2));
ws.close();
process.exit(0);
