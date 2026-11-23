import assert from 'node:assert/strict';

const cdpPort = Number(process.env.CDP_PORT ?? 9222);
const labUrl = process.env.HGAME_NETWORK_LAB_URL ?? 'http://127.0.0.1:5173/';
const pages = [];

class CDPPage {
  constructor(target) {
    this.target = target;
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.errors = [];
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result ?? {});
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        const description = details?.exception?.description ?? details?.text ?? 'Runtime exception';
        const location = details?.url ? ` (${details.url}:${details.lineNumber ?? 0}:${details.columnNumber ?? 0})` : '';
        this.errors.push(`${description}${location}`);
      } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        this.errors.push(message.params.entry.text);
      }
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Page.navigate', { url: labUrl });
    await this.waitFor("document.readyState === 'complete'", 'page load');
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 5000).unref?.();
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  }

  async waitFor(expression, label, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  async close() {
    this.socket.close();
    await fetch(`http://127.0.0.1:${cdpPort}/json/close/${this.target.id}`).catch(() => undefined);
  }
}

async function openPage() {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(labUrl)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Chrome CDP target creation failed: ${response.status}`);
  const target = await response.json();
  const page = new CDPPage(target);
  pages.push(page);
  await page.connect();
  return page;
}

async function selectAndConnect(page, mode) {
  await page.evaluate(`document.querySelector('.mode-tab[data-mode="${mode}"]').click()`);
  await page.waitFor("document.querySelector('#connection-status').dataset.state === 'offline'", `${mode} disconnect`);
  await page.evaluate("document.querySelector('#connect').click()");
  await page.waitFor("document.querySelector('#connection-status').dataset.state === 'online'", `${mode} connection`);
}

try {
  const [a, b] = await Promise.all([openPage(), openPage()]);
  assert.equal(await a.evaluate('document.title'), 'HGame 联机底座验收');
  assert.equal(await b.evaluate('document.title'), 'HGame 联机底座验收');

  // A: both tabs observe the same server-owned state.
  await Promise.all([a, b].map((page) => page.evaluate("document.querySelector('#connect').click()")));
  await Promise.all([a, b].map((page) => page.waitFor("document.querySelector('#connection-status').dataset.state === 'online'", 'state sync connection')));
  await a.evaluate("document.querySelector('#increment').click()");
  await Promise.all([a, b].map((page) => page.waitFor("document.querySelector('#counter').textContent === '1'", 'shared authoritative counter')));
  console.log('[browser] A state sync across two Chrome tabs: PASS');

  // B: the browser starts the native prediction/reconciliation loop.
  await Promise.all([selectAndConnect(a, 'predicted'), selectAndConnect(b, 'predicted')]);
  await Promise.all([a, b].map((page) => page.waitFor("document.querySelector('#prediction-status').textContent === '已启动'", 'prediction controller')));
  await a.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }))");
  await a.waitFor("Number(document.querySelector('#server-tick').textContent) > 0", 'authoritative prediction ticks');
  await a.evaluate("window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', bubbles: true }))");
  console.log('[browser] B prediction controller in Chrome: PASS');

  // C: both browser tabs submit inputs; confirmed network ticks must advance.
  await Promise.all([selectAndConnect(a, 'lockstep'), selectAndConnect(b, 'lockstep')]);
  await Promise.all([a, b].map((page) => page.waitFor("Number(document.querySelector('#confirmed-tick').textContent) > 0", 'confirmed lockstep frames')));
  console.log('[browser] C confirmed binary frames across two Chrome tabs: PASS');

  const errors = pages.flatMap((page) => page.errors);
  assert.deepEqual(errors, [], `Browser runtime errors: ${errors.join(' | ')}`);
  console.log('HGame Network browser smoke test passed with no runtime exceptions.');
} finally {
  await Promise.all(pages.map((page) => page.close()));
}
