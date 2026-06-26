import { describe, expect, it } from "vitest";
import {
  availableChannels,
  personMatchesQuery,
  preferredChannel,
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
