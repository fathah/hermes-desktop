import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { ENGINE_CONTRACT } from "../src/shared/engine-contract";

const ROOT = process.cwd();
const MAIN_DIR = join(ROOT, "src", "main");

function walkTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function rel(file: string): string {
  return relative(ROOT, file).replaceAll("\\", "/");
}

function declared(kind: (typeof ENGINE_CONTRACT)[number]["kind"]): Set<string> {
  return new Set(
    ENGINE_CONTRACT.filter((entry) => entry.kind === kind).map(
      (entry) => entry.value,
    ),
  );
}

function extractInlineCliContracts(source: string): string[] {
  const values: string[] = [];
  const callRe = /hermesCliArgs\(\s*\[([\s\S]*?)\]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(source)) !== null) {
    const strings = Array.from(match[1].matchAll(/"([^"]+)"/g)).map(
      (item) => item[1],
    );
    if (strings.length === 0) continue;
    if (strings[0].startsWith("--")) {
      values.push(strings[0]);
    } else {
      values.push(
        strings
          .filter((value) => !value.startsWith("--"))
          .slice(0, 2)
          .join(" "),
      );
    }
  }
  return values;
}

function normalizeEndpoint(raw: string): string | null {
  if (raw === "/health" || raw === "/openapi.json") return raw;
  if (raw === "/api/chat/completions") return raw;
  if (raw === "/api/jobs") return raw;
  if (raw.startsWith("/api/jobs/")) return "/api/jobs/{id}";
  if (raw === "/v1/capabilities") return raw;
  if (raw === "/v1/chat/completions") return raw;
  if (raw.startsWith("/v1/runs/")) return "/v1/runs/{id}/approval";
  return null;
}

function extractGatewayEndpoints(source: string): string[] {
  const values = new Set<string>();
  const re = /(["'`])((?:\/v1\/|\/api\/|\/openapi\.json|\/health)[^"'`\s}]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const normalized = normalizeEndpoint(match[2]);
    if (normalized) values.add(normalized);
  }
  return [...values];
}

describe("engine contract drift", () => {
  it("declares every inline Hermes CLI command consumed by main-process code", () => {
    const cliContracts = declared("cli");
    const missing: string[] = [];

    for (const file of walkTsFiles(MAIN_DIR)) {
      const source = readFileSync(file, "utf-8");
      for (const value of extractInlineCliContracts(source)) {
        if (!cliContracts.has(value)) missing.push(`${rel(file)} -> ${value}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("declares every gateway HTTP endpoint consumed by main-process code", () => {
    const httpContracts = declared("http");
    const missing: string[] = [];

    for (const file of walkTsFiles(MAIN_DIR)) {
      const source = readFileSync(file, "utf-8");
      for (const value of extractGatewayEndpoints(source)) {
        if (!httpContracts.has(value)) missing.push(`${rel(file)} -> ${value}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("keeps manifest usedBy file references pointing at real files", () => {
    const missing = ENGINE_CONTRACT.flatMap((entry) =>
      entry.usedBy
        .filter((file) => !existsSync(join(ROOT, file)))
        .map((file) => `${entry.id} -> ${file}`),
    );

    expect(missing).toEqual([]);
  });
});
