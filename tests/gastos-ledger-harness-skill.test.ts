import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const skillPath = join(
  process.cwd(),
  "skills",
  "software-development",
  "gastos-ledger-harness",
  "SKILL.md",
);

const content = readFileSync(skillPath, "utf8");

function frontmatter(): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error("Missing frontmatter block");
  return match[1];
}

function frontmatterField(name: string): string {
  const match = frontmatter().match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  return match?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
}

describe("gastos-ledger-harness skill bundle", () => {
  it("has validator-safe frontmatter", () => {
    const description = frontmatterField("description");

    expect(content.startsWith("---")).toBe(true);
    expect(frontmatterField("name")).toBe("gastos-ledger-harness");
    expect(description).toContain("Use when");
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(frontmatterField("version")).toBe("1.0.0");
    expect(frontmatterField("author")).toBe("Hermes Agent");
    expect(frontmatterField("license")).toBe("MIT");
    expect(frontmatter()).toContain("metadata:");
    expect(frontmatter()).toContain("tags:");
    expect(content.length).toBeLessThanOrEqual(100_000);
  });

  it("documents the required API-only ledger operations", () => {
    for (const required of [
      "GET /api/integrations/ledger/snapshot",
      "POST /api/integrations/ledger/reconciliation/preview",
      "POST /api/integrations/ledger/reconciliation/apply",
      "GET /api/integrations/ledger/readback",
      "`estado`",
      "`preview`",
      "`apply`",
      "`readback`",
      "`drift`",
      "confirm=true",
      "idempotencyKey",
    ]) {
      expect(content).toContain(required);
    }
  });

  it("keeps the operator contract away from secrets and direct database paths", () => {
    expect(content).toContain("names and presence only");
    expect(content).toContain("never write directly to a database");
    expect(content).toContain("Runtime installation into `~/.hermes/skills` is a separate manual");
    expect(content).not.toMatch(/\bDATABASE_URL\b/);
    expect(content).not.toMatch(/\bSELECT\s+\*/i);
    expect(content).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(content).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
  });
});
