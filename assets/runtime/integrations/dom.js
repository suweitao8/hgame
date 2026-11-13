/** Command-driven DOM presentation: no RAF, Canvas, or 2D physics needed. */
export function createDOMAdapter({ render } = {}) {
  if (typeof render !== 'function') throw new TypeError('DOM adapter requires render(scene, app)');
  return { render, dispose() {} };
}
