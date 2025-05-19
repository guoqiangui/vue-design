import { describe, it, expect } from "@jest/globals";
import { traverse } from "./reactive";

// src/reactive.test.ts
// Import traverse directly from the source file
// If traverse is not exported, you need to export it in reactive.ts

describe("traverse", () => {
  it("should not infinitely recurse on circular references", () => {
    const obj: any = { foo: 1 };
    obj.self = obj; // create circular reference

    // Should not throw or hang
    expect(() => traverse(obj)).not.toThrow();
  });

  it("should visit each object only once", () => {
    const objA: any = { foo: 1 };
    const objB: any = { bar: 2, ref: objA };
    objA.ref = objB; // create circular reference

    const seen = new Set<object>();
    traverse(objA, seen);

    // Both objects should be in seen
    expect(seen.has(objA)).toBe(true);
    expect(seen.has(objB)).toBe(true);
    // No infinite recursion
    expect(seen.size).toBe(2);
  });

  it("should handle null and primitive values gracefully", () => {
    expect(traverse(null)).toBeUndefined();
    expect(traverse(42)).toBeUndefined();
    expect(traverse("test")).toBeUndefined();
  });
});