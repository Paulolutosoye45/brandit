import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';

/*
 * File storage, two ways. Nothing else in the app touches storage directly.
 *  - Local disk (default): works on any Node host that has a persistent disk.
 *  - S3-compatible (Cloudflare R2, AWS S3, Backblaze, Wasabi): set S3_ENDPOINT, S3_BUCKET,
 *    S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. Use this on any host without a persistent disk.
 */
const dir = () => path.resolve(process.env.UPLOAD_DIR ?? '.data/uploads');
const KEY = /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export const s3On = () => !!(process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
const s3 = () => ({
  client: new AwsClient({ accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!, service: 's3', region: process.env.S3_REGION ?? 'auto' }),
  url: (key: string) => `${process.env.S3_ENDPOINT!.replace(/\/$/, '')}/${process.env.S3_BUCKET}/${key}`,
});

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', csv: 'text/csv', svg: 'image/svg+xml' };

export async function putFile(buf: Buffer, ext: string): Promise<string> {
  const e = ext.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5) || 'bin';
  const key = `${randomUUID()}.${e}`;
  if (s3On()) {
    const { client, url } = s3();
    const res = await client.fetch(url(key), { method: 'PUT', body: new Uint8Array(buf), headers: { 'Content-Type': MIME[e] ?? 'application/octet-stream' } });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
    return key;
  }
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(path.join(dir(), key), buf);
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  if (!KEY.test(key)) throw new Error('Bad file key');
  if (s3On()) {
    const { client, url } = s3();
    const res = await client.fetch(url(key), { method: 'GET' });
    if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFile(path.join(dir(), key));
}

export async function deleteFile(key: string): Promise<void> {
  if (!KEY.test(key)) return;
  if (s3On()) {
    const { client, url } = s3();
    await client.fetch(url(key), { method: 'DELETE' });
    return;
  }
  await fs.rm(path.join(dir(), key), { force: true });
}
export const extFor = (mime: string) => (mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'application/pdf' ? 'pdf' : 'bin');
