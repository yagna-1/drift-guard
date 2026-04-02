import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Runtime mode: dev (infer+diff+pin updates), ci (diff only, no pin updates), learn (infer+pin, no diff). */
export type DriftMode = 'dev' | 'ci' | 'learn';

const DEFAULT_TARGET = 'http://localhost:3000';
const DEFAULT_PORT = 4000;

function parseMode(raw: string | undefined): DriftMode {
  if (raw === 'dev' || raw === 'ci' || raw === 'learn') {
    return raw;
  }
  return 'dev';
}

function parsePort(raw: string | undefined): number {
  const n = raw !== undefined && raw !== '' ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(n) && n > 0 && n < 65536) {
    return n;
  }
  return DEFAULT_PORT;
}

function truthyEnv(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  const s = raw.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw !== undefined && raw !== '' ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface DriftGuardConfig {
  mode: DriftMode;
  target: string;
  port: number;
  cwd: string;
  schemasDir: string;
  liveSchemasDir: string;
  violationsLogPath: string;
  verbose: boolean;
  pinAfterSamples: number;
  authContextEnabled: boolean;
  variantParams: string[];
  reportJsonPath: string;
  reportMarkdownPath: string;
}

interface DriftGuardFileConfig {
  target?: string;
  port?: number;
  mode?: DriftMode;
  schemasDir?: string;
  liveSchemasDir?: string;
  violationsLogPath?: string;
  verbose?: boolean;
  pinAfterSamples?: number;
  authContextEnabled?: boolean;
  variantParams?: string[];
  reportJsonPath?: string;
  reportMarkdownPath?: string;
}

function loadFileConfig(cwd: string): DriftGuardFileConfig {
  const configPath = join(cwd, 'driftguard.config.json');
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as DriftGuardFileConfig;
    return parsed ?? {};
  } catch {
    return {};
  }
}

/**
 * Environment-driven DriftGuard configuration with sensible defaults.
 * Schemas default to `<cwd>/.driftguard/schemas`, violations to `<cwd>/.driftguard/violations.log`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): DriftGuardConfig {
  const cwd = (env.DRIFTGUARD_CWD?.trim() || process.cwd()).replace(/\/$/, '') || process.cwd();
  const fileConfig = loadFileConfig(cwd);
  const mode = parseMode(
    env.DRIFTGUARD_MODE ??
      (fileConfig.mode !== undefined ? String(fileConfig.mode) : undefined),
  );
  const target = (
    env.DRIFTGUARD_TARGET?.trim() ??
    fileConfig.target?.trim() ??
    DEFAULT_TARGET
  ).replace(/\/$/, '') || DEFAULT_TARGET;
  const port = parsePort(
    env.DRIFTGUARD_PORT ??
      (fileConfig.port !== undefined ? String(fileConfig.port) : undefined),
  );
  const schemasDir =
    env.DRIFTGUARD_SCHEMAS_DIR?.trim() ||
    fileConfig.schemasDir?.trim() ||
    join(cwd, '.driftguard', 'schemas');
  const liveSchemasDir =
    env.DRIFTGUARD_LIVE_SCHEMAS_DIR?.trim() ||
    fileConfig.liveSchemasDir?.trim() ||
    join(cwd, '.driftguard', 'live');
  const violationsLogPath =
    env.DRIFTGUARD_VIOLATIONS_LOG?.trim() ||
    fileConfig.violationsLogPath?.trim() ||
    join(cwd, '.driftguard', 'violations.log');
  const verbose = env.DRIFTGUARD_VERBOSE !== undefined
    ? truthyEnv(env.DRIFTGUARD_VERBOSE)
    : (fileConfig.verbose ?? false);
  const pinAfterSamples = parsePositiveInt(
    env.DRIFTGUARD_PIN_AFTER_SAMPLES ??
      (fileConfig.pinAfterSamples !== undefined
        ? String(fileConfig.pinAfterSamples)
        : undefined),
    3,
  );
  const authContextEnabled = env.DRIFTGUARD_AUTH_CONTEXT !== undefined
    ? truthyEnv(env.DRIFTGUARD_AUTH_CONTEXT)
    : (fileConfig.authContextEnabled ?? false);
  const variantParams = env.DRIFTGUARD_VARIANT_PARAMS !== undefined
    ? parseCsv(env.DRIFTGUARD_VARIANT_PARAMS)
    : (fileConfig.variantParams ?? []);
  const reportJsonPath =
    env.DRIFTGUARD_REPORT_JSON?.trim() ||
    fileConfig.reportJsonPath?.trim() ||
    join(cwd, '.driftguard', 'report.json');
  const reportMarkdownPath =
    env.DRIFTGUARD_REPORT_MD?.trim() ||
    fileConfig.reportMarkdownPath?.trim() ||
    join(cwd, '.driftguard', 'report.md');

  return {
    mode,
    target,
    port,
    cwd,
    schemasDir,
    liveSchemasDir,
    violationsLogPath,
    verbose,
    pinAfterSamples,
    authContextEnabled,
    variantParams,
    reportJsonPath,
    reportMarkdownPath,
  };
}
