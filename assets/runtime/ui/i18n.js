/**
 * @typedef {object} I18nOptions
 * @property {string} [locale='en'] Active locale code.
 * @property {string} [fallbackLocale='en'] Fallback locale used when active locale lacks a key.
 * @property {Record<string, Record<string, string>>} [messages] Initial flat or nested locale dictionaries.
 */

function flattenMessages(input, prefix = '', out = {}) {
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      out[key] = v;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenMessages(v, key, out);
    }
  }
  return out;
}

/**
 * Lightweight zero-dependency localization table with nested keys, `{param}` interpolation,
 * pluralization (`_zero`, `_one`, `_other`), fallback locale lookup, and change subscriptions.
 * @param {I18nOptions} [options={}]
 */
export function createI18n(options = {}) {
  let locale = typeof options.locale === 'string' && options.locale ? options.locale : 'en';
  let fallbackLocale = typeof options.fallbackLocale === 'string' && options.fallbackLocale ? options.fallbackLocale : 'en';
  /** @type {Map<string, Record<string, string>>} */
  const catalogs = new Map();
  const listeners = new Set();

  function register(loc, dict) {
    if (!loc || typeof loc !== 'string') throw new TypeError('Locale code must be a non-empty string.');
    const prev = catalogs.get(loc) ?? {};
    catalogs.set(loc, { ...prev, ...flattenMessages(dict) });
  }

  if (options.messages && typeof options.messages === 'object') {
    for (const [loc, dict] of Object.entries(options.messages)) {
      register(loc, dict);
    }
  }

  function resolveRaw(key, count) {
    const order = locale === fallbackLocale ? [locale] : [locale, fallbackLocale];
    const hasCount = typeof count === 'number' && Number.isFinite(count);
    const pluralSuffix = hasCount ? (count === 0 ? '_zero' : count === 1 ? '_one' : '_other') : null;

    for (const loc of order) {
      const dict = catalogs.get(loc);
      if (!dict) continue;
      if (pluralSuffix && typeof dict[key + pluralSuffix] === 'string') {
        return dict[key + pluralSuffix];
      }
      if (typeof dict[key] === 'string') {
        return dict[key];
      }
    }
    return null;
  }

  /**
   * Formats a localized string by key with optional `{name}` parameter substitution.
   * @param {string} key
   * @param {Record<string, unknown>} [params]
   * @returns {string}
   */
  function t(key, params) {
    const count = params && typeof params.count === 'number' ? params.count : undefined;
    const raw = resolveRaw(key, count);
    if (raw === null) return key;
    if (!params) return raw;
    return raw.replace(/\{([A-Za-z0-9_.-]+)\}/g, (full, name) => (
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : full
    ));
  }

  function has(key) {
    return resolveRaw(key) !== null;
  }

  function setLocale(nextLocale) {
    if (!nextLocale || typeof nextLocale !== 'string') throw new TypeError('Locale code must be a non-empty string.');
    if (nextLocale === locale) return;
    locale = nextLocale;
    for (const fn of listeners) fn(locale);
  }

  function setFallbackLocale(nextFallback) {
    if (!nextFallback || typeof nextFallback !== 'string') throw new TypeError('Fallback locale must be a non-empty string.');
    fallbackLocale = nextFallback;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('Listener must be a function.');
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return Object.freeze({
    register,
    setLocale,
    getLocale: () => locale,
    setFallbackLocale,
    getFallbackLocale: () => fallbackLocale,
    getLocales: () => Array.from(catalogs.keys()),
    has,
    t,
    subscribe,
  });
}
