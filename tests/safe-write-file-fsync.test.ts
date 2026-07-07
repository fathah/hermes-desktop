import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("safe write durability contract", () => {
  it("fsyncs temp files and parent directories for sync and async writes", () => {
    const source = readFileSync(
      join(process.cwd(), "src/main/utils.ts"),
      "utf-8",
    );

    expect(source).toContain("fsyncPathSync(tempPath)");
    expect(source).toContain("fsyncDirectorySync(dir)");
    expect(source).toContain("await fsyncPath(tempPath)");
    expect(source).toContain("await fsyncDirectory(dir)");
  });
});
