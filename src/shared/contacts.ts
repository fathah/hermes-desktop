// contacts.ts — shared contract for the personal-CRM layer.
//
// Every contact is a vault person-page (schema:"person") whose frontmatter
// carries structured contact fields plus rich episodic fragments ("met at
// BlueBop", "friend of Sanjay", "son's name is Haresh"). Names are poor memory
// keys, so a person is reachable by ANY fragment/alias/tag — that is what makes
// a delegated task ("nag wife about X") findable. "Me" is a first-class person
// (SELF_PERSON_ID), the default task assignee.

/** The canonical person-page id for "Me" (reuses the seeded `you` record). */
export const SELF_PERSON_ID = "you";

/** A messaging channel we can hand off to (P7). */
export type ChannelKind =
  | "email"
  | "sms"
  | "imessage"
  | "whatsapp"
  | "telegram";

export interface ContactChannel {
  kind: ChannelKind;
  /** The address/number/id used to reach the person on this channel. */
  value: string;
}

/** One episodic memory about a contact. `when`/`source` are provenance. */
export interface ContactFragment {
  text: string;
  when?: string;
  source?: string;
}

/** Structured frontmatter stored on a person page (all optional). */
export interface PersonFrontmatter {
  aliases?: string[];
  email?: string;
  phone?: string;
  telegramChatId?: string;
  whatsappPhone?: string;
  organization?: string;
  tags?: string[];
  fragments?: ContactFragment[];
}

/** A resolved person: page id + display name + frontmatter. */
export interface PersonRef extends PersonFrontmatter {
  id: string;
  name: string;
  isSelf?: boolean;
}

// Channel hand-off priority when a task opts into auto-messaging its assignee
// and several channels are available. WhatsApp first (dominant for this user),
// then Telegram/iMessage, with email as the universal fallback.
const CHANNEL_PRIORITY: ChannelKind[] = [
  "whatsapp",
  "telegram",
  "imessage",
  "sms",
  "email",
];

/** Which channels a person can be reached on, given their frontmatter. */
export function availableChannels(fm: PersonFrontmatter): ContactChannel[] {
  const channels: ContactChannel[] = [];
  const whatsapp = (fm.whatsappPhone || fm.phone || "").trim();
  if (whatsapp) channels.push({ kind: "whatsapp", value: whatsapp });
  const telegram = (fm.telegramChatId || "").trim();
  if (telegram) channels.push({ kind: "telegram", value: telegram });
  const phone = (fm.phone || "").trim();
  if (phone) {
    channels.push({ kind: "imessage", value: phone });
    channels.push({ kind: "sms", value: phone });
  }
  const email = (fm.email || "").trim();
  if (email) channels.push({ kind: "email", value: email });
  return channels;
}

/** The single channel to use for an auto-send, by priority. Null if none. */
export function preferredChannel(fm: PersonFrontmatter): ContactChannel | null {
  const channels = availableChannels(fm);
  for (const kind of CHANNEL_PRIORITY) {
    const match = channels.find((c) => c.kind === kind);
    if (match) return match;
  }
  return null;
}

/**
 * Does this person match a free-text query? Searches name, aliases, tags, and
 * fragment text — case-insensitive substring — so a contact surfaces from any
 * remembered scrap (#bluebop, "Sanjay", an org). Empty query matches all.
 */
export function personMatchesQuery(person: PersonRef, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystacks: string[] = [person.name, person.id];
  if (person.aliases) haystacks.push(...person.aliases);
  if (person.organization) haystacks.push(person.organization);
  if (person.tags) haystacks.push(...person.tags);
  if (person.fragments) haystacks.push(...person.fragments.map((f) => f.text));
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}
