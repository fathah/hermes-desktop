// telos.ts — pure parser for TELOS.md files.
// Matches headers like "## Mission", "## Goals", "## KPIs", and "## Problems"
// and returns their cleaned content to ground assistant runs.

export interface TelosData {
  mission: string;
  goals: string[];
  kpis: string[];
  problems: string[];
}

/**
 * Parses markdown list items from a raw text section.
 */
function parseListItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith("- ") || line.startsWith("* ") || /^\d+\.\s/.test(line),
    )
    .map((line) =>
      line
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Parses TELOS.md content into a structured TelosData object.
 */
export function parseTelos(content: string): TelosData {
  const data: TelosData = {
    mission: "",
    goals: [],
    kpis: [],
    problems: [],
  };

  if (!content) return data;

  const lines = content.split("\n");
  let currentSection: keyof TelosData | null = null;
  const sectionBuffers: Record<keyof TelosData, string[]> = {
    mission: [],
    goals: [],
    kpis: [],
    problems: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      const heading = trimmed.slice(3).toLowerCase();
      if (heading.includes("mission")) {
        currentSection = "mission";
      } else if (heading.includes("goal")) {
        currentSection = "goals";
      } else if (heading.includes("kpi")) {
        currentSection = "kpis";
      } else if (heading.includes("problem")) {
        currentSection = "problems";
      } else {
        currentSection = null;
      }
      continue;
    } else if (trimmed.startsWith("# ")) {
      // Top level header resets active section
      currentSection = null;
      continue;
    }

    if (currentSection) {
      sectionBuffers[currentSection].push(line);
    }
  }

  // Post-process sections
  data.mission = sectionBuffers.mission.join("\n").trim();
  data.goals = parseListItems(sectionBuffers.goals.join("\n"));
  data.kpis = parseListItems(sectionBuffers.kpis.join("\n"));
  data.problems = parseListItems(sectionBuffers.problems.join("\n"));

  return data;
}

/**
 * Formats parsed TelosData into a clean context block for the LLM system prompt.
 */
export function formatTelosContext(data: TelosData): string {
  const parts: string[] = [];

  if (data.mission) {
    parts.push(`Mission:\n${data.mission}`);
  }
  if (data.goals.length > 0) {
    parts.push(`Goals:\n${data.goals.map((g) => `- ${g}`).join("\n")}`);
  }
  if (data.kpis.length > 0) {
    parts.push(`KPIs:\n${data.kpis.map((k) => `- ${k}`).join("\n")}`);
  }
  if (data.problems.length > 0) {
    parts.push(
      `Problems being solved:\n${data.problems.map((p) => `- ${p}`).join("\n")}`,
    );
  }

  if (parts.length === 0) return "";
  return `User's Deep Context (Telos):\n${parts.join("\n\n")}`;
}
