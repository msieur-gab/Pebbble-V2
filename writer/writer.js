import * as F from '../shared/format.js';
import * as R2 from '../shared/r2.js';
import { config } from '../shared/config.js';

const $ = id => document.getElementById(id);
const SETTINGS_KEY = 'pebbble-writer-settings';

// ---------- settings ----------

function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}

function creds() {
    const s = loadSettings();
    if (config.devEndpoint) return { accountId: 'dev', accessKeyId: 'dev', secretAccessKey: 'dev', bucket: 'dev', endpoint: config.devEndpoint };
    for (const k of ['accountId', 'accessKeyId', 'secretAccessKey', 'bucket']) {
        if (!s[k]) throw new Error('Fill in the storage settings first.');
    }
    return s;
}

const publicBase = () => loadSettings().publicBase || config.publicBase;

for (const input of $('settings').querySelectorAll('input')) input.value = loadSettings()[input.name] || '';
$('save-settings').onclick = () => {
    const s = {};
    for (const input of $('settings').querySelectorAll('input')) s[input.name] = input.value.trim();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    $('settings').open = false;
};

// ---------- editor state ----------
// s = { p: {id, key}, header, pwKey, pending: [{title, blob, type, window}], removed: [file], isNew }
let s = null;
let recorded = null;

function show(section) {
    for (const id of ['start', 'editor', 'done']) $(id).hidden = id !== section;
}

function startNew() {
    s = { p: F.newPebbble(), header: F.newHeader({}), pwKey: null, pending: [], removed: [], isNew: true };
    renderEditor();
}

async function openPebbble(p) {
    $('start-msg').textContent = 'Opening…';
    try {
        const sealed = await R2.get(publicBase(), `${p.id}/header`, { fresh: true });
        if (!sealed) throw new Error('No pebbble found for this link.');
        const header = await F.openHeader(sealed, p);
        s = { p, header, pwKey: null, pending: [], removed: [], isNew: false };
        $('start-msg').textContent = '';
        renderEditor();
    } catch (e) {
        $('start-msg').textContent = e.message === 'decrypt-failed' ? 'This link does not open that pebbble.' : e.message;
    }
}

function windowLabel(w) {
    if (!w) return 'Always';
    if (w.every) return `Every year, ${w.every.replace('..', ' → ')}`;
    return `${w.from || '…'} → ${w.to || '…'}`;
}

function renderEditor() {
    const { header } = s;
    const locked = header.pw && !s.pwKey;
    $('editor-title').textContent = s.isNew ? 'New pebbble' : 'Edit pebbble';
    $('unlock').hidden = !locked;
    $('unlock-hint').textContent = header.hint || '(none)';
    $('fields').hidden = locked;
    $('owner-name').value = header.owner.name;
    $('owner-contact').value = header.owner.contact;
    $('pw-new').hidden = !!header.pw;
    $('pw-set').hidden = !header.pw;
    $('hint-show').textContent = header.hint || '(none)';
    renderTracks();
    show('editor');
}

function renderTracks() {
    const rows = [
        ...s.header.tracks.map(t => ({ title: t.title, window: t.window, remove: () => { s.removed.push(t.f); s.header.tracks = s.header.tracks.filter(x => x !== t); } })),
        ...s.pending.map(t => ({ title: `${t.title} (new)`, window: t.window, remove: () => { s.pending = s.pending.filter(x => x !== t); } })),
    ];
    $('tracks').replaceChildren(...rows.map(r => {
        const row = document.createElement('div');
        row.className = 'track';
        row.innerHTML = `<div><div class="title"></div><div class="muted"></div></div><button class="quiet">Remove</button>`;
        row.querySelector('.title').textContent = r.title;
        row.querySelector('.muted').textContent = windowLabel(r.window);
        row.querySelector('button').onclick = () => { r.remove(); renderTracks(); };
        return row;
    }));
    if (!rows.length) $('tracks').innerHTML = '<p class="muted">No messages yet.</p>';
}

// ---------- adding a message ----------

$('t-when').onchange = () => {
    $('t-dates').hidden = $('t-when').value !== 'dates';
    $('t-yearly').hidden = $('t-when').value !== 'yearly';
};

let recorder = null;
$('t-rec').onclick = async () => {
    if (recorder) { recorder.stop(); return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    // Prefer AAC in MP4 (plays everywhere, including iPhone); fall back to the browser's default.
    const mimeType = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        recorded = new Blob(chunks, { type: recorder.mimeType });
        recorder = null;
        $('t-rec').textContent = '✓ Recorded (tap to redo)';
    };
    recorder.start();
    $('t-rec').textContent = '■ Stop';
};

$('t-add').onclick = () => {
    const title = $('t-title').value.trim();
    const blob = $('t-file').files[0] || recorded;
    if (!title || !blob) { $('save-msg').textContent = 'A message needs a title and audio.'; return; }
    const when = $('t-when').value;
    const mmdd = /^\d{2}-\d{2}$/;
    let window;
    if (when === 'dates') window = { ...($('t-from').value && { from: $('t-from').value }), ...($('t-to').value && { to: $('t-to').value }) };
    if (when === 'yearly') {
        const a = $('t-every-a').value.trim(), b = $('t-every-b').value.trim() || a;
        if (!mmdd.test(a) || !mmdd.test(b)) { $('save-msg').textContent = 'Use MM-DD for yearly dates, e.g. 12-24.'; return; }
        window = { every: `${a}..${b}` };
    }
    s.pending.push({ title, blob, type: blob.type || 'audio/webm', window });
    $('t-title').value = ''; $('t-file').value = ''; recorded = null; $('t-rec').textContent = '● Record';
    $('save-msg').textContent = '';
    renderTracks();
};

// ---------- password ----------

$('unlock-btn').onclick = async () => {
    try {
        s.pwKey = await F.unlock(s.header, s.p.id, $('unlock-pw').value);
        renderEditor();
    } catch {
        $('unlock-hint').textContent = `${s.header.hint || '(none)'} — wrong password, try again`;
    }
};

// ---------- save: tracks first, header last ----------

$('save').onclick = async () => {
    const btn = $('save');
    btn.disabled = true;
    const msg = t => ($('save-msg').textContent = t);
    try {
        const c = creds();
        const { p, header } = s;
        header.owner = { name: $('owner-name').value.trim(), contact: $('owner-contact').value.trim() };

        const password = $('pw').value;
        if (password && !header.pw) s.pwKey = await F.setPassword(header, p.id, password, $('hint').value.trim());

        for (const [i, t] of s.pending.entries()) {
            msg(`Encrypting and uploading ${i + 1} of ${s.pending.length}…`);
            const file = F.newFileName();
            const { sealed, key } = await F.sealTrack(new Uint8Array(await t.blob.arrayBuffer()), p.id, file);
            await R2.put(c, `${p.id}/${file}`, sealed, { cacheControl: 'public, max-age=31536000, immutable' });
            await F.addTrack(header, p.id, { file, title: t.title, type: t.type, window: t.window, key }, s.pwKey);
        }
        s.pending = [];

        msg('Saving header…');
        await R2.put(c, `${p.id}/header`, await F.sealHeader(header, p), { cacheControl: 'no-cache' });
        for (const file of s.removed) await R2.del(c, `${p.id}/${file}`);
        s.removed = [];

        msg('');
        $('done-url').textContent = F.tagUrl(config.appBase, p);
        $('tag-msg').textContent = s.isNew ? 'Write this link to a tag.' : 'The stone keeps its link; no need to rewrite it.';
        s.isNew = false;
        show('done');
    } catch (e) {
        msg(e.message);
    } finally {
        btn.disabled = false;
    }
};

// ---------- tags ----------

$('write-tag').onclick = async () => {
    if (!('NDEFReader' in window)) { $('tag-msg').textContent = 'Writing tags needs Chrome on Android.'; return; }
    $('tag-msg').textContent = 'Hold the stone against the phone…';
    try {
        await new NDEFReader().write({ records: [{ recordType: 'url', data: $('done-url').textContent }] });
        $('tag-msg').textContent = 'Written. Tap the stone to test it.';
    } catch (e) {
        $('tag-msg').textContent = `Could not write: ${e.message}`;
    }
};

$('copy').onclick = () => navigator.clipboard.writeText($('done-url').textContent);
$('try').onclick = () => window.open($('done-url').textContent, '_blank');

$('scan').onclick = async () => {
    if (!('NDEFReader' in window)) { $('start-msg').textContent = 'Reading tags needs Chrome on Android. Paste the link instead.'; return; }
    const reader = new NDEFReader();
    const stop = new AbortController();
    reader.onreading = e => {
        const rec = [...e.message.records].find(r => r.recordType === 'url');
        const p = rec && F.parseFragment(new URL(new TextDecoder().decode(rec.data)).hash);
        if (!p) { $('start-msg').textContent = 'This tag has no v2 pebbble link.'; return; }
        stop.abort();
        openPebbble(p);
    };
    await reader.scan({ signal: stop.signal });
    $('start-msg').textContent = 'Tap the stone…';
};

$('open-link').onclick = () => {
    let p = null;
    try { p = F.parseFragment(new URL($('link').value.trim()).hash); } catch {}
    if (!p) { $('start-msg').textContent = 'That is not a pebbble link.'; return; }
    openPebbble(p);
};

$('new').onclick = startNew;
