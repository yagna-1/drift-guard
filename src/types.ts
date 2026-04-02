/**
 * DriftGuard core schema representation and diff taxonomy.
 */

export type PrimitiveKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'bigint'
  | 'null'
  | 'undefined'
  | 'symbol'
  /** Depth/cycle guard when inference cannot proceed */
  | 'unknown';

/** Severity for consumer-impact classification */
export type DiffSeverity = 'BREAKING' | 'WARN' | 'INFO';

export interface PrimitiveSchema {
  readonly kind: 'primitive';
  /** Distinct primitive kinds observed; deduped */
  readonly primitives: readonly PrimitiveKind[];
  /** Total observations of this value position */
  readonly sampleCount: number;
  /** Observations where value was not null and not undefined */
  readonly nonNullishCount: number;
}

export interface FieldSchema {
  readonly key: string;
  readonly value: SchemaNode;
  /** Times the parent object was sampled */
  readonly parentSampleCount: number;
  /** Times this key was present on the parent */
  readonly presentCount: number;
  /** When present, how often the value was null or undefined */
  readonly nullishWhenPresentCount: number;
}

export interface ObjectSchema {
  readonly kind: 'object';
  readonly sampleCount: number;
  readonly properties: Readonly<Record<string, FieldSchema>>;
}

export interface ArraySchema {
  readonly kind: 'array';
  /** How many array values were observed at this position */
  readonly arraySampleCount: number;
  /** Sum of lengths of those arrays */
  readonly elementObservations: number;
  readonly element: SchemaNode;
}

/**
 * Simple union: at most one primitive cluster, one object shape, one array shape.
 * Variants of the same category are merged (primitives accumulate kinds; object/array merge recursively).
 */
export interface UnionSchema {
  readonly kind: 'union';
  readonly sampleCount: number;
  readonly primitive?: PrimitiveSchema;
  readonly object?: ObjectSchema;
  readonly array?: ArraySchema;
}

export type SchemaNode = PrimitiveSchema | ObjectSchema | ArraySchema | UnionSchema;

export interface SchemaRenameCandidate {
  /** JSON Pointer prefix for the parent object (e.g. `/user`) */
  readonly pathPrefix: string;
  readonly fromKey: string;
  readonly toKey: string;
  readonly confidence: number;
  readonly baselineField: FieldSchema;
  readonly currentField: FieldSchema;
}

export interface SchemaDiffIssue {
  readonly severity: DiffSeverity;
  /** JSON Pointer–style path (e.g. /a/0/b) */
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly confidence?: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SchemaDiffResult {
  readonly issues: readonly SchemaDiffIssue[];
  readonly renameCandidates: readonly SchemaRenameCandidate[];
}

export function isFieldRequired(field: FieldSchema): boolean {
  return (
    field.parentSampleCount > 0 &&
    field.presentCount === field.parentSampleCount
  );
}

export function isFieldNullable(field: FieldSchema): boolean {
  return field.nullishWhenPresentCount > 0;
}
