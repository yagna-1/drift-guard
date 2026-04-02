/**
 * Recursive schema inference and cross-sample merge.
 */

import type {
  ArraySchema,
  FieldSchema,
  ObjectSchema,
  PrimitiveKind,
  PrimitiveSchema,
  SchemaNode,
  UnionSchema,
} from './types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function dedupePrimitives(kinds: readonly PrimitiveKind[]): PrimitiveKind[] {
  return [...new Set(kinds)].sort();
}

function primitiveKindOf(value: unknown): PrimitiveKind {
  if (value === null) return 'null';
  const t = typeof value;
  switch (t) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'bigint':
      return 'bigint';
    case 'undefined':
      return 'undefined';
    case 'symbol':
      return 'symbol';
    default:
      return 'unknown';
  }
}

function makePrimitive(
  kinds: readonly PrimitiveKind[],
  sampleCount: number,
  nonNullishCount: number,
): PrimitiveSchema {
  return {
    kind: 'primitive',
    primitives: dedupePrimitives(kinds),
    sampleCount,
    nonNullishCount,
  };
}

function mergePrimitiveNodes(a: PrimitiveSchema, b: PrimitiveSchema): PrimitiveSchema {
  return makePrimitive(
    [...a.primitives, ...b.primitives],
    a.sampleCount + b.sampleCount,
    a.nonNullishCount + b.nonNullishCount,
  );
}

function mergeFieldSchemas(
  key: string,
  fa: FieldSchema | undefined,
  fb: FieldSchema | undefined,
  parentSamplesA: number,
  parentSamplesB: number,
): FieldSchema {
  if (fa && fb) {
    return {
      key,
      value: mergeSchemaNodes(fa.value, fb.value),
      parentSampleCount: fa.parentSampleCount + fb.parentSampleCount,
      presentCount: fa.presentCount + fb.presentCount,
      nullishWhenPresentCount:
        fa.nullishWhenPresentCount + fb.nullishWhenPresentCount,
    };
  }
  if (fa && !fb) {
    return {
      key,
      value: fa.value,
      parentSampleCount: fa.parentSampleCount + parentSamplesB,
      presentCount: fa.presentCount,
      nullishWhenPresentCount: fa.nullishWhenPresentCount,
    };
  }
  if (!fa && fb) {
    return {
      key,
      value: fb.value,
      parentSampleCount: fb.parentSampleCount + parentSamplesA,
      presentCount: fb.presentCount,
      nullishWhenPresentCount: fb.nullishWhenPresentCount,
    };
  }
  throw new Error(`mergeFieldSchemas: missing both sides for key ${key}`);
}

function mergeObjectNodes(a: ObjectSchema, b: ObjectSchema): ObjectSchema {
  const sampleCount = a.sampleCount + b.sampleCount;
  const keys = new Set([
    ...Object.keys(a.properties),
    ...Object.keys(b.properties),
  ]);
  const properties: Record<string, FieldSchema> = {};
  for (const key of keys) {
    properties[key] = mergeFieldSchemas(
      key,
      a.properties[key],
      b.properties[key],
      a.sampleCount,
      b.sampleCount,
    );
  }
  return { kind: 'object', sampleCount, properties };
}

function mergeArrayNodes(a: ArraySchema, b: ArraySchema): ArraySchema {
  return {
    kind: 'array',
    arraySampleCount: a.arraySampleCount + b.arraySampleCount,
    elementObservations: a.elementObservations + b.elementObservations,
    element: mergeSchemaNodes(a.element, b.element),
  };
}

function sampleWeight(n: SchemaNode): number {
  switch (n.kind) {
    case 'primitive':
      return n.sampleCount;
    case 'object':
      return n.sampleCount;
    case 'array':
      return n.arraySampleCount;
    case 'union':
      return n.sampleCount;
  }
}

function wrapAsUnion(node: SchemaNode): UnionSchema {
  const w = sampleWeight(node);
  switch (node.kind) {
    case 'primitive':
      return { kind: 'union', sampleCount: w, primitive: node };
    case 'object':
      return { kind: 'union', sampleCount: w, object: node };
    case 'array':
      return { kind: 'union', sampleCount: w, array: node };
    case 'union':
      return node;
  }
}

function mergeUnionNodes(a: UnionSchema, b: UnionSchema): UnionSchema {
  const count = a.sampleCount + b.sampleCount;
  let primitive = a.primitive;
  if (b.primitive) {
    primitive = primitive
      ? mergePrimitiveNodes(primitive, b.primitive)
      : b.primitive;
  }
  let object = a.object;
  if (b.object) {
    object = object ? mergeObjectNodes(object, b.object) : b.object;
  }
  let array = a.array;
  if (b.array) {
    array = array ? mergeArrayNodes(array, b.array) : b.array;
  }
  return {
    kind: 'union',
    sampleCount: count,
    ...(primitive ? { primitive } : {}),
    ...(object ? { object } : {}),
    ...(array ? { array } : {}),
  };
}

/**
 * Merge two inferred schemas (e.g. two samples or batches).
 */
export function mergeSchemaNodes(a: SchemaNode, b: SchemaNode): SchemaNode {
  if (a.kind === 'primitive' && b.kind === 'primitive') {
    return mergePrimitiveNodes(a, b);
  }
  if (a.kind === 'object' && b.kind === 'object') {
    return mergeObjectNodes(a, b);
  }
  if (a.kind === 'array' && b.kind === 'array') {
    return mergeArrayNodes(a, b);
  }
  if (a.kind === 'union' && b.kind === 'union') {
    return mergeUnionNodes(a, b);
  }

  return mergeUnionNodes(
    a.kind === 'union' ? a : wrapAsUnion(a),
    b.kind === 'union' ? b : wrapAsUnion(b),
  );
}

function inferPrimitive(value: unknown): PrimitiveSchema {
  const k = primitiveKindOf(value);
  const nonNullish = value !== null && value !== undefined ? 1 : 0;
  return makePrimitive([k], 1, nonNullish);
}

function inferValue(
  value: unknown,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): SchemaNode {
  if (depth > maxDepth) {
    return makePrimitive(['unknown'], 1, 0);
  }

  if (value === null) {
    return makePrimitive(['null'], 1, 0);
  }
  if (value === undefined) {
    return makePrimitive(['undefined'], 1, 0);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return makePrimitive(['unknown'], 1, 0);
    }
    seen.add(value);
    let element: SchemaNode | undefined;
    for (const item of value) {
      const part = inferValue(item, depth + 1, maxDepth, seen);
      element = element ? mergeSchemaNodes(element, part) : part;
    }
    return {
      kind: 'array',
      arraySampleCount: 1,
      elementObservations: value.length,
      element: element ?? makePrimitive([], 0, 0),
    };
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return makePrimitive(['unknown'], 1, 0);
    }
    seen.add(value);
    const properties: Record<string, FieldSchema> = {};
    for (const key of Object.keys(value)) {
      const v = value[key];
      const child = inferValue(v, depth + 1, maxDepth, seen);
      const nullish = v === null || v === undefined;
      properties[key] = {
        key,
        value: child,
        parentSampleCount: 1,
        presentCount: 1,
        nullishWhenPresentCount: nullish ? 1 : 0,
      };
    }
    return { kind: 'object', sampleCount: 1, properties };
  }

  return inferPrimitive(value);
}

export interface InferSchemaOptions {
  readonly maxDepth?: number;
}

/**
 * Infer a schema from one JSON-compatible value (recursive).
 */
export function inferSchema(
  value: unknown,
  options?: InferSchemaOptions,
): SchemaNode {
  const maxDepth = options?.maxDepth ?? 64;
  return inferValue(value, 0, maxDepth, new WeakSet());
}

/**
 * Fold multiple samples into one schema.
 */
export function inferSchemaFromSamples(
  samples: readonly unknown[],
  options?: InferSchemaOptions,
): SchemaNode | undefined {
  let acc: SchemaNode | undefined;
  for (const s of samples) {
    const one = inferSchema(s, options);
    acc = acc ? mergeSchemaNodes(acc, one) : one;
  }
  return acc;
}
