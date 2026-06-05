import { execFileSync } from "child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  cpSync,
} from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { homedir } from "os";
import {
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  hermesCliArgs,
  getEnhancedPath,
} from "./installer";
import { isValidNamedProfileName, profileHome } from "./utils";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

export interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

export interface SkillSearchResult {
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
}

/**
 * Parse SKILL.md frontmatter (YAML between --- markers) for name/description.
 */
function parseSkillFrontmatter(content: string): {
  name: string;
  description: string;
} {
  const result = { name: "", description: "" };

  // Check for YAML frontmatter
  if (!content.startsWith("---")) {
    // Fall back to first heading and first paragraph
    const headingMatch = content.match(/^#\s+(.+)/m);
    if (headingMatch) result.name = headingMatch[1].trim();
    const paraMatch = content.match(/^(?!#)(?!---).+/m);
    if (paraMatch) result.description = paraMatch[0].trim().slice(0, 120);
    return result;
  }

  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return result;

  const frontmatter = content.slice(3, endIdx);

  const nameMatch = frontmatter.match(/^\s*name:\s*["']?([^"'\n]+)["']?\s*$/m);
  if (nameMatch) result.name = nameMatch[1].trim();

  const descMatch = frontmatter.match(
    /^\s*description:\s*["']?([^"'\n]+)["']?\s*$/m,
  );
  if (descMatch) result.description = descMatch[1].trim();

  return result;
}

/**
 * Walk a skills-shaped root (`<root>/<category>/<skill-name>/SKILL.md`) into a
 * sorted InstalledSkill[]. Shared by the enabled (`skills/`) and disabled
 * (`skills-disabled/`) listings.
 */
function collectSkillsFromRoot(root: string): InstalledSkill[] {
  if (!existsSync(root)) return [];
  const skills: InstalledSkill[] = [];
  try {
    for (const category of readdirSync(root)) {
      const categoryPath = join(root, category);
      if (!statSync(categoryPath).isDirectory()) continue;

      for (const entry of readdirSync(categoryPath)) {
        const entryPath = join(categoryPath, entry);
        if (!statSync(entryPath).isDirectory()) continue;

        const skillFile = join(entryPath, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        try {
          const content = readFileSync(skillFile, "utf-8").slice(0, 4000);
          const meta = parseSkillFrontmatter(content);
          skills.push({
            name: meta.name || entry,
            category,
            description: meta.description || "",
            path: entryPath,
          });
        } catch {
          skills.push({
            name: entry,
            category,
            description: "",
            path: entryPath,
          });
        }
      }
    }
  } catch {
    // ignore
  }
  return skills.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

/** The active profile's enabled skills root (`<profileHome>/skills`). */
function profileSkillsRoot(profile?: string): string {
  return join(profileHome(profile), "skills");
}

/** The active profile's disabled-skills root (`<profileHome>/skills-disabled`). */
function profileDisabledRoot(profile?: string): string {
  return join(profileHome(profile), "skills-disabled");
}

/**
 * Walk the skills directory to find all installed (enabled) skills.
 * Structure: skills/<category>/<skill-name>/SKILL.md
 */
export function listInstalledSkills(profile?: string): InstalledSkill[] {
  return collectSkillsFromRoot(profileSkillsRoot(profile));
}

/** Skills that were disabled (moved to `skills-disabled/`, gateway ignores). */
export function listDisabledSkills(profile?: string): InstalledSkill[] {
  return collectSkillsFromRoot(profileDisabledRoot(profile));
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function pathIsInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function isProfileSkillFile(skillFile: string): boolean {
  const profilesRoot = realOrResolved(join(HERMES_HOME, "profiles"));
  if (!pathIsInside(profilesRoot, skillFile)) return false;

  const parts = relative(profilesRoot, skillFile).split(/[\\/]+/);
  return (
    parts.length >= 4 &&
    isValidNamedProfileName(parts[0]) &&
    parts[1] === "skills"
  );
}

function isAllowedSkillFile(skillFile: string): boolean {
  const allowedRoots = [
    join(HERMES_HOME, "skills"),
    join(HERMES_REPO, "skills"),
  ].map(realOrResolved);

  return (
    allowedRoots.some((root) => pathIsInside(root, skillFile)) ||
    isProfileSkillFile(skillFile)
  );
}

/**
 * Get the full content of a SKILL.md for the detail view.
 */
export function getSkillContent(skillPath: string): string {
  if (typeof skillPath !== "string" || skillPath.trim() === "") return "";

  const skillFile = resolve(skillPath, "SKILL.md");
  if (!existsSync(skillFile)) return "";

  try {
    const realSkillFile = realpathSync(skillFile);
    if (!isAllowedSkillFile(realSkillFile)) return "";
    return readFileSync(realSkillFile, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Search the skill registry via the hermes CLI.
 */
export function searchSkills(query: string): SkillSearchResult[] {
  try {
    const output = execFileSync(
      HERMES_PYTHON,
      hermesCliArgs(["skills", "browse", "--query", query, "--json"]),
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
    );

    const text = output.toString().trim();
    if (!text) return [];

    // Try to parse JSON output
    try {
      const results = JSON.parse(text);
      if (Array.isArray(results)) {
        return results.map((r: Record<string, string>) => ({
          name: r.name || "",
          description: r.description || "",
          category: r.category || "",
          source: r.source || "",
          installed: false,
        }));
      }
    } catch {
      // If JSON parsing fails, the CLI may not support --json flag
      // Fall back to listing bundled skills that match
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * List bundled skills from the hermes-agent repo.
 */
export function listBundledSkills(): SkillSearchResult[] {
  const bundledDir = join(HERMES_REPO, "skills");
  if (!existsSync(bundledDir)) return [];

  const skills: SkillSearchResult[] = [];

  try {
    const categories = readdirSync(bundledDir);

    for (const category of categories) {
      const catPath = join(bundledDir, category);
      if (!statSync(catPath).isDirectory()) continue;

      const entries = readdirSync(catPath);
      for (const entry of entries) {
        const entryPath = join(catPath, entry);
        if (!statSync(entryPath).isDirectory()) continue;

        const skillFile = join(entryPath, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        try {
          const content = readFileSync(skillFile, "utf-8").slice(0, 4000);
          const meta = parseSkillFrontmatter(content);

          skills.push({
            name: meta.name || entry,
            description: meta.description || "",
            category,
            source: "bundled",
            installed: false,
          });
        } catch {
          skills.push({
            name: entry,
            description: "",
            category,
            source: "bundled",
            installed: false,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  return skills.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

/**
 * Failure markers seen in `hermes skills install/uninstall` stdout when the
 * CLI exits 0 despite the operation having failed. Observed live against
 * Hermes Agent v0.14.0 (2026.5.16) on 2026-05-22:
 *
 *   $ hermes skills install concept-diagram --yes
 *   Resolving 'concept-diagram'...
 *   No exact match for 'concept-diagram'. Did you mean one of these?
 *     concept-diagrams - official/creative/concept-diagrams
 *   $ echo $?    -> 0
 *
 * Without this classifier the desktop would trust the 0 exit and report
 * a successful install, leaving the user with a button that flashed and
 * did nothing (issue #310).
 */
const SKILL_CLI_FAILURE_MARKERS: readonly RegExp[] = [
  /\bNo exact match for\b/,
  /\bNo skill named\b/,
  /^Error:/m,
];

export interface SkillCliResult {
  success: boolean;
  error?: string;
}

/**
 * Classify the combined output of `hermes skills install/uninstall` after
 * the subprocess has exited 0. The CLI exits 0 even on resolution failure
 * (issue #310), so the exit code alone is not enough. When a known failure
 * marker is present, surface the message (minus the leading
 * "Resolving '...'" progress line) as `error` so the renderer can display
 * it; otherwise treat the operation as successful.
 *
 * Pure — no I/O, no globals — so it is cheap to unit-test exhaustively.
 */
export function classifySkillCliOutput(
  stdout: string,
  stderr: string = "",
): SkillCliResult {
  const combined = `${stdout}\n${stderr}`;
  if (SKILL_CLI_FAILURE_MARKERS.some((re) => re.test(combined))) {
    return { success: false, error: extractSkillCliMessage(combined) };
  }
  return { success: true };
}

function extractSkillCliMessage(output: string): string {
  // Strip the leading "Resolving '<name>'..." progress line — pure noise
  // for the user. Keep the rest verbatim so suggestions like
  // "Did you mean concept-diagrams" reach the renderer.
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^Resolving '.*'\.\.\.$/.test(l));
  return lines.join("\n").trim() || output.trim();
}

export function installSkill(
  identifier: string,
  profile?: string,
): SkillCliResult {
  try {
    const args = hermesCliArgs(["skills", "install", identifier, "--yes"]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }

    const stdout = execFileSync(HERMES_PYTHON, args, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 60000,
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
    // Exit 0 alone is not proof of success — the CLI exits 0 on resolution
    // failure too. Inspect the captured stdout for known failure markers
    // (issue #310).
    return classifySkillCliOutput(stdout?.toString() ?? "");
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const msg = (e.stderr?.toString() || e.message || "").trim();
    return {
      success: false,
      error: msg || e.stdout?.toString()?.trim() || "Install failed.",
    };
  }
}

export function uninstallSkill(name: string, profile?: string): SkillCliResult {
  try {
    const args = hermesCliArgs(["skills", "uninstall", name]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }

    const stdout = execFileSync(HERMES_PYTHON, args, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 30000,
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
    // Same exit-0-on-failure shape as install (#310) — classify the
    // captured output before claiming success.
    return classifySkillCliOutput(stdout?.toString() ?? "");
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const msg = (e.stderr?.toString() || e.message || "").trim();
    return {
      success: false,
      error: msg || e.stdout?.toString()?.trim() || "Uninstall failed.",
    };
  }
}

// ─────────────────────── local authoring / management ───────────────────────
// All of the below operate on the LOCAL filesystem only (the active profile's
// skills dirs). Writes are gated by a WRITE allowlist that is deliberately
// narrower than the read allowlist: only the profile's own skills/ and
// skills-disabled/ — never HERMES_REPO/skills (bundled, read-only).

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A path segment safe to use as a category/folder name (no traversal). */
function isSafeSegment(s: string): boolean {
  return SLUG_RE.test(s);
}

/** Lowercase-kebab a free-text name into a folder-safe slug. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Strip characters that would break a single-line quoted YAML scalar. */
function yamlSafe(s: string): string {
  return s.replace(/["\r\n]/g, " ").trim();
}

/**
 * A write target is allowed ONLY inside the active profile's skills/ or
 * skills-disabled/ roots. `resolve` collapses any `..`, so a traversal escapes
 * the root and fails pathIsInside. Bundled repo skills are intentionally absent.
 */
function isWritableSkillTarget(target: string, profile?: string): boolean {
  const roots = [profileSkillsRoot(profile), profileDisabledRoot(profile)].map(
    realOrResolved,
  );
  const real = realOrResolved(target);
  return roots.some((root) => pathIsInside(root, real));
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  category?: string;
  body?: string;
  profile?: string;
}

/** Author a new skill: write `<profileHome>/skills/<category>/<slug>/SKILL.md`. */
export function createSkill(
  input: CreateSkillInput,
): SkillCliResult & { path?: string } {
  const name = (input.name || "").trim();
  if (!name) return { success: false, error: "A name is required." };
  const slug = slugify(name);
  if (!slug)
    return { success: false, error: "Name must contain letters or numbers." };
  const category = (input.category || "custom").trim().toLowerCase();
  if (!isSafeSegment(category))
    return { success: false, error: "Invalid category name." };

  const dir = join(profileSkillsRoot(input.profile), category, slug);
  if (!isWritableSkillTarget(dir, input.profile))
    return { success: false, error: "Refused: outside the skills directory." };
  const skillFile = join(dir, "SKILL.md");
  if (existsSync(skillFile))
    return {
      success: false,
      error: `A skill "${slug}" already exists in "${category}".`,
    };

  const desc = yamlSafe(input.description || "");
  const body =
    input.body?.trim() ||
    `# ${name}\n\nDescribe what this skill does and when the agent should use it.`;
  const content = `---\nname: "${yamlSafe(name)}"\ndescription: "${desc}"\n---\n\n${body}\n`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(skillFile, content, "utf-8");
    return { success: true, path: dir };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/** Overwrite an installed skill's SKILL.md (profile dirs only; not bundled). */
export function writeSkillContent(
  skillPath: string,
  content: string,
  profile?: string,
): SkillCliResult {
  if (typeof skillPath !== "string" || skillPath.trim() === "")
    return { success: false, error: "Invalid skill path." };
  if (typeof content !== "string")
    return { success: false, error: "Invalid content." };
  const dir = resolve(skillPath);
  if (!isWritableSkillTarget(dir, profile))
    return { success: false, error: "This skill is read-only." };
  const skillFile = join(dir, "SKILL.md");
  if (!existsSync(skillFile))
    return { success: false, error: "Skill not found." };
  try {
    writeFileSync(skillFile, content, "utf-8");
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Enable/disable a single skill by moving its folder between `skills/` and
 * `skills-disabled/`. The gateway reads only `skills/`, so a disabled skill
 * disappears from the agent with no config change. `skillPath` is the skill's
 * current directory (from listInstalled/listDisabled).
 */
export function setSkillEnabled(
  skillPath: string,
  enabled: boolean,
  profile?: string,
): SkillCliResult {
  const src = realOrResolved(resolve(skillPath));
  const enabledRoot = realOrResolved(profileSkillsRoot(profile));
  const disabledRoot = realOrResolved(profileDisabledRoot(profile));
  // Enabling moves FROM disabled→enabled; disabling moves FROM enabled→disabled.
  const fromRoot = enabled ? disabledRoot : enabledRoot;
  const toRoot = enabled ? enabledRoot : disabledRoot;

  if (!pathIsInside(fromRoot, src))
    return { success: false, error: "Skill is not in the expected location." };
  const rel = relative(fromRoot, src); // "<category>/<name>"
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    return { success: false, error: "Invalid skill location." };
  const dest = join(toRoot, rel);
  if (existsSync(dest))
    return {
      success: false,
      error: "A skill with that name already exists in the target.",
    };
  try {
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(src, dest);
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export interface LocalSkill {
  name: string;
  description: string;
  category: string;
  source: string;
  sourcePath: string;
}

/** Local directories scanned for importable SKILL.md folders. */
function localSkillSources(): { label: string; root: string }[] {
  const sources = [
    { label: "~/.claude/skills", root: join(homedir(), ".claude", "skills") },
  ];
  // Dev convenience: this repo's .agents/skills (absent in a packaged app).
  const repoAgents = join(process.cwd(), ".agents", "skills");
  if (existsSync(repoAgents))
    sources.push({ label: ".agents/skills", root: repoAgents });
  return sources;
}

/** Find a directory containing SKILL.md at depth ≤ 2 under each source root. */
function scanForSkillDirs(root: string, label: string): LocalSkill[] {
  if (!existsSync(root)) return [];
  const found: LocalSkill[] = [];
  const consider = (dir: string, category: string): void => {
    const skillFile = join(dir, "SKILL.md");
    if (!existsSync(skillFile)) return;
    let meta = { name: "", description: "" };
    try {
      meta = parseSkillFrontmatter(
        readFileSync(skillFile, "utf-8").slice(0, 4000),
      );
    } catch {
      // keep defaults
    }
    found.push({
      name: meta.name || dir.split(/[\\/]+/).pop() || "skill",
      description: meta.description || "",
      category: category || "local",
      source: label,
      sourcePath: dir,
    });
  };
  try {
    for (const entry of readdirSync(root)) {
      const entryPath = join(root, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      if (existsSync(join(entryPath, "SKILL.md"))) {
        consider(entryPath, "local"); // <root>/<name>/SKILL.md
      } else {
        // <root>/<category>/<name>/SKILL.md
        for (const sub of readdirSync(entryPath)) {
          const subPath = join(entryPath, sub);
          try {
            if (statSync(subPath).isDirectory()) consider(subPath, entry);
          } catch {
            // ignore unreadable entries
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return found;
}

/** Discover SKILL.md folders already on this machine, minus installed ones. */
export function discoverLocalSkills(profile?: string): LocalSkill[] {
  const installed = new Set(
    [...listInstalledSkills(profile), ...listDisabledSkills(profile)].map((s) =>
      s.name.toLowerCase(),
    ),
  );
  const out: LocalSkill[] = [];
  for (const { label, root } of localSkillSources()) {
    for (const skill of scanForSkillDirs(realOrResolved(root), label)) {
      if (!installed.has(skill.name.toLowerCase())) out.push(skill);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Copy a discovered local skill into the active profile's skills dir. */
export function importLocalSkill(
  sourcePath: string,
  category?: string,
  profile?: string,
): SkillCliResult {
  const src = realOrResolved(resolve(sourcePath));
  // The source MUST be inside one of the known discovery roots — never copy an
  // arbitrary directory the renderer hands us.
  const roots = localSkillSources().map((s) => realOrResolved(s.root));
  if (!roots.some((root) => pathIsInside(root, src)))
    return { success: false, error: "Source is not a known local skill." };
  if (!existsSync(join(src, "SKILL.md")))
    return { success: false, error: "No SKILL.md in the source folder." };

  const cat = (category || "local").trim().toLowerCase();
  if (!isSafeSegment(cat))
    return { success: false, error: "Invalid category name." };
  const folder = src.split(/[\\/]+/).pop() || "skill";
  if (!isSafeSegment(folder))
    return { success: false, error: "Unsupported skill folder name." };

  const dest = join(profileSkillsRoot(profile), cat, folder);
  if (!isWritableSkillTarget(dest, profile))
    return { success: false, error: "Refused: outside the skills directory." };
  if (existsSync(dest))
    return { success: false, error: `"${folder}" is already imported.` };
  try {
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
