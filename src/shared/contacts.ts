// contacts.ts — shared contract for the personal-CRM layer.
//
// Every contact is a vault person-page (schema:"person") whose frontmatter
// carries structured contact fields plus rich episodic fragments ("met at
// BlueBop", "friend of Sanjay", "son's name is Haresh"). Names are poor memory
// keys, so a person is reachable by ANY fragment/alias/tag — that is what makes
// a delegated task ("nag wife about X") findable. "Me" is a first-class person
// (SELF_PERSON_ID), the default task assignee.

/** The canonical person id for "Me" (reuses the seeded `you` record). */
export const SELF_PERSON_ID = "you";

/** Folder-backed query database that holds one markdown row per contact. */
export const PERSON_FOLDER = "people";

/** A readable, wikilink-friendly row id from a display name ("" if not derivable). */
export function slugifyPersonId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

/** Optional context for logging a channel hand-off against a contact row. */
export interface ContactChannelContext {
  personId?: string;
  personName?: string;
  followUpAt?: string;
  note?: string;
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
  followUpAt?: string;
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

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function asFragments(value: unknown): ContactFragment[] {
  if (!Array.isArray(value)) return [];
  const fragments: ContactFragment[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      fragments.push({ text: item.trim() });
    } else if (item && typeof item === "object" && "text" in item) {
      const obj = item as Record<string, unknown>;
      if (typeof obj.text === "string" && obj.text.trim()) {
        fragments.push({
          text: obj.text.trim(),
          ...(typeof obj.when === "string" ? { when: obj.when } : {}),
          ...(typeof obj.source === "string" ? { source: obj.source } : {}),
        });
      }
    }
  }
  return fragments;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Parse a person page's frontmatter props into a typed PersonFrontmatter. */
export function parsePersonFrontmatter(
  props: Record<string, unknown>,
): PersonFrontmatter {
  return {
    aliases: asStringArray(props.aliases),
    tags: asStringArray(props.tags),
    fragments: asFragments(props.fragments),
    ...(asString(props.email) ? { email: asString(props.email) } : {}),
    ...(asString(props.phone) ? { phone: asString(props.phone) } : {}),
    ...(asString(props.telegramChatId)
      ? { telegramChatId: asString(props.telegramChatId) }
      : {}),
    ...(asString(props.whatsappPhone)
      ? { whatsappPhone: asString(props.whatsappPhone) }
      : {}),
    ...(asString(props.organization)
      ? { organization: asString(props.organization) }
      : {}),
    ...(asString(props.followUpAt)
      ? { followUpAt: asString(props.followUpAt) }
      : {}),
  };
}

/** New fragments + tags to propose for / merge into a contact. */
export interface ContactEnrichment {
  fragments: ContactFragment[];
  tags: string[];
}

/**
 * Coerce raw LLM output into the NEW fragments/tags worth proposing for a
 * contact: total + best-effort (bad input → empty), blanks dropped, and
 * filtered against what the person already has so a proposal never restates a
 * known fact. Fragment dedupe is by text, tag dedupe by value — both
 * case-insensitive.
 */
export function parseContactEnrichment(
  raw: unknown,
  existing: PersonFrontmatter,
): ContactEnrichment {
  if (!raw || typeof raw !== "object") return { fragments: [], tags: [] };
  const obj = raw as Record<string, unknown>;
  const haveFragments = new Set(
    (existing.fragments ?? []).map((f) => f.text.trim().toLowerCase()),
  );
  const haveTags = new Set((existing.tags ?? []).map((t) => t.toLowerCase()));
  const fragments = asFragments(obj.fragments).filter(
    (f) => !haveFragments.has(f.text.toLowerCase()),
  );
  const tags = asStringArray(obj.tags)
    .map((t) => t.trim())
    .filter((t) => t && !haveTags.has(t.toLowerCase()));
  return { fragments, tags };
}

/**
 * Append proposed fragments/tags onto a contact's existing frontmatter,
 * preserving every other field (email/phone/org/…) and the order of existing
 * entries. Defensive case-insensitive dedupe so a double-apply can't duplicate
 * a row — the vault stays authoritative for memory (cf. mergeMacContact).
 */
export function mergeContactEnrichment(
  existing: PersonFrontmatter,
  add: Partial<ContactEnrichment>,
): PersonFrontmatter {
  const seenFragments = new Set(
    (existing.fragments ?? []).map((f) => f.text.trim().toLowerCase()),
  );
  const fragments = [...(existing.fragments ?? [])];
  for (const frag of add.fragments ?? []) {
    const key = frag.text.trim().toLowerCase();
    if (!key || seenFragments.has(key)) continue;
    seenFragments.add(key);
    fragments.push(frag);
  }
  const seenTags = new Set((existing.tags ?? []).map((t) => t.toLowerCase()));
  const tags = [...(existing.tags ?? [])];
  for (const tag of add.tags ?? []) {
    const key = tag.toLowerCase();
    if (!key || seenTags.has(key)) continue;
    seenTags.add(key);
    tags.push(tag);
  }
  return {
    ...existing,
    ...(fragments.length ? { fragments } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

/** Build a resolved PersonRef from a person page's id, title, and props. */
export function personRefFrom(
  id: string,
  name: string,
  props: Record<string, unknown>,
): PersonRef {
  return {
    id,
    name: name || id,
    isSelf: id === SELF_PERSON_ID,
    ...parsePersonFrontmatter(props),
  };
}

/** A contact read from the macOS address book (iCloud-synced iPhone cards too). */
export interface MacContact {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
}

/** Whether the native Contacts integration is installed and OS-authorized. */
export interface MacContactsStatus {
  available: boolean;
  authorized: boolean;
}

/** Outcome of a Mac contacts sync. */
export interface MacSyncResult {
  available: boolean;
  authorized: boolean;
  added: number;
  updated: number;
  error?: string;
}

/**
 * Merge a Mac address-book card into an existing person's frontmatter. Conflict
 * policy: the vault is authoritative for user memory (aliases/tags/fragments are
 * preserved untouched), the Mac card is authoritative for structured contact
 * fields (email/phone/org fill or update). Telegram/WhatsApp ids are vault-only.
 */
export function mergeMacContact(
  existing: PersonFrontmatter,
  mac: MacContact,
): PersonFrontmatter {
  return {
    ...existing,
    ...(mac.email ? { email: mac.email } : {}),
    ...(mac.phone ? { phone: mac.phone } : {}),
    ...(mac.organization ? { organization: mac.organization } : {}),
  };
}

/** One person row to write as a result of a Mac sync. */
export interface MacSyncWrite {
  personId: string;
  props: Record<string, unknown>;
  isNew: boolean;
}

/**
 * Pure plan for a Mac contacts sync: for each card, derive a stable person id,
 * merge into the existing contact's frontmatter (preserving fragments), and
 * produce the row props to write. Cards with no usable name are skipped.
 */
export function planMacSync(
  macContacts: MacContact[],
  existing: Record<string, PersonFrontmatter>,
): MacSyncWrite[] {
  const writes: MacSyncWrite[] = [];
  for (const mac of macContacts) {
    const name = mac.name.trim();
    if (!name) continue;
    const personId = slugifyPersonId(name);
    if (!personId) continue;
    const existingFm = existing[personId];
    const merged = mergeMacContact(existingFm ?? {}, mac);
    writes.push({
      personId,
      props: personToRowProps(name, merged),
      isNew: existingFm === undefined,
    });
  }
  return writes;
}

/** Frontmatter props for a person row (title + schema + present fields). */
export function personToRowProps(
  name: string,
  fm: PersonFrontmatter,
): Record<string, unknown> {
  const props: Record<string, unknown> = { title: name, schema: "person" };
  if (fm.aliases?.length) props.aliases = fm.aliases;
  if (fm.tags?.length) props.tags = fm.tags;
  if (fm.fragments?.length) props.fragments = fm.fragments;
  if (fm.email) props.email = fm.email;
  if (fm.phone) props.phone = fm.phone;
  if (fm.telegramChatId) props.telegramChatId = fm.telegramChatId;
  if (fm.whatsappPhone) props.whatsappPhone = fm.whatsappPhone;
  if (fm.organization) props.organization = fm.organization;
  if (fm.followUpAt) props.followUpAt = fm.followUpAt;
  return props;
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
