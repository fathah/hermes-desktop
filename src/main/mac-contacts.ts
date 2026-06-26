// mac-contacts.ts — opt-in sync of the macOS address book (which includes
// iCloud-synced iPhone contacts) into vault person rows.
//
// node-mac-contacts is a native, macOS-only OPTIONAL dependency. It is loaded
// lazily and its absence is tolerated, so the app builds and runs without it —
// the feature simply reports "unavailable" until it is installed and the OS
// grants Contacts access. The merge is non-destructive: vault memory
// (fragments/aliases/tags) is preserved; the Mac card supplies structured
// fields (email/phone/org). See planMacSync for the pure logic.
import { readFile } from "fs/promises";
import { join } from "path";
import { exportRowMarkdownTo } from "./sps-vault";
import { resolveSpsVaultDir } from "./sps-storage";
import { getSpsNoteIndex } from "./note-index";
import {
  PERSON_FOLDER,
  parsePersonFrontmatter,
  planMacSync,
  type MacContact,
  type MacContactsStatus,
  type MacSyncResult,
  type PersonFrontmatter,
} from "../shared/contacts";

interface RawMacContact {
  firstName?: string;
  lastName?: string;
  nickname?: string;
  emailAddresses?: string[];
  phoneNumbers?: string[];
  organizationName?: string;
}

interface MacContactsModule {
  requestAccess?: () => Promise<string> | string;
  getAuthStatus?: () => string;
  getAllContacts?: (extraProperties?: string[]) => RawMacContact[];
}

let cachedModule: MacContactsModule | null | undefined;

function loadModule(): MacContactsModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (process.platform !== "darwin") {
    cachedModule = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("node-mac-contacts") as MacContactsModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export function getMacContactsStatus(): MacContactsStatus {
  const mod = loadModule();
  if (!mod) return { available: false, authorized: false };
  const status = mod.getAuthStatus?.() ?? "Not Determined";
  return { available: true, authorized: status === "Authorized" };
}

function toMacContact(raw: RawMacContact): MacContact {
  const name =
    [raw.firstName, raw.lastName].filter(Boolean).join(" ").trim() ||
    raw.nickname ||
    "";
  return {
    name,
    ...(raw.emailAddresses?.[0] ? { email: raw.emailAddresses[0] } : {}),
    ...(raw.phoneNumbers?.[0] ? { phone: raw.phoneNumbers[0] } : {}),
    ...(raw.organizationName ? { organization: raw.organizationName } : {}),
  };
}

function serializeRow(props: Record<string, unknown>, body = ""): string {
  const lines = Object.keys(props)
    .filter((key) => props[key] !== undefined && props[key] !== "")
    .map((key) => `${key}: ${JSON.stringify(props[key])}`);
  if (!lines.length) return body;
  return `---\n${lines.join("\n")}\n---\n${body ? `\n${body}` : ""}`;
}

function rowIdFromPath(path: string): string {
  return path.replace(/\.md$/, "").split("/").pop() ?? path;
}

// Preserve any free-text body on an existing person row so a sync never clobbers
// notes the user wrote under the frontmatter.
async function existingBody(
  vaultDir: string,
  personId: string,
): Promise<string> {
  try {
    const md = await readFile(
      join(vaultDir, PERSON_FOLDER, `${personId}.md`),
      "utf-8",
    );
    const match = /^---\n[\s\S]*?\n---\n?/.exec(md);
    return match ? md.slice(match[0].length) : md;
  } catch {
    return "";
  }
}

/** Read the address book and merge it into vault person rows. */
export async function syncMacContacts(
  profile?: string,
): Promise<MacSyncResult> {
  const mod = loadModule();
  if (!mod?.getAllContacts) {
    return {
      available: false,
      authorized: false,
      added: 0,
      updated: 0,
      error: "node-mac-contacts is not installed",
    };
  }
  try {
    await Promise.resolve(mod.requestAccess?.());
  } catch {
    /* getAllContacts will surface a denial below */
  }
  if ((mod.getAuthStatus?.() ?? "") !== "Authorized") {
    return {
      available: true,
      authorized: false,
      added: 0,
      updated: 0,
      error: "Contacts access not granted",
    };
  }

  let raw: RawMacContact[];
  try {
    raw = mod.getAllContacts(["organizationName"]) ?? [];
  } catch (err) {
    return {
      available: true,
      authorized: true,
      added: 0,
      updated: 0,
      error: String(err),
    };
  }

  const macContacts = raw.map(toMacContact).filter((c) => c.name);
  const index = await getSpsNoteIndex(profile);
  const personRows = index.query({ scope: PERSON_FOLDER }) as Array<{
    path: string;
    props?: Record<string, unknown>;
  }>;
  const existing: Record<string, PersonFrontmatter> = {};
  for (const row of personRows) {
    existing[rowIdFromPath(row.path)] = parsePersonFrontmatter(row.props ?? {});
  }

  const writes = planMacSync(macContacts, existing);
  const vaultDir = resolveSpsVaultDir(profile);
  let added = 0;
  let updated = 0;
  for (const write of writes) {
    const body = write.isNew
      ? ""
      : await existingBody(vaultDir, write.personId);
    const ok = await exportRowMarkdownTo(
      vaultDir,
      PERSON_FOLDER,
      write.personId,
      serializeRow(write.props, body),
    );
    if (!ok) continue;
    if (write.isNew) added += 1;
    else updated += 1;
  }
  return { available: true, authorized: true, added, updated };
}
