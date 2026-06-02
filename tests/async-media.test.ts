import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readMediaAsDataUrl } from "../src/main/media";

const TEST_DIR = join(tmpdir(), `hermes-async-media-test-${Date.now()}`);

describe("readMediaAsDataUrl (Async)", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("reads a local image asynchronously as a data URL", async () => {
    const filePath = join(TEST_DIR, "test.png");
    writeFileSync(filePath, "dummy-png-data");

    const promise = readMediaAsDataUrl(filePath);
    expect(promise).toBeInstanceOf(Promise);

    const dataUrl = await promise;
    expect(dataUrl).toBe("data:image/png;base64,ZHVtbXktcG5nLWRhdGE=");
  });

  it("returns null for non-image or unsupported extensions", async () => {
    const filePath = join(TEST_DIR, "test.txt");
    writeFileSync(filePath, "plain text");

    const dataUrl = await readMediaAsDataUrl(filePath);
    expect(dataUrl).toBeNull();
  });

  it("returns null for non-existent files", async () => {
    const filePath = join(TEST_DIR, "missing.png");
    const dataUrl = await readMediaAsDataUrl(filePath);
    expect(dataUrl).toBeNull();
  });
});
