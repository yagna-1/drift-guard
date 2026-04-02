import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { diffSchemas } from './diff.js';
import { inferSchema, mergeSchemaNodes } from './infer.js';
import {
  appendViolation,
  endpointKey,
  loadLiveSchema,
  loadPinnedSchema,
  saveLiveSchema,
  savePinnedSchema,
} from './store.js';
import type { SchemaDiffIssue } from './types.js';

const JSON_MEDIA = /application\/json|\+json\s*(;|$)/i;
const emittedViolationSignatures = new Set<string>();
const emittedBreakingLogSignatures = new Set<string>();

function isJsonSuccessStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

function looksLikeJsonResponse(contentType: string): boolean {
  return JSON_MEDIA.test(contentType);
}

function applyDriftHeaders(
  headers: Headers,
  opts: {
    mode: string;
    endpointLabel: string;
    violationCount: number;
    breakingCount: number;
    breakingPaths: string[];
  },
): void {
  headers.set('x-driftguard-mode', opts.mode);
  headers.set('x-driftguard-endpoint', opts.endpointLabel);
  headers.set('x-driftguard-violation-count', String(opts.violationCount));
  headers.set('x-driftguard-breaking-count', String(opts.breakingCount));
  headers.set('x-driftguard-breaking-paths', JSON.stringify(opts.breakingPaths));
}

function buildEndpointLabel(method: string, requestUrl: string): string {
  const pathname = new URL(requestUrl, 'http://driftguard.internal').pathname;
  return `${method} ${pathname}`;
}

function forwardUrl(targetBase: string, requestUrl: string): string {
  const u = new URL(requestUrl, 'http://driftguard.internal');
  const base = targetBase.endsWith('/') ? targetBase.slice(0, -1) : targetBase;
  return `${base}${u.pathname}${u.search}`;
}

function authContextKey(headers: Headers): string {
  const auth = headers.get('authorization');
  if (!auth) return 'anon';
  return `auth_${createHash('sha256').update(auth).digest('hex').slice(0, 8)}`;
}

function variantContextKey(url: URL, variantParams: string[]): string | undefined {
  if (variantParams.length === 0) return undefined;
  const parts = variantParams
    .map((name) => {
      const value = url.searchParams.get(name);
      return value ? `${name}=${value}` : undefined;
    })
    .filter((entry): entry is string => entry !== undefined)
    .sort();
  if (parts.length === 0) return undefined;
  return `variant_${parts.join('&')}`;
}

function withContextKey(baseKey: string, pieces: Array<string | undefined>): string {
  const suffix = pieces.filter((p): p is string => Boolean(p));
  if (suffix.length === 0) return baseKey;
  return `${baseKey}__${suffix.join('__')}`;
}

function violationSignature(endpoint: string, issue: SchemaDiffIssue): string {
  return `${endpoint}|${issue.severity}|${issue.code}|${issue.path}|${issue.message}`;
}

export function createDriftProxyApp() {
  const cfg = loadConfig();
  const app = new Hono();

  app.all('*', async (c) => {
    const method = c.req.method;
    const requestUrl = c.req.url;
    const parsedUrl = new URL(requestUrl, 'http://driftguard.internal');
    const rawKey = endpointKey(method, requestUrl);
    const contextKey = withContextKey(rawKey, [
      cfg.authContextEnabled ? authContextKey(c.req.raw.headers) : undefined,
      variantContextKey(parsedUrl, cfg.variantParams),
    ]);
    const key = contextKey;
    const endpointLabel = buildEndpointLabel(method, requestUrl);

    const targetUrl = forwardUrl(cfg.target, requestUrl);
    const upstreamHeaders = new Headers(c.req.raw.headers);
    upstreamHeaders.delete('host');
    upstreamHeaders.delete('connection');

    const upstream = await fetch(
      targetUrl,
      {
        method,
        headers: upstreamHeaders,
        redirect: 'manual',
        ...(method !== 'GET' && method !== 'HEAD'
          ? { body: c.req.raw.body, duplex: 'half' as const }
          : {}),
      } as RequestInit,
    );
    const contentType = upstream.headers.get('content-type') ?? '';
    const status = upstream.status;
    const bodyText = await upstream.text();

    const outHeaders = new Headers(upstream.headers);
    const baseMeta = {
      mode: cfg.mode,
      endpointLabel,
      violationCount: 0,
      breakingCount: 0,
      breakingPaths: [] as string[],
    };
    applyDriftHeaders(outHeaders, baseMeta);

    const passThrough = (): Response =>
      new Response(bodyText, { status, headers: outHeaders });

    if (!looksLikeJsonResponse(contentType) || !isJsonSuccessStatus(status)) {
      return passThrough();
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      return passThrough();
    }

    const liveNode = inferSchema(body);
    const existingLive = loadLiveSchema(key, cfg.liveSchemasDir);
    const mergedLive = existingLive
      ? mergeSchemaNodes(existingLive.schema, liveNode)
      : liveNode;
    const liveSampleCount = (existingLive?.sampleCount ?? 0) + 1;
    saveLiveSchema(
      key,
      {
        endpoint: endpointLabel,
        seenAt: new Date().toISOString(),
        sampleCount: liveSampleCount,
        schema: mergedLive,
      },
      cfg.liveSchemasDir,
    );
    const pinned = loadPinnedSchema(key, cfg.schemasDir);
    let issues: SchemaDiffIssue[] = [];

    if (!pinned) {
      if (cfg.mode !== 'ci') {
        if (liveSampleCount >= cfg.pinAfterSamples) {
          savePinnedSchema(
            key,
            {
              endpoint: endpointLabel,
              sampleCount: liveSampleCount,
              pinnedAt: new Date().toISOString(),
              schema: mergedLive,
            },
            cfg.schemasDir,
          );
        } else if (cfg.verbose) {
          console.log(
            `[drift] Waiting to pin ${key}: ${liveSampleCount}/${cfg.pinAfterSamples} samples`,
          );
        }
      }
    } else {
      if (cfg.mode !== 'ci') {
        const nextSamples = pinned.sampleCount + 1;
        const merged = mergeSchemaNodes(pinned.schema, liveNode);
        savePinnedSchema(
          key,
          {
            ...pinned,
            schema: merged,
            sampleCount: nextSamples,
          },
          cfg.schemasDir,
        );
      }

      if (cfg.mode !== 'learn') {
        const { issues: diffIssues } = diffSchemas(pinned.schema, liveNode);
        issues = [...diffIssues];
        for (const issue of issues) {
          const signature = violationSignature(key, issue);
          if (emittedViolationSignatures.has(signature)) {
            continue;
          }
          emittedViolationSignatures.add(signature);
          appendViolation({ endpoint: key, ...issue }, cfg.violationsLogPath);
        }

        const breaking = issues.filter((i) => i.severity === 'BREAKING');
        if (breaking.length > 0) {
          const freshBreaking = breaking.filter((issue) => {
            const signature = violationSignature(key, issue);
            if (emittedBreakingLogSignatures.has(signature)) return false;
            emittedBreakingLogSignatures.add(signature);
            return true;
          });
          if (freshBreaking.length > 0) {
            console.error(`\n[drift] BREAKING violations on ${endpointLabel}:`);
            freshBreaking.forEach((i) => console.error(`  ✗  ${i.path}: ${i.message}`));
          }
        }
        if (cfg.verbose) {
          const warns = issues.filter((i) => i.severity === 'WARN');
          if (warns.length > 0) {
            console.warn(`\n[drift] WARN on ${endpointLabel}:`);
            warns.forEach((i) => console.warn(`  ~  ${i.path}: ${i.message}`));
          }
        }
      }
    }

    const breaking = issues.filter((i) => i.severity === 'BREAKING');
    applyDriftHeaders(outHeaders, {
      mode: cfg.mode,
      endpointLabel,
      violationCount: issues.length,
      breakingCount: breaking.length,
      breakingPaths: breaking.map((i) => i.path),
    });

    return new Response(bodyText, { status, headers: outHeaders });
  });

  return app;
}

export function startDriftProxy(): void {
  const cfg = loadConfig();
  const app = createDriftProxyApp();
  serve({ fetch: app.fetch, port: cfg.port }, (info) => {
    console.log(
      `[drift] DriftGuard at http://localhost:${info.port} → ${cfg.target} (mode: ${cfg.mode})`,
    );
  });
}

const isEntry =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntry) {
  startDriftProxy();
}
