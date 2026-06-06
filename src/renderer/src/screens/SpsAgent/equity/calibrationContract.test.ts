import { describe, it, expect } from "vitest";
import {
  parseCalibrationScorecard,
  isCalibrationScorecard,
} from "./calibrationContract";

const CARD_MD = `---
{
  "hermes_report": "india-equity-calibration",
  "schema": 1,
  "horizon_days": 90,
  "band_pct": 5.0,
  "n_scored": 2,
  "n_unscored": 1,
  "overall": { "hit": 1, "miss": 1, "flat": 0, "n": 2, "hit_rate": 0.5 },
  "by_rating": {
    "ACCUMULATE": { "hit": 1, "miss": 0, "flat": 0, "n": 1, "hit_rate": 1.0 },
    "REDUCE": { "hit": 0, "miss": 1, "flat": 0, "n": 1, "hit_rate": 0.0 }
  },
  "by_confidence": {
    "high": { "hit": 1, "miss": 0, "flat": 0, "n": 1, "hit_rate": 1.0 },
    "low": { "hit": 0, "miss": 1, "flat": 0, "n": 1, "hit_rate": null }
  },
  "calls": [
    { "ticker": "NTPC", "date": "2026-01-01", "rating": "ACCUMULATE", "confidence": "high", "entry": 300, "exit": 360, "return_pct": 20.0, "outcome": "hit" }
  ]
}
---

# Thesis Calibration — Hit-rate Scorecard
`;

describe("parseCalibrationScorecard", () => {
  it("parses a valid scorecard", () => {
    const card = parseCalibrationScorecard(CARD_MD)!;
    expect(card).not.toBeNull();
    expect(card.horizonDays).toBe(90);
    expect(card.nScored).toBe(2);
    expect(card.nUnscored).toBe(1);
    expect(card.overall.hit_rate).toBe(0.5);
  });

  it("parses rating + confidence buckets, keeping null hit_rate", () => {
    const card = parseCalibrationScorecard(CARD_MD)!;
    expect(card.byRating.ACCUMULATE.hit_rate).toBe(1.0);
    expect(card.byRating.REDUCE.hit_rate).toBe(0.0);
    expect(card.byConfidence.high.hit_rate).toBe(1.0);
    expect(card.byConfidence.low.hit_rate).toBeNull();
  });

  it("camelCases per-call rows", () => {
    const call = parseCalibrationScorecard(CARD_MD)!.calls[0];
    expect(call.ticker).toBe("NTPC");
    expect(call.returnPct).toBe(20.0);
    expect(call.outcome).toBe("hit");
  });

  it("returns null for the wrong marker", () => {
    const md = `---\n{ "hermes_report": "india-equity-basket" }\n---\n`;
    expect(parseCalibrationScorecard(md)).toBeNull();
    expect(isCalibrationScorecard(md)).toBe(false);
  });

  it("recognizes a scorecard", () => {
    expect(isCalibrationScorecard(CARD_MD)).toBe(true);
  });
});
