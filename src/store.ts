import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { loadConfig } from './config.js';
import type { SchemaDiffIssue, SchemaNode } from './types.js';

const PATH_SEGMENT_RULES: readonly [RegExp, string][] = [
  [/^\d+$/, '{id}'],
  [
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    '{uuid}',
  ],
  [/^[a-z]{2,3}-\d{4,}$/i, '{slug}'],
  [/^[a-f0-9]{24}$/i, '{objectId}'],
];

/**
 * Normalize URL pathname segments for stable endpoint keys (dynamic ids → placeholders).
 */
function normalizePathname(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      for (const [pattern, replacement] of PATH_SEGMENT_RULES) {
        if (pattern.test(segment)) {
          return replacement;
        }
      }
      return segment;
    })
    .join('/');
}

export interface PinnedEndpointRecord {
  endpoint: string;
  sampleCount: number;
  pinnedAt: string;
  schema: SchemaNode;
}

export interface LiveEndpointRecord {
  endpoint: string;
  seenAt: string;
  sampleCount: number;
  schema: SchemaNode;
}

/**
 * Stable key for an HTTP endpoint (method + normalized path), safe for filenames.
 */
export function endpointKey(method: string, url: string): string {
  const pathname = new URL(url, 'http://driftguard.internal').pathname;
  const normalizedPath = normalizePathname(pathname);
  const tail = normalizedPath.replace(/^\//, '').replace(/\//g, '_');
  const base = tail.length > 0 ? `${method}_${tail}` : `${method}_`;
  return base.replace(/_{2,}/g, '_');
}

export function loadPinnedSchema(
  key: string,
  schemasDir?: string,
): PinnedEndpointRecord | null {
  const dir = schemasDir ?? loadConfig().schemasDir;
  const filePath = join(dir, `${key}.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as PinnedEndpointRecord;
}

export function savePinnedSchema(
  key: string,
  record: PinnedEndpointRecord,
  schemasDir?: string,
): void {
  const dir = schemasDir ?? loadConfig().schemasDir;
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${key}.json`);
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export function saveLiveSchema(
  key: string,
  record: LiveEndpointRecord,
  liveSchemasDir?: string,
): void {
  const dir = liveSchemasDir ?? loadConfig().liveSchemasDir;
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${key}.json`);
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export function loadLiveSchema(
  key: string,
  liveSchemasDir?: string,
): LiveEndpointRecord | null {
  const dir = liveSchemasDir ?? loadConfig().liveSchemasDir;
  const filePath = join(dir, `${key}.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as LiveEndpointRecord;
}

export function listSchemaKeys(schemasDir?: string): string[] {
  const dir = schemasDir ?? loadConfig().schemasDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

export function listLiveSchemaKeys(liveSchemasDir?: string): string[] {
  const dir = liveSchemasDir ?? loadConfig().liveSchemasDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

export function removePinnedSchema(key: string, schemasDir?: string): boolean {
  const dir = schemasDir ?? loadConfig().schemasDir;
  const filePath = join(dir, `${key}.json`);
  if (!existsSync(filePath)) return false;
  rmSync(filePath);
  return true;
}

export function clearViolationLog(violationsLogPath?: string): void {
  const filePath = violationsLogPath ?? loadConfig().violationsLogPath;
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

export function appendViolation(
  entry: SchemaDiffIssue & { endpoint: string },
  violationsLogPath?: string,
): void {
  const logPath = violationsLogPath ?? loadConfig().violationsLogPath;
  ensureDirForFile(logPath);
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
  appendFileSync(logPath, line, 'utf8');
}

function ensureDirForFile(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
