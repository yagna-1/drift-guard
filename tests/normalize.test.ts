import { describe, expect, it } from "vitest";
import { normalizeValue, stableStringify } from "../src/normalize.js";
import { endpointKey } from "../src/store.js";

describe("normalizeValue", () => {
  it("sorts object keys for stable structure", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(normalizeValue(a)).toEqual(normalizeValue(b));
    expect(Object.keys(normalizeValue(a) as object)).toEqual(["a", "m", "z"]);
  });

  it("drops undefined object entries", () => {
    expect(normalizeValue({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it("preserves null and primitives", () => {
    expect(normalizeValue(null)).toBe(null);
    expect(normalizeValue("x")).toBe("x");
    expect(normalizeValue(0)).toBe(0);
    expect(normalizeValue(false)).toBe(false);
  });

  it("normalizes arrays recursively", () => {
    expect(normalizeValue([{ b: 1, a: 2 }])).toEqual([{ a: 2, b: 1 }]);
  });
});

describe("stableStringify", () => {
  it("matches after key reorder", () => {
    expect(stableStringify({ x: 1, y: [{ b: 2, a: 1 }] })).toBe(
      stableStringify({ y: [{ a: 1, b: 2 }], x: 1 }),
    );
  });
});

describe("endpoint path normalization (via endpointKey)", () => {
  it("maps numeric segments to {id} in keys", () => {
    expect(endpointKey("GET", "http://h/api/users/42")).toBe(
      "GET_api_users_{id}",
    );
  });

  it("maps UUID-shaped segments to {uuid}", () => {
    const u = "550e8400-e29b-41d4-a716-446655440000";
    expect(endpointKey("GET", `http://h/x/${u}/end`)).toBe("GET_x_{uuid}_end");
  });

  it("maps slug-like segments (e.g. ORD-1234) to {slug}", () => {
    expect(endpointKey("GET", "http://h/orders/ORD-1234")).toBe(
      "GET_orders_{slug}",
    );
  });

  it("maps 24-char hex ObjectId-style segments to {objectId}", () => {
    const oid = "507f1f77bcf86cd799439011";
    expect(endpointKey("GET", `http://h/docs/${oid}`)).toBe("GET_docs_{objectId}");
  });

  it("leaves static path segments in the key", () => {
    expect(endpointKey("GET", "http://h/api/health")).toBe("GET_api_health");
  });
});
