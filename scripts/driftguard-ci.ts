import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { loadConfig } from '../src/config.js';
import type { DiffSeverity } from '../src/types.js';

interface LogLine {
  ts?: string;
  endpoint?: string;
  severity?: DiffSeverity;
  path?: string;
  code?: string;
  message?: string;
  confidence?: number;
}

function parseJsonl(content: string): LogLine[] {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const out: LogLine[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as LogLine);
    } catch {
      console.warn('[drift] Skipping invalid JSONL line');
    }
  }
  return out;
}

export function runContractReport(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const cfg = loadConfig(env);
  const logPath = cfg.violationsLogPath;

  if (!existsSync(logPath)) {
    const emptyReport = {
      generatedAt: new Date().toISOString(),
      totals: {
        violations: 0,
        breaking: 0,
        warn: 0,
        info: 0,
      },
      status: 'pass',
      violations: [] as LogLine[],
    };
    mkdirSync(dirname(cfg.reportJsonPath), { recursive: true });
    mkdirSync(dirname(cfg.reportMarkdownPath), { recursive: true });
    writeFileSync(cfg.reportJsonPath, `${JSON.stringify(emptyReport, null, 2)}\n`, 'utf8');
    writeFileSync(
      cfg.reportMarkdownPath,
      '# DriftGuard CI Report\n\n- Total: 0\n- BREAKING: 0\n- WARN: 0\n- INFO: 0\n- Status: PASS\n',
      'utf8',
    );
    console.log(
      '[drift] No violations log found. Either no traffic was proxied, or no violations were recorded.',
    );
    return 0;
  }

  const violations = parseJsonl(readFileSync(logPath, 'utf8'));
  const breaking = violations.filter((v) => v.severity === 'BREAKING');
  const warns = violations.filter((v) => v.severity === 'WARN');
  const infos = violations.filter((v) => v.severity === 'INFO');

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      violations: violations.length,
      breaking: breaking.length,
      warn: warns.length,
      info: infos.length,
    },
    status: breaking.length > 0 ? 'fail' : 'pass',
    violations,
  };
  mkdirSync(dirname(cfg.reportJsonPath), { recursive: true });
  mkdirSync(dirname(cfg.reportMarkdownPath), { recursive: true });
  writeFileSync(cfg.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const mdLines = [
    '# DriftGuard CI Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Total: ${report.totals.violations}`,
    `- BREAKING: ${report.totals.breaking}`,
    `- WARN: ${report.totals.warn}`,
    `- INFO: ${report.totals.info}`,
    `- Status: ${report.status.toUpperCase()}`,
    '',
  ];
  if (breaking.length > 0) {
    mdLines.push('## Breaking violations');
    mdLines.push('');
    for (const v of breaking) {
      mdLines.push(`- [${v.endpoint ?? '?'}] ${v.path ?? '?'} - ${v.message ?? ''}`);
    }
  }
  writeFileSync(cfg.reportMarkdownPath, `${mdLines.join('\n')}\n`, 'utf8');

  console.log('\n[drift] DriftGuard CI Report');
  console.log(
    `[drift] Total violations: ${violations.length} (${breaking.length} BREAKING, ${warns.length} WARN)`,
  );

  if (breaking.length > 0) {
    console.error('\n[drift] BREAKING violations detected:');
    breaking.forEach((v) => {
      const ep = v.endpoint ?? '?';
      const p = v.path ?? '?';
      const msg = v.message ?? '';
      console.error(`  ✗  [${ep}] ${p}: ${msg}`);
    });
    console.error(
      '\n[drift] Run with DRIFTGUARD_MODE=learn to refresh pinned schemas, then commit.',
    );
    return 1;
  }

  if (warns.length > 0) {
    console.warn('\n[drift] WARN violations (non-breaking):');
    warns.forEach((v) => {
      console.warn(`  ~  [${v.endpoint ?? '?'}] ${v.path ?? '?'}: ${v.message ?? ''}`);
    });
  }

  console.log('[drift] No breaking changes. API contract intact.');
  return 0;
}

if (import.meta.main) {
  process.exit(runContractReport());
}
