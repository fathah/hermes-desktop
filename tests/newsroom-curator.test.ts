import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

const HERMES_PYTHON = "/Users/amar/.hermes/hermes-agent/venv/bin/python";
const CLUSTER_SCRIPT = "/Users/amar/.hermes/skills/curation/newsroom-curator/cluster_news.py";

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

  it("clusters documents correctly based on topic similarity", () => {
    // Plant mock captures in the temp inbox directory
    
    // Group 1: OpenAI GPT-5
    writeFileSync(
      join(tempInboxDir, "openai-gpt5-release.md"),
      `---
status: unprocessed
title: OpenAI Announces GPT-5
source: tech-news
---
Today OpenAI officially released their next generation model GPT-5, outlining massive capabilities in multimodal logic and system reasoning.`
    );

    writeFileSync(
      join(tempInboxDir, "gpt5-reasoning-analysis.md"),
      `---
status: unprocessed
title: Detailed Analysis of GPT-5 Logic
source: research-blog
---
An initial review of OpenAI's new GPT-5 model reveals substantial logic capabilities, proving it is a significant upgrade in multi-step coding reasoning.`
    );

    // Group 2: Fed Interest Rates
    writeFileSync(
      join(tempInboxDir, "fed-rates-hold.md"),
      `---
status: unprocessed
title: Federal Reserve Interest Rates Decision
source: finance-times
---
The Federal Reserve announced today they are holding benchmark interest rates constant at their current range during the latest policy committee meeting.`
    );

    writeFileSync(
      join(tempInboxDir, "fed-keeps-rates-constant.md"),
      `---
status: unprocessed
title: Fed Keeps Policy Rate Unchanged
source: economic-weekly
---
In a highly anticipated announcement, the Fed kept interest rates steady, citing ongoing inflation tracking and economic indicators.`
    );

    // Group 3: Geopolitical Summit (Single outlier/independent story)
    writeFileSync(
      join(tempInboxDir, "geopolitical-summit-geneva.md"),
      `---
status: unprocessed
title: Geneva Security Summit Commences
source: global-news
---
Leaders and security representatives from European nations gathered in Geneva today for a three-day summit addressing border defense strategies.`
    );

    // Execute the python clustering script
    const outputRaw = execFileSync(HERMES_PYTHON, [CLUSTER_SCRIPT, tempInboxDir]);
    const clusters = JSON.parse(outputRaw.toString().trim());

    // Assertions
    expect(clusters).toBeDefined();
    
    // Validate we have grouped clusters
    const clusterKeys = Object.keys(clusters);
    expect(clusterKeys.length).toBeGreaterThanOrEqual(1);

    // Count how many files land in each cluster
    const clusterSizes = clusterKeys.map(k => clusters[k].length);
    
    // Total processed articles should be 5
    const totalProcessed = clusterSizes.reduce((a, b) => a + b, 0);
    expect(totalProcessed).toBe(5);

    // Find the cluster that contains the OpenAI files
    let gpt5Cluster: any[] = [];
    let fedCluster: any[] = [];
    let genevaCluster: any[] = [];

    for (const key of clusterKeys) {
      const cluster = clusters[key];
      const titles = cluster.map((c: any) => c.title);
      if (titles.some((t: string) => t.includes("GPT-5"))) {
        gpt5Cluster = cluster;
      } else if (titles.some((t: string) => t.includes("Fed") || t.includes("Federal"))) {
        fedCluster = cluster;
      } else if (titles.some((t: string) => t.includes("Geneva"))) {
        genevaCluster = cluster;
      }
    }

    // Assert grouping logic
    // GPT-5 articles should be grouped together
    expect(gpt5Cluster.length).toBe(2);
    expect(gpt5Cluster.map(c => c.id)).toContain("openai-gpt5-release");
    expect(gpt5Cluster.map(c => c.id)).toContain("gpt5-reasoning-analysis");

    // Fed articles should be grouped together
    expect(fedCluster.length).toBe(2);
    expect(fedCluster.map(c => c.id)).toContain("fed-rates-hold");
    expect(fedCluster.map(c => c.id)).toContain("fed-keeps-rates-constant");

    // Geneva summit should stand alone
    expect(genevaCluster.length).toBe(1);
    expect(genevaCluster.map(c => c.id)).toContain("geopolitical-summit-geneva");
  });

  it("filters out processed captures and only ingests unprocessed ones", () => {
    // Plant one unprocessed capture and one processed capture
    writeFileSync(
      join(tempInboxDir, "fresh-capture.md"),
      `---
status: unprocessed
title: Unprocessed Capture
source: manual
---
This is a fresh document.`
    );

    writeFileSync(
      join(tempInboxDir, "old-capture.md"),
      `---
status: processed
title: Processed Capture
source: manual
---
This is an old document.`
    );

    const outputRaw = execFileSync(HERMES_PYTHON, [CLUSTER_SCRIPT, tempInboxDir]);
    const clusters = JSON.parse(outputRaw.toString().trim());
    
    // Accumulate all items in clusters
    const allItems: any[] = [];
    for (const key of Object.keys(clusters)) {
      allItems.push(...clusters[key]);
    }

    expect(allItems.map(i => i.id)).toContain("fresh-capture");
    expect(allItems.map(i => i.id)).not.toContain("old-capture");
  });

  it("respects custom similarity threshold from curator-settings.md", () => {
    // Group 1: GPT-5 articles (moderately similar, group together under threshold=0.45)
    writeFileSync(
      join(tempInboxDir, "openai-gpt5-release.md"),
      `---
status: unprocessed
title: OpenAI Announces GPT-5
source: tech-news
---
Today OpenAI officially released their next generation model GPT-5, outlining massive capabilities in multimodal logic and system reasoning.`
    );

    writeFileSync(
      join(tempInboxDir, "gpt5-reasoning-analysis.md"),
      `---
status: unprocessed
title: Detailed Analysis of GPT-5 Logic
source: research-blog
---
An initial review of OpenAI's new GPT-5 model reveals substantial logic capabilities, proving it is a significant upgrade in multi-step coding reasoning.`
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
`
    );

    // Execute clustering
    const outputRaw = execFileSync(HERMES_PYTHON, [CLUSTER_SCRIPT, tempInboxDir]);
    const clusters = JSON.parse(outputRaw.toString().trim());

    // With 0.95 similarity threshold, they should not group together
    const clusterKeys = Object.keys(clusters);
    expect(clusterKeys.length).toBe(2); // Two separate clusters
  });

  it("filters out captures containing keywords from ignored_topics", () => {
    // Article 1: Interesting topic
    writeFileSync(
      join(tempInboxDir, "interesting-article.md"),
      `---
status: unprocessed
title: Important breakthroughs in Quantum Computing
source: tech-news
---
Researchers have achieved a stable logical qubit milestone.`
    );

    // Article 2: Ignored topic
    writeFileSync(
      join(tempInboxDir, "ignored-gossip.md"),
      `---
status: unprocessed
title: Hollywood Celebrity Gossip Weekly Review
source: clickbait
---
Some celebrity did something trivial today.`
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
`
    );

    // Execute clustering
    const outputRaw = execFileSync(HERMES_PYTHON, [CLUSTER_SCRIPT, tempInboxDir]);
    const clusters = JSON.parse(outputRaw.toString().trim());

    // Accumulate all articles
    const allItems: any[] = [];
    for (const key of Object.keys(clusters)) {
      allItems.push(...clusters[key]);
    }

    expect(allItems.map(i => i.id)).toContain("interesting-article");
    expect(allItems.map(i => i.id)).not.toContain("ignored-gossip");
  });
});
