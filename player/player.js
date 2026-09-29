// Pebbble player.
//
// Behind (drawn into #app): arrival (a stone was just tapped) or the library.
// The pebbble itself is one sheet: stone, now playing, controls and its voices.
// Dragged down it folds into the mini player; swiping the mini player changes voice.
// Other sheets (device question, password, menu, settings) open over it.
//
// Not-owned phone: everything lives in memory and is gone when the page closes.
// Owned phone: header, keys and audio are kept in IndexedDB for offline listening.
import * as F from '../shared/format.js';
import * as R2 from '../shared/r2.js';
import * as L from './library.js';
import { config } from '../shared/config.js';
import { initI18n, setLanguage, language, LANGUAGES, t } from '../shared/i18n.js';
import { $, esc, mmss, stone, plural, ICON, dedication, belongsTo, createSheets, toast, shake, revealPasswords, hidePasswords } from '../shared/ui.js';

const audio = $('audio');
const VERSION = '2026-09-29 · 11:10'; // shown in Settings, to tell which version a phone runs

// ---------- state ----------
let view = 'none';
let p = null, header = null, sealedHeader = null, pwKey = null, offline = false, known = false;
const PL = { idx: -1, repeat: 'off', sleep: 0, sleepAt: 0, url: null, loading: false };
let savedNote = '';

const sheets = createSheets({
    base: 'player',
    onOpen: id => { if (id === 'settings-sheet') renderSettings(); },
    onClose: () => { $('sleep-choices').hidden = true; hidePasswords(); },
    onChange: () => renderMini(),
});

const seed = () => F.coverSeed(header, p.id);
const windowOf = tr => F.windowStatus(tr.window);
const openIdx = () => header.tracks.map((tr, i) => [tr, i]).filter(([tr]) => windowOf(tr).state === 'open').map(([, i]) => i);
// The year shows only when it isn't this one (an eighteenth-birthday voice, years ahead).
const fmtDate = d => d.toLocaleDateString(language(), { day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });

// ---------- views ----------

function draw(html, keepScroll = false) {
    const y = window.scrollY;
    $('app').innerHTML = html;
    window.scrollTo(0, keepScroll ? y : 0);
    renderMini();
}

function showStatus(text) {
    view = 'status';
    draw(`<p class="status">${esc(text)}</p>`);
}

function renderArrival() {
    view = 'arrival';
    const open = openIdx().length, asleep = header.tracks.filter(tr => windowOf(tr).state === 'locked').length;
    const who = belongsTo(header), { contact } = header, ded = dedication(header);
    draw(`<section class="arrival">
        <p class="eyebrow appear">${t(known ? 'arrival.back' : 'arrival.found')}</p>
        <div class="stone appear d1">${stone(seed())}</div>
        ${header.name ? `<h1 class="serif appear d2">${esc(header.name)}</h1>` : '<div style="height:28px"></div>'}
        ${ded ? `<p class="dedication appear d2">${esc(ded)}</p>` : ''}
        <p class="count soft appear d2">${plural('arrival.voices', open)}${asleep ? t('arrival.asleep', { count: asleep }) : ''}</p>
        <button class="primary appear d3" id="listen">${t('arrival.listen')}</button>
        ${contact ? `<p class="owner-note appear d4">${who ? `${t('arrival.owner', { name: `<b>${esc(who)}</b>` })}<br>` : ''}${t('arrival.write', { contact: `<a href="mailto:${esc(contact)}">${esc(contact)}</a>` })}</p>` : ''}
        ${offline ? `<p class="saved-note">${t('status.offline')}</p>` : ''}
    </section>`);
    $('listen').onclick = proceed;
}

/** The pebbble sheet's static parts: name, voices, owner line, notes. */
function renderSheet() {
    const name = belongsTo(header), { contact } = header;
    if (!$('player').classList.contains('on')) { $('pl-scroll').scrollTop = 0; $('player').classList.remove('compact'); }
    $('pl-name').textContent = header.name || name;
    $('pl-status').hidden = !offline && header.tracks.length > 0;
    $('pl-status').textContent = header.tracks.length ? t('status.offline') : t('status.empty');
    $('controls').hidden = openIdx().length === 0;
    $('pl-foot').innerHTML = name || contact ? `${name ? t('page.foot', { name: esc(name) }) : ''}${name && contact ? ' · ' : ''}${contact ? t('page.footContact', { contact: `<a href="mailto:${esc(contact)}">${esc(contact)}</a>` }) : ''}` : '';
    $('saved-note').textContent = savedNote;
    renderVoices();
    updatePlayer();
}

function renderVoices() {
    if (!header) return;
    const playing = !audio.paused;
    $('voices').innerHTML = header.tracks.map((tr, i) => {
        const w = windowOf(tr);
        if (w.state === 'locked') return `<li class="voice sleeping"><span class="n">${ICON.moon}</span><span class="t">${esc(tr.title)}<span class="wake">${t('voice.wakes', { date: fmtDate(w.opens) })}</span></span></li>`;
        const cur = i === PL.idx;
        return `<li class="voice ${cur ? 'current' : ''}" data-i="${i}"><span class="n">${cur ? `<span class="eq ${playing ? '' : 'paused'}"><i></i><i></i><i></i></span>` : i + 1}</span><span class="t">${esc(tr.title)}</span><span class="d">${mmss(tr.duration)}</span></li>`;
    }).join('');
    for (const li of $('voices').querySelectorAll('.voice[data-i]')) li.onclick = () => (+li.dataset.i === PL.idx ? toggle() : playAt(+li.dataset.i));
}

async function renderLibrary() {
    view = 'library';
    const saved = L.isOwned() ? (await L.listPebbbles()).sort((a, b) => b.savedAt - a.savedAt) : [];
    const bar = `<div class="bar"><span></span><span></span><button class="icon-btn" id="open-settings" aria-label="${t('settings.title')}">${ICON.settings}</button></div>`;
    if (!saved.length) {
        draw(`${bar}${installCard()}<section class="empty"><div class="rings"><i></i><i></i><i></i><b></b></div>
            <h1 class="serif" style="font-size:1.6rem;margin:0 0 8px">${t('library.emptyTitle')}</h1>
            <p class="soft" style="max-width:280px;margin:0 auto">${t('library.emptyText')}</p>
            <p class="faint" style="font-size:.82rem;max-width:280px;margin:18px auto 0">${t('library.iphone')}</p></section>`);
    } else {
        draw(`${bar}<section class="library"><h1 class="serif">${t('library.title')}</h1>${installCard()}
            <div class="shelf" id="shelf">${saved.map(rec => `<button data-id="${esc(rec.id)}"><div class="stone">${stone(rec.cover || rec.id)}</div>
                <div class="name">${esc(rec.title)}</div><div class="sub">${plural('library.count', rec.count)}</div></button>`).join('')}</div></section>`);
        for (const b of $('shelf').querySelectorAll('button')) {
            const rec = saved.find(r => r.id === b.dataset.id);
            b.onclick = () => load({ id: rec.id, key: rec.key }, { direct: true });
        }
    }
    $('open-settings').onclick = () => openSheet('settings-sheet');
    wireInstall();
}

async function home() {
    await renderLibrary();
}

const rerender = () => {
    if (view === 'arrival') renderArrival();
    else if (view === 'library') renderLibrary();
    if (header) renderSheet();
};

// ---------- opening a pebbble ----------

/** Read the key from the address, then remove it so it doesn't stay in history. */
function takeFragment() {
    const found = F.parseFragment(location.hash);
    if (found) history.replaceState(null, '', location.pathname + location.search);
    return found;
}

/**
 * direct: opened by a touch inside the app (library), so it can start playing at once.
 * Otherwise (a tap on the stone opened the page) the arrival screen's Listen button
 * gives the touch browsers require before sound.
 */
async function load(found, { direct = false } = {}) {
    if (p && found.id !== p.id) stopPlayback();
    p = found; header = null; sealedHeader = null; pwKey = null; offline = false; savedNote = '';
    closeSheets();
    showStatus(t('status.opening'));

    const cached = L.isOwned() ? await L.getPebbble(p.id) : null;
    const usable = cached && cached.key === p.key ? cached : null; // a rewritten stone brings a new key
    known = !!usable;

    try {
        sealedHeader = await R2.get(config.publicBase, `${p.id}/header`, { fresh: true });
        if (!sealedHeader) return showStatus(t('status.empty'));
    } catch {
        if (!usable) return showStatus(t('status.cannotOpen'));
        sealedHeader = usable.header;
        offline = true;
    }
    try {
        header = await F.openHeader(sealedHeader, p);
    } catch {
        return showStatus(t('status.cannotOpen'));
    }
    // A remembered password key stops working if the creator changed the password: ask again.
    if (usable?.pwKey && await F.pwKeyStillValid(header, p.id, usable.pwKey)) pwKey = usable.pwKey;

    if (direct) proceed();
    else renderArrival();
}

/** After Listen (or a direct open): device question, password, then the pebbble plays. */
function proceed() {
    if (!L.getMode()) return openSheet('device-sheet');
    if (header.pw && !pwKey) return askPassword();
    if (PL.idx >= 0) return openPlayer(); // already playing this pebbble: just unfold it
    if (L.isOwned()) { keep(); renderLibrary(); } // behind the sheet: the shelf, now with this stone
    renderSheet();
    openPlayer();
    const first = openIdx()[0];
    if (first !== undefined) playAt(first);
}

for (const [id, mode] of [['device-yes', 'owned'], ['device-no', 'guest']]) {
    $(id).onclick = async () => {
        $(id).classList.add('selected');
        await L.setMode(mode);
        setTimeout(() => { $(id).classList.remove('selected'); closeSheets(); setTimeout(proceed, 200); }, 250);
    };
}

function askPassword() {
    $('hint').textContent = header.hint ? `“${header.hint}”` : '';
    $('pw').value = '';
    $('lock-msg').textContent = '';
    openSheet('lock-sheet');
    setTimeout(() => $('pw').focus(), 350);
}

$('unlock').onclick = async () => {
    try {
        pwKey = await F.unlock(header, p.id, $('pw').value);
    } catch {
        $('lock-msg').textContent = t('lock.wrong');
        shake($('lock-sheet'));
        return;
    }
    closeSheets();
    setTimeout(proceed, 200);
};

// ---------- owned phone: keep everything for offline ----------

async function keep() {
    const id = p.id;
    // Ask the browser not to clear saved voices when space runs low (granted silently or not at all).
    navigator.storage?.persist?.().catch(() => {});
    await L.putPebbble({ id, key: p.key, pwKey, header: sealedHeader, title: header.name, cover: seed(), count: header.tracks.length, savedAt: Date.now() });
    // All voices, sleeping ones too, so a Christmas voice still wakes offline.
    const wanted = header.tracks.map(tr => `${id}/${tr.f}`);
    let done = 0;
    for (const path of wanted) {
        if (!(await L.getFile(path))) {
            setSaved(t('status.saving', { done, total: wanted.length }));
            try { await L.putFile(path, await R2.get(config.publicBase, path)); } catch { setSaved(''); return; }
        }
        done++;
    }
    for (const path of await L.filePaths(id)) if (!wanted.includes(path)) await L.deleteFile(path);
    if (p?.id === id) {
        setSaved(t('status.saved'));
        $('pl-install').innerHTML = installCard();
        wireInstall();
    }
}
function setSaved(text) { savedNote = text; if ($('saved-note')) $('saved-note').textContent = text; }

// ---------- playback ----------

async function playAt(i) {
    const tr = header.tracks[i];
    PL.idx = i;
    PL.loading = true;
    updatePlayer();
    try {
        const path = `${p.id}/${tr.f}`;
        let sealed = L.isOwned() ? await L.getFile(path) : null;
        sealed ??= await R2.get(config.publicBase, path);
        const bytes = await F.openTrack(sealed, p.id, tr.f, await F.trackKey(tr, p.id, pwKey));
        if (PL.idx !== i) return; // another voice was chosen meanwhile
        if (PL.url) URL.revokeObjectURL(PL.url);
        PL.url = URL.createObjectURL(new Blob([bytes], { type: tr.type }));
        audio.src = PL.url;
        audio.loop = PL.repeat === 'one';
        PL.loading = false;
        await audio.play().catch(() => toast(t('status.tapPlay'))); // blocked without a touch: stay paused
    } catch {
        PL.loading = false;
        toast(t('status.couldNotPlay', { title: tr.title }));
    }
    updatePlayer();
    renderVoices();
    setMediaSession();
}

function stopPlayback() {
    audio.pause();
    audio.removeAttribute('src');
    if (PL.url) URL.revokeObjectURL(PL.url);
    Object.assign(PL, { idx: -1, url: null, sleep: 0 });
    renderMini();
}

const toggle = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());

function skip(dir) {
    const list = openIdx();
    if (!list.length) return;
    if (dir < 0 && audio.currentTime > 5) { audio.currentTime = 0; return; }
    const pos = list.indexOf(PL.idx);
    playAt(list[(pos + dir + list.length) % list.length]);
}

audio.addEventListener('ended', () => {
    if (PL.sleep === -1) { PL.sleep = 0; toast(t('player.slept')); updatePlayer(); return; }
    const list = openIdx(), pos = list.indexOf(PL.idx);
    if (pos < list.length - 1) return playAt(list[pos + 1]);
    if (PL.repeat === 'all' && list.length) return playAt(list[0]);
    updatePlayer();
});
audio.addEventListener('timeupdate', () => { checkSleep(); updateProgress(); });
for (const ev of ['play', 'pause']) audio.addEventListener(ev, () => { updatePlayer(); renderVoices(); });

function checkSleep() {
    if (PL.sleep > 0 && Date.now() >= PL.sleepAt) {
        PL.sleep = 0;
        audio.pause();
        toast(t('player.slept'));
    }
}
setInterval(() => { if (PL.sleep > 0) { checkSleep(); updateSleepLabel(); } }, 1000);

// ---------- player UI ----------

function updateProgress() {
    const d = audio.duration, now = audio.currentTime;
    const pct = d ? Math.min(1, now / d) * 100 : 0;
    $('fill').style.width = pct + '%';
    $('dot').style.left = pct + '%';
    $('mini-line').style.width = pct + '%';
    $('t-now').textContent = mmss(now);
    $('t-left').textContent = '-' + mmss(Math.max(0, (d || 0) - now));
}

function updateSleepLabel() {
    const left = Math.max(0, (PL.sleepAt - Date.now()) / 1000);
    $('sleep').innerHTML = `${ICON.moon}<span>${PL.sleep > 0 ? t('player.sleepIn', { time: mmss(left) }) : PL.sleep === -1 ? t('player.sleepEnd') : t('player.sleep')}</span>`;
    $('sleep').classList.toggle('active', PL.sleep !== 0);
}

function updatePlayer() {
    if (!header) return renderMini();
    const s = seed();
    if ($('pl-stone').dataset.seed !== s) { $('pl-stone').innerHTML = stone(s); $('mini-stone').innerHTML = stone(s, 'thumb'); $('pl-stone').dataset.seed = s; }
    const playing = !audio.paused;
    $('pl-stone').classList.toggle('breathing', playing);
    const tr = header.tracks[PL.idx];
    const list = openIdx();
    $('pl-title').textContent = tr ? tr.title : header.name || '';
    $('pl-sub').textContent = tr ? t('player.of', { name: header.name || belongsTo(header), n: list.indexOf(PL.idx) + 1, total: list.length }).replace(/^ · /, '') : '';
    $('play').innerHTML = playing ? ICON.pause : ICON.play;
    $('play').setAttribute('aria-label', t(playing ? 'player.pause' : 'player.play'));
    $('mini-play').innerHTML = playing ? ICON.pauseSmall : ICON.playSmall;
    $('mini-title').textContent = tr?.title || '';
    $('mini-sub').textContent = header.name || '';
    $('repeat').innerHTML = `${ICON.repeat}<span>${t({ off: 'player.repeatOff', all: 'player.repeatAll', one: 'player.repeatOne' }[PL.repeat])}</span>`;
    $('repeat').classList.toggle('active', PL.repeat !== 'off');
    updateSleepLabel();
    updateProgress();
    renderMini();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

function renderMini() {
    const anySheet = [...document.querySelectorAll('.sheet')].some(s => s.classList.contains('on'));
    $('mini').classList.toggle('on', PL.idx >= 0 && !anySheet && view !== 'status');
}

function openPlayer() { updatePlayer(); openSheet('player'); }

// Long lists: shrink the stone while the voices scroll. Only when the list is truly
// longer than the space, so a short list never flickers between the two sizes.
$('pl-scroll').addEventListener('scroll', () => {
    const sc = $('pl-scroll'), sheet = $('player');
    if (!sheet.classList.contains('compact')) {
        if (sc.scrollTop > 24 && sc.scrollHeight - sc.clientHeight > 180) sheet.classList.add('compact');
    } else if (sc.scrollTop === 0) {
        sheet.classList.remove('compact');
    }
});
const collapse = () => closeSheets();
$('collapse').onclick = collapse;
$('mini-open').onclick = e => { if (miniSwiped) return; if (!e.target.closest('#mini-play')) openPlayer(); };

// ---------- gestures ----------

// Drag the top of the sheet down to fold it into the mini player.
{
    const sheet = $('player'), zone = $('drag-zone');
    let y0 = null, dy = 0, t0 = 0, dragging = false;
    zone.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        y0 = e.clientY; dy = 0; t0 = performance.now(); dragging = false;
    });
    zone.addEventListener('pointermove', e => {
        if (y0 === null) return;
        dy = Math.max(0, e.clientY - y0);
        if (!dragging && dy > 8) { dragging = true; zone.setPointerCapture(e.pointerId); sheet.classList.add('dragging'); }
        if (dragging) sheet.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
        if (y0 === null) return;
        const fast = dy / (performance.now() - t0) > 0.6;
        sheet.classList.remove('dragging');
        sheet.style.transform = '';
        if (dragging && (dy > 120 || (fast && dy > 40))) collapse();
        y0 = null;
        setTimeout(() => { dragging = false; }, 0); // after the click that may follow this pointerup
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    // A drag must not also count as a tap on the buttons in the zone.
    zone.addEventListener('click', e => { if (dragging) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// Mini player: swipe sideways to change voice, swipe up (or tap) to unfold.
let miniSwiped = false;
{
    const inner = $('mini-open');
    let x0 = null, y0 = 0, dx = 0, dy = 0;
    inner.addEventListener('pointerdown', e => { if (e.target.closest('#mini-play')) return; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; miniSwiped = false; });
    inner.addEventListener('pointermove', e => {
        if (x0 === null) return;
        dx = e.clientX - x0; dy = e.clientY - y0;
        if (!miniSwiped && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { miniSwiped = true; inner.setPointerCapture(e.pointerId); inner.classList.add('dragging'); }
        if (miniSwiped) { inner.style.transform = `translateX(${dx}px)`; inner.style.opacity = String(1 - Math.min(0.6, Math.abs(dx) / 300)); }
    });
    const end = () => {
        if (x0 === null) return;
        inner.classList.remove('dragging');
        if (miniSwiped && Math.abs(dx) > 60) {
            const dir = dx < 0 ? 1 : -1;
            inner.style.transform = `translateX(${dir * -120}%)`; inner.style.opacity = '0';
            setTimeout(() => {
                skip(dir);
                inner.classList.add('dragging');
                inner.style.transform = `translateX(${dir * 60}%)`;
                requestAnimationFrame(() => { inner.classList.remove('dragging'); inner.style.transform = ''; inner.style.opacity = ''; });
            }, 180);
        } else {
            inner.style.transform = ''; inner.style.opacity = '';
            if (!miniSwiped && dy < -30) openPlayer();
        }
        x0 = null;
        setTimeout(() => { miniSwiped = false; }, 50);
    };
    inner.addEventListener('pointerup', end);
    inner.addEventListener('pointercancel', end);
}
$('mini-play').onclick = toggle;
$('play').onclick = toggle;
$('prev').onclick = () => skip(-1);
$('next').onclick = () => skip(1);
$('progress').onclick = e => {
    if (!audio.duration) return;
    const r = $('progress').getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
};
$('repeat').onclick = () => {
    PL.repeat = { off: 'all', all: 'one', one: 'off' }[PL.repeat];
    audio.loop = PL.repeat === 'one';
    updatePlayer();
};
$('sleep').onclick = () => {
    const box = $('sleep-choices');
    box.hidden = !box.hidden;
    const choices = [[0, t('player.off')], [15, t('player.min', { n: 15 })], [30, t('player.min', { n: 30 })], [45, t('player.min', { n: 45 })], [60, t('player.hour')], [-1, t('player.endOfVoice')]];
    box.innerHTML = choices.map(([m, l]) => `<button data-m="${m}" class="${PL.sleep === m ? 'on' : ''}">${esc(l)}</button>`).join('');
    for (const b of box.querySelectorAll('button')) b.onclick = () => {
        PL.sleep = +b.dataset.m;
        PL.sleepAt = PL.sleep > 0 ? Date.now() + PL.sleep * 60000 : 0;
        box.hidden = true;
        updateSleepLabel();
        if (PL.sleep) toast(PL.sleep > 0 ? t('player.sleepSet', { time: b.textContent }) : t('player.sleepSetEnd'));
    };
};

// Lock screen / headphones controls, with the stone as artwork.
const artwork = new Map();
async function coverPng(s) {
    if (artwork.has(s)) return artwork.get(s);
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(stone(s));
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
    const g = c.getContext('2d');
    g.fillStyle = '#ecebe7'; g.fillRect(0, 0, 512, 512);
    g.drawImage(img, 56, 56, 400, 400);
    const url = URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/png')));
    artwork.set(s, url);
    return url;
}
async function setMediaSession() {
    if (!('mediaSession' in navigator) || PL.idx < 0) return;
    const tr = header.tracks[PL.idx];
    let art = [];
    try { art = [{ src: await coverPng(seed()), sizes: '512x512', type: 'image/png' }]; } catch {}
    navigator.mediaSession.metadata = new MediaMetadata({ title: tr.title, artist: header.from || '', album: header.name || '', artwork: art });
}
if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('previoustrack', () => skip(-1));
    ms.setActionHandler('nexttrack', () => skip(1));
}

// ---------- gentle install suggestion ----------
// Owned phones only, when Pebbble isn't already on the home screen. Android/Chrome offers
// its own install prompt; iPhone has none, so we explain the Share step instead.
// "Not now" is remembered for 30 days.

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; rerenderInstall(); });
window.addEventListener('appinstalled', () => { installPrompt = null; rerenderInstall(); });

const INSTALL_LATER = 'pebbble-install-later';
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installWanted() {
    if (!L.isOwned() || isStandalone()) return false;
    try { if (Date.now() - Number(localStorage.getItem(INSTALL_LATER) || 0) < 30 * 864e5) return false; } catch {}
    return !!installPrompt || isIOS();
}
function installCard() {
    if (!installWanted()) return '';
    const action = installPrompt
        ? `<div class="row"><button class="add" data-install="add">${t('install.add')}</button><button class="later" data-install="later">${t('install.later')}</button></div>`
        : `<div class="row"><p class="ios">${t('install.ios')}</p><button class="later" data-install="later">${t('install.later')}</button></div>`;
    return `<div class="install" id="install-card"><b>${t('install.title')}</b><p>${t('install.text')}</p>${action}</div>`;
}
function wireInstall() {
    for (const b of document.querySelectorAll('[data-install]')) b.onclick = async () => {
        if (b.dataset.install === 'add' && installPrompt) {
            installPrompt.prompt();
            await installPrompt.userChoice.catch(() => {});
            installPrompt = null;
        } else {
            try { localStorage.setItem(INSTALL_LATER, String(Date.now())); } catch {}
        }
        rerenderInstall();
    };
}
function rerenderInstall() {
    if (view === 'library') renderLibrary();
    if ($('pl-install') && savedNote === t('status.saved')) { $('pl-install').innerHTML = installCard(); wireInstall(); }
}

// ---------- this pebbble: edit / forget / settings ----------

function isMine({ id, key }) {
    try {
        const lib = JSON.parse(localStorage.getItem('pebbble-writer-library'));
        return !!lib?.items?.some(i => i.id === id && i.key === key);
    } catch { return false; }
}

function openMenu() {
    $('menu-stone').innerHTML = stone(seed(), 'thumb');
    $('menu-name').textContent = header.name || belongsTo(header);
    $('m-edit').hidden = !isMine(p);
    $('m-edit').innerHTML = `${ICON.pen}<span><b>${t('menu.edit')}</b><span>${t('menu.editText')}</span></span>`;
    $('m-forget').hidden = !L.isOwned();
    resetForget();
    $('m-settings').innerHTML = `${ICON.settings}<span><b>${t('menu.settings')}</b><span>${t('menu.settingsText')}</span></span>`;
    openSheet('menu-sheet');
}
function resetForget() {
    $('m-forget').classList.remove('confirm');
    $('m-forget').innerHTML = `${ICON.leaf}<span><b>${t('menu.forget')}</b><span>${t('menu.forgetText')}</span></span>`;
}
$('open-menu').onclick = openMenu;
$('m-edit').onclick = () => { location.href = `../writer/#${p.id}.${p.key}`; };
$('m-settings').onclick = () => openSheet('settings-sheet');
$('m-forget').onclick = async () => {
    const b = $('m-forget');
    if (!b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.innerHTML = `${ICON.leaf}<span><b>${t('menu.forgetConfirm', { name: esc(header.name || belongsTo(header)) })}</b><span>${t('menu.forgetConfirmText')}</span></span>`;
        return;
    }
    const name = header.name || belongsTo(header);
    stopPlayback();
    await L.forget(p.id);
    p = header = null;
    closeSheets();
    await home();
    toast(t('menu.forgotten', { name }));
};

// ---------- settings ----------

function renderSettings() {
    $('version').textContent = `Pebbble · ${VERSION}`;
    $('langs').innerHTML = Object.entries(LANGUAGES).map(([code, name]) => `<button data-lang="${code}" class="${code === language() ? 'on' : ''}">${name}</button>`).join('');
    for (const b of $('langs').querySelectorAll('button')) b.onclick = async () => {
        await setLanguage(b.dataset.lang);
        renderSettings();
        rerender();
        updatePlayer();
    };
    $('set-mine').classList.toggle('selected', L.getMode() === 'owned');
    $('set-notmine').classList.toggle('selected', L.getMode() === 'guest');
}
$('set-mine').onclick = async () => {
    await L.setMode('owned');
    navigator.storage?.persist?.().catch(() => {});
    renderSettings();
    toast(t('settings.nowMine'));
    if (header) { renderSheet(); keep(); }
};
$('set-notmine').onclick = async () => {
    if (L.isOwned() && !confirm(t('settings.clearConfirm'))) return;
    await L.setMode('guest');
    savedNote = '';
    renderSettings();
    toast(t('settings.nowNotMine'));
    if (header) renderSheet();
    if (view === 'library') renderLibrary();
};
$('clear').onclick = async () => {
    if (!confirm(t('settings.clearConfirm'))) return;
    await L.clearAll();
    savedNote = '';
    toast(t('settings.cleared'));
    if (view === 'library') renderLibrary();
    if (header) renderSheet();
};

// ---------- sheets ----------
// The pebbble sheet stays open underneath; other sheets open over it with the scrim
// between them. Tapping the scrim closes only the sheet on top.

function openSheet(id) { sheets.open(id); }
function closeSheets() { sheets.closeAll(); }

// ---------- start ----------

// A new tap while the page is open changes only the hash.
window.addEventListener('hashchange', () => { const f = takeFragment(); if (f) load(f); });

navigator.serviceWorker?.register('sw.js', { updateViaCache: 'none' }).catch(() => {});

await initI18n();
revealPasswords();
const first = takeFragment();
if (first) load(first);
else home();
