import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`])).sort();
const load = lang => JSON.parse(readFileSync(new URL(`../shared/i18n/${lang}.json`, import.meta.url)));

test('all four languages have the same keys', () => {
    const en = keys(load('en'));
    for (const lang of ['fr', 'es', 'zh']) assert.deepEqual(keys(load(lang)), en, lang);
});

test('every key used in the apps exists in English', () => {
    const en = new Set(keys(load('en')));
    const used = new Set();
    for (const f of ['player/player.js', 'player/index.html', 'writer/writer.js', 'writer/index.html', 'shared/ui.js']) {
        const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
        for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'|data-i18n(?:-placeholder|-label)?="([\w.]+)"|plural\(\s*'([\w.]+)'/g)) used.add(m[1] || m[2] || m[3]);
    }
    const missing = [...used].filter(k => !en.has(k) && !en.has(`${k}_one`));
    assert.deepEqual(missing, []);
});
