/**
 * Schema diff, severity classification, and rename heuristics.
 */

import type {
  ArraySchema,
  FieldSchema,
  ObjectSchema,
  PrimitiveKind,
  PrimitiveSchema,
  SchemaDiffIssue,
  SchemaDiffResult,
  SchemaNode,
  SchemaRenameCandidate,
  UnionSchema,
} from './types.js';
import { isFieldRequired } from './types.js';

function jsonPointerSegment(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

function joinPath(base: string, segment: string): string {
  return `${base}/${jsonPointerSegment(segment)}`;
}

function toUnionShape(node: SchemaNode): UnionSchema {
  switch (node.kind) {
    case 'primitive':
      return {
        kind: 'union',
        sampleCount: node.sampleCount,
        primitive: node,
      };
    case 'object':
      return {
        kind: 'union',
        sampleCount: node.sampleCount,
        object: node,
      };
    case 'array':
      return {
        kind: 'union',
        sampleCount: node.arraySampleCount,
        array: node,
      };
    case 'union':
      return node;
  }
}

function primitiveSetEqual(
  a: readonly PrimitiveKind[],
  b: readonly PrimitiveKind[],
): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((k) => sa.has(k));
}

/**
 * Whether two schemas match structurally (ignores sample/presence counts).
 */
export function schemasStructurallyEqual(a: SchemaNode, b: SchemaNode): boolean {
  const ua = a.kind === 'union' ? a : toUnionShape(a);
  const ub = b.kind === 'union' ? b : toUnionShape(b);
  return unionStructurallyEqual(ua, ub);
}

function unionStructurallyEqual(a: UnionSchema, b: UnionSchema): boolean {
  const ap = a.primitive;
  const bp = b.primitive;
  if (!!ap !== !!bp) return false;
  if (ap && bp && !primitiveSetEqual(ap.primitives, bp.primitives)) return false;

  const ao = a.object;
  const bo = b.object;
  if (!!ao !== !!bo) return false;
  if (ao && bo && !objectStructurallyEqual(ao, bo)) return false;

  const aa = a.array;
  const ba = b.array;
  if (!!aa !== !!ba) return false;
  if (aa && ba && !schemasStructurallyEqual(aa.element, ba.element)) return false;

  return true;
}

function objectStructurallyEqual(a: ObjectSchema, b: ObjectSchema): boolean {
  const keysA = Object.keys(a.properties).sort();
  const keysB = Object.keys(b.properties).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (
      !schemasStructurallyEqual(
        a.properties[keysA[i]].value,
        b.properties[keysB[i]].value,
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Heuristic: baseline required keys that vanished vs new keys in current with the same structural type.
 */
export function detectLikelyRenames(
  baseline: ObjectSchema,
  current: ObjectSchema,
  pathPrefix = '',
): readonly SchemaRenameCandidate[] {
  const lost: string[] = [];
  for (const key of Object.keys(baseline.properties)) {
    const f = baseline.properties[key];
    if (!isFieldRequired(f)) continue;
    if (current.properties[key] !== undefined) continue;
    lost.push(key);
  }

  const added: string[] = [];
  for (const key of Object.keys(current.properties)) {
    if (baseline.properties[key] !== undefined) continue;
    added.push(key);
  }

  const candidates: SchemaRenameCandidate[] = [];
  const usedAdded = new Set<string>();

  for (const fromKey of lost) {
    const bf = baseline.properties[fromKey];
    let best: { key: string; field: FieldSchema } | undefined;
    for (const toKey of added) {
      if (usedAdded.has(toKey)) continue;
      const cf = current.properties[toKey];
      if (!schemasStructurallyEqual(bf.value, cf.value)) continue;
      if (
        !best ||
        cf.presentCount > best.field.presentCount ||
        (cf.presentCount === best.field.presentCount &&
          toKey.localeCompare(best.key) < 0)
      ) {
        best = { key: toKey, field: cf };
      }
    }
    if (best) {
      usedAdded.add(best.key);
      candidates.push({
        pathPrefix,
        fromKey,
        toKey: best.key,
        confidence: renameConfidence(fromKey, best.key, bf, best.field),
        baselineField: bf,
        currentField: best.field,
      });
    }
  }

  return candidates;
}

function bigramSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const grams = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i += 1) {
    const gram = s1.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < s2.length - 1; i += 1) {
    const gram = s2.slice(i, i + 2);
    const count = grams.get(gram) ?? 0;
    if (count > 0) {
      grams.set(gram, count - 1);
      overlap += 1;
    }
  }
  const total = (s1.length - 1) + (s2.length - 1);
  return total === 0 ? 0 : (2 * overlap) / total;
}

function renameConfidence(
  fromKey: string,
  toKey: string,
  baselineField: FieldSchema,
  currentField: FieldSchema,
): number {
  const keySimilarity = bigramSimilarity(fromKey, toKey);
  const baselinePresence = baselineField.parentSampleCount > 0
    ? baselineField.presentCount / baselineField.parentSampleCount
    : 0;
  const currentPresence = currentField.parentSampleCount > 0
    ? currentField.presentCount / currentField.parentSampleCount
    : 0;
  const presenceProximity = 1 - Math.min(1, Math.abs(baselinePresence - currentPresence));
  const score = (keySimilarity * 0.4) + (presenceProximity * 0.6);
  return Math.max(0.1, Math.min(0.99, Number(score.toFixed(2))));
}

function push(
  issues: SchemaDiffIssue[],
  severity: SchemaDiffIssue['severity'],
  path: string,
  code: string,
  message: string,
  confidence?: number,
  details?: Readonly<Record<string, unknown>>,
): void {
  issues.push({ severity, path, code, message, confidence, details });
}

function diffPrimitives(
  base: PrimitiveSchema,
  cur: PrimitiveSchema,
  path: string,
  issues: SchemaDiffIssue[],
): void {
  const b = new Set(base.primitives);
  const c = new Set(cur.primitives);
  let narrowed = false;
  for (const k of base.primitives) {
    if (!c.has(k)) {
      narrowed = true;
      break;
    }
  }
  let widened = false;
  for (const k of cur.primitives) {
    if (!b.has(k)) {
      widened = true;
      break;
    }
  }
  if (primitiveSetEqual(base.primitives, cur.primitives)) return;
  if (narrowed) {
    push(
      issues,
      'BREAKING',
      path,
      'primitive.narrowed',
      `Primitive kinds narrowed from [${[...b].sort().join(', ')}] to [${[...c].sort().join(', ')}]`,
    );
  } else if (widened) {
    push(
      issues,
      'WARN',
      path,
      'primitive.widened',
      `Primitive kinds widened from [${[...b].sort().join(', ')}] to [${[...c].sort().join(', ')}]`,
    );
  }
}

function categoryOf(node: SchemaNode): 'primitive' | 'object' | 'array' | 'union' {
  if (node.kind === 'union') {
    const branches =
      (node.primitive ? 1 : 0) +
      (node.object ? 1 : 0) +
      (node.array ? 1 : 0);
    return branches > 1 ? 'union' : node.primitive
      ? 'primitive'
      : node.object
        ? 'object'
        : 'array';
  }
  return node.kind;
}

function diffUnionBranches(
  base: UnionSchema,
  cur: UnionSchema,
  path: string,
  issues: SchemaDiffIssue[],
  renameAccumulator: SchemaRenameCandidate[],
): void {
  const bp = base.primitive;
  const cp = cur.primitive;
  if (bp && !cp) {
    push(
      issues,
      'BREAKING',
      path,
      'union.primitive.removed',
      'Primitive branch removed from union',
    );
  } else if (bp && cp) {
    diffPrimitives(bp, cp, path, issues);
  } else if (!bp && cp) {
    push(
      issues,
      'WARN',
      path,
      'union.primitive.added',
      'New primitive branch added to union',
    );
  }

  const bo = base.object;
  const co = cur.object;
  if (bo && !co) {
    push(
      issues,
      'BREAKING',
      path,
      'union.object.removed',
      'Object branch removed from union',
    );
  } else if (bo && co) {
    diffObjects(bo, co, path, issues, renameAccumulator);
  } else if (!bo && co) {
    push(
      issues,
      'INFO',
      path,
      'union.object.added',
      'New object branch added to union',
    );
  }

  const ba = base.array;
  const ca = cur.array;
  if (ba && !ca) {
    push(
      issues,
      'BREAKING',
      path,
      'union.array.removed',
      'Array branch removed from union',
    );
  } else if (ba && ca) {
    diffArrays(ba, ca, path, issues, renameAccumulator);
  } else if (!ba && ca) {
    push(
      issues,
      'INFO',
      path,
      'union.array.added',
      'New array branch added to union',
    );
  }
}

function diffArrays(
  base: ArraySchema,
  cur: ArraySchema,
  path: string,
  issues: SchemaDiffIssue[],
  renameAccumulator: SchemaRenameCandidate[],
): void {
  const elPath = joinPath(path, '0');
  diffNodes(
    base.element,
    cur.element,
    elPath,
    issues,
    renameAccumulator,
  );
  if (cur.elementObservations === 0 && base.elementObservations > 0) {
    push(
      issues,
      'WARN',
      path,
      'array.empty',
      'Array element observations dropped to zero in newer schema',
    );
  }
}

function diffObjects(
  base: ObjectSchema,
  cur: ObjectSchema,
  path: string,
  issues: SchemaDiffIssue[],
  renameAccumulator: SchemaRenameCandidate[],
): void {
  const localRenames = detectLikelyRenames(base, cur, path);
  renameAccumulator.push(...localRenames);

  for (const r of localRenames) {
    push(
      issues,
      'WARN',
      path,
      'object.field.rename.candidate',
      `Possible rename: "${r.fromKey}" -> "${r.toKey}"`,
      r.confidence,
      { from: r.fromKey, to: r.toKey },
    );
  }

  for (const key of Object.keys(base.properties)) {
    const bf = base.properties[key];
    const cf = cur.properties[key];
    const kp = joinPath(path, key);
    if (!cf) {
      if (isFieldRequired(bf)) {
        push(
          issues,
          'BREAKING',
          kp,
          'object.field.removed.required',
          `Required field "${key}" removed`,
        );
      } else {
        push(
          issues,
          'WARN',
          kp,
          'object.field.removed.optional',
          `Optional field "${key}" no longer observed`,
        );
      }
      continue;
    }
    if (isFieldRequired(bf) && !isFieldRequired(cf)) {
      push(
        issues,
        'WARN',
        kp,
        'object.field.required.weakened',
        `Field "${key}" is no longer always present`,
      );
    }
    if (!isFieldRequired(bf) && isFieldRequired(cf)) {
      push(
        issues,
        'INFO',
        kp,
        'object.field.required.strengthened',
        `Field "${key}" is now always present`,
      );
    }
    const wasNullFree =
      bf.nullishWhenPresentCount === 0 && bf.presentCount > 0;
    const nowNullable = cf.nullishWhenPresentCount > 0;
    if (wasNullFree && nowNullable) {
      push(
        issues,
        'WARN',
        kp,
        'object.field.nullable.added',
        `Field "${key}" may now be null or undefined when present`,
      );
    }
    diffNodes(bf.value, cf.value, kp, issues, renameAccumulator);
  }

  for (const key of Object.keys(cur.properties)) {
    if (base.properties[key] !== undefined) continue;
    const kp = joinPath(path, key);
    push(
      issues,
      'INFO',
      kp,
      'object.field.added',
      `New field "${key}" observed`,
    );
  }
}

function diffNodes(
  baseline: SchemaNode,
  current: SchemaNode,
  path: string,
  issues: SchemaDiffIssue[],
  renameAccumulator: SchemaRenameCandidate[],
): void {
  const bu = baseline.kind === 'union' ? baseline : toUnionShape(baseline);
  const cu = current.kind === 'union' ? current : toUnionShape(current);

  const bCat = categoryOf(baseline);
  const cCat = categoryOf(current);

  if (bCat !== cCat && baseline.kind !== 'union' && current.kind !== 'union') {
    push(
      issues,
      'BREAKING',
      path,
      'kind.changed',
      `Type kind changed from ${bCat} to ${cCat}`,
    );
    return;
  }

  if (baseline.kind === 'union' || current.kind === 'union') {
    diffUnionBranches(bu, cu, path, issues, renameAccumulator);
    return;
  }

  switch (baseline.kind) {
    case 'primitive': {
      const c = current as PrimitiveSchema;
      diffPrimitives(baseline, c, path, issues);
      return;
    }
    case 'array': {
      diffArrays(baseline, current as ArraySchema, path, issues, renameAccumulator);
      return;
    }
    case 'object': {
      diffObjects(
        baseline,
        current as ObjectSchema,
        path,
        issues,
        renameAccumulator,
      );
      return;
    }
    default:
      return;
  }
}

/**
 * Full structural diff between two inferred schemas.
 */
export function diffSchemas(
  baseline: SchemaNode,
  current: SchemaNode,
): SchemaDiffResult {
  const issues: SchemaDiffIssue[] = [];
  const renameCandidates: SchemaRenameCandidate[] = [];
  diffNodes(baseline, current, '', issues, renameCandidates);
  return { issues, renameCandidates };
}
