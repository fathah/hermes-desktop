import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

const HERMES_PYTHON = "/Users/amar/.hermes/hermes-agent/venv/bin/python";
const CLUSTER_SCRIPT =
  "/Users/amar/.hermes/skills/curation/newsroom-curator/cluster_news.py";
const TEST_TIMEOUT_MS = 30_000;
const PYTHON_CLUSTER_WRAPPER = String.raw`
import importlib.util
import json
import os
import sys
import types

script_path = sys.argv[1]
inbox_path = sys.argv[2]

# Keep the unit test deterministic. The curator script normally tries txtai,
# then live Ollama, before falling back to local bag-of-words clustering. Under
# the full Vitest suite the shared Ollama path can be slow or return different
# cluster boundaries, so this wrapper proves the offline curator behavior.
txtai = types.ModuleType("txtai")
txtai_embeddings = types.ModuleType("txtai.embeddings")
class DisabledEmbeddings:
    def __init__(self, *args, **kwargs):
        raise RuntimeError("txtai disabled for deterministic test")
txtai_embeddings.Embeddings = DisabledEmbeddings
sys.modules["txtai"] = txtai
sys.modules["txtai.embeddings"] = txtai_embeddings

spec = importlib.util.spec_from_file_location("cluster_news", script_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)
module.get_ollama_embeddings = lambda *args, **kwargs: None
module.get_openai_embeddings = lambda *args, **kwargs: None

config = module.read_hermes_config()
vault_path = config.get("vault_path")
settings = module.load_curator_settings(vault_path, inbox_path)
articles = module.load_captures(inbox_path, settings.get("ignored_topics", []))
grouped = module.cluster_articles(articles, settings.get("threshold", 0.45))
print(json.dumps(grouped, indent=2))
`;

function runCluster(
  inboxDir: string,
): Record<string, Array<{ id: string; title: string }>> {
  const outputRaw = execFileSync(
    HERMES_PYTHON,
    ["-c", PYTHON_CLUSTER_WRAPPER, CLUSTER_SCRIPT, inboxDir],
    {
      env: {
        ...process.env,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        OPENAI_API_KEY: "",
      },
      timeout: TEST_TIMEOUT_MS,
    },
  );
  return JSON.parse(outputRaw.toString().trim());
}

describe("Newsroom Curator: Semantic Similarity Clustering", () => {
  let tempVaultDir: string;
  let tempInboxDir: string;

  beforeEach(() => {
    // Create a temporary vault and inbox directory for raw captures
    tempVaultDir = mkdtempSync(join(tmpdir(), "newsroom-vault-test-"));
    tempInboxDir = join(tempVaultDir, "_inbox");
    mkdirSync(tempInboxDir);
  });

  afterEach(() => {
    // Clean up temporary directories
    if (tempVaultDir) {
      rmSync(tempVaultDir, { recursive: true, force: true });
    }
  });

  it(
    "clusters documents correctly based on topic similarity",
    () => {
      // Plant mock captures in the temp inbox directory

      // Group 1: OpenAI GPT-5
      writeFileSync(
        join(tempInboxDir, "openai-gpt5-release.md"),
        `---
status: unprocessed
title: OpenAI Announces GPT-5
source: tech-news
---
Today OpenAI officially released their next generation model GPT-5, outlining massive capabilities in multimodal logic and system reasoning.`,
      );

      writeFileSync(
        join(tempInboxDir, "gpt5-reasoning-analysis.md"),
        `---
status: unprocessed
title: Detailed Analysis of GPT-5 Logic
source: research-blog
---
An initial review of OpenAI's new GPT-5 model reveals substantial logic capabilities, proving it is a significant upgrade in multi-step coding reasoning.`,
      );

      // Group 2: Fed Interest Rates
      writeFileSync(
        join(tempInboxDir, "fed-rates-hold.md"),
        `---
status: unprocessed
title: Federal Reserve Interest Rates Decision
source: finance-times
---
The Federal Reserve announced today they are holding benchmark interest rates constant at their current range during the latest policy committee meeting.`,
      );

      writeFileSync(
        join(tempInboxDir, "fed-keeps-rates-constant.md"),
        `---
status: unprocessed
title: Fed Keeps Policy Rate Unchanged
source: economic-weekly
---
In a highly anticipated announcement, the Fed kept interest rates steady, citing ongoing inflation tracking and economic indicators.`,
      );

      // Group 3: Geopolitical Summit (Single outlier/independent story)
      writeFileSync(
        join(tempInboxDir, "geopolitical-summit-geneva.md"),
        `---
status: unprocessed
title: Geneva Security Summit Commences
source: global-news
---
Leaders and security representatives from European nations gathered in Geneva today for a three-day summit addressing border defense strategies.`,
      );

      // Execute the python clustering script
      const clusters = runCluster(tempInboxDir);

      // Assertions
      expect(clusters).toBeDefined();

      // Validate we have grouped clusters
      const clusterKeys = Object.keys(clusters);
      expect(clusterKeys.length).toBeGreaterThanOrEqual(1);

      // Count how many files land in each cluster
      const clusterSizes = clusterKeys.map((k) => clusters[k].length);

      // Total processed articles should be 5
      const totalProcessed = clusterSizes.reduce((a, b) => a + b, 0);
      expect(totalProcessed).toBe(5);

      // Find the cluster that contains the OpenAI files
      let gpt5Cluster: Array<{ id: string; title: string }> = [];
      let fedCluster: Array<{ id: string; title: string }> = [];
      let genevaCluster: Array<{ id: string; title: string }> = [];

      for (const key of clusterKeys) {
        const cluster = clusters[key];
        const titles = cluster.map((c: { title: string }) => c.title);
        if (titles.some((t: string) => t.includes("GPT-5"))) {
          gpt5Cluster = cluster;
        } else if (
          titles.some((t: string) => t.includes("Fed") || t.includes("Federal"))
        ) {
          fedCluster = cluster;
        } else if (titles.some((t: string) => t.includes("Geneva"))) {
          genevaCluster = cluster;
        }
      }

      // Assert grouping logic
      // GPT-5 articles should be grouped together
      expect(gpt5Cluster.length).toBe(2);
      expect(gpt5Cluster.map((c) => c.id)).toContain("openai-gpt5-release");
      expect(gpt5Cluster.map((c) => c.id)).toContain("gpt5-reasoning-analysis");

      // Fed articles should be grouped together
      expect(fedCluster.length).toBe(2);
      expect(fedCluster.map((c) => c.id)).toContain("fed-rates-hold");
      expect(fedCluster.map((c) => c.id)).toContain("fed-keeps-rates-constant");

      // Geneva summit should stand alone
      expect(genevaCluster.length).toBe(1);
      expect(genevaCluster.map((c) => c.id)).toContain(
        "geopolitical-summit-geneva",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "filters out processed captures and only ingests unprocessed ones",
    () => {
      // Plant one unprocessed capture and one processed capture
      writeFileSync(
        join(tempInboxDir, "fresh-capture.md"),
        `---
status: unprocessed
title: Unprocessed Capture
source: manual
---
This is a fresh document.`,
      );

      writeFileSync(
        join(tempInboxDir, "old-capture.md"),
        `---
status: processed
title: Processed Capture
source: manual
---
This is an old document.`,
      );

      const clusters = runCluster(tempInboxDir);

      // Accumulate all items in clusters
      const allItems: Array<{ id: string }> = [];
      for (const key of Object.keys(clusters)) {
        allItems.push(...clusters[key]);
      }

      expect(allItems.map((i) => i.id)).toContain("fresh-capture");
      expect(allItems.map((i) => i.id)).not.toContain("old-capture");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "respects custom similarity threshold from curator-settings.md",
    () => {
      // Group 1: GPT-5 articles (moderately similar, group together under threshold=0.45)
      writeFileSync(
        join(tempInboxDir, "openai-gpt5-release.md"),
        `---
status: unprocessed
title: OpenAI Announces GPT-5
source: tech-news
---
Today OpenAI officially released their next generation model GPT-5, outlining massive capabilities in multimodal logic and system reasoning.`,
      );

      writeFileSync(
        join(tempInboxDir, "gpt5-reasoning-analysis.md"),
        `---
status: unprocessed
title: Detailed Analysis of GPT-5 Logic
source: research-blog
---
An initial review of OpenAI's new GPT-5 model reveals substantial logic capabilities, proving it is a significant upgrade in multi-step coding reasoning.`,
      );

      // 1. Write curator-settings.md with high threshold (0.95)
      writeFileSync(
        join(tempVaultDir, "curator-settings.md"),
        `# Settings
\`\`\`json
{
  "threshold": 0.95
}
\`\`\`
`,
      );

      // Execute clustering
      const clusters = runCluster(tempInboxDir);

      // With 0.95 similarity threshold, they should not group together
      const clusterKeys = Object.keys(clusters);
      expect(clusterKeys.length).toBe(2); // Two separate clusters
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "filters out captures containing keywords from ignored_topics",
    () => {
      // Article 1: Interesting topic
      writeFileSync(
        join(tempInboxDir, "interesting-article.md"),
        `---
status: unprocessed
title: Important breakthroughs in Quantum Computing
source: tech-news
---
Researchers have achieved a stable logical qubit milestone.`,
      );

      // Article 2: Ignored topic
      writeFileSync(
        join(tempInboxDir, "ignored-gossip.md"),
        `---
status: unprocessed
title: Hollywood Celebrity Gossip Weekly Review
source: clickbait
---
Some celebrity did something trivial today.`,
      );

      // Write curator-settings.md with ignored_topics
      writeFileSync(
        join(tempVaultDir, "curator-settings.md"),
        `# Settings
\`\`\`json
{
  "ignored_topics": ["gossip", "celebrity"]
}
\`\`\`
`,
      );

      // Execute clustering
      const clusters = runCluster(tempInboxDir);

      // Accumulate all articles
      const allItems: Array<{ id: string }> = [];
      for (const key of Object.keys(clusters)) {
        allItems.push(...clusters[key]);
      }

      expect(allItems.map((i) => i.id)).toContain("interesting-article");
      expect(allItems.map((i) => i.id)).not.toContain("ignored-gossip");
    },
    TEST_TIMEOUT_MS,
  );
});
