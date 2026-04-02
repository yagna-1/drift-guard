import { describe, expect, it } from "vitest";
import {
  inferSchema,
  inferSchemaFromSamples,
  mergeSchemaNodes,
} from "../src/infer.js";
import {
  isFieldNullable,
  isFieldRequired,
  type ObjectSchema,
  type PrimitiveSchema,
  type SchemaNode,
} from "../src/types.js";

function assertObject(node: SchemaNode): ObjectSchema {
  expect(node.kind).toBe("object");
  return node as ObjectSchema;
}

function assertPrimitive(node: SchemaNode): PrimitiveSchema {
  expect(node.kind).toBe("primitive");
  return node as PrimitiveSchema;
}

describe("inferSchema", () => {
  it("infers string, number, and boolean primitives", () => {
    expect(assertPrimitive(inferSchema("hi")).primitives).toEqual(["string"]);
    expect(assertPrimitive(inferSchema(3)).primitives).toEqual(["number"]);
    expect(assertPrimitive(inferSchema(false)).primitives).toEqual(["boolean"]);
  });

  it("records null as a distinct primitive kind", () => {
    const p = assertPrimitive(inferSchema(null));
    expect(p.primitives).toContain("null");
    expect(p.nonNullishCount).toBe(0);
  });

  it("infers object properties and marks fields present on that sample", () => {
    const obj = assertObject(inferSchema({ id: 1, name: "a" }));
    const idField = obj.properties.id;
    expect(isFieldRequired(idField)).toBe(true);
    expect(isFieldNullable(idField)).toBe(false);
    expect(assertPrimitive(idField.value).primitives).toEqual(["number"]);
  });

  it("infers arrays and merges element shapes across items", () => {
    const node = inferSchema([1, 2, 3]);
    expect(node.kind).toBe("array");
    if (node.kind === "array") {
      expect(assertPrimitive(node.element).primitives).toEqual(["number"]);
      expect(node.arraySampleCount).toBe(1);
    }
  });
});

describe("mergeSchemaNodes + samples", () => {
  it("keeps a field required only when it appears in every merged sample", () => {
    const merged = inferSchemaFromSamples([{ a: 1 }, { a: 2 }]);
    const obj = assertObject(merged!);
    expect(isFieldRequired(obj.properties.a)).toBe(true);
  });

  it("marks a field optional when it is absent in any sample", () => {
    const merged = inferSchemaFromSamples([{ a: "x" }, {}]);
    const obj = assertObject(merged!);
    expect(isFieldRequired(obj.properties.a)).toBe(false);
  });

  it("treats a key that only appears in a later sample as optional overall", () => {
    const merged = inferSchemaFromSamples([{ a: 1 }, { a: 1, b: 2 }]);
    const obj = assertObject(merged!);
    expect(isFieldRequired(obj.properties.a)).toBe(true);
    expect(isFieldRequired(obj.properties.b)).toBe(false);
  });

  it("merges conflicting primitives into one primitive cluster with both kinds", () => {
    const a = inferSchema("x");
    const b = inferSchema(1);
    const m = mergeSchemaNodes(a, b);
    expect(m.kind).toBe("primitive");
    expect([...assertPrimitive(m).primitives].sort()).toEqual(["number", "string"]);
  });

  it("marks nullable when null appears as a value for a key", () => {
    const merged = inferSchemaFromSamples([{ v: "ok" }, { v: null }]);
    const obj = assertObject(merged!);
    expect(isFieldNullable(obj.properties.v)).toBe(true);
  });
});
