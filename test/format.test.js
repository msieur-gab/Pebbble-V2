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
    const h = F.newHeader({ name: 'Lullabies', from: 'Papa', for: 'Lina', contact: 'papa@example.com' });
    const sealed = await F.sealHeader(h, p);
    const back = await F.openHeader(sealed, p);
    assert.deepEqual([back.name, back.from, back.for, back.contact], ['Lullabies', 'Papa', 'Lina', 'papa@example.com']);
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

test('from a date: asleep until that day, then awake for good', () => {
    const w = { from: '2038-03-14' };
    const before = F.windowStatus(w, new Date(2038, 2, 13, 23, 59));
    assert.equal(before.state, 'locked');
    assert.equal(before.opens.getTime(), new Date(2038, 2, 14).getTime());
    assert.equal(F.windowStatus(w, new Date(2038, 2, 14, 0, 1)).state, 'open');
    assert.equal(F.windowStatus(w, new Date(2090, 0, 1)).state, 'open');
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
    const h = F.newHeader({ name: 'Lullabies', from: 'Gab' });
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

test('password: forgiving about capitals, spaces and accents, exact about symbols and digits', async () => {
    const { id } = F.newPebbble();
    const h = F.newHeader({});
    await F.setPassword(h, id, '78@szx86 Rivière', 'hint');
    for (const ok of ['78@szx86 rivière', '78@SZX86 RIVIERE', '  78@szx86   riviere ', '78@Szx86 Riviere']) await F.unlock(h, id, ok);
    assert.equal(F.relaxPassword('Año Niño Çà Über'), 'ano nino ca uber');
    assert.equal(F.relaxPassword('Straße'), 'straße');
    for (const bad of ['78szx86 riviere', '78@szx87 riviere', '78-szx-86 riviere']) await assert.rejects(F.unlock(h, id, bad), /wrong-password/);
});

test('setup code: opens only with the same key phrase', async () => {
    const settings = { accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 'secret', bucket: 'pebbble', publicBase: 'https://pub-x.r2.dev' };
    const code = await F.sealSetup(settings, await F.deriveSetupKey('pierre de rivière'));
    assert.ok(F.isSetupCode(code));
    assert.ok(!code.includes('secret'));
    assert.deepEqual(await F.openSetup(code, await F.deriveSetupKey('pierre de rivière')), settings);
    await assert.rejects(F.openSetup(code, await F.deriveSetupKey('other words')), /decrypt-failed/);
    await assert.rejects(F.openSetup('hello', await F.deriveSetupKey('x')), /not-a-setup-code/);
});
