import { describe, expect, it } from "vitest";
import {
  guardedAgent,
  guardedLookup,
  ipIsBlocked,
  safeFetch,
} from "../src/main/security/ssrf-guard";

function lookupLiteral(
  hostname: string,
): Promise<{ address: string; family: number | undefined }> {
  return new Promise((resolve, reject) => {
    guardedLookup(hostname, {}, (err, address, family) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ address: String(address), family });
    });
  });
}

describe("ssrf-guard", () => {
  it("classifies private and local address ranges as blocked", () => {
    expect(ipIsBlocked("127.0.0.1")).toBe(true);
    expect(ipIsBlocked("10.0.0.5")).toBe(true);
    expect(ipIsBlocked("169.254.1.1")).toBe(true);
    expect(ipIsBlocked("::1")).toBe(true);
    expect(ipIsBlocked("fc00::1")).toBe(true);
    expect(ipIsBlocked("not-an-ip")).toBe(true);
  });

  it("allows public address literals", () => {
    expect(ipIsBlocked("8.8.8.8")).toBe(false);
    expect(ipIsBlocked("2606:4700:4700::1111")).toBe(false);
  });

  it("pins public IP literals without DNS", async () => {
    await expect(lookupLiteral("8.8.8.8")).resolves.toEqual({
      address: "8.8.8.8",
      family: 4,
    });
    await expect(lookupLiteral("[2606:4700:4700::1111]")).resolves.toEqual({
      address: "2606:4700:4700::1111",
      family: 6,
    });
  });

  it("rejects blocked IP literals before connect", async () => {
    await expect(lookupLiteral("127.0.0.1")).rejects.toThrow("blocked host");
    await expect(lookupLiteral("[::1]")).rejects.toThrow("blocked host");
  });

  it("exports the shared guarded dispatcher and safe fetch wrapper", () => {
    expect(guardedAgent).toBeTruthy();
    expect(safeFetch).toBeTypeOf("function");
  });
});
