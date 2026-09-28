import { chromium } from 'playwright';
// End-to-end check: writer → storage → player, in headless Chromium.
// Needs the dev server running (npm run serve) and Playwright (npm i --no-save playwright).
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = process.env.BASE || 'http://localhost:8787';
const SP = mkdtempSync(join(tmpdir(), 'pebbble-'));
// one second of 440 Hz, 8 kHz mono WAV
const n = 8000, wav = Buffer.alloc(44 + n * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 8000)), 44 + i * 2);
writeFileSync(SP + '/tone.wav', wav);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const phone = await browser.newContext();
const page = await phone.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const log = (...a) => console.log('•', ...a);

// Writer: new pebbble with password and three messages
await page.goto(base + '/writer/');
// This browser is "Gab's phone": set the library passphrase first
await page.click('#settings summary');
await page.fill('#lib-pass', 'pierre de rivière');
await page.click('#save-settings');
await page.waitForFunction(() => document.getElementById('mine-msg').textContent.startsWith('No pebbbles yet'));
await page.click('#new');
await page.fill('#p-name', 'Lullabies');
const firstStone = await page.innerHTML('#w-cover');
await page.click('#w-reroll');
log('another stone drawn', firstStone !== await page.innerHTML('#w-cover'));
const chosenStone = await page.$eval('#w-cover path[mask]', el => el.getAttribute('d'));
await page.fill('#owner-name', 'Gab');
await page.fill('#owner-contact', 'gab@example.com');
await page.fill('#pw', 'caillou');
await page.fill('#hint', 'what you throw in the river');
const add = async (title, when, fill) => {
  await page.fill('#t-title', title);
  await page.setInputFiles('#t-file', SP + '/tone.wav');
  await page.selectOption('#t-when', when);
  if (fill) await fill();
  await page.click('#t-add');
};
await add('Hello', '');
await add('Christmas', 'yearly', async () => { await page.fill('#t-every-a', '12-20'); await page.fill('#t-every-b', '12-27'); });
await add('Old news', 'dates', async () => { await page.fill('#t-from', '2025-01-01'); await page.fill('#t-to', '2025-01-02'); });
await page.click('#save');
await page.waitForSelector('#done:not([hidden])', { timeout: 20000 });
const url = await page.textContent('#done-url');
log('tag URL', url, `(${url.length} chars)`);

// Stored files are ciphertext
const id = new URL(url).hash.slice(1).split('.')[0];
const files = readdirSync(`.dev-bucket/${id}`);
log('stored files', files.length, files.every(f => !readFileSync(`.dev-bucket/${id}/${f}`).includes('RIFF')) ? 'all encrypted' : 'PLAINTEXT FOUND');

const idbCount = pg => pg.evaluate(() => new Promise(res => {
  const q = indexedDB.open('pebbble-v2', 1);
  q.onupgradeneeded = () => { q.transaction.abort(); res({ pebbbles: 0, files: 0 }); };
  q.onsuccess = () => { const d = q.result; const tx = d.transaction(['pebbbles', 'files']); const out = {};
    tx.objectStore('pebbbles').count().onsuccess = e => out.pebbbles = e.target.result;
    tx.objectStore('files').count().onsuccess = e => out.files = e.target.result;
    tx.oncomplete = () => { d.close(); res(out); }; };
  q.onerror = () => res({ pebbbles: 0, files: 0 });
}));
const on = (pg, id) => pg.waitForSelector(`#${id}.on`);
const unlockWith = async (pg, pw) => {
  await on(pg, 'lock-sheet');
  await pg.fill('#pw', pw); await pg.click('#unlock');
};
const wrongThenRight = async pg => {
  await unlockWith(pg, 'wrong');
  await pg.waitForFunction(() => document.getElementById('lock-msg').textContent);
  const wrong = await pg.textContent('#lock-msg');
  await pg.fill('#pw', 'caillou'); await pg.click('#unlock');
  return wrong;
};
const playing = pg => pg.waitForFunction(() => { const a = document.getElementById('audio'); return a.duration > 0 && !a.paused; }, null, { timeout: 10000 })
  .then(() => pg.evaluate(() => ({ title: document.getElementById('pl-title').textContent, duration: document.getElementById('audio').duration.toFixed(2) })));
const voices = pg => pg.$$eval('.voice', r => r.map(x => x.innerText.replace(/\s*\n\s*/g, ' | ')));

// ---------- Player on a NOT-owned phone ----------
const guestCtx = await browser.newContext({ locale: 'en-US' });
const g = await guestCtx.newPage(); g.on('pageerror', e => errors.push(e.message));
await g.goto(url);
await g.waitForSelector('#listen');
log('address after open', g.url());
log('arrival:', await g.$eval('.arrival', el => el.innerText.replace(/\s*\n\s*/g, ' | ')));
log('same stone as chosen in writer', chosenStone === await g.$eval('.arrival .stone path[mask]', el => el.getAttribute('d')));
await g.click('#listen');
await on(g, 'device-sheet');
await g.click('#device-no');
log('wrong password →', await wrongThenRight(g));
log('autoplay after Listen:', await playing(g));
log('voices:', await voices(g));
log('NOT-OWNED stored on phone', await idbCount(g), '| cached pebbble files:', await g.evaluate(async () => { let n = 0; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (r.url.includes('/bucket/')) n++; return n; }));

// Repeat, sleep timer, mini player
await g.click('#repeat'); await g.click('#repeat');
log('repeat:', await g.textContent('#repeat'));
await g.click('#sleep'); await g.click('#sleep-choices button[data-m="-1"]');
log('sleep:', await g.textContent('#sleep'));
await g.click('#collapse');
await on(g, 'mini');
log('mini player:', await g.textContent('#mini-title'), '| menu on a not-owned phone offers:', await (async () => { await g.click('#open-menu'); await on(g, 'menu-sheet'); return g.$$eval('#menu-sheet .menu-row:not([hidden]) b', b => b.map(x => x.textContent)); })());

// ---------- Player on an OWNED phone ----------
const ownCtx = await browser.newContext({ locale: 'en-US' });
const o = await ownCtx.newPage(); o.on('pageerror', e => errors.push(e.message));
await o.goto(url);
await o.click('#listen');
await on(o, 'device-sheet'); await o.click('#device-yes');
await unlockWith(o, 'caillou');
await playing(o);
await o.click('#collapse');
await o.waitForFunction(() => document.getElementById('saved-note')?.textContent === 'Kept on this phone', null, { timeout: 15000 });
log('OWNED stored on phone', await idbCount(o), '→', await o.textContent('#saved-note'));
await o.evaluate(() => navigator.serviceWorker.ready);

// A second tap on the same stone: welcome back, no questions, plays
await o.goto(url);
await o.waitForSelector('#listen');
log('second tap says:', await o.textContent('.eyebrow'));
await o.click('#listen');
log('no device question, no password:', await playing(o));

// Offline: open without a tap, library shelf, plays without the password
await ownCtx.setOffline(true);
await o.goto(base + '/player/');
await o.waitForSelector('#shelf button');
if (process.env.SHOTS) await o.screenshot({ path: process.env.SHOTS + '/library.png' });
log('offline library:', await o.$$eval('#shelf button', r => r.map(x => x.innerText.replace(/\s*\n\s*/g, ' | '))));
await o.click('#shelf button');
log('offline from library:', await playing(o), '|', await o.$eval('.status.inline', e => e.textContent).catch(() => 'no offline note'));
await ownCtx.setOffline(false);

// Language
await o.click('#collapse');
await o.click('#open-menu'); await on(o, 'menu-sheet'); await o.click('#m-settings'); await on(o, 'settings-sheet');
await o.click('#langs button[data-lang="fr"]');
await o.waitForFunction(() => document.getElementById('settings-title').textContent === 'Réglages');
log('in French:', await o.textContent('#settings-title'), '|', (await voices(o))[0]);
await o.click('#langs button[data-lang="en"]');

// Switching to not-owned wipes the phone
o.once('dialog', d => d.accept());
await o.click('#set-notmine');
await o.waitForTimeout(400);
log('after switching to not-owned', await idbCount(o));
await o.click('#set-mine');
await o.click('#scrim', { position: { x: 20, y: 20 } });

// Writer: reopen by link, unlock, add a message, save — stone keeps its link
await page.goto(base + '/writer/');
await page.fill('#link', url); await page.click('#open-link');
await page.waitForSelector('#unlock:not([hidden])');
await page.fill('#unlock-pw', 'caillou'); await page.click('#unlock-btn');
await page.waitForSelector('#fields:not([hidden])');
await add('Added later', '');
await page.click('#save');
await page.waitForSelector('#done:not([hidden])');
log('same link after edit', (await page.textContent('#done-url')) === url);

const g2 = await guestCtx.newPage();
await g2.goto(url); await g2.click('#listen');
await unlockWith(g2, 'caillou');
await playing(g2);
await g2.click('#collapse');
log('voices now', (await voices(g2)).length, '(device question remembered: yes)');

// My pebbbles: listed on this phone after saving
await page.click('#done .back');
await page.waitForSelector('#mine-list .mine');
log('my pebbbles (phone)', await page.$$eval('#mine-list .mine', r => r.map(x => x.innerText.replace(/\n/g, ' | '))));

// Player on the creator's phone offers Edit, which opens the writer on that pebbble
const mine = await phone.newPage(); mine.on('pageerror', e => errors.push(e.message));
await mine.goto(url);
await mine.click('#listen');
await on(mine, 'device-sheet'); await mine.click('#device-yes');
await unlockWith(mine, 'caillou');
await playing(mine);
await mine.click('#collapse');
await mine.click('#open-menu'); await on(mine, 'menu-sheet');
log('menu on creator phone:', await mine.$$eval('#menu-sheet .menu-row:not([hidden]) b', b => b.map(x => x.textContent)));
await mine.click('#m-edit');
await mine.waitForSelector('#unlock:not([hidden])');
log('Edit opened writer | address', mine.url());
await mine.fill('#unlock-pw', 'caillou'); await mine.click('#unlock-btn');
await mine.waitForSelector('#fields:not([hidden])');
log('editing', await mine.inputValue('#p-name'), 'with', await mine.$$eval('#tracks .track', r => r.length), 'messages');

// Guest phone: no Edit
await g2.click('#open-menu'); await on(g2, 'menu-sheet');
log('Edit on guest phone', await g2.isVisible('#m-edit'));

// A second device ("computer") with the same passphrase sees the same list
const pc = await (await browser.newContext()).newPage(); pc.on('pageerror', e => errors.push(e.message));
await pc.goto(base + '/writer/');
await pc.click('#settings summary'); await pc.fill('#lib-pass', 'pierre de rivière'); await pc.click('#save-settings');
await pc.waitForSelector('#mine-list .mine');
log('my pebbbles (computer)', await pc.$$eval('#mine-list .mine', r => r.map(x => x.innerText.replace(/\n/g, ' | '))));
await pc.click('#mine-list .mine');
await pc.waitForSelector('#unlock:not([hidden])');

// Change the password and hint on the computer; recordings untouched
const before = readdirSync(`.dev-bucket/${id}`).filter(f => f !== 'header').map(f => f + readFileSync(`.dev-bucket/${id}/${f}`).length).sort().join();
await pc.fill('#unlock-pw', 'caillou'); await pc.click('#unlock-btn');
await pc.waitForSelector('#fields:not([hidden])');
await pc.fill('#hint-edit', 'on the beach');
await pc.fill('#pw-change', 'galet');
await pc.click('#save'); await pc.waitForSelector('#done:not([hidden])');
const after = readdirSync(`.dev-bucket/${id}`).filter(f => f !== 'header').map(f => f + readFileSync(`.dev-bucket/${id}/${f}`).length).sort().join();
log('password changed; recordings untouched', before === after);

// Owned phone that remembered the old password asks again, with the new hint
const own2 = await ownCtx.newPage();
await own2.goto(url); await own2.click('#listen');
await on(own2, 'lock-sheet');
log('owned phone asks again, hint:', await own2.textContent('#hint'));
await unlockWith(own2, 'caillou');
await own2.waitForFunction(() => document.getElementById('lock-msg').textContent);
await own2.fill('#pw', 'galet'); await own2.click('#unlock');
log('old password refused, new one opens:', await playing(own2));

// Forget on the owned phone
await own2.click('#collapse');
await own2.click('#open-menu'); await on(own2, 'menu-sheet');
await own2.click('#m-forget'); await own2.click('#m-forget');
await own2.waitForSelector('.empty');
log('forgotten: stored on phone', await idbCount(own2), '| library shows:', await own2.textContent('.empty h1'));

// Remove the password entirely
await pc.click('#done .back'); await pc.click('#mine-list .mine');
await pc.waitForSelector('#unlock:not([hidden])');
await pc.fill('#unlock-pw', 'galet'); await pc.click('#unlock-btn');
await pc.waitForSelector('#fields:not([hidden])');
await pc.click('#pw-remove');
await pc.click('#save'); await pc.waitForSelector('#done:not([hidden])');
const open3 = await guestCtx.newPage();
await open3.goto(url); await open3.click('#listen');
log('password removed: opens without asking:', await playing(open3));

const wrongPc = await (await browser.newContext()).newPage();
await wrongPc.goto(base + '/writer/');
await wrongPc.click('#settings summary'); await wrongPc.fill('#lib-pass', 'wrong words'); await wrongPc.click('#save-settings');
await wrongPc.waitForFunction(() => document.getElementById('mine-msg').textContent.startsWith('No pebbbles'));
log('other passphrase sees', await wrongPc.$$eval('#mine-list .mine', r => r.length), 'pebbbles');
log('page errors', errors.length ? errors : 'none');
await browser.close();
