import test from 'node:test';
import assert from 'node:assert/strict';
import aws4 from 'aws4';
import { sign } from '../shared/r2.js';

const creds = { accountId: 'abc123', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', bucket: 'pebbble' };

test('signature matches the aws4 reference implementation', async () => {
    const now = new Date('2026-09-28T08:00:00Z');
    const body = new TextEncoder().encode('hello');
    const ours = await sign(creds, 'PUT', 'Xy_z-12/header', body, now);

    const ref = aws4.sign({
        host: `${creds.accountId}.r2.cloudflarestorage.com`,
        method: 'PUT',
        path: '/pebbble/Xy_z-12/header',
        service: 's3',
        region: 'auto',
        headers: { 'X-Amz-Date': '20260928T080000Z', 'X-Amz-Content-Sha256': ours.headers['x-amz-content-sha256'] },
    }, creds);

    assert.equal(ours.headers.authorization, ref.headers.Authorization);
    assert.equal(ours.url, 'https://abc123.r2.cloudflarestorage.com/pebbble/Xy_z-12/header');
});
