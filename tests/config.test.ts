import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const keys = [
  'DRIFTGUARD_CWD',
  'DRIFTGUARD_TARGET',
  'DRIFTGUARD_MODE',
  'DRIFTGUARD_VARIANT_PARAMS',
  'DRIFTGUARD_REPORT_JSON',
  'DRIFTGUARD_REPORT_MD',
];

afterEach(() => {
  for (const key of keys) {
    delete process.env[key];
  }
});

describe('loadConfig', () => {
  it('loads values from driftguard.config.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'dg-config-'));
    writeFileSync(
      join(root, 'driftguard.config.json'),
      JSON.stringify(
        {
          target: 'http://localhost:9000',
          mode: 'ci',
          pinAfterSamples: 7,
          authContextEnabled: true,
          variantParams: ['type', 'view'],
          reportJsonPath: join(root, 'artifacts', 'report.json'),
          reportMarkdownPath: join(root, 'artifacts', 'report.md'),
        },
        null,
        2,
      ),
      'utf8',
    );
    process.env.DRIFTGUARD_CWD = root;

    const cfg = loadConfig(process.env);
    expect(cfg.target).toBe('http://localhost:9000');
    expect(cfg.mode).toBe('ci');
    expect(cfg.pinAfterSamples).toBe(7);
    expect(cfg.authContextEnabled).toBe(true);
    expect(cfg.variantParams).toEqual(['type', 'view']);
    expect(cfg.reportJsonPath).toContain('artifacts/report.json');
    expect(cfg.reportMarkdownPath).toContain('artifacts/report.md');
  });

  it('environment variables override file config', () => {
    const root = mkdtempSync(join(tmpdir(), 'dg-config-'));
    writeFileSync(
      join(root, 'driftguard.config.json'),
      JSON.stringify({ target: 'http://localhost:9000', mode: 'ci' }, null, 2),
      'utf8',
    );
    process.env.DRIFTGUARD_CWD = root;
    process.env.DRIFTGUARD_TARGET = 'http://localhost:1234';
    process.env.DRIFTGUARD_MODE = 'learn';

    const cfg = loadConfig(process.env);
    expect(cfg.target).toBe('http://localhost:1234');
    expect(cfg.mode).toBe('learn');
  });
});
