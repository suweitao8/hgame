/** Validate generator-produced projects against their own pruned local HGame runtime. */
export default async function main(cdp, args, session) {
  const reports = [];
  for (const [dimension, port] of [[2, 4176], [3, 4177]]) {
    const page = await session.ctx.newPage();
    const errors = [];
    const wasm = [];
    const failedResponses = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text().slice(0, 400));
    });
    page.on('response', response => {
      if (response.url().includes('.wasm')) wasm.push({ status: response.status(), url: response.url() });
      if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
    });
    try {
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.bringToFront();
      await page.waitForFunction(() => document.querySelector('#game')?.dataset.engineReady === 'true', null, {
        timeout: 45000,
      });
      await page.waitForTimeout(500);
      reports.push(await page.evaluate(({ dimension, wasm }) => ({
        dimension,
        canvas: [document.querySelector('#game')?.width, document.querySelector('#game')?.height],
        engineReady: document.querySelector('#game')?.dataset.engineReady,
        frame: document.querySelector('#game')?.dataset.frame,
        wasm,
      }), { dimension, wasm }));
      reports.at(-1).errors = errors;
      reports.at(-1).failedResponses = failedResponses;
    } finally {
      await page.close().catch(() => {});
    }
  }
  return reports;
}
