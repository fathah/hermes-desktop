import { describe, expect, it } from "vitest";
import {
  availableChannels,
  mergeContactEnrichment,
  mergeMacContact,
  parseContactEnrichment,
  parsePersonFrontmatter,
  personMatchesQuery,
  personRefFrom,
  personToRowProps,
  planMacSync,
  preferredChannel,
  slugifyPersonId,
  SELF_PERSON_ID,
  type MacContact,
  type PersonFrontmatter,
  type PersonRef,
} from "./contacts";

describe("availableChannels", () => {
  it("derives whatsapp/imessage/sms/email from the fields present", () => {
    const fm: PersonFrontmatter = {
      phone: "+919812345678",
      email: "x@y.com",
      telegramChatId: "12345",
    };
    const kinds = availableChannels(fm).map((c) => c.kind);
    expect(kinds).toContain("whatsapp");
    expect(kinds).toContain("telegram");
    expect(kinds).toContain("imessage");
    expect(kinds).toContain("sms");
    expect(kinds).toContain("email");
  });

  it("prefers an explicit whatsappPhone over the generic phone", () => {
    const fm: PersonFrontmatter = { phone: "111", whatsappPhone: "222" };
    const whatsapp = availableChannels(fm).find((c) => c.kind === "whatsapp");
    expect(whatsapp?.value).toBe("222");
  });

  it("returns nothing for an empty contact", () => {
    expect(availableChannels({})).toEqual([]);
  });
});

describe("preferredChannel", () => {
  it("picks whatsapp first by priority", () => {
    const fm: PersonFrontmatter = { phone: "1", email: "x@y.com" };
    expect(preferredChannel(fm)?.kind).toBe("whatsapp");
  });

  it("falls back to email when no phone/telegram exists", () => {
    expect(preferredChannel({ email: "x@y.com" })?.kind).toBe("email");
  });

  it("is null when no channel is reachable", () => {
    expect(preferredChannel({})).toBeNull();
  });
});

describe("personMatchesQuery", () => {
  const person: PersonRef = {
    id: "p-haresh",
    name: "Priya",
    aliases: ["Wife"],
    organization: "BlueBop Cafe",
    tags: ["bluebop", "family"],
    fragments: [
      { text: "friend of Sanjay & Shafali" },
      { text: "son's name is Haresh" },
    ],
  };

  it("matches the empty query (all contacts)", () => {
    expect(personMatchesQuery(person, "")).toBe(true);
  });

  it("matches by name, alias, tag, org, and fragment text", () => {
    expect(personMatchesQuery(person, "priya")).toBe(true);
    expect(personMatchesQuery(person, "wife")).toBe(true);
    expect(personMatchesQuery(person, "#bluebop".replace("#", ""))).toBe(true);
    expect(personMatchesQuery(person, "cafe")).toBe(true);
    expect(personMatchesQuery(person, "sanjay")).toBe(true);
    expect(personMatchesQuery(person, "haresh")).toBe(true);
  });

  it("is case-insensitive and does not match unrelated text", () => {
    expect(personMatchesQuery(person, "SANJAY")).toBe(true);
    expect(personMatchesQuery(person, "secretary")).toBe(false);
  });
});

describe("parsePersonFrontmatter", () => {
  it("coerces arrays and object/string fragments from raw props", () => {
    const fm = parsePersonFrontmatter({
      aliases: ["Wife", "P"],
      tags: "bluebop, family",
      fragments: [
        { text: "met at BlueBop", when: "2025" },
        "son's name is Haresh",
        { nope: true },
      ],
      email: "p@x.com",
      followUpAt: "2026-07-09",
      organization: "  ",
    });
    expect(fm.aliases).toEqual(["Wife", "P"]);
    expect(fm.tags).toEqual(["bluebop", "family"]);
    expect(fm.fragments).toEqual([
      { text: "met at BlueBop", when: "2025" },
      { text: "son's name is Haresh" },
    ]);
    expect(fm.email).toBe("p@x.com");
    expect(fm.followUpAt).toBe("2026-07-09");
    expect(fm.organization).toBeUndefined(); // blank trimmed away
  });
});

describe("personRefFrom", () => {
  it("marks the self id and falls back name to id", () => {
    expect(personRefFrom(SELF_PERSON_ID, "You", {}).isSelf).toBe(true);
    expect(personRefFrom("p-x", "", {}).name).toBe("p-x");
    expect(personRefFrom("p-x", "Asha", {}).isSelf).toBe(false);
  });
});

describe("personToRowProps", () => {
  it("always sets title + schema and only includes present fields", () => {
    const props = personToRowProps("Priya", {
      tags: ["family"],
      phone: "123",
      followUpAt: "2026-07-09",
    });
    expect(props).toMatchObject({
      title: "Priya",
      schema: "person",
      tags: ["family"],
      phone: "123",
      followUpAt: "2026-07-09",
    });
    expect(props).not.toHaveProperty("email");
  });
});

describe("slugifyPersonId", () => {
  it("makes a wikilink-friendly slug, empty when nothing usable", () => {
    expect(slugifyPersonId("Priya Sharma")).toBe("priya-sharma");
    expect(slugifyPersonId("  !!!  ")).toBe("");
  });
});

describe("mergeMacContact", () => {
  it("preserves vault memory and takes structured fields from the card", () => {
    const existing: PersonFrontmatter = {
      aliases: ["Wife"],
      tags: ["family"],
      fragments: [{ text: "met at BlueBop" }],
      email: "old@x.com",
      telegramChatId: "555",
    };
    const mac: MacContact = {
      name: "Priya",
      email: "new@x.com",
      phone: "+91 98765",
      organization: "BlueBop",
    };
    const merged = mergeMacContact(existing, mac);
    // memory preserved
    expect(merged.fragments).toEqual([{ text: "met at BlueBop" }]);
    expect(merged.aliases).toEqual(["Wife"]);
    expect(merged.telegramChatId).toBe("555");
    // structured fields updated from the card
    expect(merged.email).toBe("new@x.com");
    expect(merged.phone).toBe("+91 98765");
    expect(merged.organization).toBe("BlueBop");
  });
});

describe("planMacSync", () => {
  it("creates new contacts and merges into existing ones by slug", () => {
    const macContacts: MacContact[] = [
      { name: "Priya Sharma", phone: "111" },
      { name: "New Person", email: "n@x.com" },
      { name: "   ", email: "skip@x.com" }, // no usable name
    ];
    const existing: Record<string, PersonFrontmatter> = {
      "priya-sharma": { fragments: [{ text: "wife" }] },
    };
    const writes = planMacSync(macContacts, existing);
    expect(writes).toHaveLength(2);
    const priya = writes.find((w) => w.personId === "priya-sharma");
    expect(priya?.isNew).toBe(false);
    expect(priya?.props).toMatchObject({ title: "Priya Sharma", phone: "111" });
    // the existing fragment survives the sync
    expect(priya?.props.fragments).toEqual([{ text: "wife" }]);
    const fresh = writes.find((w) => w.personId === "new-person");
    expect(fresh?.isNew).toBe(true);
  });
});

describe("mergeContactEnrichment", () => {
  it("appends new fragments and tags while preserving existing data", () => {
    const existing: PersonFrontmatter = {
      email: "p@x.com",
      tags: ["family"],
      fragments: [{ text: "wife" }],
    };
    const merged = mergeContactEnrichment(existing, {
      fragments: [{ text: "handles Linking Rd lease", source: "enrichment" }],
      tags: ["realestate"],
    });
    expect(merged.email).toBe("p@x.com");
    expect(merged.tags).toEqual(["family", "realestate"]);
    expect(merged.fragments).toEqual([
      { text: "wife" },
      { text: "handles Linking Rd lease", source: "enrichment" },
    ]);
  });

  it("dedupes fragments by text and tags case-insensitively", () => {
    const existing: PersonFrontmatter = {
      tags: ["Family"],
      fragments: [{ text: "Wife" }],
    };
    const merged = mergeContactEnrichment(existing, {
      fragments: [{ text: "wife" }, { text: "cafe partner" }],
      tags: ["family", "cafe"],
    });
    expect(merged.fragments).toEqual([
      { text: "Wife" },
      { text: "cafe partner" },
    ]);
    expect(merged.tags).toEqual(["Family", "cafe"]);
  });
});

describe("parseContactEnrichment", () => {
  it("coerces LLM JSON into new fragments/tags, dropping ones already present", () => {
    const existing: PersonFrontmatter = {
      tags: ["family"],
      fragments: [{ text: "wife" }],
    };
    const parsed = parseContactEnrichment(
      {
        fragments: [
          { text: "wife" }, // already present → dropped
          { text: "runs BlueBop kitchen" },
          { text: "   " }, // blank → dropped
        ],
        tags: ["family", "cafe", ""],
      },
      existing,
    );
    expect(parsed.fragments).toEqual([{ text: "runs BlueBop kitchen" }]);
    expect(parsed.tags).toEqual(["cafe"]);
  });

  it("returns empty arrays for malformed or empty LLM output", () => {
    const existing: PersonFrontmatter = {};
    expect(parseContactEnrichment(null, existing)).toEqual({
      fragments: [],
      tags: [],
    });
    expect(parseContactEnrichment({ nonsense: 1 }, existing)).toEqual({
      fragments: [],
      tags: [],
    });
  });
});
