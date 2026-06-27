// contact-enrichment.ts — the AI proposer behind "Suggest details" for a
// contact. Given a person's current row and some context snippets that mention
// them, it asks the gateway for durable reachability fragments + categorization
// tags, then returns only the items the contact does not already have. Like the
// task classifier (task-triage.ts) it reuses gateway-chat and NEVER throws —
// when the gateway is down or the output is garbage it proposes nothing.
import { gatewayChat, extractJson, type ChatMessage } from "./gateway-chat";
import {
  parseContactEnrichment,
  type ContactEnrichment,
  type PersonRef,
} from "../shared/contacts";

const ENRICH_MAX_TOKENS = 400;

const SYSTEM_PROMPT = [
  "You maintain a personal CRM. Given a contact and snippets of text that mention them,",
  "extract DURABLE facts that make the contact easier to find or act on later.",
  "",
  "Return STRICT JSON only, shaped:",
  '{ "fragments": [{ "text": "<short reachability fact>" }], "tags": ["<lowercase-tag>"] }',
  "",
  'A fragment is a terse, durable scrap: a role/relationship ("wife", "cafe chef"),',
  'an affiliation, or what they handle ("handles Linking Rd lease"). A tag is a single',
  "lowercase category word. Rules: only facts SUPPORTED by the snippets; never restate",
  "what the contact already has; no transient events; omit anything you are unsure of.",
  'If there is nothing durable to add, return {"fragments":[],"tags":[]}.',
].join("\n");

/** Build the chat messages for an enrichment proposal (pure). */
export function buildEnrichmentMessages(
  person: PersonRef,
  snippets: string[],
): ChatMessage[] {
  const known = {
    name: person.name,
    aliases: person.aliases ?? [],
    tags: person.tags ?? [],
    fragments: (person.fragments ?? []).map((f) => f.text),
  };
  const user = [
    `Contact: ${person.name}`,
    `Already known (do not repeat): ${JSON.stringify(known)}`,
    "",
    "Context snippets mentioning this contact:",
    ...snippets.map((s, i) => `${i + 1}. ${s}`),
  ].join("\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/**
 * Propose new fragments + tags for a contact from context snippets. Returns the
 * NEW items only (filtered against the contact's current row). Never throws:
 * gateway failure or unparseable output yields an empty proposal.
 */
export async function proposeContactEnrichment(
  person: PersonRef,
  snippets: string[],
  profile?: string,
): Promise<ContactEnrichment> {
  try {
    const messages = buildEnrichmentMessages(person, snippets);
    const content = await gatewayChat(messages, ENRICH_MAX_TOKENS, profile);
    const parsed = extractJson(content);
    return parseContactEnrichment(parsed, person);
  } catch {
    return { fragments: [], tags: [] };
  }
}
