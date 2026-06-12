import { describe, expect, it } from "vitest";

describe("jsdom canvas setup", () => {
  it("provides a no-op 2d canvas context for renderer tests", () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    expect(ctx).toBeTruthy();
    expect(ctx?.clearRect).toEqual(expect.any(Function));
    expect(ctx?.setLineDash).toEqual(expect.any(Function));
  });

  it("returns null for unsupported canvas context types", () => {
    const canvas = document.createElement("canvas");

    expect(canvas.getContext("webgl")).toBeNull();
  });
});
