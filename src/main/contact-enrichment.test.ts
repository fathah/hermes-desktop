// contact-enrichment.test.ts — the AI proposer that suggests new reachability
// fragments + tags for a contact. Pure prompt building + a gateway-backed
// proposer that NEVER throws (degrades to nothing when the LLM is unavailable).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEnrichmentMessages,
  proposeContactEnrichment,
} from "./contact-enrichment";
import { gatewayChat } from "./gateway-chat";
import type { PersonRef } from "../shared/contacts";

vi.mock("./gateway-chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gateway-chat")>();
  return { ...actual, gatewayChat: vi.fn() };
});

const PERSON: PersonRef = {
  id: "priya-sharma",
  name: "Priya Sharma",
  aliases: ["Priya"],
  tags: ["family"],
  fragments: [{ text: "wife" }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildEnrichmentMessages", () => {
  it("grounds the prompt in the contact's name, current data, and the context snippets", () => {
    const messages = buildEnrichmentMessages(PERSON, [
      "Priya handles the Linking Road lease renewal.",
    ]);
    expect(messages[0].role).toBe("system");
    const all = messages.map((m) => m.content).join("\n");
    expect(all).toContain("Priya Sharma");
    expect(all).toContain("Linking Road lease");
    expect(all.toLowerCase()).toContain("fragment");
    expect(all.toLowerCase()).toContain("json");
  });
});

describe("proposeContactEnrichment", () => {
  it("returns only the NEW fragments/tags the contact does not already have", async () => {
    vi.mocked(gatewayChat).mockResolvedValue(
      JSON.stringify({
        fragments: [{ text: "wife" }, { text: "runs BlueBop kitchen" }],
        tags: ["family", "cafe"],
      }),
    );
    const result = await proposeContactEnrichment(PERSON, ["…context…"]);
    expect(result.fragments).toEqual([{ text: "runs BlueBop kitchen" }]);
    expect(result.tags).toEqual(["cafe"]);
  });

  it("degrades to nothing when the gateway throws", async () => {
    vi.mocked(gatewayChat).mockRejectedValue(new Error("gateway down"));
    const result = await proposeContactEnrichment(PERSON, ["x"]);
    expect(result).toEqual({ fragments: [], tags: [] });
  });

  it("degrades to nothing when the model returns unparseable output", async () => {
    vi.mocked(gatewayChat).mockResolvedValue("sorry, I cannot help with that");
    const result = await proposeContactEnrichment(PERSON, ["x"]);
    expect(result).toEqual({ fragments: [], tags: [] });
  });
});
