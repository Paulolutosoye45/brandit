import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

const S3 = { S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/', S3_BUCKET: 'brandit-files', S3_ACCESS_KEY_ID: 'AKIDEXAMPLE', S3_SECRET_ACCESS_KEY: 'secret' };
afterEach(() => { vi.unstubAllGlobals(); for (const k of Object.keys(S3)) delete (process.env as any)[k]; });

describe('file storage', () => {
  it('uses local disk until the S3 settings are all present', async () => {
    process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-storage-${process.pid}`);
    const st = await import('../lib/storage');
    expect(st.s3On()).toBe(false);
    const key = await st.putFile(Buffer.from('hello'), 'png');
    expect(key).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect((await st.getFile(key)).toString()).toBe('hello');
    await st.deleteFile(key);
    await expect(st.getFile(key)).rejects.toThrow();
    Object.assign(process.env, { S3_BUCKET: 'only-one-setting' });
    expect(st.s3On()).toBe(false);
    delete process.env.S3_BUCKET;
  });

  it('sends signed requests to the bucket when S3 is set up, and refuses unsafe keys', async () => {
    Object.assign(process.env, S3);
    const st = await import('../lib/storage');
    expect(st.s3On()).toBe(true);
    const seen: { method: string; url: string; auth: string | null; type: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      const req = input instanceof Request ? input : new Request(input, init);
      seen.push({ method: req.method, url: req.url, auth: req.headers.get('authorization'), type: req.headers.get('content-type') });
      return req.method === 'GET' ? new Response(new Uint8Array([1, 2, 3])) : new Response(null, { status: 200 });
    }));
    const key = await st.putFile(Buffer.from('pdf-bytes'), 'pdf');
    expect(Array.from(await st.getFile(key))).toEqual([1, 2, 3]);
    await st.deleteFile(key);
    expect(seen.map((s) => s.method)).toEqual(['PUT', 'GET', 'DELETE']);
    for (const s of seen) {
      expect(s.url).toBe(`https://acct.r2.cloudflarestorage.com/brandit-files/${key}`);
      expect(s.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    }
    expect(seen[0].type).toBe('application/pdf');
    await expect(st.getFile('../../etc/passwd')).rejects.toThrow('Bad file key');
  });

  it('fails loudly when the bucket refuses an upload', async () => {
    Object.assign(process.env, S3);
    const st = await import('../lib/storage');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    await expect(st.putFile(Buffer.from('x'), 'png')).rejects.toThrow(/403/);
  });
});
