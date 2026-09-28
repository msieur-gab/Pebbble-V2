import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../shared/format.js';

const audio = new TextEncoder().encode('pretend this is audio');

test('tag URL round-trips and fits an NTAG213', () => {
    const p = F.newPebbble();
    const url = F.tagUrl('https://msieur-gab.github.io/Pebbble-V2/player/', p);
    assert.deepEqual(F.parseFragment(new URL(url).hash), p);
    // NTAG213: 137 usable bytes; the URI record abbreviates "https://" and adds ~7 bytes of framing.
    assert.ok(url.length - 8 + 7 <= 137, `URL too long: ${url.length}`);
    assert.equal(F.parseFragment('#nope'), null);
});

test('header opens with the tag key, not with another', async () => {
    const p = F.newPebbble();
    const h = F.newHeader({ name: 'Gab', contact: 'gab@example.com' });
    const sealed = await F.sealHeader(h, p);
    assert.equal((await F.openHeader(sealed, p)).owner.name, 'Gab');
    await assert.rejects(F.openHeader(sealed, F.newPebbble()), /decrypt-failed/);
    // A header can't be moved to another pebbble id with the same key.
    await assert.rejects(F.openHeader(sealed, { ...p, id: F.newPebbble().id }), /decrypt-failed/);
});

test('track without password', async () => {
    const { id } = F.newPebbble();
    const h = F.newHeader({});
    const file = F.newFileName();
    const { sealed, key } = await F.sealTrack(audio, id, file);
    const t = await F.addTrack(h, id, { file, title: 'Hello', type: 'audio/webm', key });
    const back = await F.openTrack(sealed, id, file, await F.trackKey(t, id));
    assert.deepEqual(back, audio);
});

test('password: set later, wraps existing tracks, wrong password fails', async () => {
    const { id } = F.newPebbble();
    const h = F.newHeader({});
    const f1 = F.newFileName();
    const s1 = await F.sealTrack(audio, id, f1);
    await F.addTrack(h, id, { file: f1, title: 'one', type: 'audio/webm', key: s1.key });

    const pwKey = await F.setPassword(h, id, 'caillou', 'what you throw in the river');
    assert.equal(h.tracks[0].k, undefined);
    assert.ok(h.tracks[0].wk);
    await assert.rejects(F.trackKey(h.tracks[0], id), /password-required/);

    // Adding a track later needs the password key.
    const f2 = F.newFileName();
    const s2 = await F.sealTrack(audio, id, f2);
    await assert.rejects(F.addTrack(h, id, { file: f2, title: 'two', type: 'audio/webm', key: s2.key }), /password-required/);
    await F.addTrack(h, id, { file: f2, title: 'two', type: 'audio/webm', key: s2.key }, pwKey);

    await assert.rejects(F.unlock(h, id, 'wrong'), /wrong-password/);
    const k = await F.unlock(h, id, 'caillou');
    for (const [t, s, f] of [[h.tracks[0], s1, f1], [h.tracks[1], s2, f2]]) {
        assert.deepEqual(await F.openTrack(s.sealed, id, f, await F.trackKey(t, id, k)), audio);
    }
});

test('one-off window', () => {
    const w = { from: '2026-12-24', to: '2026-12-26' };
    assert.equal(F.windowStatus(w, new Date(2026, 11, 23)).state, 'locked');
    assert.equal(F.windowStatus(w, new Date(2026, 11, 24, 0, 1)).state, 'open');
    assert.equal(F.windowStatus(w, new Date(2026, 11, 26, 23, 59)).state, 'open');
    assert.equal(F.windowStatus(w, new Date(2026, 11, 27)).state, 'past');
    assert.equal(F.windowStatus(undefined).state, 'open');
});

test('yearly window, including one that wraps the new year', () => {
    const xmas = { every: '12-20..12-27' };
    assert.equal(F.windowStatus(xmas, new Date(2027, 11, 22)).state, 'open');
    const s = F.windowStatus(xmas, new Date(2027, 0, 5));
    assert.equal(s.state, 'locked');
    assert.equal(s.opens.getTime(), new Date(2027, 11, 20).getTime());

    const ny = { every: '12-31..01-02' };
    assert.equal(F.windowStatus(ny, new Date(2027, 0, 1)).state, 'open');
    assert.equal(F.windowStatus(ny, new Date(2027, 11, 31, 20)).state, 'open');
    assert.equal(F.windowStatus(ny, new Date(2027, 0, 3)).state, 'locked');

    const birthday = { every: '03-14..03-14' };
    assert.equal(F.windowStatus(birthday, new Date(2030, 2, 14, 18)).state, 'open');
    assert.equal(F.windowStatus(birthday, new Date(2030, 2, 15)).opens.getFullYear(), 2031);
});

test('name and cover seed', async () => {
    const p = F.newPebbble();
    const h = F.newHeader({ name: 'Gab' }, 'Lullabies');
    assert.equal(F.coverSeed(h, p.id), p.id);
    h.cover = F.newCoverSeed();
    const back = await F.openHeader(await F.sealHeader(h, p), p);
    assert.equal(back.name, 'Lullabies');
    assert.equal(F.coverSeed(back, p.id), h.cover);
});

test('library: same passphrase finds and opens the same list', async () => {
    const a = await F.deriveLibrary('pierre de rivière', 'pebbble');
    const b = await F.deriveLibrary('pierre de rivière', 'pebbble');
    assert.deepEqual(a, b);
    const other = await F.deriveLibrary('something else', 'pebbble');
    assert.notEqual(a.libId, other.libId);

    const p = F.newPebbble();
    const lib = F.upsertLibrary(F.newLibrary(), { ...p, name: 'Lullabies', updated: 1 });
    F.upsertLibrary(lib, { ...p, name: 'Lullabies (renamed)', updated: 2 });
    assert.equal(lib.items.length, 1);
    const back = await F.openLibrary(await F.sealLibrary(lib, a), b);
    assert.equal(back.items[0].name, 'Lullabies (renamed)');
    await assert.rejects(F.openLibrary(await F.sealLibrary(lib, a), { ...other, libId: a.libId }), /decrypt-failed/);
});

test('password: change and remove without touching the audio', async () => {
    const { id } = F.newPebbble();
    const h = F.newHeader({});
    const f = F.newFileName();
    const tr = await F.sealTrack(audio, id, f);
    await F.addTrack(h, id, { file: f, title: 'one', type: 'audio/webm', key: tr.key });
    const k1 = await F.setPassword(h, id, 'caillou', 'river');

    const k2 = await F.changePassword(h, id, k1, 'galet', 'beach');
    assert.equal(h.hint, 'beach');
    await assert.rejects(F.unlock(h, id, 'caillou'), /wrong-password/);
    assert.equal(await F.pwKeyStillValid(h, id, k1), false);
    assert.equal(await F.pwKeyStillValid(h, id, k2), true);
    // same sealed audio still opens
    assert.deepEqual(await F.openTrack(tr.sealed, id, f, await F.trackKey(h.tracks[0], id, await F.unlock(h, id, 'galet'))), audio);

    await F.removePassword(h, id, k2);
    assert.equal(h.pw, undefined);
    assert.deepEqual(await F.openTrack(tr.sealed, id, f, await F.trackKey(h.tracks[0], id)), audio);
});
