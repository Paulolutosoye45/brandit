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

/** The short error word S3-compatible stores put in the body of a refusal, such as SignatureDoesNotMatch or NoSuchBucket. */
async function why(res: Response): Promise<string> {
  try { const m = /<Code>([A-Za-z]+)<\/Code>/.exec((await res.text()).slice(0, 2000)); return m ? ` ${m[1]}` : ''; } catch { return ''; }
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', csv: 'text/csv', svg: 'image/svg+xml' };

export async function putFile(buf: Buffer, ext: string): Promise<string> {
  const e = ext.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5) || 'bin';
  const key = `${randomUUID()}.${e}`;
  if (s3On()) {
    const { client, url } = s3();
    const res = await client.fetch(url(key), { method: 'PUT', body: new Uint8Array(buf), headers: { 'Content-Type': MIME[e] ?? 'application/octet-stream' } });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status}${await why(res)})`);
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
    if (!res.ok) throw new Error(`Storage read failed (${res.status}${await why(res)})`);
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

/*
 * Named files, used only for our own database backups. Customer uploads always get a random key (above); these have fixed,
 * checked names so a backup can be found again, and nothing in the website can ask for one (/api/files only serves random keys).
 */
export const BACKUP_NAME = /^backups\/(daily\/\d{4}-\d{2}-\d{2}|monthly\/\d{4}-\d{2})\.json\.gz$/;
const checkName = (name: string) => { if (!BACKUP_NAME.test(name)) throw new Error('Bad backup name'); };

export async function putNamed(name: string, buf: Buffer, contentType = 'application/gzip'): Promise<void> {
  checkName(name);
  if (s3On()) {
    const { client, url } = s3();
    const res = await client.fetch(url(name), { method: 'PUT', body: new Uint8Array(buf), headers: { 'Content-Type': contentType } });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status}${await why(res)})`);
    return;
  }
  const file = path.join(dir(), name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
}

export async function getNamed(name: string): Promise<Buffer> {
  checkName(name);
  if (s3On()) {
    const { client, url } = s3();
    const res = await client.fetch(url(name), { method: 'GET' });
    if (!res.ok) throw new Error(`Storage read failed (${res.status}${await why(res)})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFile(path.join(dir(), name));
}

export async function deleteNamed(name: string): Promise<void> {
  checkName(name);
  if (s3On()) {
    const { client, url } = s3();
    const res = await client.fetch(url(name), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status}${await why(res)})`);
    return;
  }
  await fs.rm(path.join(dir(), name), { force: true });
}

export type StoredFile = { name: string; bytes: number; modified: Date };

/** Every backup file under a prefix such as "backups/daily/", newest name first. */
export async function listNamed(prefix: 'backups/daily/' | 'backups/monthly/'): Promise<StoredFile[]> {
  let out: StoredFile[] = [];
  if (s3On()) {
    const { client } = s3();
    const base = `${process.env.S3_ENDPOINT!.replace(/\/$/, '')}/${process.env.S3_BUCKET}`;
    let token: string | undefined;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
      if (token) q.set('continuation-token', token);
      const res = await client.fetch(`${base}?${q}`, { method: 'GET' });
      if (!res.ok) throw new Error(`Storage list failed (${res.status}${await why(res)})`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([^<]+)<\/Key>/.exec(m[1])?.[1];
        if (!key || !BACKUP_NAME.test(key)) continue;
        out.push({ name: key, bytes: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0), modified: new Date(/<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1] ?? 0) });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] : undefined;
      if (!token) break;
    }
  } else {
    const folder = path.join(dir(), prefix);
    const names = await fs.readdir(folder).catch(() => [] as string[]);
    for (const n of names) {
      const name = `${prefix}${n}`;
      if (!BACKUP_NAME.test(name)) continue;
      const st = await fs.stat(path.join(folder, n));
      out.push({ name, bytes: st.size, modified: st.mtime });
    }
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}
