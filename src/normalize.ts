/**
 * Canonical JSON normalization for stable inference and comparison.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively normalize a value: plain objects get sorted keys; `undefined` is dropped
 * from object values; arrays are mapped recursively. Non-JSON types are returned as-is
 * (caller may still infer symbol/bigint via typeof).
 */
export function normalizeValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value;
  if (typeof value === 'symbol') return value;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const v = value[k];
      if (v === undefined) continue;
      out[k] = normalizeValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Returns a stable JSON string for hashing/comparison when the value is JSON-safe.
 * Throws if `JSON.stringify` rejects a value (e.g. circular). For general drift use,
 * prefer `normalizeValue` first.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}
