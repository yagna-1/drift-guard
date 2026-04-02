import { describe, expect, it } from "vitest";
import { diffSchemas } from "../src/diff.js";
import { inferSchema, inferSchemaFromSamples } from "../src/infer.js";

function codes(issues: readonly { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

describe("diffSchemas (SchemaNode)", () => {
  it("BREAKING when a required baseline field disappears", () => {
    const baseline = inferSchema({ id: 1 });
    const current = inferSchema({});
    const { issues } = diffSchemas(baseline, current);
    expect(issues.some((i) => i.severity === "BREAKING" && i.path === "/id")).toBe(
      true,
    );
    expect(codes(issues)).toContain("object.field.removed.required");
  });

  it("WARN when an optional baseline field is no longer observed", () => {
    const baseline = inferSchemaFromSamples([{ extra: "x" }, {}])!;
    const current = inferSchema({});
    const { issues } = diffSchemas(baseline, current);
    expect(issues.some((i) => i.severity === "WARN" && i.path === "/extra")).toBe(
      true,
    );
    expect(codes(issues)).toContain("object.field.removed.optional");
  });

  it("BREAKING when primitive kinds narrow (e.g. string to number)", () => {
    const baseline = inferSchema({ n: "a" });
    const current = inferSchema({ n: 1 });
    const { issues } = diffSchemas(baseline, current);
    expect(
      issues.some(
        (i) =>
          i.severity === "BREAKING" &&
          i.path === "/n" &&
          i.code === "primitive.narrowed",
      ),
    ).toBe(true);
  });

  it("WARN when primitive kinds widen without removing baseline kinds", () => {
    const baseline = inferSchema({ n: "a" });
    const current = inferSchemaFromSamples([{ n: "a" }, { n: 1 }])!;
    const { issues } = diffSchemas(baseline, current);
    expect(
      issues.some(
        (i) =>
          i.severity === "WARN" &&
          i.path === "/n" &&
          i.code === "primitive.widened",
      ),
    ).toBe(true);
  });

  it("WARN when a field is no longer always present", () => {
    const baseline = inferSchemaFromSamples([{ a: 1 }, { a: 2 }])!;
    const current = inferSchemaFromSamples([{ a: 1 }, {}])!;
    const { issues } = diffSchemas(baseline, current);
    expect(
      issues.some(
        (i) =>
          i.severity === "WARN" &&
          i.path === "/a" &&
          i.code === "object.field.required.weakened",
      ),
    ).toBe(true);
  });

  it("WARN when a field gains null when present (nullable)", () => {
    const baseline = inferSchemaFromSamples([{ a: "ok" }, { a: "no" }])!;
    const current = inferSchemaFromSamples([{ a: "ok" }, { a: null }])!;
    const { issues } = diffSchemas(baseline, current);
    expect(
      issues.some(
        (i) =>
          i.severity === "WARN" &&
          i.path === "/a" &&
          i.code === "object.field.nullable.added",
      ),
    ).toBe(true);
  });

  it("INFO for newly observed top-level fields", () => {
    const baseline = inferSchema({ a: "x" });
    const current = inferSchema({ a: "x", b: 2 });
    const { issues } = diffSchemas(baseline, current);
    expect(
      issues.some(
        (i) =>
          i.severity === "INFO" &&
          i.path === "/b" &&
          i.code === "object.field.added",
      ),
    ).toBe(true);
  });

  it("BREAKING on nested primitive mismatch", () => {
    const baseline = inferSchema({ user: { id: 1 } });
    const current = inferSchema({ user: { id: "x" } });
    const { issues } = diffSchemas(baseline, current);
    expect(
      issues.some(
        (i) =>
          i.severity === "BREAKING" &&
          i.path === "/user/id" &&
          i.code === "primitive.narrowed",
      ),
    ).toBe(true);
  });

  it("INFO when an optional field becomes always present (non-breaking)", () => {
    const baseline = inferSchemaFromSamples([{ a: "x" }, {}])!;
    const current = inferSchemaFromSamples([{ a: "x" }, { a: "y" }])!;
    const { issues } = diffSchemas(baseline, current);
    expect(
      issues.some(
        (i) =>
          i.severity === "INFO" &&
          i.path === "/a" &&
          i.code === "object.field.required.strengthened",
      ),
    ).toBe(true);
    expect(issues.some((i) => i.severity === "BREAKING" && i.path === "/a")).toBe(
      false,
    );
  });

  it("emits first-class rename candidate with confidence", () => {
    const baseline = inferSchema({ user_name: "alice", email: "a@example.com" });
    const current = inferSchema({ username: "alice", email: "a@example.com" });
    const { issues, renameCandidates } = diffSchemas(baseline, current);
    const renameIssue = issues.find((i) => i.code === "object.field.rename.candidate");
    expect(renameIssue).toBeTruthy();
    expect(renameIssue?.severity).toBe("WARN");
    expect(typeof renameIssue?.confidence).toBe("number");
    expect((renameIssue?.confidence ?? 0) > 0).toBe(true);
    expect(renameCandidates.length).toBeGreaterThan(0);
    expect(renameCandidates[0].fromKey).toBe("user_name");
    expect(renameCandidates[0].toKey).toBe("username");
  });
});
