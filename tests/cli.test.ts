import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { inferSchema } from '../src/infer.js';
import { saveLiveSchema, savePinnedSchema } from '../src/store.js';

const envKeys = [
  'DRIFTGUARD_CWD',
  'DRIFTGUARD_SCHEMAS_DIR',
  'DRIFTGUARD_LIVE_SCHEMAS_DIR',
  'DRIFTGUARD_VIOLATIONS_LOG',
];

function setCliEnv(root: string): void {
  process.env.DRIFTGUARD_CWD = root;
  process.env.DRIFTGUARD_SCHEMAS_DIR = join(root, '.driftguard', 'schemas');
  process.env.DRIFTGUARD_LIVE_SCHEMAS_DIR = join(root, '.driftguard', 'live');
  process.env.DRIFTGUARD_VIOLATIONS_LOG = join(root, '.driftguard', 'violations.log');
}

afterEach(() => {
  for (const key of envKeys) {
    delete process.env[key];
  }
});

describe('cli', () => {
  it('list exits 0 with no schemas', () => {
    const root = mkdtempSync(join(tmpdir(), 'dg-cli-'));
    setCliEnv(root);
    expect(runCli(['list'])).toBe(0);
  });

  it('diff returns 1 when breaking changes are found', () => {
    const root = mkdtempSync(join(tmpdir(), 'dg-cli-'));
    setCliEnv(root);
    mkdirSync(process.env.DRIFTGUARD_SCHEMAS_DIR!, { recursive: true });
    mkdirSync(process.env.DRIFTGUARD_LIVE_SCHEMAS_DIR!, { recursive: true });

    savePinnedSchema(
      'GET_api_users_{id}',
      {
        endpoint: 'GET /api/users/{id}',
        sampleCount: 1,
        pinnedAt: new Date().toISOString(),
        schema: inferSchema({ id: 1, name: 'A' }),
      },
      process.env.DRIFTGUARD_SCHEMAS_DIR,
    );
    saveLiveSchema(
      'GET_api_users_{id}',
      {
        endpoint: 'GET /api/users/{id}',
        seenAt: new Date().toISOString(),
        sampleCount: 1,
        schema: inferSchema({ id: '1', name: 'A' }),
      },
      process.env.DRIFTGUARD_LIVE_SCHEMAS_DIR,
    );

    expect(runCli(['diff'])).toBe(1);
  });

  it('approve promotes live schemas and clears violations log', () => {
    const root = mkdtempSync(join(tmpdir(), 'dg-cli-'));
    setCliEnv(root);
    mkdirSync(process.env.DRIFTGUARD_SCHEMAS_DIR!, { recursive: true });
    mkdirSync(process.env.DRIFTGUARD_LIVE_SCHEMAS_DIR!, { recursive: true });
    mkdirSync(join(root, '.driftguard'), { recursive: true });

    saveLiveSchema(
      'GET_api_orders',
      {
        endpoint: 'GET /api/orders',
        seenAt: new Date().toISOString(),
        sampleCount: 1,
        schema: inferSchema({ id: 1 }),
      },
      process.env.DRIFTGUARD_LIVE_SCHEMAS_DIR,
    );

    const logPath = process.env.DRIFTGUARD_VIOLATIONS_LOG!;
    writeFileSync(logPath, '{"severity":"WARN"}\n', 'utf8');

    expect(runCli(['approve'])).toBe(0);
    const schemaFile = join(process.env.DRIFTGUARD_SCHEMAS_DIR!, 'GET_api_orders.json');
    expect(readFileSync(schemaFile, 'utf8')).toContain('"GET /api/orders"');
    expect(() => readFileSync(logPath, 'utf8')).toThrow();
  });

  it('reset removes a pinned endpoint file', () => {
    const root = mkdtempSync(join(tmpdir(), 'dg-cli-'));
    setCliEnv(root);
    mkdirSync(process.env.DRIFTGUARD_SCHEMAS_DIR!, { recursive: true });

    savePinnedSchema(
      'GET_api_health',
      {
        endpoint: 'GET /api/health',
        sampleCount: 1,
        pinnedAt: new Date().toISOString(),
        schema: inferSchema({ ok: true }),
      },
      process.env.DRIFTGUARD_SCHEMAS_DIR,
    );
    expect(runCli(['reset', 'GET_api_health'])).toBe(0);
    expect(runCli(['reset', 'GET_api_health'])).toBe(1);
  });
});
