import { existsSync, readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import { getSharedDb } from "./db";
import { profileHome } from "./utils";
import { HERMES_HOME, HERMES_REPO, HERMES_PYTHON, getEnhancedPath } from "./installer";
import { stripAnsi } from "./utils";

export interface SkillEntry {
  id?: number;
  name: string;
  description: string;
  keywords: string;
  status: string;
  entrypoint: string;
  dependencies: string;
  created_at?: string;
}

function parseSkillFrontmatter(content: string): {
  name: string;
  description: string;
  keywords: string;
} {
  const result = { name: "", description: "", keywords: "" };

  // Check for YAML frontmatter
  if (!content.startsWith("---")) {
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

  const descMatch = frontmatter.match(/^\s*description:\s*["']?([^"'\n]+)["']?\s*$/m);
  if (descMatch) result.description = descMatch[1].trim();

  const keywordsMatch = frontmatter.match(/^\s*keywords:\s*["']?([^"'\n]+)["']?\s*$/m);
  if (keywordsMatch) result.keywords = keywordsMatch[1].trim();

  return result;
}

export async function registerLocalSkill(
  skill: Omit<SkillEntry, "id" | "created_at">,
  _profile?: string
): Promise<{ success: boolean; error?: string }> {
  const db = getSharedDb(false);
  if (!db) return { success: false, error: "Database not available." };

  try {
    db.prepare(`
      INSERT INTO skills_registry (name, description, keywords, status, entrypoint, dependencies)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        keywords = excluded.keywords,
        entrypoint = excluded.entrypoint,
        dependencies = excluded.dependencies,
        status = excluded.status
    `).run(
      skill.name,
      skill.description,
      skill.keywords,
      skill.status,
      skill.entrypoint,
      skill.dependencies
    );
    return { success: true };
  } catch (err) {
    console.error("[skills-registry] Failed to register skill:", err);
    return { success: false, error: (err as Error).message };
  }
}

export async function lookupLocalSkill(
  query: string,
  _profile?: string
): Promise<SkillEntry[]> {
  const db = getSharedDb(true);
  if (!db) return [];

  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) {
    try {
      return db.prepare("SELECT * FROM skills_registry LIMIT 10").all() as SkillEntry[];
    } catch {
      return [];
    }
  }

  const clauses: string[] = [];
  const params: string[] = [];
  for (const word of words) {
    clauses.push("(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(keywords) LIKE ?)");
    const likeVal = `%${word}%`;
    params.push(likeVal, likeVal, likeVal);
  }

  const sql = `SELECT * FROM skills_registry WHERE ${clauses.join(" AND ")} LIMIT 5`;
  try {
    return db.prepare(sql).all(...params) as SkillEntry[];
  } catch (err) {
    console.error("[skills-registry] lookup failed:", err);
    return [];
  }
}

export async function syncDiskSkillsToDb(
  profile?: string
): Promise<{ success: boolean; count: number; error?: string }> {
  const db = getSharedDb(false);
  if (!db) return { success: false, count: 0, error: "Database not available." };

  const pHome = profileHome(profile || "default");
  const scanDirs = [
    join(pHome, "skills"),
    join(HERMES_HOME, "skills"),
    join(HERMES_REPO, "skills"),
  ];

  const foundSkills: Array<Omit<SkillEntry, "id" | "created_at">> = [];

  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;

    try {
      const categories = readdirSync(dir);
      for (const category of categories) {
        const catPath = join(dir, category);
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
            const name = meta.name || entry;

            // Attempt to locate execution entrypoint
            let entrypoint = "";
            if (existsSync(join(entryPath, "main.py"))) {
              entrypoint = join(entryPath, "main.py");
            } else if (existsSync(join(entryPath, "main.js"))) {
              entrypoint = join(entryPath, "main.js");
            }

            // Find requirements
            let dependencies = "";
            const reqFile = join(entryPath, "requirements.txt");
            if (existsSync(reqFile)) {
              dependencies = JSON.stringify(
                readFileSync(reqFile, "utf-8")
                  .split("\n")
                  .map((l) => l.trim())
                  .filter((l) => l && !l.startsWith("#"))
              );
            }

            foundSkills.push({
              name,
              description: meta.description || "",
              keywords: meta.keywords || category,
              status: "active",
              entrypoint,
              dependencies,
            });
          } catch (e) {
            console.error(`[skills-registry] Failed to read skill folder: ${entryPath}`, e);
          }
        }
      }
    } catch (err) {
      console.error(`[skills-registry] Error scanning skills directory: ${dir}`, err);
    }
  }

  if (foundSkills.length === 0) {
    return { success: true, count: 0 };
  }

  try {
    const insert = db.prepare(`
      INSERT INTO skills_registry (name, description, keywords, status, entrypoint, dependencies)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        keywords = excluded.keywords,
        entrypoint = excluded.entrypoint,
        dependencies = excluded.dependencies,
        status = excluded.status
    `);

    const tx = db.transaction((list: any[]) => {
      for (const item of list) {
        insert.run(
          item.name,
          item.description,
          item.keywords,
          item.status,
          item.entrypoint,
          item.dependencies
        );
      }
    });

    tx(foundSkills);
    return { success: true, count: foundSkills.length };
  } catch (err) {
    console.error("[skills-registry] Transaction failed:", err);
    return { success: false, count: 0, error: (err as Error).message };
  }
}

export async function scaffoldNewSkill(
  name: string,
  description: string,
  code: string,
  deps: string[],
  profile?: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const pHome = profileHome(profile || "default");
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const skillDir = join(pHome, "skills", "custom", slug);

    mkdirSync(skillDir, { recursive: true });

    // Write SKILL.md
    const skillMd =
      `---\n` +
      `name: "${name}"\n` +
      `description: "${description}"\n` +
      `keywords: "custom, autopoietic, generated"\n` +
      `---\n\n` +
      `# ${name}\n\n` +
      `${description}\n`;

    writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

    // Write main.py
    writeFileSync(join(skillDir, "main.py"), code, "utf-8");

    // Write requirements.txt
    if (deps && deps.length > 0) {
      writeFileSync(join(skillDir, "requirements.txt"), deps.join("\n"), "utf-8");

      // Attempt background pip install
      await new Promise<void>((resolvePip) => {
        execFile(
          HERMES_PYTHON,
          ["-m", "pip", "install", ...deps],
          {
            env: {
              ...process.env,
              PATH: getEnhancedPath(),
              HOME: homedir(),
            },
            timeout: 30000,
          },
          () => {
            resolvePip();
          }
        );
      });
    }

    // Sync disk skills to DB to register it immediately
    await syncDiskSkillsToDb(profile);

    return { success: true, path: skillDir };
  } catch (err) {
    console.error("[skills-registry] Scaffold failed:", err);
    return { success: false, error: (err as Error).message };
  }
}

export async function testSkillRun(
  name: string,
  args?: string,
  _profile?: string
): Promise<{ success: boolean; output: string }> {
  const db = getSharedDb(true);
  if (!db) return { success: false, output: "Database not available." };

  try {
    const entry = db.prepare("SELECT * FROM skills_registry WHERE name = ?").get(name) as SkillEntry | undefined;
    if (!entry || !entry.entrypoint) {
      return { success: false, output: `Skill '${name}' not found or has no execution entrypoint.` };
    }

    const entrypoint = entry.entrypoint;
    if (!existsSync(entrypoint)) {
      return { success: false, output: `Entrypoint file not found: ${entrypoint}` };
    }

    const runArgs = args ? [entrypoint, ...args.split(/\s+/)] : [entrypoint];

    return new Promise((resolve) => {
      execFile(
        HERMES_PYTHON,
        runArgs,
        {
          cwd: dirname(entrypoint),
          env: {
            ...process.env,
            PATH: getEnhancedPath(),
            HOME: homedir(),
            HERMES_HOME,
          },
          timeout: 10000,
        },
        (error, stdout, stderr) => {
          const output = stdout.toString() + stderr.toString();
          resolve({ success: !error, output: stripAnsi(output) });
        }
      );
    });
  } catch (err) {
    return { success: false, output: (err as Error).message };
  }
}
