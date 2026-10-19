import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const prod = parse(read('render.yaml')) as any;
const stg = parse(read('render.staging.yaml')) as any;
const web = stg.services[0];
const db = stg.databases[0];
const keys: string[] = web.envVars.map((e: any) => e.key);
const envVar = (k: string) => web.envVars.find((e: any) => e.key === k);

describe('the test-site blueprint', () => {
  it('shares no name with the real site, so both can live in one Render account', () => {
    expect(web.name).not.toBe(prod.services[0].name);
    expect(db.name).not.toBe(prod.databases[0].name);
    expect(web.envVars.find((e: any) => e.key === 'DATABASE_URL').fromDatabase.name).toBe(db.name);
  });

  it('builds and starts exactly like the real site, so a change that works here works there', () => {
    expect(web.buildCommand).toBe(prod.services[0].buildCommand);
    expect(web.startCommand).toBe(prod.services[0].startCommand);
    expect(web.plan).toBe(prod.services[0].plan);
    expect(web.region).toBe('frankfurt');
    expect(db.region).toBe('frankfurt');
    expect(envVar('NODE_VERSION').value).toBe(prod.services[0].envVars.find((e: any) => e.key === 'NODE_VERSION').value);
  });

  it('deploys its own branch and stays private', () => {
    expect(web.branch).toBe('staging');
    expect(db.ipAllowList).toEqual([]);
    expect(db.plan).not.toBe('free');   // a free Render database is deleted after 30 days
  });

  it('is marked as the test site, in live mode, and asks for a password', () => {
    expect(envVar('APP_ENV').value).toBe('staging');
    expect(envVar('DEMO_MODE').value).toBe('false');
    expect(envVar('STAGING_PASSWORD').sync).toBe(false);
  });

  it('can never text a real person: no SMS or WhatsApp keys', () => {
    for (const k of keys) expect(k, k).not.toMatch(/^(SMS_|WHATSAPP_)/);
  });

  it('asks for its own bucket and a Paystack key, and never writes a secret into the file', () => {
    for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'PAYSTACK_SECRET_KEY']) expect(keys).toContain(k);
    for (const e of web.envVars) {
      if (/SECRET|KEY|PIN|PASSWORD|TOKEN/.test(e.key) && e.key !== 'S3_REGION') {
        expect(e.value, e.key).toBeUndefined();
        expect(e.generateValue === true || e.sync === false, e.key).toBe(true);
      }
    }
  });

  it('only mentions settings that .env.example documents', () => {
    const documented = read('.env.example');
    for (const k of keys) if (!['NODE_VERSION', 'HOSTNAME'].includes(k)) expect(documented, k).toContain(`${k}=`);
  });
});
