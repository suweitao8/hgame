// The HGame scene scheduler uses these even in hosts with no browser globals.
const RuntimeDOMException = globalThis.DOMException ?? class extends Error {
  constructor(message = '', name = 'Error') {
    super(message);
    this.name = name;
  }
};

class MiniGameAbortSignal {
  #aborted = false;
  #reason;
  #listeners = new Map();
  onabort = null;

  get aborted() { return this.#aborted; }
  get reason() { return this.#reason; }

  addEventListener(type, listener, options) {
    if (type === 'abort' && listener && !this.#listeners.has(listener)) {
      this.#listeners.set(listener, options?.once === true);
    }
  }

  removeEventListener(type, listener) {
    if (type === 'abort') this.#listeners.delete(listener);
  }

  throwIfAborted() {
    if (this.#aborted) throw this.#reason;
  }

  abort(reason) {
    if (this.#aborted) return;
    this.#aborted = true;
    this.#reason = reason === undefined ? new RuntimeDOMException('This operation was aborted', 'AbortError') : reason;
    const event = { type: 'abort', target: this, currentTarget: this };
    const call = listener => {
      try {
        if (typeof listener === 'function') listener.call(this, event);
        else listener?.handleEvent?.(event);
      } catch (error) {
        setTimeout(() => { throw error; }, 0);
      }
    };
    for (const [listener, once] of Array.from(this.#listeners)) {
      if (!this.#listeners.has(listener)) continue;
      if (once) this.#listeners.delete(listener);
      call(listener);
    }
    call(this.onabort);
  }
}

const RuntimeAbortController = globalThis.AbortController ?? class {
  #signal = new MiniGameAbortSignal();
  get signal() { return this.#signal; }
  abort(reason) { this.#signal.abort(reason); }
};

const clockStart = Date.now();
const runtimePerformance = globalThis.performance ?? { now: () => Date.now() - clockStart };

export {
  RuntimeAbortController as AbortController,
  RuntimeDOMException as DOMException,
  runtimePerformance as performance,
};

function subscribe(api, name, listener) {
  api['on' + name]?.(listener);
  return () => api['off' + name]?.(listener);
}

function listen(listeners, callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function emit(listeners, value) {
  for (const listener of listeners) listener(value);
}

function frameScheduler(api, canvas) {
  const scope = typeof GameGlobal === 'undefined' ? globalThis : GameGlobal;
  for (const owner of [canvas, api, scope, globalThis]) {
    if (typeof owner.requestAnimationFrame === 'function' && typeof owner.cancelAnimationFrame === 'function') {
      return {
        requestFrame: owner.requestAnimationFrame.bind(owner),
        cancelFrame: owner.cancelAnimationFrame.bind(owner),
      };
    }
  }
  return {
    requestFrame: callback => setTimeout(() => callback(Date.now()), 16),
    cancelFrame: id => clearTimeout(id),
  };
}

function assetService(api, listedFiles) {
  const files = new Set(listedFiles);
  function assetPath(file) {
    if (!files.has(file)) throw new Error('Mini-game asset is not declared in minigame.config.json: ' + file);
    return file;
  }

  function read(file, encoding) {
    return new Promise((resolve, reject) => {
      api.getFileSystemManager().readFile({
        filePath: assetPath(file),
        ...(encoding ? { encoding } : {}),
        success: result => resolve(result.data),
        fail: error => reject(new Error('Could not read ' + file + ': ' + (error?.errMsg || error))),
      });
    });
  }

  return Object.freeze({
    readText: file => read(file, 'utf8'),
    readJson: async file => JSON.parse(await read(file, 'utf8')),
    readArrayBuffer: file => read(file),
    loadImage(file) {
      return new Promise((resolve, reject) => {
        const source = assetPath(file);
        const image = api.createImage();
        image.onload = () => resolve(image);
        image.onerror = error => reject(new Error('Could not load ' + file + ': ' + (error?.errMsg || error)));
        image.src = source;
      });
    },
    createAudio(file, { loop = false, volume = 1 } = {}) {
      const source = assetPath(file);
      const audio = api.createInnerAudioContext();
      audio.loop = loop;
      audio.volume = volume;
      audio.src = source;
      return audio;
    },
  });
}

function storageService(api) {
  const keys = () => api.getStorageInfoSync().keys;
  return Object.freeze({
    get length() { return keys().length; },
    key: index => keys()[index] ?? null,
    getItem(key) {
      key = String(key);
      const value = api.getStorageSync(key);
      if (value == null || (value === '' && !keys().includes(key))) return null;
      return String(value);
    },
    setItem: (key, value) => { api.setStorageSync(String(key), String(value)); },
    removeItem: key => { api.removeStorageSync(String(key)); },
  });
}

const TOUCH_EVENTS = { start: 'TouchStart', move: 'TouchMove', end: 'TouchEnd', cancel: 'TouchCancel' };

function mapTouches(list) {
  return Array.from(list ?? [], touch => ({
    id: touch.identifier,
    x: touch.clientX ?? touch.pageX ?? touch.screenX ?? touch.x,
    y: touch.clientY ?? touch.pageY ?? touch.screenY ?? touch.y,
  })).filter(touch => Number.isFinite(touch.x) && Number.isFinite(touch.y));
}

export function createMinigameHost(api, target, game, listedFiles) {
  if (typeof api?.createCanvas !== 'function') throw new Error('The ' + target + ' mini-game runtime is required');
  const canvas = api.createCanvas();
  const resizeListeners = new Set();
  const visibilityListeners = new Set();
  let viewport;
  let visible = true;

  function resize(event) {
    const info = api.getWindowInfo?.() ?? api.getSystemInfoSync?.() ?? {};
    const width = event?.windowWidth ?? info.windowWidth ?? info.screenWidth ?? canvas.width;
    const height = event?.windowHeight ?? info.windowHeight ?? info.screenHeight ?? canvas.height;
    const pixelRatio = Math.max(1, Number(info.pixelRatio) || 1);
    if (!(width > 0 && height > 0)) throw new Error('Mini-game viewport size is unavailable');
    if (viewport?.width === width && viewport.height === height && viewport.pixelRatio === pixelRatio) return;
    viewport = Object.freeze({ width, height, pixelRatio });
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    emit(resizeListeners, viewport);
  }

  function setVisible(value) {
    if (value === visible) return;
    visible = value;
    emit(visibilityListeners, visible);
  }

  resize();
  subscribe(api, 'WindowResize', resize);
  if (target === 'douyin' && (api.canIUse?.('onDeviceOrientationChange') ?? true)) {
    subscribe(api, 'DeviceOrientationChange', () => resize());
  }
  subscribe(api, 'Hide', () => setVisible(false));
  subscribe(api, 'Show', () => { resize(); setVisible(true); });

  return Object.freeze({
    target,
    game: Object.freeze(game),
    canvas,
    get viewport() { return viewport; },
    get visible() { return visible; },
    ...frameScheduler(api, canvas),
    onResize: listener => listen(resizeListeners, listener),
    onVisibility: listener => listen(visibilityListeners, listener),
    onTouch(phase, listener) {
      if (!Object.prototype.hasOwnProperty.call(TOUCH_EVENTS, phase)) throw new Error('Unknown touch phase: ' + phase);
      return subscribe(api, TOUCH_EVENTS[phase], event => listener({
        touches: mapTouches(event.touches),
        changedTouches: mapTouches(event.changedTouches ?? event.touches),
      }));
    },
    assets: assetService(api, listedFiles),
    storage: storageService(api),
  });
}
