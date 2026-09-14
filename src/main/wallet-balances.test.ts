// @vitest-environment node
// @lat: [[wallet-token-balances#Tests]]

import { describe, expect, it, vi } from "vitest";
import { formatTokenBalance, formatTokenBalanceFull } from "../shared/tokens";

describe("formatTokenBalance", () => {
  it('returns "0" for zero raw value', () => {
    expect(formatTokenBalance("0", 18)).toBe("0");
  });

  it('returns "0" for empty raw value', () => {
    expect(formatTokenBalance("", 18)).toBe("0");
  });

  it("formats exactly 1 token (1e18 raw, 18 decimals)", () => {
    expect(formatTokenBalance("1000000000000000000", 18)).toBe("1");
  });

  it("formats a whole number with no fractional part", () => {
    expect(formatTokenBalance("5000000000000000000", 18)).toBe("5");
  });

  it("formats a small fractional balance (0.5 token)", () => {
    expect(formatTokenBalance("500000000000000000", 18)).toBe("0.5");
  });

  it("formats with up to 4 significant digits", () => {
    // 0.1234 tokens
    expect(formatTokenBalance("123400000000000000", 18)).toBe("0.1234");
  });

  it("trims trailing zeros from fractional part", () => {
    // 0.1200 tokens → "0.12"
    expect(formatTokenBalance("120000000000000000", 18)).toBe("0.12");
  });

  it('shows "< 0.0001" for tiny non-zero balances beyond 4 decimals', () => {
    // 0.00001 tokens = 1e13 raw
    expect(formatTokenBalance("10000000000000", 18)).toBe("< 0.0001");
  });

  it("formats a large balance with M suffix (1M tokens)", () => {
    // 1,000,000 tokens
    expect(formatTokenBalance("1000000000000000000000000", 18)).toBe("1M");
  });

  it("formats 1.5M tokens", () => {
    // 1,500,000 tokens
    expect(formatTokenBalance("1500000000000000000000000", 18)).toBe("1.5M");
  });

  it("formats 10.5K tokens", () => {
    // 10,500 tokens
    expect(formatTokenBalance("10500000000000000000000", 18)).toBe("10.5K");
  });

  it("formats exactly 1K tokens", () => {
    // 1,000 tokens
    expect(formatTokenBalance("1000000000000000000000", 18)).toBe("1K");
  });

  it("formats 999 tokens without K suffix", () => {
    // 999 tokens
    expect(formatTokenBalance("999000000000000000000", 18)).toBe("999");
  });

  it("formats 123.4567 tokens without suffix", () => {
    const raw = BigInt("123456700000000000000").toString();
    expect(formatTokenBalance(raw, 18)).toBe("123.4567");
  });

  it("formats when the fractional part has leading zeros then significant digits", () => {
    // 0.001234 tokens — 4 significant digits from first non-zero
    expect(formatTokenBalance("1234000000000000", 18)).toBe("0.001234");
  });

  it("works with 6-decimal tokens (USDC-like)", () => {
    // 1.5 USDC
    expect(formatTokenBalance("1500000", 6)).toBe("1.5");
  });

  it("trims trailing zeros for 6-decimal tokens", () => {
    // 0.12 USDC
    expect(formatTokenBalance("120000", 6)).toBe("0.12");
  });
});

describe("formatTokenBalanceFull", () => {
  it('returns "0" for zero', () => {
    expect(formatTokenBalanceFull("0", 18)).toBe("0");
  });

  it("shows full number without K/M suffix", () => {
    // 10,500 tokens → "10500" not "10.5K"
    expect(formatTokenBalanceFull("10500000000000000000000", 18)).toBe("10500");
  });

  it("shows full number without M suffix", () => {
    // 1,500,000 tokens
    expect(formatTokenBalanceFull("1500000000000000000000000", 18)).toBe(
      "1500000",
    );
  });

  it("formats fractions with 4 significant digits", () => {
    expect(formatTokenBalanceFull("123400000000000000", 18)).toBe("0.1234");
  });
});

describe("formatTokenBalance precision for huge balances", () => {
  // These exceed Number.MAX_SAFE_INTEGER once scaled, so a float-based
  // implementation would round the K/M figure incorrectly. The string/BigInt
  // path must stay exact.
  it("keeps M rounding exact for 1,234,567 tokens", () => {
    // 1,234,567 tokens → 1.23M (truncated/rounded to 2 decimals)
    const raw = (1_234_567n * 10n ** 18n).toString();
    expect(formatTokenBalance(raw, 18)).toBe("1.23M");
  });

  it("rounds 1,999,999 tokens up to 2M", () => {
    const raw = (1_999_999n * 10n ** 18n).toString();
    expect(formatTokenBalance(raw, 18)).toBe("2M");
  });

  it("formats a balance far beyond Number.MAX_SAFE_INTEGER", () => {
    // 987,654,321,000,000 tokens — 15-digit whole part.
    const raw = (987_654_321_000_000n * 10n ** 18n).toString();
    expect(formatTokenBalance(raw, 18)).toBe("987654321M");
  });

  it("preserves the exact whole-token count in the M figure", () => {
    // 5,000,123 tokens → 5M (the .000123 fraction rounds away).
    const raw = (5_000_123n * 10n ** 18n).toString();
    expect(formatTokenBalance(raw, 18)).toBe("5M");
  });
});

// Use vi.hoisted so the mock closures can reference the mock objects
// even though vi.mock is hoisted above the describe block.
const mockState = vi.hoisted(() => ({
  getBalance: vi.fn().mockResolvedValue(BigInt("2000000000000000000")),
  hdBalanceOf: vi.fn().mockResolvedValue(BigInt("100000000000000000")),
}));

vi.mock("ethers", () => ({
  JsonRpcProvider: vi.fn().mockImplementation(function () {
    return { getBalance: mockState.getBalance };
  }),
  Contract: vi.fn().mockImplementation(function (address: string) {
    if (address === "0xfda75f77a22b4f4b783bbbb21915ef64d149bba3") {
      return { balanceOf: mockState.hdBalanceOf };
    }
    return { balanceOf: vi.fn().mockResolvedValue(BigInt(0)) };
  }),
}));

describe("getTokenBalances", () => {
  it("returns balances for all tokens including native ETH", async () => {
    const { getTokenBalances } = await import("./wallet-balances");
    const result = await getTokenBalances(
      "0x1234567890abcdef1234567890abcdef12345678",
    );

    expect(result.address).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(result.balances).toHaveLength(2);
    expect(result.balances[0].tokenId).toBe("eth");
    expect(result.balances[0].formatted).toBe("2");
    expect(result.balances[0].formattedFull).toBe("2");
    expect(result.balances[1].tokenId).toBe("hd");
    expect(result.balances[1].formatted).toBe("0.1");
    expect(result.balances[1].formattedFull).toBe("0.1");
    expect(result.fetchedAt).toBeGreaterThan(0);
  });

  it("includes error field when a token call fails", async () => {
    // Override HD mock to reject for this test
    mockState.hdBalanceOf.mockRejectedValueOnce(new Error("RPC timeout"));

    const { getTokenBalances } = await import("./wallet-balances");
    const result = await getTokenBalances(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );

    expect(result.balances).toHaveLength(2);
    // HD should have an error
    const hd = result.balances.find((b) => b.tokenId === "hd");
    expect(hd?.error).toBeTruthy();
    // ETH should still succeed
    const eth = result.balances.find((b) => b.tokenId === "eth");
    expect(eth?.error).toBeUndefined();
  });

  it("marks a token as errored when its RPC call exceeds the timeout", async () => {
    vi.useFakeTimers();
    try {
      // HD balanceOf never settles, so only the timeout can resolve it.
      mockState.hdBalanceOf.mockImplementationOnce(() => new Promise(() => {}));

      const { getTokenBalances } = await import("./wallet-balances");
      const pending = getTokenBalances(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        50,
      );
      await vi.advanceTimersByTimeAsync(60);
      const result = await pending;

      const hd = result.balances.find((b) => b.tokenId === "hd");
      expect(hd?.error).toMatch(/timed out/i);
      // The fast-resolving ETH read is unaffected by HD's timeout.
      const eth = result.balances.find((b) => b.tokenId === "eth");
      expect(eth?.error).toBeUndefined();
      expect(eth?.formatted).toBe("2");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withTimeout", () => {
  it("resolves with the value when the promise settles in time", async () => {
    const { withTimeout } = await import("./wallet-balances");
    await expect(withTimeout(Promise.resolve(42), 1000, "fast")).resolves.toBe(
      42,
    );
  });

  it("propagates the original rejection when the promise fails in time", async () => {
    const { withTimeout } = await import("./wallet-balances");
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000, "fail"),
    ).rejects.toThrow("boom");
  });

  it("rejects with a labelled timeout error past the deadline", async () => {
    vi.useFakeTimers();
    try {
      const { withTimeout } = await import("./wallet-balances");
      const pending = withTimeout(new Promise(() => {}), 100, "slow-call");
      const assertion = expect(pending).rejects.toThrow(
        /slow-call timed out after 100ms/,
      );
      await vi.advanceTimersByTimeAsync(150);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
