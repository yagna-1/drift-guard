import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { runContractReport } from './driftguard-ci.js';
import { createDriftProxyApp } from '../src/proxy.js';

function closeServer(server: { close: (cb: () => void) => void }): Promise<void> {
  return new Promise((resolve) => server.close(resolve));
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function hit(url: string): Promise<Response> {
  return fetch(url, { method: 'GET' });
}

async function run(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'driftguard-battle-'));
  const backendPort = 3321;
  const proxyPort = 4421;

  process.env.DRIFTGUARD_CWD = root;
  process.env.DRIFTGUARD_SCHEMAS_DIR = join(root, '.driftguard', 'schemas');
  process.env.DRIFTGUARD_LIVE_SCHEMAS_DIR = join(root, '.driftguard', 'live');
  process.env.DRIFTGUARD_VIOLATIONS_LOG = join(root, '.driftguard', 'violations.log');
  process.env.DRIFTGUARD_TARGET = `http://localhost:${backendPort}`;
  process.env.DRIFTGUARD_PORT = String(proxyPort);
  process.env.DRIFTGUARD_PIN_AFTER_SAMPLES = '3';

  let version: 'v1' | 'v2-additive' | 'v3-breaking' = 'v1';
  const backend = new Hono();
  backend.get('/api/users/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (version === 'v1') {
      return c.json({ id, user_name: `user-${id}`, email: `${id}@example.com` });
    }
    if (version === 'v2-additive') {
      return c.json({
        id,
        user_name: `user-${id}`,
        email: `${id}@example.com`,
        profile: { timezone: 'UTC' },
      });
    }
    return c.json({ id, username: `user-${id}`, email: `${id}@example.com` });
  });
  backend.get('/api/ping', (c) => c.text('pong'));
  backend.get('/api/error-json', (c) => c.json({ error: 'boom' }, 500));

  const backendServer = serve({ fetch: backend.fetch, port: backendPort });

  try {
    process.env.DRIFTGUARD_MODE = 'learn';
    const learnProxy = serve({ fetch: createDriftProxyApp().fetch, port: proxyPort });
    try {
      // Baseline learning under concurrent traffic.
      await Promise.all(
        Array.from({ length: 150 }, (_, i) => hit(`http://localhost:${proxyPort}/api/users/${(i % 10) + 1}`)),
      );
      await Promise.all([
        hit(`http://localhost:${proxyPort}/api/ping`),
        hit(`http://localhost:${proxyPort}/api/error-json`),
      ]);
    } finally {
      await closeServer(learnProxy);
    }

    version = 'v2-additive';
    process.env.DRIFTGUARD_MODE = 'ci';
    const ciProxyAdditive = serve({ fetch: createDriftProxyApp().fetch, port: proxyPort });
    try {
      await Promise.all(
        Array.from({ length: 120 }, (_, i) => hit(`http://localhost:${proxyPort}/api/users/${(i % 12) + 1}`)),
      );
    } finally {
      await closeServer(ciProxyAdditive);
    }

    const additiveExit = runContractReport(process.env);
    assert(additiveExit === 0, 'Expected additive change phase to pass contract report');

    version = 'v3-breaking';
    process.env.DRIFTGUARD_MODE = 'ci';
    const ciProxyBreaking = serve({ fetch: createDriftProxyApp().fetch, port: proxyPort });
    try {
      await Promise.all(
        Array.from({ length: 80 }, (_, i) => hit(`http://localhost:${proxyPort}/api/users/${(i % 8) + 1}`)),
      );
    } finally {
      await closeServer(ciProxyBreaking);
    }

    const breakingExit = runContractReport(process.env);
    assert(
      breakingExit === 1,
      'Expected breaking drift phase to fail contract report',
    );

    const logText = readFileSync(process.env.DRIFTGUARD_VIOLATIONS_LOG!, 'utf8');
    assert(
      logText.includes('BREAKING'),
      'Expected violations log to include BREAKING entries',
    );

    console.log('\n[battle] PASS: DriftGuard survives load and catches breaking drift.');
  } finally {
    await closeServer(backendServer);
  }
}

run().catch((error: unknown) => {
  const msg = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[battle] FAIL: ${msg}`);
  process.exit(1);
});
