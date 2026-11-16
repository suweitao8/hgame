/**
 * Lightweight zero-dependency localization table with nested keys, `{param}` interpolation,
 * pluralization (`_zero`, `_one`, `_other`), fallback locale lookup, and change subscriptions.
 * @param {I18nOptions} [options={}]
 */
export function createI18n(options?: I18nOptions | undefined): Readonly<{
    register: (loc: any, dict: any) => void;
    setLocale: (nextLocale: any) => void;
    getLocale: () => string;
    setFallbackLocale: (nextFallback: any) => void;
    getFallbackLocale: () => string;
    getLocales: () => string[];
    has: (key: any) => boolean;
    t: (key: string, params?: Record<string, unknown> | undefined) => string;
    subscribe: (fn: any) => () => boolean;
}>;
export type I18nOptions = {
    /**
     * Active locale code.
     */
    locale?: string | undefined;
    /**
     * Fallback locale used when active locale lacks a key.
     */
    fallbackLocale?: string | undefined;
    /**
     * Initial flat or nested locale dictionaries.
     */
    messages?: Record<string, Record<string, string>> | undefined;
};
