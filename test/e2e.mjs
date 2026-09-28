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
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const log = (...a) => console.log('•', ...a);

// Writer: new pebbble with password and three messages
await page.goto(base + '/writer/');
await page.click('#new');
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
await o.click('#lib-list .track button:last-child');
await o.waitForSelector('#list:not([hidden])');
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
log('page errors', errors.length ? errors : 'none');
await browser.close();
