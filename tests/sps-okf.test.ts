import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import {
  convertMarkdownLinksToWikilinks,
  convertWikilinksToMarkdownLinks,
  parsePageMarkdown,
  stringifyPageMarkdown,
  spsImportOkfBundle,
  spsExportOkfBundle,
  resolveRelativePath,
} from "../src/main/sps-okf";

const TEMP_TEST_DIR = join(__dirname, "temp-okf-test");

describe("OKF Link and Frontmatter Utilities", () => {
  it("should resolve relative and absolute link paths", () => {
    expect(
      resolveRelativePath("datasets/sales.md", "../tables/orders.md"),
    ).toBe("tables/orders.md");
    expect(resolveRelativePath("datasets/sales.md", "/tables/orders.md")).toBe(
      "tables/orders.md",
    );
    expect(resolveRelativePath("about.md", "./contact.md")).toBe("contact.md");
  });

  it("should convert Markdown links into Obsidian wikilinks using pathMap", () => {
    const pathMap = new Map<string, string>();
    pathMap.set("tables/orders.md", "orders");
    pathMap.set("tables/customers.md", "customers");

    const md =
      "See the [orders](../tables/orders.md) or [Acme Customers](/tables/customers.md).";
    const converted = convertMarkdownLinksToWikilinks(
      md,
      "datasets/sales.md",
      pathMap,
    );

    expect(converted).toBe(
      "See the [[orders]] or [[customers|Acme Customers]].",
    );
  });

  it("should convert Obsidian wikilinks to relative Markdown links using pathMap", () => {
    const pathMap = new Map<string, string>();
    pathMap.set("orders", "tables/orders.md");
    pathMap.set("customers", "tables/customers.md");

    const md = "See [[orders]] and [[customers|Acme Customers]].";
    const converted = convertWikilinksToMarkdownLinks(
      md,
      "datasets/sales.md",
      pathMap,
    );

    expect(converted).toBe(
      "See [orders](../tables/orders.md) and [Acme Customers](../tables/customers.md).",
    );
  });

  it("should parse scalar frontmatter properties and separate body", () => {
    const md = `---\ntype: "Playbook"\ntitle: "Order Freshness Check"\nresource: "https://gcp/orders"\ntags: ["revenue", "oncall"]\ncustomKey: "customValue"\n---\n# Triage Steps\n1. Inspect dashboard.`;
    const { props, body } = parsePageMarkdown(md);

    expect(props.type).toBe("Playbook");
    expect(props.title).toBe("Order Freshness Check");
    expect(props.resource).toBe("https://gcp/orders");
    expect(props.customKey).toBe("customValue");
    expect(props.tags).toEqual(["revenue", "oncall"]);
    expect(body.trim()).toBe("# Triage Steps\n1. Inspect dashboard.");
  });

  it("should stringify frontmatter properties and body correctly", () => {
    const props = {
      type: "Concept",
      title: "Customers Profile",
      tags: ["marketing"],
    };
    const body = "# Content\nNotes here.";
    const stringified = stringifyPageMarkdown(props, body);

    expect(stringified).toContain("type: Concept");
    expect(stringified).toContain("title: Customers Profile");
    expect(stringified).toContain("- marketing");
    expect(stringified).toContain("# Content");
  });
});

describe("OKF Import and Export Integration", () => {
  beforeEach(async () => {
    await fs.mkdir(TEMP_TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_TEST_DIR, { recursive: true, force: true });
  });

  it("should export vault pages and subdirectories into a conforming OKF bundle", async () => {
    const vaultDir = join(TEMP_TEST_DIR, "vault");
    const okfDir = join(TEMP_TEST_DIR, "okf-bundle");

    await fs.mkdir(vaultDir, { recursive: true });
    await fs.mkdir(join(vaultDir, "tables"), { recursive: true });

    // Write a standard root page with wikilink
    await fs.writeFile(
      join(vaultDir, "about.md"),
      `---\ntitle: "About Page"\ntype: "Concept"\ntags: ["meta"]\n---\nThis is [[about]] and [[orders|Orders DB]].`,
    );

    // Write a database row page
    await fs.writeFile(
      join(vaultDir, "tables", "orders.md"),
      `---\ntitle: "Orders Database"\ntype: "Task"\n---\nStores customer orders. Links back to [[about]].`,
    );

    // Write a wiki log
    await fs.writeFile(
      join(vaultDir, "log.md"),
      `## [2026-06-13] ingest | Initialized catalog.`,
    );

    // Run export
    const exportResult = await spsExportOkfBundle(vaultDir, okfDir);
    expect(exportResult.success).toBe(true);

    // Verify files were exported correctly
    const rootIndex = await fs.readFile(join(okfDir, "index.md"), "utf-8");
    expect(rootIndex).toContain('okf_version: "0.1"');
    expect(rootIndex).toContain("* [About Page](/about.md)");
    expect(rootIndex).toContain("* [tables](/tables/) - tables Database");

    const subIndex = await fs.readFile(
      join(okfDir, "tables", "index.md"),
      "utf-8",
    );
    expect(subIndex).toContain("* [Orders Database](/tables/orders.md)");

    const exportedAbout = await fs.readFile(join(okfDir, "about.md"), "utf-8");
    expect(exportedAbout).toContain("type: Concept");
    expect(exportedAbout).toContain("[about](./about.md)");
    expect(exportedAbout).toContain("[Orders DB](./tables/orders.md)");

    const exportedOrders = await fs.readFile(
      join(okfDir, "tables", "orders.md"),
      "utf-8",
    );
    expect(exportedOrders).toContain("type: Task");
    expect(exportedOrders).toContain("[about](../about.md)");

    const exportedLog = await fs.readFile(join(okfDir, "log.md"), "utf-8");
    expect(exportedLog).toContain("Directory Update Log");
    expect(exportedLog).toContain(
      "## [2026-06-13] ingest | Initialized catalog.",
    );
  });

  it("should import a nested OKF bundle into proposed changesets", async () => {
    const okfDir = join(TEMP_TEST_DIR, "okf-bundle");
    await fs.mkdir(okfDir, { recursive: true });
    await fs.mkdir(join(okfDir, "playbooks"), { recursive: true });

    // Write some OKF pages
    await fs.writeFile(
      join(okfDir, "playbooks", "freshness-alert.md"),
      `---\ntype: "Playbook"\ntitle: "Freshness Alert"\nresource: "https://gcp/alerts/freshness"\ntags: ["oncall"]\ntimestamp: "2026-05-28T14:30:00Z"\n---\nSee [tables index](/index.md) or [orders table](../tables/orders.md).`,
    );

    await fs.writeFile(
      join(okfDir, "orders.md"),
      `---\ntype: "Table"\ntitle: "Orders"\n---\nStores customer orders.`,
    );

    // Run import
    const importResult = await spsImportOkfBundle(okfDir);
    expect(importResult.success).toBe(true);
    expect(importResult.pages.length).toBe(2);

    const playbookPage = importResult.pages.find(
      (p) => p.pageId === "freshness-alert",
    );
    expect(playbookPage).toBeDefined();
    expect(playbookPage!.title).toBe("Freshness Alert");
    expect(playbookPage!.markdown).toContain("type: Playbook");
    expect(playbookPage!.markdown).toContain(
      "source: https://gcp/alerts/freshness",
    );
    expect(playbookPage!.markdown).toContain("- oncall");
    expect(playbookPage!.markdown).toContain("ingestedAt: 1779978600000"); // Unix timestamp of ISO string
    expect(playbookPage!.markdown).toContain("[[orders|orders table]]"); // Link converted!
  });
});
