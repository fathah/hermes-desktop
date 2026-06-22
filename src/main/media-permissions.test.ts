import { describe, expect, it } from "vitest";
import { isRendererMediaRequestAllowed } from "./media-permissions";

describe("isRendererMediaRequestAllowed", () => {
  it("allows audio-only media in trusted app renderers", () => {
    expect(
      isRendererMediaRequestAllowed({
        url: "file:///app/index.html",
        mediaTypes: ["audio"],
      }),
    ).toBe(true);
  });

  it("denies video in the normal app renderer", () => {
    expect(
      isRendererMediaRequestAllowed({
        url: "file:///app/index.html",
        mediaTypes: ["video"],
      }),
    ).toBe(false);
  });

  it("allows video only in the trusted Quick Capture window", () => {
    expect(
      isRendererMediaRequestAllowed({
        url: "file:///app/index.html?window=capture",
        mediaTypes: ["video"],
      }),
    ).toBe(true);
    expect(
      isRendererMediaRequestAllowed({
        url: "https://example.com/?window=capture",
        mediaTypes: ["video"],
      }),
    ).toBe(false);
  });
});
