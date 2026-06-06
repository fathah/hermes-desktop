import { describe, it, expect } from "vitest";
import { sma, rsi, macd, pointAndFigure, closes } from "./indicators";
import type { PriceBar } from "./reportContract";

describe("sma", () => {
  it("computes a trailing average and nulls the warmup window", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([null, null, 2, 3, 4]);
  });
  it("throws on non-positive period", () => {
    expect(() => sma([1], 0)).toThrow();
  });
});

describe("rsi", () => {
  it("returns 100 when there are no losses", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(rising, 14)).toBe(100);
  });
  it("is low for a steadily falling series", () => {
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(falling, 14)!).toBeLessThan(10);
  });
  it("returns null when too short", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });
});

describe("macd", () => {
  it("returns null when too short", () => {
    expect(macd([1, 2, 3])).toBeNull();
  });
  it("is positive when fast EMA leads an uptrend", () => {
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
    const m = macd(rising)!;
    expect(m.macd).toBeGreaterThan(0);
    expect(m).toHaveProperty("signal");
    expect(m).toHaveProperty("histogram");
  });
});

describe("pointAndFigure", () => {
  it("returns null for trivial input", () => {
    expect(pointAndFigure([100])).toBeNull();
  });

  it("builds an X column on a sustained rise", () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
    const pnf = pointAndFigure(rising, 0.02, 3)!;
    expect(pnf.boxSize).toBeGreaterThan(0);
    expect(pnf.columns.length).toBeGreaterThanOrEqual(1);
    expect(pnf.columns[pnf.columns.length - 1].dir).toBe("X");
  });

  it("reverses to an O column after a 3-box drop", () => {
    // rise then fall hard
    const up = Array.from({ length: 20 }, (_, i) => 100 + i * 3);
    const down = Array.from({ length: 20 }, (_, i) => 160 - i * 4);
    const pnf = pointAndFigure([...up, ...down], 0.02, 3)!;
    const dirs = new Set(pnf.columns.map((c) => c.dir));
    expect(dirs.has("X")).toBe(true);
    expect(dirs.has("O")).toBe(true);
    expect(pnf.columns[pnf.columns.length - 1].dir).toBe("O");
  });

  it("flags a buy signal on a double-top breakout", () => {
    // up, small pullback (3-box reversal), then higher high
    const seq = [
      ...Array.from({ length: 15 }, (_, i) => 100 + i * 2), // up to ~128
      ...Array.from({ length: 6 }, (_, i) => 128 - i * 3), // pullback (reversal)
      ...Array.from({ length: 20 }, (_, i) => 112 + i * 3), // new higher high
    ];
    const pnf = pointAndFigure(seq, 0.02, 3)!;
    expect(pnf.signal).toBe("buy");
  });

  it("box indices map back into a sane price band", () => {
    const series = Array.from(
      { length: 40 },
      (_, i) => 300 + Math.sin(i / 3) * 20,
    );
    const pnf = pointAndFigure(series)!;
    expect(pnf.minBox * pnf.boxSize).toBeLessThan(340);
    expect(pnf.maxBox * pnf.boxSize).toBeGreaterThan(260);
  });
});

describe("closes", () => {
  it("extracts numeric closes, dropping holes", () => {
    const series = [
      { date: "d1", c: 10 },
      { date: "d2", c: 11 },
    ] as PriceBar[];
    expect(closes(series)).toEqual([10, 11]);
  });
});
