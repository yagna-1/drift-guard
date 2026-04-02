import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { createDriftProxyApp } from '../src/proxy.js';
import { runContractReport } from '../scripts/driftguard-ci.js';

function closeServer(server: { close: (cb: () => void) => void }): Promise<void> {
  return new Promise((resolve) => server.close(resolve));
}

const envKeys = [
  'DRIFTGUARD_CWD',
  'DRIFTGUARD_SCHEMAS_DIR',
  'DRIFTGUARD_LIVE_SCHEMAS_DIR',
  'DRIFTGUARD_VIOLATIONS_LOG',
  'DRIFTGUARD_TARGET',
  'DRIFTGUARD_PORT',
  'DRIFTGUARD_MODE',
  'DRIFTGUARD_PIN_AFTER_SAMPLES',
];

afterEach(() => {
  for (const key of envKeys) {
    delete process.env[key];
  }
});

describe('mvp integration loop', () => {
  it('fails contract report after a breaking API drift', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dg-mvp-'));
    const backendPort = 3310;
    const proxyPort = 4410;

    process.env.DRIFTGUARD_CWD = root;
    process.env.DRIFTGUARD_SCHEMAS_DIR = join(root, '.driftguard', 'schemas');
    process.env.DRIFTGUARD_LIVE_SCHEMAS_DIR = join(root, '.driftguard', 'live');
    process.env.DRIFTGUARD_VIOLATIONS_LOG = join(root, '.driftguard', 'violations.log');
    process.env.DRIFTGUARD_TARGET = `http://localhost:${backendPort}`;
    process.env.DRIFTGUARD_PORT = String(proxyPort);
    process.env.DRIFTGUARD_PIN_AFTER_SAMPLES = '1';

    let shapeVersion = 1;
    const backend = new Hono();
    backend.get('/api/users/1', (c) => {
      if (shapeVersion === 1) {
        return c.json({ id: 1, user_name: 'alice', email: 'a@example.com' });
      }
      return c.json({ id: 1, username: 'alice', email: 'a@example.com' });
    });
    const backendServer = serve({ fetch: backend.fetch, port: backendPort });

    process.env.DRIFTGUARD_MODE = 'learn';
    const learnProxy = serve({
      fetch: createDriftProxyApp().fetch,
      port: proxyPort,
    });
    const learnRes = await fetch(`http://localhost:${proxyPort}/api/users/1`);
    expect(learnRes.status).toBe(200);
    await closeServer(learnProxy);

    shapeVersion = 2;
    process.env.DRIFTGUARD_MODE = 'ci';
    const ciProxy = serve({
      fetch: createDriftProxyApp().fetch,
      port: proxyPort,
    });
    const ciRes = await fetch(`http://localhost:${proxyPort}/api/users/1`);
    expect(ciRes.status).toBe(200);
    await closeServer(ciProxy);
    await closeServer(backendServer);

    const reportExitCode = runContractReport(process.env);
    expect(reportExitCode).toBe(1);
    const reportJson = join(root, '.driftguard', 'report.json');
    const reportMd = join(root, '.driftguard', 'report.md');
    expect(existsSync(reportJson)).toBe(true);
    expect(existsSync(reportMd)).toBe(true);
    expect(readFileSync(reportMd, 'utf8')).toContain('DriftGuard CI Report');
  });
});
