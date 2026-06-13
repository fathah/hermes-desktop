import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

const HERMES_PYTHON = "/Users/amar/.hermes/hermes-agent/venv/bin/python";
const SEMANTIC_SEARCH_SCRIPT =
  "/Users/amar/.hermes/skills/search/vault-semantic-search/semantic_search.py";

describe("Vault Semantic Search Tool", () => {
  let tempVaultDir: string;
  let tempEmbeddingsDir: string;
  let tempConfigPath: string;
  let tempEnvPath: string;

  beforeEach(() => {
    // Set up temp directories
    const runId = Math.random().toString(36).substring(7);
    tempVaultDir = mkdtempSync(join(tmpdir(), `hermes-vault-test-${runId}-`));
    tempEmbeddingsDir = mkdtempSync(
      join(tmpdir(), `hermes-embeddings-test-${runId}-`),
    );
    tempConfigPath = join(tempEmbeddingsDir, "config.yaml");
    tempEnvPath = join(tempEmbeddingsDir, "temp.env");

    // Create an empty .env file
    writeFileSync(tempEnvPath, "OPENAI_API_KEY=");

    // Populate mock files in the vault
    writeFileSync(
      join(tempVaultDir, "annual-leave.md"),
      `---
title: Annual Leave Policy
---
Employees are entitled to 25 days of annual paid time off (PTO) per year. Vacation requests must be submitted at least two weeks in advance.`,
    );

    writeFileSync(
      join(tempVaultDir, "ssh-keys.md"),
      `---
title: SSH Key Management
---
Generate a secure SSH key pair using ed25519. Ensure the private key has a passphrase and is kept in a secure vault.`,
    );

    writeFileSync(
      join(tempVaultDir, "geopolitics.md"),
      `---
title: European Geopolitics
---
The security treaty signed in Geneva aims to stabilize trade and immigration policies across central European countries.`,
    );
  });

  afterEach(() => {
    // Clean up temporary directories
    if (tempVaultDir && existsSync(tempVaultDir)) {
      rmSync(tempVaultDir, { recursive: true, force: true });
    }
    if (tempEmbeddingsDir && existsSync(tempEmbeddingsDir)) {
      rmSync(tempEmbeddingsDir, { recursive: true, force: true });
    }
  });

  it(
    "builds the index and retrieves matching files using BoW offline fallback",
    () => {
    // Create config targeting non-running Ollama port to force offline BoW fallback
    writeFileSync(
      tempConfigPath,
      `vault_path: "${tempVaultDir}"
api: "http://127.0.0.1:9999"`,
    );

    const env = {
      ...process.env,
      HERMES_CONFIG_PATH: tempConfigPath,
      HERMES_VAULT_PATH: tempVaultDir,
      HERMES_EMBEDDINGS_DIR: tempEmbeddingsDir,
      HERMES_ENV_PATH: tempEnvPath,
      HERMES_DISABLE_OLLAMA_START: "1",
    };

    // Run semantic search script for "annual off-work guidelines"
    const stdoutRaw = execFileSync(
      HERMES_PYTHON,
      [SEMANTIC_SEARCH_SCRIPT, "annual off-work guidelines", "3"],
      { env },
    );
    const results = JSON.parse(stdoutRaw.toString().trim());

    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);

    // The first result should be annual-leave.md due to word overlaps ("annual", "off")
    const topResult = results[0];
    expect(topResult.title).toBe("annual-leave");
    expect(topResult.path).toBe("annual-leave.md");
    expect(topResult.score).toBeGreaterThan(0);
  }, 60000);

  it(
    "updates index incrementally when a file is modified",
    () => {
    writeFileSync(
      tempConfigPath,
      `vault_path: "${tempVaultDir}"
api: "http://127.0.0.1:9999"`,
    );

    const env = {
      ...process.env,
      HERMES_CONFIG_PATH: tempConfigPath,
      HERMES_VAULT_PATH: tempVaultDir,
      HERMES_EMBEDDINGS_DIR: tempEmbeddingsDir,
      HERMES_ENV_PATH: tempEnvPath,
      HERMES_DISABLE_OLLAMA_START: "1",
    };

    // First run to build initial index
    execFileSync(HERMES_PYTHON, [SEMANTIC_SEARCH_SCRIPT, "some query", "1"], {
      env,
    });

    // Verify metadata db exists and contains cached paths
    const dbPath = join(tempEmbeddingsDir, "metadata.db");
    expect(existsSync(dbPath)).toBe(true);

    // Query SQLite metadata db using python to avoid node-sqlite3 dependency
    const dbStdout = execFileSync(HERMES_PYTHON, [
      "-c",
      `import sqlite3, json; conn = sqlite3.connect("${dbPath.replace(/\\/g, "/")}"); c = conn.cursor(); c.execute("SELECT path FROM notes_meta"); print(json.dumps([r[0] for r in c.fetchall()]))`,
    ]);
    const paths = JSON.parse(dbStdout.toString().trim());
    expect(paths).toContain("annual-leave.md");
    expect(paths).toContain("ssh-keys.md");
    expect(paths).toContain("geopolitics.md");

    // Modify ssh-keys.md
    const sshPath = join(tempVaultDir, "ssh-keys.md");
    writeFileSync(
      sshPath,
      `---
title: SSH Key Management
---
Generate a secure SSH key pair using ed25519. Ensure the private key has a passphrase. Follow annual security guidelines for compliance.`,
    );

    // Run query for "annual guidelines" which overlaps with modified ssh-keys.md
    const stdoutRaw = execFileSync(
      HERMES_PYTHON,
      [SEMANTIC_SEARCH_SCRIPT, "annual guidelines", "3"],
      { env },
    );
    const results = JSON.parse(stdoutRaw.toString().trim());

    // Both annual-leave.md and ssh-keys.md should match
    const matchedTitles = results.map((r: { title: string }) => r.title);
    expect(matchedTitles).toContain("annual-leave");
    expect(matchedTitles).toContain("ssh-keys");
  }, 60000);

  it(
    "interacts with live Ollama if it is active",
    async () => {
    // Check if live Ollama is running on 11434
    let ollamaAlive = false;
    try {
      const response = await fetch("http://127.0.0.1:11434/api/tags");
      if (response.ok) {
        const body = await response.json();
        // nomic-embed-text or supergemma must be pulled
        const models = body.models?.map((m: { name: string }) => m.name) || [];
        ollamaAlive =
          models.includes("nomic-embed-text:latest") ||
          models.includes("nomic-embed-text") ||
          models.includes(
            "hf.co/Jiunsong/supergemma4-26b-uncensored-gguf-v2:Q4_K_M",
          );
      }
    } catch {
      ollamaAlive = false;
    }

    if (!ollamaAlive) {
      console.log(
        "Skipping live Ollama test: Ollama service or required models not available.",
      );
      return;
    }

    writeFileSync(
      tempConfigPath,
      `vault_path: "${tempVaultDir}"
api: "http://127.0.0.1:11434"`,
    );

    const env = {
      ...process.env,
      HERMES_CONFIG_PATH: tempConfigPath,
      HERMES_VAULT_PATH: tempVaultDir,
      HERMES_EMBEDDINGS_DIR: tempEmbeddingsDir,
      HERMES_ENV_PATH: tempEnvPath,
    };

    // Test semantic matching for "vacation days" -> should match annual-leave.md (which contains only "paid time off")
    const stdoutRaw = execFileSync(
      HERMES_PYTHON,
      [SEMANTIC_SEARCH_SCRIPT, "vacation days", "1"],
      { env },
    );
    const results = JSON.parse(stdoutRaw.toString().trim());

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe("annual-leave");
  }, 60000);
});
