import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `brandit-wa-${process.pid}`);
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
process.env.NEXT_PUBLIC_APP_URL = 'https://brandit.test';
delete process.env.SMS_API_KEY;

let db: typeof import('../lib/db');
let messages: typeof import('../lib/messages');

beforeAll(async () => {
  db = await import('../lib/db');
  messages = await import('../lib/messages');
  await db.query('select 1');
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.WHATSAPP_ACCESS_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID; });

const queue = (lang: 'en' | 'pcm') => db.tx((q) => messages.queueMessage(q, { toPhone: '+2348031234567', template: 'abandoned_nudge', lang, vars: { name: 'Ada', product: 'Business cards', code: 'BR-1', link: 'https://brandit.test/continue' } } as any));

describe('WhatsApp templates in Pidgin', () => {
  it('sends the English template when the Pidgin one is not approved yet, instead of losing the message', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'x'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    const used: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      const name = JSON.parse(init.body).template.name as string;
      used.push(name);
      return name.endsWith('_pcm') ? new Response('{"error":{"code":132001}}', { status: 404 }) : new Response('{}', { status: 200 });
    }));
    await db.query("delete from messages where template = 'abandoned_nudge'");
    await queue('pcm');
    await messages.flushMessages();
    expect(used).toEqual(['brandit_abandoned_nudge_pcm', 'brandit_abandoned_nudge']);
    const row = await db.one<any>("select channel, status, error from messages where template = 'abandoned_nudge'");
    expect(row.channel).toBe('whatsapp');
    expect(row.status).toBe('sent');
    expect(row.error).toMatch(/English/);
  });

  it('does not retry an English message, and still fails honestly when WhatsApp is down', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'x'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    const fetchMock = vi.fn(async () => new Response('down', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await db.query("delete from messages where template = 'abandoned_nudge'");
    await queue('en');
    await messages.flushMessages();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = await db.one<any>("select status from messages where template = 'abandoned_nudge'");
    expect(row.status).toBe('failed');
  });
});
