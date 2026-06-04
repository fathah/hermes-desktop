import { describe, it, expect } from "vitest";
import { audioFilename, normalizeVoice } from "../src/main/voice";

describe("audioFilename (WS4)", () => {
  it("maps recorder MIME types to an extension OpenAI accepts", () => {
    expect(audioFilename("audio/webm;codecs=opus")).toBe("audio.webm");
    expect(audioFilename("audio/mp4")).toBe("audio.m4a");
    expect(audioFilename("audio/mpeg")).toBe("audio.mp3");
    expect(audioFilename("audio/wav")).toBe("audio.wav");
    expect(audioFilename("audio/ogg")).toBe("audio.ogg");
  });

  it("falls back to webm for unknown/empty MIME", () => {
    expect(audioFilename("")).toBe("audio.webm");
    expect(audioFilename("application/octet-stream")).toBe("audio.webm");
  });
});

describe("normalizeVoice (WS4)", () => {
  it("passes through supported voices", () => {
    expect(normalizeVoice("nova")).toBe("nova");
    expect(normalizeVoice("shimmer")).toBe("shimmer");
  });

  it("defaults unknown/empty voices to alloy", () => {
    expect(normalizeVoice(undefined)).toBe("alloy");
    expect(normalizeVoice("robot")).toBe("alloy");
  });
});
