// Tiny i18n: detects the language, loads shared/i18n/<lang>.json, fills {params}.
// Elements with data-i18n="key" get their text set automatically.

export const LANGUAGES = { en: 'English', fr: 'Français', es: 'Español', zh: '中文' };
const STORAGE_KEY = 'pebbble-language';
let strings = {};
let current = 'en';

function detect() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved in LANGUAGES) return saved;
    } catch {}
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return nav in LANGUAGES ? nav : 'en';
}

async function load(lang) {
    const res = await fetch(new URL(`./i18n/${lang}.json`, import.meta.url));
    if (!res.ok) throw new Error(`i18n ${lang}`);
    strings = await res.json();
    current = lang;
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

export async function initI18n() {
    try { await load(detect()); } catch { await load('en'); }
}

export async function setLanguage(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
    await load(lang);
}

export const language = () => current;

export function t(key, params = {}) {
    const value = key.split('.').reduce((o, k) => o?.[k], strings);
    if (typeof value !== 'string') return key;
    return value.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m));
}
