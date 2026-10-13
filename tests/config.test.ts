import { describe, expect, it } from 'vitest';
import { assertSafeMode, isDemo } from '../lib/db';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('demo mode fails safe', () => {
  it('is on by default only while developing or testing', () => {
    expect(isDemo(env({ NODE_ENV: 'development' }))).toBe(true);
    expect(isDemo(env({ NODE_ENV: 'test' }))).toBe(true);
  });
  it('is never on in production unless asked for by name', () => {
    expect(isDemo(env({ NODE_ENV: 'production' }))).toBe(false);
    expect(isDemo(env({ NODE_ENV: 'production', DEMO_MODE: '' }))).toBe(false);
    expect(isDemo(env({ NODE_ENV: 'production', DEMO_MODE: 'yes' }))).toBe(false);
    expect(isDemo(env({ NODE_ENV: 'production', DEMO_MODE: 'true' }))).toBe(true);
  });
  it('can always be switched off', () => {
    expect(isDemo(env({ NODE_ENV: 'development', DEMO_MODE: 'false' }))).toBe(false);
  });
  it('refuses to run demo logins against a hosted database in production', () => {
    expect(() => assertSafeMode(env({ NODE_ENV: 'production', DEMO_MODE: 'true', DATABASE_URL: 'postgres://x' }))).toThrow(/hosted database/);
    expect(() => assertSafeMode(env({ NODE_ENV: 'production', DEMO_MODE: 'false', DATABASE_URL: 'postgres://x' }))).not.toThrow();
    expect(() => assertSafeMode(env({ NODE_ENV: 'production', DEMO_MODE: 'true' }))).not.toThrow();
    expect(() => assertSafeMode(env({ NODE_ENV: 'development', DEMO_MODE: 'true', DATABASE_URL: 'postgres://x' }))).not.toThrow();
  });
});
