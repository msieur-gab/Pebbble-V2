// Cloudflare R2 access.
// Reads go through the bucket's public URL (plain fetch, no credentials).
// Writes use R2's S3-compatible API, signed in the browser (AWS Signature V4).

const te = new TextEncoder();
const subtle = globalThis.crypto.subtle;

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async data => hex(await subtle.digest('SHA-256', typeof data === 'string' ? te.encode(data) : data));
async function hmac(key, msg) {
    const k = await subtle.importKey('raw', typeof key === 'string' ? te.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await subtle.sign('HMAC', k, te.encode(msg)));
}
const encodeSegment = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** Public read. Returns Uint8Array, or null when the object doesn't exist. */
export async function get(publicBase, path, { fresh = false } = {}) {
    const res = await fetch(`${publicBase.replace(/\/$/, '')}/${path}`, { cache: fresh ? 'no-store' : 'default' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`fetch-failed ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}

/**
 * Build signed request headers for one S3 call.
 * Exported for tests; `now` lets tests pin the timestamp.
 */
export async function sign({ accountId, accessKeyId, secretAccessKey, bucket, endpoint }, method, key, body = new Uint8Array(), now = new Date()) {
    const base = endpoint || `https://${accountId}.r2.cloudflarestorage.com`; // endpoint: local dev server only
    const host = new URL(base).host;
    const uri = `/${encodeSegment(bucket)}/${key.split('/').map(encodeSegment).join('/')}`;
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = await sha256(body);
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonical = [method, uri, '', `host:${host}`, `x-amz-content-sha256:${payloadHash}`, `x-amz-date:${amzDate}`, '', signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/auto/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');

    let k = await hmac(`AWS4${secretAccessKey}`, dateStamp);
    for (const part of ['auto', 's3', 'aws4_request']) k = await hmac(k, part);
    const signature = hex(await hmac(k, toSign));

    return {
        url: `${base}${uri}`,
        headers: {
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
            authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
    };
}

/** Upload one object. */
export async function put(creds, key, body, { contentType = 'application/octet-stream', cacheControl } = {}) {
    const { url, headers } = await sign(creds, 'PUT', key, body);
    headers['content-type'] = contentType;
    if (cacheControl) headers['cache-control'] = cacheControl;
    const res = await fetch(url, { method: 'PUT', headers, body });
    if (!res.ok) throw new Error(`upload-failed ${res.status}: ${await res.text()}`);
}

/** Delete one object (missing objects count as deleted). */
export async function del(creds, key) {
    const { url, headers } = await sign(creds, 'DELETE', key);
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) throw new Error(`delete-failed ${res.status}`);
}
