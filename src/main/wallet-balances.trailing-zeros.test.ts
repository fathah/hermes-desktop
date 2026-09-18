// @vitest-environment node
// @lat: [[wallet-token-balances#Tests]]

import { describe, expect, it } from "vitest";
import { formatTokenBalance, formatTokenBalanceFull } from "../shared/tokens";

// Truncated fractional output omits the trailing zeros the truncation
// exposes while preserving interior zeros: 1.20001 renders as "1.2", never
// as "1.2000".
describe("token balance trailing zeros after the 4-digit cut", () => {
  it("drops zeros the cut turns into trailing zeros", () => {
    // 1.20001 tokens → "1.2", not "1.2000"
    expect(formatTokenBalanceFull("1200010000000000000", 18)).toBe("1.2");
  });

  it("drops the whole fraction when the cut leaves only zeros", () => {
    // 1.00001 tokens → "1", not "1.0000"
    expect(formatTokenBalanceFull("1000010000000000000", 18)).toBe("1");
  });

  it("re-trims a sub-1 balance whose leading zeros are preserved", () => {
    // 0.0001200005 tokens → "0.00012": the leading zeros stay, the zeros
    // exposed by the truncation go.
    expect(formatTokenBalanceFull("120000500000000", 18)).toBe("0.00012");
  });

  it("applies to 6-decimal tokens", () => {
    // 1.20001 USDC-like → "1.2"
    expect(formatTokenBalanceFull("1200010", 6)).toBe("1.2");
  });

  it("re-trims through the compact formatter below the K threshold", () => {
    // 999.90001 tokens stays under 1,000, so the compact formatter renders it
    // in full and truncates the same way.
    expect(formatTokenBalance("999900010000000000000", 18)).toBe("999.9");
  });

  it("keeps interior zeros that survive the cut (control)", () => {
    // 1.2001 tokens: every visible digit is significant, so nothing is trimmed.
    expect(formatTokenBalanceFull("1200100000000000000", 18)).toBe("1.2001");
  });

  it("keeps an interior zero while dropping the tail the cut exposes", () => {
    // 1.0200001 tokens → "1.02": the interior zero stays, the exposed tail goes.
    expect(formatTokenBalanceFull("1020000100000000000", 18)).toBe("1.02");
  });

  it("re-trims a sub-1 balance with no leading zeros", () => {
    // 0.100001 tokens → "0.1": with no leading zeros, the exposed tail is the
    // whole visible fraction but its first digit.
    expect(formatTokenBalanceFull("100001000000000000", 18)).toBe("0.1");
  });

  it("re-trims a sub-1 balance for 6-decimal tokens", () => {
    // 0.100001 USDC-like → "0.1", at a 6-decimal scale.
    expect(formatTokenBalanceFull("100001", 6)).toBe("0.1");
  });

  it("returns the bare integer when the fraction is past the 4-digit window", () => {
    // 1.000000001 tokens → "1": the visible fraction is all zeros, so the
    // decimal point goes with it.
    expect(formatTokenBalanceFull("1000000001000000000", 18)).toBe("1");
  });

  it("leaves the compact K path untouched (control)", () => {
    // 1000.20001 tokens is at the K threshold, so the compact scale renders it.
    expect(formatTokenBalance("1000200010000000000000", 18)).toBe("1K");
  });
});
