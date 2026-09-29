// Interface pieces shared by the player and the writer: helpers, icons, sheets, toast,
// and the few sentences both apps show about a pebbble.
import { pebbleCover } from './cover.js';
import { t } from './i18n.js';

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const mmss = s => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
export const stone = (seed, detail = 'full') => pebbleCover(seed, { detail });
/** "key_one" when count is 1, else "key". */
export const plural = (key, count, extra = {}) => t(count === 1 ? `${key}_one` : key, { count, ...extra });

const svg = (body, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24">${body}</svg>`;
export const ICON = {
    play: svg('<path d="M8 5.5v13l11-6.5z"/>'),
    pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/>'),
    playSmall: svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>'),
    pauseSmall: svg('<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
    repeat: svg('<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>'),
    moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
    settings: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
    back: svg('<path d="M15 6l-6 6 6 6"/>'),
    chev: svg('<path d="M9 6l6 6-6 6"/>', 'icon chev'),
    pen: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>'),
    leaf: svg('<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/>'),
    reroll: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};

// ---------- what a pebbble says about itself ----------

/**
 * The line under a pebbble's name, in the phrasing its creator chose:
 * "for Lina · from Papa" (the default), or with `ded: 'love'` "made with love by Papa for Lina".
 */
export function dedication(header) {
    const from = header.from?.trim(), to = header.for?.trim();
    if (header.ded === 'love' && from) return to ? t('pebbble.loveFor', { from, for: to }) : t('pebbble.love', { from });
    if (from && to) return t('pebbble.forFrom', { for: to, from });
    if (to) return t('pebbble.for', { for: to });
    if (from) return t('pebbble.from', { from });
    return '';
}

/** Who a found stone goes back to: the person it is for, else its maker. */
export const belongsTo = header => header.for?.trim() || header.from?.trim() || '';

// ---------- sheets ----------

/**
 * Bottom sheets with one scrim. A `base` sheet (the player's pebbble sheet) stays open
 * underneath while another sheet opens over it; tapping the scrim closes only the top one.
 * Without a base, opening a sheet closes any other.
 */
export function createSheets({ base = null, onOpen = () => {}, onChange = () => {}, onClose = () => {} } = {}) {
    const scrim = $('scrim');
    const baseOn = () => !!base && $(base).classList.contains('on');

    function open(id) {
        const under = baseOn() && id !== base;
        for (const sh of document.querySelectorAll('.sheet.on')) if (!(under && sh.id === base)) sh.classList.remove('on', 'over');
        if (id === base) {
            scrim.classList.remove('on', 'over');
        } else {
            scrim.classList.add('on');
            scrim.classList.toggle('over', under);
            $(id).classList.toggle('over', under);
        }
        $(id).classList.add('on');
        onOpen(id);
        onChange();
    }
    function closeAll() {
        for (const sh of document.querySelectorAll('.sheet')) sh.classList.remove('on', 'over');
        scrim.classList.remove('on', 'over');
        onClose();
        onChange();
    }
    function closeTop() {
        const over = document.querySelector('.sheet.over.on');
        if (!over) return closeAll();
        over.classList.remove('on', 'over');
        scrim.classList.remove('on', 'over');
        onChange();
    }
    scrim.onclick = closeTop;
    return { open, closeAll, closeTop, isOpen: id => $(id).classList.contains('on') };
}

// ---------- show / hide passwords ----------

const EYE = svg('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
const EYE_OFF = svg('<path d="M3 3l18 18"/><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5C18.4 5.5 22 12 22 12a17 17 0 0 1-3.3 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 6.5 10 6.5c1.9 0 3.5-.6 4.9-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>');

/** Give every password field under root an eye button that shows or hides what was typed. */
export function revealPasswords(root = document) {
    for (const input of root.querySelectorAll('input[type=password]:not([data-reveal])')) {
        input.dataset.reveal = '';
        const wrap = document.createElement('div');
        wrap.className = 'pw-field';
        input.replaceWith(wrap);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reveal';
        const set = shown => {
            input.type = shown ? 'text' : 'password';
            btn.innerHTML = shown ? EYE_OFF : EYE;
            btn.setAttribute('aria-label', t(shown ? 'common.hide' : 'common.show'));
            btn.setAttribute('aria-pressed', String(shown));
        };
        btn.onclick = () => { set(input.type === 'password'); input.focus(); };
        input.hidePassword = () => set(false);
        set(false);
        wrap.append(input, btn);
    }
}
/** Hide every revealed password again (when a sheet or screen closes). */
export function hidePasswords(root = document) {
    for (const input of root.querySelectorAll('input[data-reveal][type=text]')) input.hidePassword();
}

// ---------- toast ----------

let toastTimer;
export function toast(msg) {
    $('toast').textContent = msg;
    $('toast').classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('on'), 2600);
}

/** Shake an element (a wrong password). */
export function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
}
