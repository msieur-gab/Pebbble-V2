// Minimal v2 player. Everything stays in memory (not-owned device behaviour);
// the owned-device offline library comes over from the current player later.
import * as F from '../shared/format.js';
import * as R2 from '../shared/r2.js';
import { config } from '../shared/config.js';

const $ = id => document.getElementById(id);
let p = null, header = null, pwKey = null, currentUrl = null;

function status(text) {
    $('status').hidden = !text;
    $('status').textContent = text || '';
}

/** Read the key from the address, then remove it so it doesn't stay in history. */
function takeFragment() {
    const found = F.parseFragment(location.hash);
    if (found) history.replaceState(null, '', location.pathname + location.search);
    return found;
}

async function load(found) {
    p = found; header = null; pwKey = null;
    $('empty').hidden = true;
    for (const id of ['owner', 'lock', 'list']) $(id).hidden = true;
    status('Opening your pebbble…');
    try {
        const sealed = await R2.get(config.publicBase, `${p.id}/header`, { fresh: true });
        if (!sealed) throw new Error('This pebbble has no messages yet.');
        header = await F.openHeader(sealed, p);
    } catch (e) {
        status(e.message === 'decrypt-failed' ? 'This stone could not be opened.' : e.message);
        return;
    }
    status('');
    renderOwner();
    if (header.pw) {
        $('hint').textContent = header.hint || '(no hint)';
        $('lock').hidden = false;
    } else {
        renderTracks();
    }
}

function renderOwner() {
    const { name, contact } = header.owner;
    $('owner').hidden = !name && !contact;
    $('owner-name').textContent = name || 'someone';
    $('owner-contact').textContent = contact;
    $('owner-contact-line').hidden = !contact;
}

$('unlock').onclick = async () => {
    $('lock-msg').textContent = '';
    try {
        pwKey = await F.unlock(header, p.id, $('pw').value);
    } catch {
        $('lock-msg').textContent = 'Not quite. Look at the hint again.';
        return;
    }
    $('lock').hidden = true;
    $('pw').value = '';
    renderTracks();
};

const fmt = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

function renderTracks() {
    $('list').hidden = false;
    $('tracks').replaceChildren(...header.tracks.map(t => {
        const w = F.windowStatus(t.window);
        const row = document.createElement('div');
        row.className = 'track';
        row.innerHTML = '<div><div class="title"></div><div class="muted"></div></div>';
        row.querySelector('.title').textContent = t.title;
        const note = row.querySelector('.muted');
        if (w.state === 'open') {
            note.textContent = w.closes ? `Until ${fmt(w.closes)}` : '';
            const btn = document.createElement('button');
            btn.textContent = 'Play';
            btn.onclick = () => play(t, btn);
            row.append(btn);
        } else {
            note.textContent = w.state === 'locked' ? `Opens on ${fmt(w.opens)}` : 'This message has passed';
        }
        return row;
    }));
    if (!header.tracks.length) $('tracks').innerHTML = '<p class="muted">No messages yet.</p>';
}

async function play(t, btn) {
    btn.disabled = true;
    btn.textContent = '…';
    try {
        const sealed = await R2.get(config.publicBase, `${p.id}/${t.f}`);
        const audio = await F.openTrack(sealed, p.id, t.f, await F.trackKey(t, p.id, pwKey));
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = URL.createObjectURL(new Blob([audio], { type: t.type }));
        $('audio').src = currentUrl;
        $('audio').hidden = false;
        await $('audio').play();
    } catch (e) {
        status(`Could not play “${t.title}”.`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Play';
    }
}

// A new tap while the page is open changes only the hash.
window.addEventListener('hashchange', () => { const f = takeFragment(); if (f) load(f); });

const first = takeFragment();
if (first) load(first);
