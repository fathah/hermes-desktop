import { BrowserWindow, shell } from "electron";
import { mkdir, readdir, writeFile } from "fs/promises";
import { join, relative } from "path";
import pptxgen from "pptxgenjs";
import {
  DECK_THEME_TOKENS,
  buildDeckGenerationPrompt,
  buildDeckRepairPrompt,
  createDeckProject,
  nextDeckExportName,
  parseDeckProjectJson,
  runDeckQa,
  type DeckExportResult,
  type DeckGenerationInput,
  type DeckGenerationResult,
  type DeckQaIssue,
  type DeckProject,
} from "../shared/deck-studio";
import { getApiUrl, getRemoteAuthHeader, isRemoteOnlyMode } from "./hermes";

interface ModelParseResult {
  project: DeckProject | null;
  issues: DeckQaIssue[];
  raw: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHex(hex: string): string {
  return hex.replace("#", "").toUpperCase();
}

function deckExportsDir(vaultDir: string): string {
  return join(vaultDir, "exports", "decks");
}

async function existingExportNames(exportsDir: string): Promise<string[]> {
  try {
    return await readdir(exportsDir);
  } catch {
    return [];
  }
}

async function writeDeckNotesSidecar(
  project: DeckProject,
  exportsDir: string,
): Promise<string> {
  const names = await existingExportNames(exportsDir);
  const name = nextDeckExportName(names, project.title, "md");
  const notesPath = join(exportsDir, name);
  const body = [
    `# ${project.title} Speaker Notes`,
    `Audience: ${project.audience}`,
    `Goal: ${project.goal}`,
    "",
    ...project.slides.map((slide, index) =>
      [
        `## ${index + 1}. ${slide.title}`,
        slide.speakerNotes?.trim() || "_No speaker notes._",
        slide.evidenceRefs.length
          ? `Evidence refs: ${slide.evidenceRefs.join(", ")}`
          : "Evidence refs: none",
      ].join("\n\n"),
    ),
  ].join("\n\n");
  await writeFile(notesPath, `${body}\n`, "utf-8");
  return notesPath;
}

async function callDeckModel(
  prompt: string,
  profile?: string,
): Promise<string> {
  const res = await fetch(`${getApiUrl(profile)}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getRemoteAuthHeader() },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: "hermes-agent",
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You produce strict JSON only. Do not include markdown fences unless explicitly requested.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gateway ${res.status}: ${body.slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

function parseModelDeck(raw: string): ModelParseResult {
  try {
    const project = parseDeckProjectJson(raw);
    return { project, issues: runDeckQa(project).issues, raw };
  } catch (err) {
    return {
      project: null,
      raw,
      issues: [
        {
          code: "deck_title",
          severity: "blocker",
          path: "json",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}

export async function generateDeckProject(
  input: DeckGenerationInput,
  profile?: string,
): Promise<DeckGenerationResult> {
  const fallback = (error?: string): DeckGenerationResult => {
    const project = createDeckProject(input);
    const qa = runDeckQa(project);
    return {
      ok: qa.ok,
      mode: error ? "fallback" : "deterministic",
      project,
      issues: qa.issues,
      error,
    };
  };

  if (isRemoteOnlyMode()) {
    return fallback("Model deck generation is disabled in remote-only mode.");
  }

  try {
    const firstRaw = await callDeckModel(buildDeckGenerationPrompt(input), profile);
    const first = parseModelDeck(firstRaw);
    if (first.project && runDeckQa(first.project).ok) {
      return {
        ok: true,
        mode: "model",
        project: first.project,
        issues: [],
      };
    }

    const repairRaw = await callDeckModel(
      buildDeckRepairPrompt(first.raw, first.issues),
      profile,
    );
    const repaired = parseModelDeck(repairRaw);
    if (repaired.project && runDeckQa(repaired.project).ok) {
      return {
        ok: true,
        mode: "model",
        project: repaired.project,
        issues: [],
      };
    }
    return fallback(
      repaired.issues.map((issue) => issue.message).join(" ") ||
        "Model output could not be repaired.",
    );
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  }
}

function renderBody(project: DeckProject): string {
  const theme = DECK_THEME_TOKENS[project.theme] ?? DECK_THEME_TOKENS.investor;
  const slides = project.slides
    .map((slide, index) => {
      const body = slide.body
        .map((block) =>
          block.kind === "bullet"
            ? `<li>${escapeHtml(block.text)}</li>`
            : `<p class="body-block ${block.kind}">${escapeHtml(block.text)}</p>`,
        )
        .join("");
      const visual = slide.visuals
        .map(
          (block) => `<div class="visual ${block.kind}">
            ${block.value ? `<strong>${escapeHtml(block.value)}</strong>` : ""}
            ${block.label ? `<span>${escapeHtml(block.label)}</span>` : ""}
            ${block.caption ? `<small>${escapeHtml(block.caption)}</small>` : ""}
          </div>`,
        )
        .join("");
      return `<section class="slide slide-${slide.kind}">
        <div class="slide-kicker">${String(index + 1).padStart(2, "0")} / ${project.slides.length}</div>
        <div class="slide-main">
          <h1>${escapeHtml(slide.title)}</h1>
          ${slide.subtitle ? `<h2>${escapeHtml(slide.subtitle)}</h2>` : ""}
          ${body ? `<ul>${body}</ul>` : ""}
        </div>
        ${visual ? `<aside>${visual}</aside>` : ""}
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: 16in 9in; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: ${theme.background};
      color: ${theme.foreground};
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .slide {
      width: 16in;
      height: 9in;
      page-break-after: always;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 4.6in;
      gap: 0.42in;
      padding: 0.52in;
      position: relative;
      background: ${theme.background};
      overflow: hidden;
    }
    .slide-title {
      grid-template-columns: 1fr;
      align-content: end;
    }
    .slide-kicker {
      position: absolute;
      top: 0.32in;
      right: 0.42in;
      font-size: 0.13in;
      font-weight: 700;
      color: ${theme.muted};
      letter-spacing: 0.04em;
    }
    .slide-main {
      align-self: center;
      max-width: 9.4in;
    }
    h1 {
      margin: 0;
      font-size: 0.76in;
      line-height: 0.93;
      letter-spacing: 0;
      max-width: 10in;
    }
    h2 {
      margin: 0.24in 0 0;
      font-size: 0.28in;
      line-height: 1.2;
      font-weight: 600;
      color: ${theme.muted};
    }
    ul {
      margin: 0.36in 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 0.14in;
    }
    li, .body-block {
      border-left: 0.07in solid ${theme.accent};
      padding: 0.08in 0 0.08in 0.16in;
      font-size: 0.2in;
      line-height: 1.28;
      font-weight: 600;
    }
    .callout {
      border: 0;
      padding: 0.22in;
      background: ${theme.panel};
      color: ${theme.foreground};
      border-radius: 0.08in;
    }
    aside {
      align-self: stretch;
      display: grid;
      gap: 0.18in;
      align-content: center;
    }
    .visual {
      min-height: 1.5in;
      border-radius: 0.1in;
      background: ${theme.panel};
      padding: 0.28in;
      display: grid;
      align-content: center;
      gap: 0.08in;
    }
    .visual strong {
      font-size: 0.46in;
      line-height: 1;
      color: ${theme.accent};
    }
    .visual span {
      font-size: 0.18in;
      font-weight: 800;
    }
    .visual small {
      font-size: 0.13in;
      line-height: 1.35;
    }
  </style>
</head>
<body>${slides}</body>
</html>`;
}

export async function exportDeckPdf(
  project: DeckProject,
  vaultDir: string,
): Promise<DeckExportResult> {
  const qa = runDeckQa(project);
  if (!qa.ok) {
    return {
      ok: false,
      error: qa.issues
        .filter((issue) => issue.severity === "blocker")
        .map((issue) => issue.message)
        .join(" "),
    };
  }

  const exportsDir = deckExportsDir(vaultDir);
  await mkdir(exportsDir, { recursive: true });
  const outPath = join(
    exportsDir,
    nextDeckExportName(await existingExportNames(exportsDir), project.title, "pdf"),
  );
  const notesPath = await writeDeckNotesSidecar(project, exportsDir);

  const win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    const html = renderBody(project);
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      landscape: true,
      pageSize: { width: 160000, height: 90000 },
      margins: { marginType: "none" },
    });
    await writeFile(outPath, pdf);
    return { ok: true, path: outPath, notesPath };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    win.destroy();
  }
}

export async function exportDeckPptx(
  project: DeckProject,
  vaultDir: string,
): Promise<DeckExportResult> {
  const qa = runDeckQa(project);
  if (!qa.ok) {
    return {
      ok: false,
      error: qa.issues
        .filter((issue) => issue.severity === "blocker")
        .map((issue) => issue.message)
        .join(" "),
    };
  }

  const exportsDir = deckExportsDir(vaultDir);
  await mkdir(exportsDir, { recursive: true });
  const outPath = join(
    exportsDir,
    nextDeckExportName(await existingExportNames(exportsDir), project.title, "pptx"),
  );
  const notesPath = await writeDeckNotesSidecar(project, exportsDir);
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "SPS Agent";
  pptx.company = "SPS";
  pptx.subject = project.goal;
  pptx.title = project.title;

  for (const [index, deckSlide] of project.slides.entries()) {
    const theme = DECK_THEME_TOKENS[project.theme] ?? DECK_THEME_TOKENS.investor;
    const slide = pptx.addSlide();
    slide.bkgd = stripHex(theme.background);
    slide.color = stripHex(theme.foreground);
    slide.addText(`${String(index + 1).padStart(2, "0")} / ${project.slides.length}`, {
      x: 11.4,
      y: 0.25,
      w: 1.3,
      h: 0.2,
      fontSize: 8,
      bold: true,
      color: stripHex(theme.muted),
      align: "right",
    });
    slide.addText(deckSlide.kind.toUpperCase(), {
      x: 0.55,
      y: 0.35,
      w: 2,
      h: 0.25,
      fontSize: 8,
      bold: true,
      color: stripHex(theme.accent),
    });
    slide.addText(deckSlide.title, {
      x: 0.55,
      y: deckSlide.kind === "title" ? 4.45 : 0.75,
      w: deckSlide.visuals.length ? 8.0 : 11.2,
      h: 1.25,
      fontSize: deckSlide.kind === "title" ? 42 : 34,
      bold: true,
      color: stripHex(theme.foreground),
      breakLine: false,
      fit: "shrink",
    });
    if (deckSlide.subtitle) {
      slide.addText(deckSlide.subtitle, {
        x: 0.6,
        y: deckSlide.kind === "title" ? 5.75 : 1.9,
        w: 8.3,
        h: 0.5,
        fontSize: 16,
        bold: true,
        color: stripHex(theme.muted),
        fit: "shrink",
      });
    }
    deckSlide.body.slice(0, 6).forEach((block, bodyIndex) => {
      const y = 2.45 + bodyIndex * 0.62;
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.6,
        y,
        w: 0.07,
        h: 0.4,
        fill: { color: stripHex(theme.accent) },
        line: { color: stripHex(theme.accent), transparency: 100 },
      });
      slide.addText(block.text, {
        x: 0.82,
        y,
        w: deckSlide.visuals.length ? 7.2 : 10.6,
        h: 0.45,
        fontSize: 14,
        bold: block.kind === "callout",
        color: stripHex(theme.foreground),
        fit: "shrink",
      });
    });
    deckSlide.visuals.slice(0, 3).forEach((visual, visualIndex) => {
      const y = 2.0 + visualIndex * 1.35;
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 9.25,
        y,
        w: 3.15,
        h: 1.05,
        fill: { color: stripHex(theme.panel) },
        line: { color: stripHex(theme.panel), transparency: 100 },
      });
      slide.addText(
        [visual.value, visual.label, visual.caption].filter(Boolean).join("\n"),
        {
          x: 9.45,
          y: y + 0.12,
          w: 2.75,
          h: 0.8,
          fontSize: visual.value ? 16 : 11,
          bold: true,
          color: stripHex(visual.value ? theme.accent : theme.foreground),
          fit: "shrink",
        },
      );
    });
    if (deckSlide.speakerNotes) {
      slide.addNotes(deckSlide.speakerNotes);
    }
  }

  await pptx.writeFile({ fileName: outPath });
  return { ok: true, path: outPath, notesPath };
}

export function isSafeDeckExportPath(filePath: string, vaultDir: string): boolean {
  const rel = relative(deckExportsDir(vaultDir), filePath);
  return Boolean(rel) && !rel.startsWith("..") && !rel.startsWith("/");
}

export async function openDeckExport(
  filePath: string,
  vaultDir: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSafeDeckExportPath(filePath, vaultDir)) {
    return { ok: false, error: "Deck export path is outside the export folder." };
  }
  const error = await shell.openPath(filePath);
  return error ? { ok: false, error } : { ok: true };
}
