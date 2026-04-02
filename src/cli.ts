#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, type DriftMode } from './config.js';
import { diffSchemas } from './diff.js';
import { startDriftProxy } from './proxy.js';
import {
  clearViolationLog,
  listLiveSchemaKeys,
  listSchemaKeys,
  loadLiveSchema,
  loadPinnedSchema,
  removePinnedSchema,
  savePinnedSchema,
} from './store.js';
import type { SchemaDiffIssue } from './types.js';

type ParsedArgs = {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [key, inlineValue] = token.slice(2).split('=');
    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
      continue;
    }
    flags[key] = true;
  }

  return { command, positionals, flags };
}

function getFlag(parsed: ParsedArgs, key: string): string | undefined {
  const val = parsed.flags[key];
  return typeof val === 'string' ? val : undefined;
}

function usage(): string {
  return [
    'DriftGuard CLI',
    '',
    'Usage:',
    '  driftguard start [--target URL] [--port N] [--mode dev|ci|learn]',
    '  driftguard list',
    '  driftguard diff',
    '  driftguard reset <endpointKey>',
    '  driftguard approve',
    '',
    'Notes:',
    '  - "diff" compares pinned schemas in .driftguard/schemas with',
    '    latest live snapshots in .driftguard/live.',
    '  - "approve" promotes live snapshots into pinned schemas.',
  ].join('\n');
}

function severityOrder(v: SchemaDiffIssue): number {
  switch (v.severity) {
    case 'BREAKING':
      return 0;
    case 'WARN':
      return 1;
    case 'INFO':
      return 2;
  }
}

function printIssues(endpointKey: string, issues: readonly SchemaDiffIssue[]): void {
  const sorted = [...issues].sort((a, b) => severityOrder(a) - severityOrder(b));
  for (const issue of sorted) {
    const mark = issue.severity === 'BREAKING' ? '✗' : issue.severity === 'WARN' ? '~' : '+';
    console.log(`  ${mark} [${endpointKey}] ${issue.path || '/'}: ${issue.message}`);
  }
}

function runList(): number {
  const cfg = loadConfig();
  const keys = listSchemaKeys(cfg.schemasDir);
  if (keys.length === 0) {
    console.log('[drift] No pinned schemas found.');
    return 0;
  }
  console.log(`[drift] Pinned schemas (${keys.length}):`);
  keys.forEach((k) => console.log(`  - ${k}`));
  return 0;
}

function runDiff(): number {
  const cfg = loadConfig();
  const pinnedKeys = new Set(listSchemaKeys(cfg.schemasDir));
  const liveKeys = new Set(listLiveSchemaKeys(cfg.liveSchemasDir));
  const allKeys = [...new Set([...pinnedKeys, ...liveKeys])].sort();
  if (allKeys.length === 0) {
    console.log('[drift] No pinned or live schemas found.');
    return 0;
  }

  const issues: SchemaDiffIssue[] = [];
  for (const key of allKeys) {
    const pinned = loadPinnedSchema(key, cfg.schemasDir);
    const live = loadLiveSchema(key, cfg.liveSchemasDir);
    if (!pinned && live) {
      issues.push({
        severity: 'INFO',
        path: '/',
        code: 'endpoint.new',
        message: `New endpoint "${key}" seen in live snapshots`,
      });
      continue;
    }
    if (pinned && !live) {
      issues.push({
        severity: 'WARN',
        path: '/',
        code: 'endpoint.missing.live',
        message: `Endpoint "${key}" has no live snapshot to compare`,
      });
      continue;
    }
    if (!pinned || !live) continue;
    const result = diffSchemas(pinned.schema, live.schema);
    if (result.issues.length > 0) {
      printIssues(key, result.issues);
      issues.push(...result.issues);
    }
  }

  const breaking = issues.filter((i) => i.severity === 'BREAKING').length;
  const warn = issues.filter((i) => i.severity === 'WARN').length;
  const info = issues.filter((i) => i.severity === 'INFO').length;

  console.log(
    `[drift] Diff summary: ${breaking} BREAKING, ${warn} WARN, ${info} INFO`,
  );
  return breaking > 0 ? 1 : 0;
}

function runReset(parsed: ParsedArgs): number {
  const key = parsed.positionals[0];
  if (!key) {
    console.error('[drift] Missing endpoint key. Usage: driftguard reset <endpointKey>');
    return 2;
  }
  const cfg = loadConfig();
  const removed = removePinnedSchema(key, cfg.schemasDir);
  if (!removed) {
    console.error(`[drift] Pinned schema not found: ${key}`);
    return 1;
  }
  console.log(`[drift] Removed pinned schema: ${key}`);
  return 0;
}

function runApprove(): number {
  const cfg = loadConfig();
  const liveKeys = listLiveSchemaKeys(cfg.liveSchemasDir);
  if (liveKeys.length === 0) {
    console.log('[drift] No live schemas to approve.');
    return 0;
  }
  mkdirSync(cfg.schemasDir, { recursive: true });

  let promoted = 0;
  for (const key of liveKeys) {
    const live = loadLiveSchema(key, cfg.liveSchemasDir);
    if (!live) continue;
    savePinnedSchema(
      key,
      {
        endpoint: live.endpoint,
        sampleCount: live.sampleCount,
        pinnedAt: new Date().toISOString(),
        schema: live.schema,
      },
      cfg.schemasDir,
    );
    promoted += 1;
  }
  clearViolationLog(cfg.violationsLogPath);
  console.log(`[drift] Approved ${promoted} live schema snapshot(s) into pinned schemas.`);
  return 0;
}

function runStart(parsed: ParsedArgs): number {
  const target = getFlag(parsed, 'target');
  const port = getFlag(parsed, 'port');
  const mode = getFlag(parsed, 'mode');
  if (target) process.env.DRIFTGUARD_TARGET = target;
  if (port) process.env.DRIFTGUARD_PORT = port;
  if (mode) {
    if (mode !== 'dev' && mode !== 'ci' && mode !== 'learn') {
      console.error('[drift] Invalid mode. Use dev | ci | learn.');
      return 2;
    }
    process.env.DRIFTGUARD_MODE = mode as DriftMode;
  }
  startDriftProxy();
  return 0;
}

export function runCli(argv = process.argv.slice(2)): number {
  const parsed = parseArgs(argv);
  const command = parsed.command;
  switch (command) {
    case 'start':
      return runStart(parsed);
    case 'list':
      return runList();
    case 'diff':
      return runDiff();
    case 'reset':
      return runReset(parsed);
    case 'approve':
      return runApprove();
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(usage());
      return 0;
    default:
      console.error(`[drift] Unknown command: ${command}\n`);
      console.error(usage());
      return 2;
  }
}

const isEntry =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntry) {
  process.exit(runCli());
}
