import { describe, it, expect } from "vitest";
import { parseBasketBoard, isBasketBoard } from "./basketContract";

const BOARD_MD = `---
{
  "hermes_report": "india-equity-basket",
  "schema": 1,
  "basket_id": "defensive-psu",
  "name": "Defensive PSU",
  "as_of": "2026-06-06",
  "generated_at": "2026-06-06T00:00:00Z",
  "rows": [
    {
      "rank": 1, "ticker": "NTPC", "rating": "ACCUMULATE", "composite": 64,
      "price": 300, "intrinsic": 345, "upside_pct": 15, "dividend_floor": 240,
      "floor_cushion": 20, "div_yield": 4.5, "risk_score": 62,
      "risk_worst_axis": "tech_disruption", "risk_worst_severity": "high",
      "commodity": "coal", "suggestion": "Hold", "reason": "+15% upside, risk high"
    },
    {
      "rank": 2, "ticker": "ONGC", "rating": "REDUCE", "composite": 48,
      "upside_pct": -5, "floor_cushion": -3, "suggestion": "Trim",
      "reason": "floor cushion -3%"
    }
  ],
  "summary": { "n": 2, "add": [], "trim": ["ONGC"], "hold": ["NTPC"], "top_pick": "NTPC" },
  "data_gaps": ["ONGC: no dividend yield"]
}
---

# Defensive PSU — Basket Ranking Board
`;

describe("parseBasketBoard", () => {
  it("parses a valid basket board", () => {
    const board = parseBasketBoard(BOARD_MD);
    expect(board).not.toBeNull();
    expect(board!.basketId).toBe("defensive-psu");
    expect(board!.name).toBe("Defensive PSU");
    expect(board!.rows).toHaveLength(2);
    expect(board!.summary.topPick).toBe("NTPC");
    expect(board!.summary.trim).toEqual(["ONGC"]);
    expect(board!.dataGaps).toHaveLength(1);
  });

  it("camelCases and types row fields", () => {
    const board = parseBasketBoard(BOARD_MD)!;
    const ntpc = board.rows[0];
    expect(ntpc.ticker).toBe("NTPC");
    expect(ntpc.upsidePct).toBe(15);
    expect(ntpc.floorCushion).toBe(20);
    expect(ntpc.divYield).toBe(4.5);
    expect(ntpc.riskWorstSeverity).toBe("high");
    expect(ntpc.commodity).toBe("coal");
    expect(ntpc.suggestion).toBe("Hold");
  });

  it("coerces missing numerics to null, not NaN", () => {
    const board = parseBasketBoard(BOARD_MD)!;
    const ongc = board.rows[1];
    expect(ongc.divYield).toBeNull();
    expect(ongc.composite).toBe(48);
    expect(ongc.upsidePct).toBe(-5);
  });

  it("returns null for a single-stock report (wrong marker)", () => {
    const md = `---\n{ "hermes_report": "india-equity-research", "ticker": "NTPC" }\n---\n`;
    expect(parseBasketBoard(md)).toBeNull();
    expect(isBasketBoard(md)).toBe(false);
  });

  it("returns null for non-frontmatter markdown", () => {
    expect(parseBasketBoard("just some text")).toBeNull();
    expect(parseBasketBoard("")).toBeNull();
  });

  it("isBasketBoard recognizes a board", () => {
    expect(isBasketBoard(BOARD_MD)).toBe(true);
  });
});
