import { chromium } from 'playwright';
// End-to-end check: writer → storage → player, in headless Chromium.
// Needs the dev server running (npm run serve) and Playwright (npm i --no-save playwright).
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = process.env.BASE || 'http://localhost:8787';
const SP = mkdtempSync(join(tmpdir(), 'pebbble-'));
// 30 seconds of 440 Hz, 8 kHz mono WAV (long enough that a voice never ends mid-check)
const n = 8000 * 30, wav = Buffer.alloc(44 + n * 2);
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

// Web NFC stand-in: writing records the link, scanning waits for the test to "tap" a stone.
const fakeNfc = () => {
  window.NDEFReader = class {
    constructor() { window.__ndef = this; }
    async write(msg) { await new Promise(r => setTimeout(r, 300)); window.__written = msg.records[0].data; }
    async makeReadOnly() { await new Promise(r => setTimeout(r, 200)); window.__locked = true; }
    async scan() {}
  };
};
const tapStone = (pg, link) => pg.evaluate(link => window.__ndef.onreading({ message: { records: [{ recordType: 'url', data: new TextEncoder().encode(link) }] } }), link);
await phone.addInitScript(fakeNfc);

// First time: guided storage setup, then the key phrase
const setupGuided = async (pg, phrase) => {
  await pg.goto(base + '/writer/');
  await pg.click('#c-guide'); await on(pg, 'guide-sheet');
  await pg.fill('#g-public', 'https://pub-example.r2.dev');
  await pg.fill('#g-endpoint', 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
  await pg.fill('#g-key', 'key'); await pg.fill('#g-secret', 'secret');
  await pg.click('#g-connect');
  await pg.waitForSelector('#k-in');
  await pg.fill('#k-in', phrase); await pg.click('#k-go');
  await pg.waitForSelector('#shelf');
};
const on = (pg, id) => pg.waitForSelector(`#${id}.on`);
const off = (pg, id) => pg.waitForSelector(`#${id}:not(.on)`, { state: 'attached' });
await setupGuided(page, 'pierre de rivière');
log('writer set up; shelf shows', await page.$$eval('#shelf button[data-id]', b => b.length), 'pebbbles');

// A new pebbble: name, another stone, From / For, password, contact, three voices
await page.click('#new');
await page.waitForSelector('#e-name');
await page.fill('#e-name', 'Lullabies');
const firstStone = await page.innerHTML('#e-stone');
await page.click('#reroll');
log('another stone drawn', firstStone !== await page.innerHTML('#e-stone'));
const chosenStone = await page.$eval('#e-stone path[mask]', el => el.getAttribute('d'));
await page.fill('#e-from', 'Papa');
await page.fill('#e-for', 'Lina');
log('preview:', await page.$eval('#preview', el => el.innerText.replace(/\s*\n\s*/g, ' | ')));
await page.click('#r-pw'); await on(page, 'pw-sheet');
await page.fill('#pw-in', 'caillou'); await page.fill('#pw-hint', 'what you throw in the river');
await page.click('#pw-save'); await off(page, 'pw-sheet');
await page.click('#r-found'); await on(page, 'found-sheet');
await page.fill('#f-contact', 'papa@example.com');
log('finder will read:', await page.$eval('#finder', el => el.innerText.replace(/\s*\n\s*/g, ' ')));
await page.click('#f-done'); await off(page, 'found-sheet');
const add = async (pg, title, when, fill) => {
  await pg.click('#add-voice'); await on(pg, 'voice-sheet');
  await pg.setInputFiles('#v-file', SP + '/tone.wav');
  await pg.waitForFunction(() => document.getElementById('rec-time').textContent !== '0:00');
  await pg.fill('#v-title', title);
  await pg.click(`#v-when [data-w="${when}"]`);
  if (fill) await fill();
  await pg.click('#v-save'); await off(pg, 'voice-sheet');
};
await add(page, 'Hello', 'always');
await add(page, 'Christmas', 'yearly', async () => {
  for (const [id, v] of [['#v-ya-d', '20'], ['#v-ya-m', '12'], ['#v-yb-d', '27'], ['#v-yb-m', '12']]) await page.selectOption(id, v);
});
await add(page, 'For your eighteenth birthday', 'from', () => page.fill('#v-from', '2090-03-14'));
log('voices in the editor:', await page.$$eval('#e-voices .voice', r => r.map(x => x.innerText.replace(/\s*\n\s*/g, ' | '))));
log('dock says:', await page.textContent('#dock-btn'));
await page.click('#dock-btn');
await page.waitForSelector('.check', { timeout: 20000 });
const url = await page.evaluate(() => window.__written);
log('written to the stone:', url, `(${url.length} chars) |`, await page.textContent('.write h1'));
await page.click('#lock-ask'); await page.click('#lock-yes');
await page.waitForFunction(() => window.__locked === true);
await page.waitForFunction(() => document.querySelector('.lock-card b')?.textContent === 'Tag locked');
log('tag locked after asking twice');

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
const dragDown = async pg => {
  const z = await pg.$eval('#drag-zone .handle', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 4 }; });
  await pg.mouse.move(z.x, z.y); await pg.mouse.down();
  for (let i = 1; i <= 10; i++) await pg.mouse.move(z.x, z.y + i * 25);
  await pg.mouse.up();
};
await dragDown(g);
await on(g, 'mini');
log('dragged down → mini player:', await g.textContent('#mini-title'), '| sheet open:', await g.$eval('#player', e => e.classList.contains('on')));
await g.click('#mini-title');
await on(g, 'player');
await g.click('#open-menu'); await on(g, 'menu-sheet');
log('menu over the sheet, on a not-owned phone offers:', await g.$$eval('#menu-sheet .menu-row:not([hidden]) b', b => b.map(x => x.textContent)), '| sheet still under it:', await g.$eval('#player', e => e.classList.contains('on')));
await g.click('#scrim', { position: { x: 20, y: 20 } });

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
log('offline from library:', await playing(o), '|', await o.textContent('#pl-status'));
await ownCtx.setOffline(false);

// Language
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

// Writer: open the stone by tapping it, unlock, add a voice, save; the stone keeps its link
await page.click('#w-done');
await page.waitForSelector('#shelf button[data-id]');
await page.click('#tap-hint');
await page.waitForFunction(() => document.getElementById('tap-text').textContent.startsWith('Listening'));
await tapStone(page, url);
await page.waitForSelector('#u-pw');
await page.fill('#u-pw', 'caillou'); await page.click('#u-go');
await page.waitForSelector('#e-voices');
await add(page, 'Added later', 'always');
// Listen to a saved voice before deciding to keep it
await page.click('#e-voices .voice[data-kind="track"]'); await on(page, 'voice-sheet');
await page.click('#v-play');
await page.waitForFunction(() => document.getElementById('v-play').textContent === 'Stop', null, { timeout: 10000 });
log('saved voice plays in the editor:', await page.inputValue('#v-title'), '|', await page.textContent('#v-play-time'));
await page.click('#v-play');
await page.click('#scrim', { position: { x: 20, y: 20 } }); await off(page, 'voice-sheet');
// Another stone and the "made with love" phrasing, on a saved pebbble
const oldStone = await page.innerHTML('#e-stone');
await page.click('#reroll');
log('saved pebbble can take another stone:', oldStone !== await page.innerHTML('#e-stone'));
await page.click('#preview .seg button[data-ded="love"]');
log('preview with the other phrasing:', await page.textContent('#preview .pv-ded'));
log('existing pebbble dock says:', await page.textContent('#dock-btn'));
await page.click('#dock-btn');
await page.waitForSelector('#shelf button[data-id]');
const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('pebbble-writer-library')).items[0]);
log('same link after edit', `${base}/player/#${entry.id}.${entry.key}` === url);

const g2 = await guestCtx.newPage();
await g2.goto(url); await g2.click('#listen');
await unlockWith(g2, 'caillou');
await playing(g2);
log('voices now', (await voices(g2)).length, '(device question remembered: yes)');
log('player shows the chosen phrasing:', await g2.textContent('.arrival .dedication').catch(() => 'n/a'));
// Swipe the mini player sideways to change voice
await g2.click('#collapse'); await on(g2, 'mini');
const swipe = async (pg, dx) => {
  const b = await pg.$eval('#mini-open', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await pg.mouse.move(b.x, b.y); await pg.mouse.down();
  for (let i = 1; i <= 10; i++) await pg.mouse.move(b.x + dx * i / 10, b.y);
  await pg.mouse.up();
};
const t1 = await g2.textContent('#mini-title');
await swipe(g2, -160);
await g2.waitForFunction(t => document.getElementById('mini-title').textContent !== t, t1);
log('swipe left on mini:', t1, '→', await g2.textContent('#mini-title'));
await swipe(g2, 160);
await g2.waitForFunction(t => document.getElementById('mini-title').textContent === t, t1);
log('swipe right on mini: back to', await g2.textContent('#mini-title'));
await g2.click('#mini-title'); await on(g2, 'player');

// My pebbbles: listed on this phone
log('my pebbbles (phone)', await page.$$eval('#shelf button[data-id]', r => r.map(x => x.innerText.replace(/\n/g, ' | '))));

// Player on the creator's phone offers Edit, which opens the writer on that pebbble
const mine = await phone.newPage(); mine.on('pageerror', e => errors.push(e.message));
await mine.goto(url);
await mine.click('#listen');
await on(mine, 'device-sheet'); await mine.click('#device-yes');
await unlockWith(mine, 'caillou');
await playing(mine);
await mine.click('#open-menu'); await on(mine, 'menu-sheet');
log('menu on creator phone:', await mine.$$eval('#menu-sheet .menu-row:not([hidden]) b', b => b.map(x => x.textContent)));
await mine.click('#m-edit');
await mine.waitForSelector('#u-pw');
log('Edit opened writer | address', mine.url());
await mine.fill('#u-pw', 'caillou'); await mine.click('#u-go');
await mine.waitForSelector('#e-voices');
log('editing', await mine.inputValue('#e-name'), 'with', await mine.$$eval('#e-voices .voice', r => r.length), 'voices');

// Guest phone: no Edit
await g2.click('#open-menu'); await on(g2, 'menu-sheet');
log('Edit on guest phone', await g2.isVisible('#m-edit'));

// Another device ("computer", no NFC) joins with a setup code and the same key phrase
await page.click('#gear'); await on(page, 'settings-sheet');
await page.click('#s-share'); await on(page, 'share-sheet');
await page.waitForFunction(() => document.getElementById('share-code').textContent.startsWith('pebbble-setup:'));
const code = await page.textContent('#share-code');
log('setup code', code.slice(0, 24) + '…', `(${code.length} chars, secret hidden: ${!code.includes('secret')})`);
const pc = await (await browser.newContext()).newPage(); pc.on('pageerror', e => errors.push(e.message));
await pc.goto(base + '/writer/');
await pc.click('#c-paste'); await on(pc, 'paste-sheet');
await pc.fill('#paste-code', code); await pc.click('#paste-go');
await pc.waitForSelector('#k-in');
await pc.fill('#k-in', 'wrong words here'); await pc.click('#k-go');
await pc.waitForFunction(() => document.getElementById('k-msg').textContent);
log('wrong key phrase on the code:', await pc.textContent('#k-msg'));
await pc.fill('#k-in', 'pierre de rivière'); await pc.click('#k-go');
await pc.waitForSelector('#shelf button[data-id]');
log('my pebbbles (computer)', await pc.$$eval('#shelf button[data-id]', r => r.map(x => x.innerText.replace(/\n/g, ' | '))));
log('computer without NFC says:', await pc.textContent('#tap-text'));

// Change the password and hint on the computer; recordings untouched
const before = readdirSync(`.dev-bucket/${id}`).filter(f => f !== 'header').map(f => f + readFileSync(`.dev-bucket/${id}/${f}`).length).sort().join();
await pc.click('#shelf button[data-id]');
await pc.waitForSelector('#u-pw');
await pc.fill('#u-pw', 'caillou'); await pc.click('#u-go');
await pc.waitForSelector('#e-voices');
await pc.click('#r-pw'); await on(pc, 'pw-sheet');
await pc.fill('#pw-in', 'galet'); await pc.fill('#pw-hint', 'on the beach');
await pc.click('#pw-save'); await off(pc, 'pw-sheet');
await pc.click('#dock-btn'); await pc.waitForSelector('#shelf button[data-id]');
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
await own2.click('#open-menu'); await on(own2, 'menu-sheet');
await own2.click('#m-forget'); await own2.click('#m-forget');
await own2.waitForSelector('.empty');
log('forgotten: stored on phone', await idbCount(own2), '| library shows:', await own2.textContent('.empty h1'));

// Remove the password entirely
await pc.click('#shelf button[data-id]');
await pc.waitForSelector('#u-pw');
await pc.fill('#u-pw', 'galet'); await pc.click('#u-go');
await pc.waitForSelector('#e-voices');
await pc.click('#r-pw'); await on(pc, 'pw-sheet');
await pc.click('#pw-remove'); await off(pc, 'pw-sheet');
log('password row now:', await pc.$eval('#r-pw span span', el => el.textContent));
await pc.click('#dock-btn'); await pc.waitForSelector('#shelf button[data-id]');
const open3 = await guestCtx.newPage();
await open3.goto(url); await open3.click('#listen');
log('password removed: opens without asking:', await playing(open3));

// Another key phrase sees another (empty) list
const other = await (await browser.newContext()).newPage();
await setupGuided(other, 'other words entirely');
log('other key phrase sees', await other.$$eval('#shelf button[data-id]', r => r.length), 'pebbbles');
// ---------- Install suggestion + persistent storage ----------
const stubs = () => {
  window.__persist = 0;
  if (navigator.storage) navigator.storage.persist = async () => { window.__persist++; return true; };
};
// Android: Chrome fires beforeinstallprompt; we simulate it
const andCtx = await browser.newContext({ locale: 'en-US' });
await andCtx.addInitScript(stubs);
const and = await andCtx.newPage(); and.on('pageerror', e => errors.push(e.message));
await and.goto(url); await and.click('#listen');
await on(and, 'device-sheet'); await and.click('#device-yes');
await playing(and);
await and.waitForFunction(() => document.getElementById('saved-note').textContent === 'Kept on this phone');
log('storage kept permanently requested:', await and.evaluate(() => window.__persist > 0));
await and.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
await and.waitForSelector('#pl-install .install');
log('Android, in the sheet:', await and.$eval('#pl-install .install', el => el.innerText.replace(/\s*\n\s*/g, ' | ')));
await and.click('#pl-install [data-install="add"]');
log('Android install prompt shown:', await and.evaluate(() => window.__prompted === true), '| card gone:', !(await and.$('#pl-install .install')));
// iPhone: no prompt event; the card explains the Share step, 'Not now' hides it
const iosCtx = await browser.newContext({ locale: 'en-US', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
const ios = await iosCtx.newPage(); ios.on('pageerror', e => errors.push(e.message));
await ios.goto(url); await ios.click('#listen');
await on(ios, 'device-sheet'); await ios.click('#device-yes');
await playing(ios);
await ios.waitForSelector('#pl-install .install');
log('iPhone, in the sheet:', await ios.$eval('#pl-install .install', el => el.innerText.replace(/\s*\n\s*/g, ' | ')));
await ios.click('#pl-install [data-install="later"]');
await ios.goto(base + '/player/'); await ios.waitForSelector('#shelf');
log('iPhone after "Not now", library shows card:', !!(await ios.$('.install')));
// Not-owned phone: never suggested
log('not-owned phone shows card:', !!(await open3.$('.install')));
// Delete the pebbble from the computer: files gone, list empty, the stone plays nothing
await pc.click('#shelf button[data-id]');
await pc.waitForSelector('#r-delete');
await pc.click('#r-delete'); await pc.click('#r-delete');
await pc.waitForSelector('#shelf');
await pc.waitForFunction(() => !document.querySelector('#shelf button[data-id]'));
log('deleted: files left', readdirSync(`.dev-bucket/${id}`).length, '| list', await pc.$$eval('#shelf button[data-id]', r => r.length));
log('page errors', errors.length ? errors : 'none');
await browser.close();
