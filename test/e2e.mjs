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
const unlockAndList = async pg => {
  await pg.fill('#pw', 'wrong'); await pg.click('#unlock');
  await pg.waitForFunction(() => document.getElementById('lock-msg').textContent);
  const wrong = await pg.textContent('#lock-msg');
  await pg.fill('#pw', 'caillou'); await pg.click('#unlock');
  await pg.waitForSelector('#list:not([hidden])');
  return wrong;
};
const playFirst = async pg => {
  await pg.click('#tracks .track button');
  await pg.waitForFunction(() => document.getElementById('audio').duration > 0, null, { timeout: 10000 });
  return (await pg.$eval('#audio', a => a.duration)).toFixed(2);
};

// Player on a NOT-owned device
const guestCtx = await browser.newContext({ locale: 'en-US' });
const g = await guestCtx.newPage(); g.on('pageerror', e => errors.push(e.message));
await g.goto(url);
await g.waitForSelector('#device:not([hidden])');
log('address after open', g.url());
log('owner', await g.textContent('#owner-name'), '/', await g.textContent('#owner-contact'));
log('name', await g.textContent('#pebbble-name'), '| same stone as chosen in writer', chosenStone === await g.$eval('#cover path[mask]', el => el.getAttribute('d')));
await g.click('#device-no');
log('not-owned text:', await g.textContent('#device-text'));
await g.click('#device-continue');
await g.waitForSelector('#lock:not([hidden])');
log('hint', await g.textContent('#hint'), '| wrong password →', await unlockAndList(g));
log('tracks', await g.$$eval('#tracks .track', r => r.map(x => x.innerText.replace(/\n/g, ' | '))));
log('played', await playFirst(g), 's');
log('NOT-OWNED stored on device', await idbCount(g), '| cached pebbble files:', await g.evaluate(async () => { let n = 0; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (r.url.includes('/bucket/')) n++; return n; }));

// Player on an OWNED device
const ownCtx = await browser.newContext({ locale: 'en-US' });
const o = await ownCtx.newPage(); o.on('pageerror', e => errors.push(e.message));
await o.goto(url);
await o.waitForSelector('#device:not([hidden])');
await o.click('#device-yes'); await o.click('#device-continue');
await o.waitForSelector('#lock:not([hidden])');
await unlockAndList(o);
await o.waitForFunction(() => document.getElementById('saved-note').textContent === 'Saved for offline', null, { timeout: 15000 });
log('OWNED stored on device', await idbCount(o), '→', await o.textContent('#saved-note'));
await o.evaluate(() => navigator.serviceWorker.ready);

// Offline: open the player with no tap, pick from the library, play without the password
await ownCtx.setOffline(true);
await o.goto(base + '/player/');
await o.waitForSelector('#library:not([hidden])');
log('offline library', await o.$$eval('#lib-list .track', r => r.map(x => x.innerText.replace(/\n/g, ' | '))));
if (process.env.SHOTS) await o.screenshot({ path: process.env.SHOTS + '/library.png' });
await o.click('#lib-list .track button:last-child');
await o.waitForSelector('#list:not([hidden])');
if (process.env.SHOTS) await o.screenshot({ path: process.env.SHOTS + '/open.png', fullPage: true });
log('offline status:', await o.textContent('#status'), '| played', await playFirst(o), 's (no password asked)');
await ownCtx.setOffline(false);

// Language switch
await o.click('#settings summary');
await o.selectOption('#lang', 'fr');
await o.waitForFunction(() => document.querySelector('#tracks .track button')?.textContent === 'Écouter');
log('in French:', await o.$eval('#tracks .track', r => r.innerText.replace(/\n/g, ' | ')), '|', await o.textContent('#settings summary'));

// Switching to not-owned wipes the device
o.once('dialog', d => d.accept());
await o.selectOption('#mode', 'guest');
await o.waitForTimeout(300);
log('after switching to not-owned', await idbCount(o));

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
await g2.goto(url);
await g2.waitForSelector('#lock:not([hidden])');
await g2.fill('#pw', 'caillou'); await g2.click('#unlock');
await g2.waitForSelector('#list:not([hidden])');
log('tracks now', await g2.$$eval('#tracks .track', r => r.length), '(device question remembered:', !(await g2.isVisible('#device')), ')');
// My pebbbles: listed on this phone after saving
await page.click('#done .back');
await page.waitForSelector('#mine-list .mine');
log('my pebbbles (phone)', await page.$$eval('#mine-list .mine', r => r.map(x => x.innerText.replace(/\n/g, ' | '))));

// Player on the creator's phone shows Edit, which opens the writer on that pebbble
const mine = await phone.newPage(); mine.on('pageerror', e => errors.push(e.message));
await mine.goto(url);
await mine.waitForSelector('#device:not([hidden])');
log('Edit on creator phone', await mine.isVisible('#edit'));
await mine.click('#device-yes'); await mine.click('#device-continue');
await mine.click('#edit');
await mine.waitForSelector('#unlock:not([hidden])');
log('Edit opened writer on', await mine.inputValue('#p-name') || '(locked, asks password first)', '| address', mine.url());
await mine.fill('#unlock-pw', 'caillou'); await mine.click('#unlock-btn');
await mine.waitForSelector('#fields:not([hidden])');
log('editing', await mine.inputValue('#p-name'), 'with', await mine.$$eval('#tracks .track', r => r.length), 'messages');

// Guest phone: no Edit
log('Edit on guest phone', await g2.isVisible('#edit'));

// A second device ("computer") with the same passphrase sees the same list
const pc = await (await browser.newContext()).newPage(); pc.on('pageerror', e => errors.push(e.message));
await pc.goto(base + '/writer/');
log('computer before passphrase:', await pc.textContent('#mine-msg'));
await pc.click('#settings summary'); await pc.fill('#lib-pass', 'pierre de rivière'); await pc.click('#save-settings');
await pc.waitForSelector('#mine-list .mine');
log('my pebbbles (computer)', await pc.$$eval('#mine-list .mine', r => r.map(x => x.innerText.replace(/\n/g, ' | '))));
await pc.click('#mine-list .mine');
await pc.waitForSelector('#unlock:not([hidden])');
log('computer opened it from the list, no link copied');
const wrongPc = await (await browser.newContext()).newPage();
await wrongPc.goto(base + '/writer/');
await wrongPc.click('#settings summary'); await wrongPc.fill('#lib-pass', 'wrong words'); await wrongPc.click('#save-settings');
await wrongPc.waitForFunction(() => document.getElementById('mine-msg').textContent.startsWith('No pebbbles'));
log('other passphrase sees', await wrongPc.$$eval('#mine-list .mine', r => r.length), 'pebbbles');
// Change the password and hint on the computer; audio untouched, stone untouched
const before = readdirSync(`.dev-bucket/${id}`).filter(f => f !== 'header').map(f => f + readFileSync(`.dev-bucket/${id}/${f}`).length).sort().join();
await pc.fill('#unlock-pw', 'caillou'); await pc.click('#unlock-btn');
await pc.waitForSelector('#fields:not([hidden])');
await pc.fill('#hint-edit', 'on the beach');
await pc.fill('#pw-change', 'galet');
await pc.click('#save'); await pc.waitForSelector('#done:not([hidden])');
const after = readdirSync(`.dev-bucket/${id}`).filter(f => f !== 'header').map(f => f + readFileSync(`.dev-bucket/${id}/${f}`).length).sort().join();
log('password changed; recordings untouched', before === after);

// Owned phone that remembered the old password: asks again, with the new hint
const own2 = await ownCtx.newPage();
await own2.goto(url);
await own2.waitForSelector('#lock:not([hidden])');
log('owned phone asks again, hint:', await own2.textContent('#hint'));
await own2.fill('#pw', 'caillou'); await own2.click('#unlock');
await own2.waitForFunction(() => document.getElementById('lock-msg').textContent);
await own2.fill('#pw', 'galet'); await own2.click('#unlock');
await own2.waitForSelector('#list:not([hidden])');
log('old password refused, new one opens; played', await playFirst(own2), 's');

// Remove the password entirely
await pc.click('#done .back'); await pc.click('#mine-list .mine');
await pc.waitForSelector('#unlock:not([hidden])');
await pc.fill('#unlock-pw', 'galet'); await pc.click('#unlock-btn');
await pc.waitForSelector('#fields:not([hidden])');
await pc.click('#pw-remove');
await pc.click('#save'); await pc.waitForSelector('#done:not([hidden])');
const open3 = await guestCtx.newPage();
await open3.goto(url);
await open3.waitForSelector('#list:not([hidden])');
log('password removed: opens without asking; played', await playFirst(open3), 's');
log('page errors', errors.length ? errors : 'none');
await browser.close();
