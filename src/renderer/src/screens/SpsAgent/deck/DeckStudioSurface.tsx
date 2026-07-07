import { useEffect, useMemo, useState } from "react";
import {
  DECK_STUDIO_FOLDER,
  DECK_THEME_IDS,
  DECK_THEME_TOKENS,
  buildDeckInputFromPage,
  getDeckTemplateRecipe,
  runDeckQa,
  scoreSlideDensity,
  type DeckGenerationInput,
  type DeckQaIssue,
  type DeckProject,
  type DeckSlide,
  type DeckThemeId,
} from "../../../../../shared/deck-studio";
import { blk } from "../lib/ids";
import { useStore } from "../store";
import type { PageMeta, TreeNode } from "../types";
import {
  listDeckProjects,
  readDeckProject,
  saveDeckProject,
} from "./deckStudioStorage";

type DeckStep = "brief" | "outline" | "slides" | "export";
type DeckMessageTone = "info" | "success" | "error";

const PACK_PAGES = ["Decks"];

function childTitlesFor(
  rootId: string,
  tree: TreeNode[],
  meta: Record<string, PageMeta>,
): Set<string> {
  const root = tree.find((node) => node.id === rootId);
  return new Set(
    (root?.children ?? [])
      .map((child) => meta[child.id]?.title)
      .filter((title): title is string => Boolean(title)),
  );
}

function packBlocks() {
  return [
    blk("p", "Editable Deck Studio projects saved as source-grounded Deck IR."),
    blk("database", "", {
      source: DECK_STUDIO_FOLDER,
      view: "table",
      cols: [
        { id: "status", name: "Status" },
        { id: "theme", name: "Theme" },
        { id: "slideCount", name: "Slides" },
        { id: "issueCount", name: "Issues" },
      ],
    }),
  ];
}

function outlineLabel(slide: DeckSlide, index: number): string {
  return `${String(index + 1).padStart(2, "0")} ${slide.kind.toUpperCase()}`;
}

function SlideThumbRail({
  slides,
  selectedId,
  onSelect,
  issues,
}: {
  slides: DeckSlide[];
  selectedId: string;
  onSelect: (id: string) => void;
  issues: DeckQaIssue[];
}): React.JSX.Element {
  return (
    <div className="deck-thumb-rail" aria-label="Slide thumbnails">
      {slides.map((slide, index) => (
        <button
          key={slide.id}
          type="button"
          className={`deck-thumb ${slide.id === selectedId ? "active" : ""}`}
          onClick={() => onSelect(slide.id)}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{slide.title}</strong>
          {issues.some((issue) => issue.slideId === slide.id) && (
            <em>
              {issues.filter((issue) => issue.slideId === slide.id).length}
            </em>
          )}
        </button>
      ))}
    </div>
  );
}

function DeckCanvas({
  project,
  slide,
}: {
  project: DeckProject;
  slide: DeckSlide;
}): React.JSX.Element {
  const theme = DECK_THEME_TOKENS[project.theme];
  const density = scoreSlideDensity(slide);
  return (
    <section
      className={`deck-canvas slide-${slide.kind}`}
      data-testid="deck-canvas"
      data-theme={project.theme}
      data-density={density.level}
      style={
        {
          "--deck-bg": theme.background,
          "--deck-fg": theme.foreground,
          "--deck-accent": theme.accent,
          "--deck-panel": theme.panel,
          "--deck-muted": theme.muted,
        } as React.CSSProperties
      }
    >
      <div className="deck-canvas-main">
        <span className="deck-kind">{slide.kind}</span>
        <h2>{slide.title}</h2>
        {slide.subtitle && <p className="deck-subtitle">{slide.subtitle}</p>}
        <div className="deck-body">
          {slide.body.map((block) => (
            <p key={block.id} className={`deck-block ${block.kind}`}>
              {block.text}
            </p>
          ))}
        </div>
      </div>
      {slide.visuals.length > 0 && (
        <aside className="deck-visuals">
          {slide.visuals.map((visual) => (
            <div key={visual.id} className={`deck-visual ${visual.kind}`}>
              {visual.value && <strong>{visual.value}</strong>}
              {visual.label && <span>{visual.label}</span>}
              {visual.caption && <small>{visual.caption}</small>}
            </div>
          ))}
        </aside>
      )}
    </section>
  );
}

function SlideInspector({
  slide,
  onChange,
}: {
  slide: DeckSlide;
  onChange: (slide: DeckSlide) => void;
}): React.JSX.Element {
  return (
    <aside className="deck-inspector">
      <label>
        Slide title
        <input
          value={slide.title}
          onChange={(event) =>
            onChange({ ...slide, title: event.currentTarget.value })
          }
        />
      </label>
      <label>
        Subtitle
        <input
          value={slide.subtitle ?? ""}
          onChange={(event) =>
            onChange({ ...slide, subtitle: event.currentTarget.value })
          }
        />
      </label>
      <label>
        Body
        <textarea
          value={slide.body.map((block) => block.text).join("\n")}
          rows={6}
          onChange={(event) => {
            const body = event.currentTarget.value
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .map((text, index) => ({
                id: `${slide.id}-body-${index + 1}`,
                kind: "bullet" as const,
                text,
              }));
            onChange({ ...slide, body });
          }}
        />
      </label>
      <label>
        Speaker notes
        <textarea
          value={slide.speakerNotes ?? ""}
          rows={4}
          onChange={(event) =>
            onChange({ ...slide, speakerNotes: event.currentTarget.value })
          }
        />
      </label>
    </aside>
  );
}

function IssueList({
  issues,
}: {
  issues: DeckQaIssue[];
}): React.JSX.Element | null {
  if (issues.length === 0) return null;
  return (
    <div className="deck-issues" role="status">
      {issues.map((issue) => (
        <p key={`${issue.path}-${issue.code}`}>{issue.message}</p>
      ))}
    </div>
  );
}

function QaPanel({
  issues,
  reviewedWarnings,
  onReviewWarnings,
}: {
  issues: DeckQaIssue[];
  reviewedWarnings: boolean;
  onReviewWarnings: () => void;
}): React.JSX.Element {
  const blockers = issues.filter((issue) => issue.severity === "blocker");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return (
    <aside className="deck-qa-panel">
      <h2>QA</h2>
      <p>
        {blockers.length} blocker{blockers.length === 1 ? "" : "s"} ·{" "}
        {warnings.length} warning{warnings.length === 1 ? "" : "s"}
      </p>
      {issues.length === 0 ? (
        <span className="deck-qa-ok">Ready for export</span>
      ) : (
        <div className="deck-qa-list">
          {issues.map((issue) => (
            <div
              key={`${issue.path}-${issue.code}`}
              data-severity={issue.severity}
            >
              <strong>{issue.severity}</strong>
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && blockers.length === 0 && !reviewedWarnings && (
        <button type="button" onClick={onReviewWarnings}>
          Mark warnings reviewed
        </button>
      )}
    </aside>
  );
}

export function DeckStudioSurface({
  profile = "default",
}: {
  profile?: string;
}): React.JSX.Element {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const docs = useStore((s) => s.docs);
  const page = useStore((s) => s.page);
  const makePage = useStore((s) => s.makePage);
  const flash = useStore((s) => s.flash);
  const pendingDeckStudioInput = useStore((s) => s.pendingDeckStudioInput);
  const clearPendingDeckStudioInput = useStore(
    (s) => s.clearPendingDeckStudioInput,
  );
  const [activeStep, setActiveStep] = useState<DeckStep>("brief");
  const [notes, setNotes] = useState("");
  const [audience, setAudience] = useState("decision makers");
  const [goal, setGoal] = useState("create a clear first draft");
  const [theme, setTheme] = useState<DeckThemeId>("investor");
  const [style, setStyle] = useState("premium, editorial, source-grounded");
  const [slideCount, setSlideCount] = useState(6);
  const [project, setProject] = useState<DeckProject | null>(null);
  const [selectedSlideId, setSelectedSlideId] = useState("");
  const [issues, setIssues] = useState<DeckQaIssue[]>([]);
  const [savedRows, setSavedRows] = useState<
    Array<{ path: string; title: string; props: Record<string, unknown> }>
  >([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<DeckMessageTone>("info");
  const [generationMode, setGenerationMode] = useState("");
  const [reviewedWarnings, setReviewedWarnings] = useState(false);
  const [lastExportPath, setLastExportPath] = useState("");
  const [lastNotesPath, setLastNotesPath] = useState("");
  const selectedSlide = useMemo(
    () => project?.slides.find((slide) => slide.id === selectedSlideId) ?? null,
    [project, selectedSlideId],
  );

  useEffect(() => {
    const existing = tree.find(
      (node) => meta[node.id]?.title === "Deck Studio",
    );
    if (existing) {
      const existingChildTitles = childTitlesFor(existing.id, tree, meta);
      for (const title of PACK_PAGES) {
        if (existingChildTitles.has(title)) continue;
        makePage({ icon: "DS", title }, packBlocks(), existing.id);
      }
      return;
    }
    const root = makePage(
      { icon: "DS", title: "Deck Studio" },
      [
        blk(
          "p",
          "Turn notes, research, and sourced ideas into editable deck projects.",
        ),
      ],
      null,
    );
    for (const title of PACK_PAGES) {
      makePage({ icon: "DS", title }, packBlocks(), root);
    }
  }, [makePage, meta, tree]);

  useEffect(() => {
    void listDeckProjects(profile)
      .then((rows) => setSavedRows(rows))
      .catch(() => setSavedRows([]));
  }, [profile]);

  const applyDeckInput = (input: DeckGenerationInput): void => {
    setNotes(input.notes);
    setAudience(input.audience);
    setGoal(input.goal);
    setTheme(input.theme);
    setSlideCount(input.slideCount);
    setStyle(input.style || "premium, source-grounded, concise");
    setActiveStep("brief");
  };

  useEffect(() => {
    if (!pendingDeckStudioInput) return;
    applyDeckInput(pendingDeckStudioInput);
    clearPendingDeckStudioInput();
  }, [clearPendingDeckStudioInput, pendingDeckStudioInput]);

  const updateProject = (next: DeckProject): void => {
    const qa = runDeckQa(next);
    setProject(next);
    setIssues(qa.issues);
    setReviewedWarnings(false);
    if (
      !selectedSlideId ||
      !next.slides.some((slide) => slide.id === selectedSlideId)
    ) {
      setSelectedSlideId(next.slides[0]?.id ?? "");
    }
  };

  const generateOutline = async (): Promise<void> => {
    setMessage("");
    setMessageTone("info");
    const result = await window.hermesAPI.deckGenerate(
      {
        notes,
        audience,
        goal,
        theme,
        slideCount,
        style,
      },
      profile,
    );
    setIssues(result.issues ?? []);
    setGenerationMode(result.mode);
    if (result.error) {
      setMessageTone("info");
      setMessage(`Used deterministic fallback: ${result.error}`);
    }
    if (!result.ok) {
      setProject(null);
      setMessageTone("error");
      setMessage("Generated deck needs repair before preview.");
      return;
    }
    setProject(result.project);
    setSelectedSlideId(result.project.slides[0]?.id ?? "");
    setActiveStep("outline");
  };

  const approveOutline = async (): Promise<void> => {
    if (!project) return;
    const next = { ...project, status: "review" as const };
    const qa = runDeckQa(next);
    setIssues(qa.issues);
    if (!qa.ok) return;
    const saved = await saveDeckProject(next, profile);
    updateProject(next);
    setActiveStep("slides");
    if (saved.ok) {
      flash("Deck outline approved and saved.");
    }
  };

  const updateTheme = (nextTheme: DeckThemeId): void => {
    setTheme(nextTheme);
    if (!project) return;
    updateProject({ ...project, theme: nextTheme });
  };

  const updateSlide = (slide: DeckSlide): void => {
    if (!project) return;
    updateProject({
      ...project,
      slides: project.slides.map((candidate) =>
        candidate.id === slide.id ? slide : candidate,
      ),
    });
  };

  const exportPdf = async (): Promise<void> => {
    if (!project) return;
    const result = await window.hermesAPI.deckExportPdf(project, profile);
    setLastExportPath(result.path ?? "");
    setLastNotesPath(result.notesPath ?? "");
    setMessageTone(result.ok ? "success" : "error");
    setMessage(
      result.ok && result.path
        ? `PDF exported: ${result.path}`
        : (result.error ?? "PDF export failed."),
    );
  };

  const exportPptx = async (): Promise<void> => {
    if (!project) return;
    const result = await window.hermesAPI.deckExportPptx(project, profile);
    setLastExportPath(result.path ?? "");
    setLastNotesPath(result.notesPath ?? "");
    setMessageTone(result.ok ? "success" : "error");
    setMessage(
      result.ok && result.path
        ? `PPTX exported: ${result.path}`
        : (result.error ?? "PPTX export failed."),
    );
  };

  const openLastExport = async (): Promise<void> => {
    if (!lastExportPath) return;
    const result = await window.hermesAPI.deckOpenExport(
      lastExportPath,
      profile,
    );
    if (!result.ok) {
      setMessageTone("error");
      setMessage(result.error ?? "Could not open export.");
    }
  };

  const loadSavedDeck = async (path: string): Promise<void> => {
    const rowId = path.split("/").pop()?.replace(/\.md$/, "");
    if (!rowId) return;
    const saved = await readDeckProject(rowId, profile);
    if (!saved) return;
    setProject(saved);
    setSelectedSlideId(saved.slides[0]?.id ?? "");
    setTheme(saved.theme);
    setActiveStep("slides");
  };

  return (
    <div className="deck-studio">
      <header className="deck-header">
        <div>
          <p className="deck-eyebrow">SPS Agent</p>
          <h1>Deck Studio</h1>
        </div>
        <nav className="deck-tabs" aria-label="Deck Studio panels">
          {(["brief", "outline", "slides", "export"] as DeckStep[]).map(
            (step) => (
              <button
                key={step}
                type="button"
                className={activeStep === step ? "active" : ""}
                onClick={() => setActiveStep(step)}
              >
                {step}
              </button>
            ),
          )}
        </nav>
      </header>

      <IssueList issues={issues} />
      {generationMode && (
        <p className="deck-mode">Generation mode: {generationMode}</p>
      )}

      {activeStep === "brief" && (
        <section className="deck-brief-grid">
          <div className="deck-brief">
            <label>
              Rough notes
              <textarea
                value={notes}
                rows={12}
                onChange={(event) => setNotes(event.currentTarget.value)}
                placeholder="Paste rough notes, research snippets, or a meeting outline."
              />
            </label>
            <div className="deck-brief-actions">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  applyDeckInput(
                    buildDeckInputFromPage({
                      pageId: page,
                      title: meta[page]?.title ?? page,
                      blocks: docs[page] ?? [],
                    }),
                  )
                }
              >
                Use current page
              </button>
              <button type="button" onClick={generateOutline}>
                Generate outline
              </button>
            </div>
          </div>
          <aside className="deck-brief-settings">
            <label>
              Audience
              <input
                value={audience}
                onChange={(event) => setAudience(event.currentTarget.value)}
              />
            </label>
            <label>
              Goal
              <input
                value={goal}
                onChange={(event) => setGoal(event.currentTarget.value)}
              />
            </label>
            <label>
              Theme
              <select
                value={theme}
                onChange={(event) =>
                  updateTheme(event.currentTarget.value as DeckThemeId)
                }
              >
                {DECK_THEME_IDS.map((themeId) => (
                  <option key={themeId} value={themeId}>
                    {DECK_THEME_TOKENS[themeId].name}
                  </option>
                ))}
              </select>
            </label>
            <div className="deck-theme-gallery" aria-label="Theme gallery">
              {DECK_THEME_IDS.map((themeId) => {
                const tokens = DECK_THEME_TOKENS[themeId];
                return (
                  <button
                    key={themeId}
                    type="button"
                    className={theme === themeId ? "active" : ""}
                    onClick={() => updateTheme(themeId)}
                    style={
                      {
                        "--deck-bg": tokens.background,
                        "--deck-fg": tokens.foreground,
                        "--deck-accent": tokens.accent,
                      } as React.CSSProperties
                    }
                  >
                    <span></span>
                    {tokens.name}
                  </button>
                );
              })}
            </div>
            <label>
              Slide count
              <input
                type="number"
                min={4}
                max={12}
                value={slideCount}
                onChange={(event) =>
                  setSlideCount(Number(event.currentTarget.value))
                }
              />
            </label>
            <label>
              Style
              <input
                value={style}
                onChange={(event) => setStyle(event.currentTarget.value)}
              />
            </label>
            {savedRows.length > 0 && (
              <div className="deck-saved">
                <h2>Saved decks</h2>
                {savedRows.map((row) => (
                  <button
                    key={row.path}
                    type="button"
                    onClick={() => loadSavedDeck(row.path)}
                  >
                    {row.title}
                  </button>
                ))}
              </div>
            )}
          </aside>
        </section>
      )}

      {activeStep === "outline" && project && (
        <section className="deck-outline">
          <div className="deck-outline-list">
            {project.slides.map((slide, index) => (
              <article key={slide.id} className="deck-outline-row">
                <span>{outlineLabel(slide, index)}</span>
                <h2>{slide.title}</h2>
                <p>
                  {slide.subtitle ||
                    slide.body[0]?.text ||
                    "Review slide copy."}
                </p>
                <small>
                  {getDeckTemplateRecipe(project.theme, slide.kind).layout}
                </small>
              </article>
            ))}
          </div>
          <div className="deck-outline-actions">
            <button
              type="button"
              className="secondary"
              onClick={generateOutline}
            >
              Regenerate outline
            </button>
            <button type="button" onClick={approveOutline}>
              Approve outline
            </button>
          </div>
        </section>
      )}

      {activeStep === "slides" && project && selectedSlide && (
        <>
          <div className="deck-slide-toolbar">
            <label>
              Theme
              <select
                value={theme}
                onChange={(event) =>
                  updateTheme(event.currentTarget.value as DeckThemeId)
                }
              >
                {DECK_THEME_IDS.map((themeId) => (
                  <option key={themeId} value={themeId}>
                    {DECK_THEME_TOKENS[themeId].name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <section className="deck-workbench">
            <SlideThumbRail
              slides={project.slides}
              selectedId={selectedSlide.id}
              onSelect={setSelectedSlideId}
              issues={issues}
            />
            <DeckCanvas project={project} slide={selectedSlide} />
            <div className="deck-side-stack">
              <SlideInspector slide={selectedSlide} onChange={updateSlide} />
              <QaPanel
                issues={issues}
                reviewedWarnings={reviewedWarnings}
                onReviewWarnings={() => setReviewedWarnings(true)}
              />
            </div>
          </section>
        </>
      )}

      {activeStep === "export" && (
        <section className="deck-export">
          <div>
            <h2>Export</h2>
            <p>
              PDF export preserves the deterministic preview. PPTX maps the same
              Deck IR into editable PowerPoint text, shapes, and speaker notes.
            </p>
            {lastNotesPath && <p>Notes sidecar: {lastNotesPath}</p>}
          </div>
          <button
            type="button"
            disabled={
              !project ||
              issues.some((issue) => issue.severity === "blocker") ||
              (issues.some((issue) => issue.severity === "warning") &&
                !reviewedWarnings)
            }
            onClick={exportPdf}
          >
            Export PDF
          </button>
          <button
            type="button"
            disabled={
              !project ||
              issues.some((issue) => issue.severity === "blocker") ||
              (issues.some((issue) => issue.severity === "warning") &&
                !reviewedWarnings)
            }
            onClick={exportPptx}
          >
            Export PPTX
          </button>
          {lastExportPath && (
            <button
              type="button"
              className="secondary"
              onClick={openLastExport}
            >
              Open export
            </button>
          )}
        </section>
      )}

      {message && <p className={`deck-message ${messageTone}`}>{message}</p>}
    </div>
  );
}
