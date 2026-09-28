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

// Player
const pl = await browser.newPage(); pl.on('pageerror', e => errors.push(e.message));
await pl.goto(url);
await pl.waitForSelector('#lock:not([hidden])');
log('address after open', pl.url());
log('owner', await pl.textContent('#owner-name'), '/', await pl.textContent('#owner-contact'), '| hint:', await pl.textContent('#hint'));
await pl.fill('#pw', 'wrong'); await pl.click('#unlock');
await pl.waitForFunction(() => document.getElementById('lock-msg').textContent);
log('wrong password →', await pl.textContent('#lock-msg'));
await pl.fill('#pw', 'caillou'); await pl.click('#unlock');
await pl.waitForSelector('#list:not([hidden])');
const rows = await pl.$$eval('.track', r => r.map(x => x.innerText.replace(/\n/g, ' | ')));
log('tracks', rows);
await pl.click('.track button');
await pl.waitForFunction(() => { const a = document.getElementById('audio'); return a.duration > 0; }, null, { timeout: 10000 });
log('played duration', await pl.$eval('#audio', a => a.duration.toFixed(2)), 's');

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

const pl2 = await browser.newPage();
await pl2.goto(url); await pl2.fill('#pw', 'caillou'); await pl2.click('#unlock');
await pl2.waitForSelector('#list:not([hidden])');
log('tracks now', await pl2.$$eval('.track', r => r.length));
log('page errors', errors.length ? errors : 'none');
await browser.close();
