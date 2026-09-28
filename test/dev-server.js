// Local stand-in for GitHub Pages + R2.
//   GET  /...                 static files from the repo
//   GET  /bucket/<key>        public read (like the r2.dev URL)
//   PUT/DELETE /s3/<bucket>/<key>   upload API (signature is not checked here)
// Usage: npm run serve  →  http://localhost:8787/writer/
import http from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = join(root, '.dev-bucket');
const port = Number(process.env.PORT) || 8787;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const safe = (base, p) => {
    const full = normalize(join(base, decodeURIComponent(p)));
    if (!full.startsWith(base)) throw new Error('bad path');
    return full;
};
const body = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
        if (url.pathname.startsWith('/s3/')) {
            if (!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256')) { res.writeHead(403).end('unsigned'); return; }
            const key = url.pathname.split('/').slice(3).join('/');
            const file = safe(store, key);
            if (req.method === 'PUT') { await mkdir(dirname(file), { recursive: true }); await writeFile(file, await body(req)); }
            else if (req.method === 'DELETE') await rm(file, { force: true });
            res.writeHead(200).end();
            return;
        }
        if (url.pathname.startsWith('/bucket/')) {
            const data = await readFile(safe(store, url.pathname.slice(8))).catch(() => null);
            if (!data) { res.writeHead(404).end(); return; }
            res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(data);
            return;
        }
        let path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
        const data = await readFile(safe(root, path)).catch(() => null);
        if (!data) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(data);
    } catch (e) {
        res.writeHead(500).end(String(e));
    }
}).listen(port, () => console.log(`Pebbble dev: http://localhost:${port}/writer/`));
