import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { fatalProblems } from '../lib/setup';
import { DEFAULT_SETTINGS } from '../lib/settings-defaults';

const root = path.resolve(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const bp = parse(read('render.yaml')) as any;
const web = bp.services[0];
const db = bp.databases[0];
const envKeys: string[] = web.envVars.map((e: any) => e.key);
const envVar = (k: string) => web.envVars.find((e: any) => e.key === k);

// Plan names from Render's Blueprint reference (render.com/docs/blueprint-spec), read October 2026.
const WEB_PLANS = ['free', '0.5c-512mb', '1c-2g', '2c-4g', '2c-8g', '2c-16g', '4c-8g', '4c-16g', '4c-32g', '8c-16g', '8c-32g', '8c-64g', '12c-24g', '12c-48g', '12c-96g'];
const DB_PLANS = ['free', '0.1c-256mb', '0.5c-1g', '1c-2g', '1c-4g', '2c-4g', '2c-8g', '2c-16g', '4c-16g', '4c-32g'];

describe('the Render blueprint', () => {
  it('has one web service and one database', () => {
    expect(bp.services).toHaveLength(1);
    expect(bp.databases).toHaveLength(1);
    expect(web.type).toBe('web');
    expect(web.runtime).toBe('node');
  });

  it('puts everything in Frankfurt, the nearest Render region to Lagos (it cannot be changed later)', () => {
    expect(web.region).toBe('frankfurt');
    expect(db.region).toBe('frankfurt');
  });

  it('uses plan names Render recognises, and never a free plan for a live shop', () => {
    expect(WEB_PLANS).toContain(web.plan);
    expect(DB_PLANS).toContain(db.plan);
    expect(web.plan).not.toBe('free');
    expect(db.plan).not.toBe('free');
    expect(web.plan).not.toBe('0.5c-512mb');   // too small for the image and PDF checks
  });

  it('keeps the database private: only services inside Render can connect', () => {
    expect(db.ipAllowList).toEqual([]);
    expect(Number(db.diskSizeGB) === 1 || Number(db.diskSizeGB) % 5 === 0).toBe(true);
  });

  it('stores files in a bucket, not on a disk, and keeps one instance for the built-in scheduler', () => {
    expect(web.disk).toBeUndefined();
    expect(web.numInstances).toBe(1);
    for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) expect(envKeys).toContain(k);
  });

  it('turns demo mode off and wires the database in without copying a password', () => {
    expect(envVar('DEMO_MODE').value).toBe('false');
    expect(envVar('DATABASE_URL').fromDatabase).toEqual({ name: db.name, property: 'connectionString' });
  });

  it('never writes a secret into the file', () => {
    for (const e of web.envVars) {
      if (/SECRET|KEY|PIN|PASSWORD|TOKEN/.test(e.key) && e.key !== 'S3_REGION') {
        expect(e.value, e.key).toBeUndefined();
        expect(e.generateValue === true || e.sync === false, e.key).toBe(true);
      }
    }
    expect(envVar('SESSION_SECRET').generateValue).toBe(true);
    expect(envVar('CRON_SECRET').generateValue).toBe(true);
  });

  it('gives the live server what it refuses to start without', () => {
    // The two things fatalProblems() demands: a long session secret and a hosted database.
    const supplied = { NODE_ENV: 'production', DEMO_MODE: 'false', SESSION_SECRET: 'x'.repeat(44), DATABASE_URL: 'postgres://render' } as unknown as NodeJS.ProcessEnv;
    expect(fatalProblems(supplied)).toEqual([]);
    expect(envKeys).toContain('SESSION_SECRET');
    expect(envKeys).toContain('DATABASE_URL');
  });

  it('points the health check at a route that exists and answers without a login', () => {
    expect(web.healthCheckPath).toBe('/api/health');
    expect(fs.existsSync(path.join(root, 'app/api/health/route.ts'))).toBe(true);
  });

  it('builds and starts the standalone server, with its static files and public folder copied in', () => {
    expect(read('next.config.mjs')).toMatch(/output:\s*'standalone'/);
    expect(web.buildCommand).toContain('npm ci --include=dev');   // the build needs the dev tools even though NODE_ENV is production
    expect(web.buildCommand).toContain('npm run build');
    expect(web.buildCommand).toMatch(/cp -r public \.next\/standalone\/public/);
    expect(web.buildCommand).toMatch(/cp -r \.next\/static \.next\/standalone\/\.next\/static/);
    expect(web.startCommand).toBe('node .next/standalone/server.js');
    expect(envVar('HOSTNAME').value).toBe('0.0.0.0');
  });

  it('pins the same Node major version the Dockerfile and the tests use', () => {
    const major = (v: string) => v.split('.')[0];
    expect(major(envVar('NODE_VERSION').value)).toBe(major(read('Dockerfile').match(/FROM node:(\d+)/)![1]));
    expect(major(envVar('NODE_VERSION').value)).toBe(process.versions.node.split('.')[0]);
  });

  it('only mentions settings that .env.example documents', () => {
    const documented = read('.env.example');
    for (const k of envKeys) if (!['NODE_VERSION', 'HOSTNAME'].includes(k)) expect(documented, k).toContain(`${k}=`);
  });
});

describe('uploads behind Cloudflare', () => {
  it('stay under the 100 MB request cap on Cloudflare free and Pro plans', () => {
    expect(DEFAULT_SETTINGS.max_upload_mb).toBeLessThan(100);
  });
});
