// InboxSurface.tsx — the capture inbox + ingest review queue (second-brain loop).
//
// The inbox is the "Raw Sources" layer: quick notes and web-clips land here as
// immutable markdown rows under vault/_inbox/, awaiting agent ingest. Writes go
// through the existing folder-backed-row path (spsExportRow) — no new IPC — and
// the note-index makes them queryable.
//
// "Process inbox" runs the read-only ingest agent (spsIngestInbox), which
// PROPOSES a changeset of wiki pages. The proposal is shown in a review queue;
// the user applies it, and the desktop COMMITS each page through the store
// (ingestCommitPage) so it appears in both storage modes — the propose-then-
// commit keystone. Nothing the agent proposes lands until you approve it.
import { useCallback, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { useVaultQuery, type VaultRow } from "../hooks/useNoteIndex";
import {
  buildCapture,
  withStatus,
  INBOX_FOLDER,
  type CaptureStatus,
} from "./capture";
import { commitChangeset } from "./ingestApply";
import {
  getAutoApply,
  setAutoApply,
  getIngestIntervalMin,
  setIngestIntervalMin,
} from "./ingestPrefs";
import { installVaultSkill } from "./vaultSkill";
import { blk } from "../lib/ids";
import { pageFromMarkdown } from "../editor/pageMarkdown";
import { DEFAULT_WIKI_SCHEMA } from "../../../../../shared/wikiSchema";

interface InboxSurfaceProps {
  profile?: string;
}

type Mode = "note" | "web";

interface ProposedPage {
  op: "create" | "update";
  pageId: string;
  title: string;
  markdown: string;
}
interface Changeset {
  summary: string;
  pages: ProposedPage[];
  captures: Array<{ id: string; status: "processed" | "discarded" }>;
  memory: string[];
}

/** Strip the folder + .md suffix from an index path to get the row id. */
function rowIdOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

function timeLabel(capturedAt: unknown): string {
  if (typeof capturedAt !== "number") return "";
  try {
    return new Date(capturedAt).toLocaleString();
  } catch {
    return "";
  }
}

export function InboxSurface({
  profile = "default",
}: InboxSurfaceProps): React.JSX.Element {
  const { rows, refetch } = useVaultQuery(INBOX_FOLDER, [
    { prop: "status", op: "eq", value: "unprocessed" },
  ]);
  // Optimistically hide rows we just acted on — the chokidar re-index that backs
  // useVaultQuery lands a beat after the write, so we reconcile on refetch.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Ingest review queue.
  const ingestCommitPage = useStore((s) => s.ingestCommitPage);
  const flash = useStore((s) => s.flash);
  const [ingesting, setIngesting] = useState(false);
  const [changeset, setChangeset] = useState<Changeset | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [skipMem, setSkipMem] = useState<Set<number>>(new Set());
  const [autoApply, setAutoApplyState] = useState(() => getAutoApply());
  const [intervalMin, setIntervalMin] = useState(() => getIngestIntervalMin());

  const visible = rows.filter((r) => !hidden.has(r.path));

  const reconcile = useCallback(() => {
    // Give the watcher time to re-index, then refetch and clear optimistic state.
    setTimeout(() => {
      refetch();
      setHidden(new Set());
    }, 500);
  }, [refetch]);

  const writeCapture = useCallback(
    async (markdown: string, id: string) => {
      const api = window.hermesAPI;
      if (!api?.spsExportRow) throw new Error("Vault is unavailable offline.");
      const ok = await api.spsExportRow(INBOX_FOLDER, id, markdown, profile);
      if (!ok) throw new Error("Could not write the capture to the vault.");
    },
    [profile],
  );

  const captureNote = useCallback(async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { id, markdown } = buildCapture({
        source: "quick-note",
        body,
        title,
        via: "user",
        capturedAt: Date.now(),
      });
      await writeCapture(markdown, id);
      setTitle("");
      setBody("");
      reconcile();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [body, title, writeCapture, reconcile]);

  const captureWeb = useCallback(async () => {
    const target = url.trim();
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      // Reuse the SSRF-hardened unfurl (IP-pinned, redirect-revalidating).
      const meta = await window.hermesAPI.spsUnfurl(target);
      const lines = [meta.title, meta.desc, meta.url].filter(Boolean);
      const { id, markdown } = buildCapture({
        source: "web",
        title: title || meta.title,
        body: lines.join("\n\n"),
        url: meta.url || target,
        via: "user",
        capturedAt: Date.now(),
      });
      await writeCapture(markdown, id);
      setTitle("");
      setUrl("");
      reconcile();
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't clip that link: ${e.message}`
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  }, [url, title, writeCapture, reconcile]);

  const setStatus = useCallback(
    async (row: VaultRow, status: CaptureStatus) => {
      const api = window.hermesAPI;
      if (!api?.spsReadRow || !api?.spsExportRow) return;
      const id = rowIdOf(row.path);
      setHidden((prev) => new Set(prev).add(row.path));
      try {
        const current = await api.spsReadRow(INBOX_FOLDER, id, profile);
        if (current == null) return;
        await api.spsExportRow(
          INBOX_FOLDER,
          id,
          withStatus(current, status),
          profile,
        );
        reconcile();
      } catch {
        // Un-hide on failure so the row isn't silently lost from the view.
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(row.path);
          return next;
        });
      }
    },
    [profile, reconcile],
  );

  const processInbox = useCallback(async (): Promise<void> => {
    setIngesting(true);
    setError("");
    try {
      const res = await window.hermesAPI.spsIngestInbox?.(profile);
      if (!res) throw new Error("Ingest is unavailable.");
      if (!res.ok || !res.changeset) {
        throw new Error(res.error || "Ingest failed.");
      }
      const cs = res.changeset;
      if (cs.pages.length === 0 && cs.captures.length === 0) {
        setError("The agent found nothing to file from these captures.");
        return;
      }
      // Auto-apply: commit immediately (full audit/undo still apply); otherwise
      // stage the changeset for manual review.
      if (autoApply) {
        const { pages, memory } = await commitChangeset(cs, ingestCommitPage, {
          profile,
        });
        flash(
          `Filed ${pages} page${pages === 1 ? "" : "s"}` +
            (memory ? ` · ${memory} memory` : ""),
        );
        reconcile();
      } else {
        setChangeset(cs);
        setSkip(new Set());
        setSkipMem(new Set());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIngesting(false);
    }
  }, [profile, autoApply, ingestCommitPage, flash, reconcile]);

  const applyChangeset = useCallback(async (): Promise<void> => {
    if (!changeset) return;
    setIngesting(true);
    try {
      await commitChangeset(changeset, ingestCommitPage, {
        profile,
        skipPages: skip,
        skipMemory: skipMem,
      });
      setChangeset(null);
      setSkip(new Set());
      setSkipMem(new Set());
      reconcile();
    } finally {
      setIngesting(false);
    }
  }, [changeset, skip, skipMem, profile, ingestCommitPage, reconcile]);

  const toggleSkip = (pageId: string): void =>
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });

  // Open the editable "Wiki schema" page (seed from the default if absent).
  const editWikiSchema = useCallback((): void => {
    const st = useStore.getState();
    if (!st.meta["WIKI"]) {
      const { blocks } = pageFromMarkdown(DEFAULT_WIKI_SCHEMA);
      st.makePageWithId(
        "WIKI",
        { icon: "🧠", title: "Wiki schema" },
        blocks.length ? blocks : [blk("p", "")],
        st.ensureWikiFolder(),
      );
    }
    st.selectPage("WIKI");
    st.setSurface("doc");
  }, []);

  const installSkill = useCallback(async (): Promise<void> => {
    const res = await installVaultSkill(profile);
    flash(res.message);
  }, [profile, flash]);

  const toggleSkipMem = (i: number): void =>
    setSkipMem((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const canCapture =
    mode === "note" ? body.trim().length > 0 : url.trim().length > 0;

  return (
    <div
      className="inbox-surface"
      style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}
    >
      <header style={{ marginBottom: 20 }}>
        <h1
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 24,
            margin: 0,
          }}
        >
          <Icon name="inbox" size={22} />
          Inbox
        </h1>
        <p style={{ color: "var(--tx-3)", marginTop: 6 }}>
          Capture rough thoughts and links. The agent turns these raw sources
          into linked wiki pages — they stay untouched until then.
        </p>
      </header>

      <section
        style={{
          border: "1px solid var(--bd-1, rgba(0,0,0,0.08))",
          borderRadius: 10,
          padding: 14,
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button
            className={`nav-item ${mode === "note" ? "active" : ""}`}
            style={{ flex: "0 0 auto" }}
            onClick={() => setMode("note")}
          >
            <Icon name="callout" size={15} />
            <span className="nav-label">Quick note</span>
          </button>
          <button
            className={`nav-item ${mode === "web" ? "active" : ""}`}
            style={{ flex: "0 0 auto" }}
            onClick={() => setMode("web")}
          >
            <Icon name="doc" size={15} />
            <span className="nav-label">Web clip</span>
          </button>
        </div>

        <input
          className="inbox-input"
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
        />

        {mode === "note" ? (
          <textarea
            className="inbox-body"
            placeholder="What's on your mind?  (⌘↵ to capture)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") captureNote();
            }}
            rows={4}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        ) : (
          <input
            className="inbox-url"
            placeholder="https://…  (↵ to clip)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") captureWeb();
            }}
            style={inputStyle}
          />
        )}

        {error && (
          <div
            style={{
              color: "var(--danger, #c0392b)",
              fontSize: 13,
              marginTop: 8,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}
        >
          <button
            className="btn-primary"
            disabled={busy || !canCapture}
            onClick={mode === "note" ? captureNote : captureWeb}
            style={{
              padding: "7px 16px",
              borderRadius: 7,
              border: "none",
              background: canCapture
                ? "var(--accent, #2d7ff9)"
                : "var(--bd-1, #ddd)",
              color: "#fff",
              cursor: canCapture && !busy ? "pointer" : "default",
            }}
          >
            {busy ? "Capturing…" : "Capture"}
          </button>
        </div>
      </section>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          color: "var(--tx-3)",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span>Unprocessed</span>
        <span
          style={{
            background: "var(--bd-1, rgba(0,0,0,0.06))",
            borderRadius: 10,
            padding: "1px 8px",
          }}
        >
          {visible.length}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn-primary"
          disabled={ingesting || visible.length === 0}
          onClick={() => void processInbox()}
          title="Run the agent to turn these captures into wiki pages"
          style={{
            padding: "6px 12px",
            borderRadius: 7,
            border: "none",
            background:
              visible.length > 0
                ? "var(--accent, #2d7ff9)"
                : "var(--bd-1, #ddd)",
            color: "#fff",
            cursor: ingesting || visible.length === 0 ? "default" : "pointer",
            fontSize: 12.5,
          }}
        >
          {ingesting ? "Processing…" : "Process inbox"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 16,
          color: "var(--tx-3)",
          fontSize: 12.5,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={autoApply}
            onChange={(e) => {
              setAutoApply(e.target.checked);
              setAutoApplyState(e.target.checked);
            }}
          />
          Auto-apply (skip review)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Auto-process every
          <select
            value={intervalMin}
            onChange={(e) => {
              const m = Number(e.target.value);
              setIngestIntervalMin(m);
              setIntervalMin(m);
            }}
            style={{ padding: "2px 6px", borderRadius: 6 }}
          >
            <option value={0}>Off</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>60 min</option>
          </select>
        </label>
        {intervalMin > 0 && !autoApply && (
          <span style={{ color: "var(--tx-4)" }}>
            enable auto-apply for scheduled runs to land
          </span>
        )}
      </div>

      {changeset && (
        <section
          style={{
            border: "1px solid var(--accent, #2d7ff9)",
            borderRadius: 10,
            padding: 14,
            marginBottom: 20,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Proposed changes
          </div>
          <div style={{ color: "var(--tx-3)", fontSize: 13, marginBottom: 12 }}>
            {changeset.summary || "Review the agent's proposed wiki pages."}
          </div>
          {changeset.pages.length === 0 ? (
            <div style={{ color: "var(--tx-4)", fontSize: 13 }}>
              No new pages — the captures will just be marked processed.
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {changeset.pages.map((p) => {
                const skipped = skip.has(p.pageId);
                return (
                  <li
                    key={p.pageId}
                    style={{
                      border: "1px solid var(--bd-1, rgba(0,0,0,0.08))",
                      borderRadius: 8,
                      padding: "10px 12px",
                      opacity: skipped ? 0.5 : 1,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10.5,
                          textTransform: "uppercase",
                          letterSpacing: 0.4,
                          color: "var(--tx-4)",
                        }}
                      >
                        {p.op}
                      </span>
                      <strong>{p.title}</strong>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--tx-4)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        [[{p.pageId}]]
                      </span>
                      <span style={{ flex: 1 }} />
                      <button
                        className="icon-btn"
                        onClick={() => toggleSkip(p.pageId)}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "var(--tx-3)",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        {skipped ? "Include" : "Skip"}
                      </button>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: 12,
                        color: "var(--tx-2)",
                        maxHeight: 140,
                        overflow: "auto",
                      }}
                    >
                      {p.markdown.slice(0, 600)}
                      {p.markdown.length > 600 ? "…" : ""}
                    </pre>
                  </li>
                );
              })}
            </ul>
          )}
          {changeset.memory.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--tx-3)",
                  marginBottom: 6,
                }}
              >
                Remember about you
              </div>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {changeset.memory.map((fact, i) => {
                  const skipped = skipMem.has(i);
                  return (
                    <li
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        opacity: skipped ? 0.5 : 1,
                      }}
                    >
                      <Icon name="wand" size={13} />
                      <span style={{ flex: 1 }}>{fact}</span>
                      <button
                        className="icon-btn"
                        onClick={() => toggleSkipMem(i)}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "var(--tx-3)",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        {skipped ? "Include" : "Skip"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 12,
            }}
          >
            <button
              className="icon-btn"
              onClick={() => setChangeset(null)}
              style={{
                border: "1px solid var(--bd-1, #ddd)",
                background: "transparent",
                color: "var(--tx-2)",
                borderRadius: 7,
                padding: "7px 14px",
                cursor: "pointer",
              }}
            >
              Discard
            </button>
            <button
              className="btn-primary"
              disabled={ingesting}
              onClick={() => void applyChangeset()}
              style={{
                padding: "7px 16px",
                borderRadius: 7,
                border: "none",
                background: "var(--accent, #2d7ff9)",
                color: "#fff",
                cursor: ingesting ? "default" : "pointer",
              }}
            >
              {ingesting ? "Applying…" : "Apply"}
            </button>
          </div>
        </section>
      )}

      {visible.length === 0 ? (
        <div
          style={{
            color: "var(--tx-4)",
            padding: "24px 0",
            textAlign: "center",
          }}
        >
          Nothing waiting. Captures you add land here.
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {visible.map((row) => (
            <li
              key={row.path}
              style={{
                border: "1px solid var(--bd-1, rgba(0,0,0,0.08))",
                borderRadius: 9,
                padding: "10px 12px",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {String(row.props.title ?? "Untitled capture")}
                </div>
                <div
                  style={{
                    color: "var(--tx-4)",
                    fontSize: 12,
                    marginTop: 3,
                    display: "flex",
                    gap: 8,
                  }}
                >
                  <span style={{ textTransform: "capitalize" }}>
                    {String(row.props.source ?? "note")}
                  </span>
                  <span>·</span>
                  <span>{timeLabel(row.props.capturedAt)}</span>
                </div>
              </div>
              <button
                title="Mark processed"
                className="icon-btn"
                onClick={() => setStatus(row, "processed")}
                style={iconBtnStyle}
              >
                <Icon name="check" size={15} />
              </button>
              <button
                title="Discard"
                className="icon-btn"
                onClick={() => setStatus(row, "discarded")}
                style={iconBtnStyle}
              >
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        style={{
          marginTop: 28,
          paddingTop: 14,
          borderTop: "1px solid var(--bd-1, rgba(0,0,0,0.08))",
          display: "flex",
          gap: 16,
          fontSize: 12.5,
        }}
      >
        <button onClick={editWikiSchema} style={footerLinkStyle}>
          Edit wiki schema
        </button>
        <button onClick={() => void installSkill()} style={footerLinkStyle}>
          Install agent vault skill
        </button>
      </div>
    </div>
  );
}

const footerLinkStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--accent, #2d7ff9)",
  cursor: "pointer",
  padding: 0,
  fontSize: 12.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid var(--bd-1, rgba(0,0,0,0.12))",
  background: "var(--bg-1, transparent)",
  color: "inherit",
  marginBottom: 8,
  boxSizing: "border-box",
};

const iconBtnStyle: React.CSSProperties = {
  flex: "0 0 auto",
  border: "none",
  background: "transparent",
  color: "var(--tx-3)",
  cursor: "pointer",
  padding: 4,
  borderRadius: 6,
};
