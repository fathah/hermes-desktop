import { describe, expect, it } from "vitest";
import { StreamRedactor } from "../src/main/redactor";

describe("StreamRedactor", () => {
  const secretKey1 = "desk-1234-5678-abcd";
  const secretKey2 = "remote-token-secret-999";

  it("passes normal text through unchanged", () => {
    const redactor = new StreamRedactor([secretKey1, secretKey2]);
    expect(redactor.process("hello").chunkToEmit).toBe("hello");
    expect(redactor.flush()).toBe("");
  });

  it("emits the full text when process and flush are combined", () => {
    const redactor = new StreamRedactor([secretKey1, secretKey2]);
    const p = redactor.process("hello world").chunkToEmit;
    const f = redactor.flush();
    expect(p + f).toBe("hello world");
  });

  it("redacts complete secrets immediately when present in a single chunk", () => {
    const redactor = new StreamRedactor([secretKey1, secretKey2]);
    expect(redactor.process(`my key is ${secretKey1}`).chunkToEmit).toBe(
      "my key is [REDACTED]",
    );
    expect(redactor.flush()).toBe("");
  });

  it("buffers potential matches and redacts when split across chunks", () => {
    const redactor = new StreamRedactor([secretKey1]);

    // Send prefix "desk-"
    expect(redactor.process("key: desk-").chunkToEmit).toBe("key: ");

    // Send middle part "1234-56"
    expect(redactor.process("1234-56").chunkToEmit).toBe("");

    // Send rest "78-abcd"
    expect(redactor.process("78-abcd").chunkToEmit).toBe("[REDACTED]");

    // Send suffix
    expect(redactor.process("!").chunkToEmit).toBe("!");
    expect(redactor.flush()).toBe("");
  });

  it("buffers partial match but releases it if it turns out not to be the secret", () => {
    const redactor = new StreamRedactor([secretKey1]);

    // Send prefix "desk-"
    expect(redactor.process("key: desk-").chunkToEmit).toBe("key: ");

    // Send non-matching continuation "999"
    // The redactor realizes it's not the secret and flushes the buffered "desk-" + "999"
    // Wait, the redactor suffix check will run on "desk-999". "desk-999" has no suffix matching prefix of "desk-1234-5678-abcd" (since "desk-999" is not a prefix).
    // So it should emit "desk-999"!
    expect(redactor.process("999").chunkToEmit).toBe("desk-999");
    expect(redactor.flush()).toBe("");
  });

  it("redacts multiple different secrets", () => {
    const redactor = new StreamRedactor([secretKey1, secretKey2]);

    expect(redactor.process(`key1: desk-`).chunkToEmit).toBe("key1: ");
    expect(redactor.process(`1234-5678-abcd and key2: remote-`).chunkToEmit).toBe(
      "[REDACTED] and key2: ",
    );
    expect(redactor.process(`token-secret-999!`).chunkToEmit).toBe(
      "[REDACTED]!",
    );
    expect(redactor.flush()).toBe("");
  });

  it("ignores secrets that are too short (<= 8 characters) to avoid false positives", () => {
    const shortSecret = "secret";
    const redactor = new StreamRedactor([shortSecret]);
    expect(redactor.process("my secret is safe").chunkToEmit).toBe(
      "my secret is safe",
    );
    expect(redactor.flush()).toBe("");
  });

  it("flushes remaining buffer on flush call", () => {
    const redactor = new StreamRedactor([secretKey1]);

    // Partial match at the end
    expect(redactor.process("key: desk-12").chunkToEmit).toBe("key: ");

    // Flush should return the redacted/complete buffer
    expect(redactor.flush()).toBe("desk-12");
  });
});
