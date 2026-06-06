// Per-report data-confidence badge. A number you might invest off deserves an
// honest signal of HOW it was sourced. Prefers the skill-computed
// provenance.data_confidence (evidence.assess_confidence); otherwise derives the
// same grade client-side from the evidence-ref tier mix + declared data gaps, so
// the badge shows even for older reports that predate the skill field.

import type { EquityReport } from "./reportContract";

export interface DataConfidence {
  level: "high" | "medium" | "low";
  reason: string;
}

function fromProvenance(report: EquityReport): DataConfidence | null {
  const raw = report.provenance?.data_confidence;
  if (!raw) return null;
  if (typeof raw === "string") {
    const level = raw.toLowerCase();
    if (level === "high" || level === "medium" || level === "low") {
      return { level, reason: "" };
    }
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const level = String(obj.level ?? "").toLowerCase();
  if (level === "high" || level === "medium" || level === "low") {
    return { level, reason: String(obj.reason ?? "") };
  }
  return null;
}

export function dataConfidence(report: EquityReport): DataConfidence {
  const fromSkill = fromProvenance(report);
  if (fromSkill) return fromSkill;

  const refs = report.evidenceRefs;
  const gaps = report.dataGaps.length;
  const n = refs.length;
  if (n === 0) {
    return { level: "low", reason: "no evidence sources" };
  }
  const highTier = refs.filter(
    (r) => r.tier === "tier1" || r.tier === "tier2",
  ).length;
  const stale = refs.filter((r) => !r.fetched_at).length;
  // Round to 2dp before thresholding so the grade matches the Python
  // evidence.assess_confidence (e.g. 2/3 → 0.67 clears the 0.67 high bar).
  const share = Math.round((highTier / n) * 100) / 100;
  const staleRatio = stale / n;

  let level: DataConfidence["level"];
  if (share < 0.34 || staleRatio > 0.5 || gaps >= 4) {
    level = "low";
  } else if (share >= 0.67 && stale === 0 && gaps === 0) {
    level = "high";
  } else {
    level = "medium";
  }

  const bits = [`${Math.round(share * 100)}% tier1/2`];
  if (stale) bits.push(`${stale}/${n} undated`);
  if (gaps) bits.push(`${gaps} gaps`);
  return { level, reason: bits.join(", ") };
}
