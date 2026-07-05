import { getSharedDb } from "./db";
import { getModelConfig } from "./config";
import { formatLogError, log } from "./log";

/**
 * Persist model/provider (and council group) metadata for the just-completed
 * assistant message in a session. Resolves the effective model/provider from
 * the per-turn override or the profile's model config, finds the latest
 * assistant row for the session, and upserts its metadata row.
 *
 * Extracted from the send-message IPC handler (it previously did inline
 * `require("../db")` / `require("../config")` and raw SQL). Best-effort — any
 * DB error is logged and swallowed so it never breaks the chat turn.
 */
export function saveAssistantMessageMetadata(opts: {
  sessionId: string;
  profile?: string;
  modelOverride?: { model?: string; provider?: string };
  clientRunId?: string;
}): void {
  const { sessionId, profile, modelOverride, clientRunId } = opts;
  try {
    const db = getSharedDb(false);
    if (!db) return;

    const mc = getModelConfig(profile);
    const finalModel = modelOverride?.model || mc.model;
    const finalProvider = modelOverride?.provider || mc.provider;

    const lastMsg = db
      .prepare(
        `
        SELECT id FROM messages
        WHERE session_id = ? AND role = 'assistant'
        ORDER BY timestamp DESC, id DESC
        LIMIT 1
      `,
      )
      .get(sessionId) as { id: number } | undefined;
    if (!lastMsg) return;

    let councilGroupId: string | null = null;
    if (clientRunId && clientRunId.startsWith("council-turn-")) {
      councilGroupId = clientRunId.split("::")[0];
    }

    db.prepare(
      `
      INSERT OR REPLACE INTO messages_metadata (message_id, model, provider, council_group_id)
      VALUES (?, ?, ?, ?)
    `,
    ).run(lastMsg.id, finalModel, finalProvider, councilGroupId);
  } catch (err) {
    log.error("chat", {
      msg: "failed to save message metadata to DB",
      sessionId,
      profile,
      error: formatLogError(err),
    });
  }
}
