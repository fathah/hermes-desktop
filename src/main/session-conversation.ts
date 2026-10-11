/** Native Agent provenance markers and legacy branch/reset evidence. */
interface ChildRule {
  columns: string[];
  sql: string;
}

const marker = (key: string): string =>
  `json_extract(CASE WHEN json_valid(s.model_config) THEN s.model_config ELSE '{}' END, '$.${key}')`;

const childRules: ChildRule[] = [
  { columns: ["parent_session_id"], sql: "s.parent_session_id IS NULL" },
  { columns: ["model_config"], sql: `${marker("_branched_from")} IS NOT NULL` },
  { columns: ["model_config"], sql: `${marker("_reset_from")} IS NOT NULL` },
  {
    columns: ["parent_session_id", "end_reason", "started_at", "ended_at"],
    sql: "EXISTS (SELECT 1 FROM sessions p WHERE p.id = s.parent_session_id AND p.end_reason = 'branched' AND s.started_at >= p.ended_at)",
  },
  {
    columns: ["parent_session_id", "end_reason", "session_key"],
    sql: "EXISTS (SELECT 1 FROM sessions p WHERE p.id = s.parent_session_id AND p.end_reason IN ('session_reset', 'session_switch', 'idle', 'daily', 'suspended', 'resume_pending_expired') AND s.session_key IS NOT NULL AND s.session_key != '' AND s.session_key = p.session_key)",
  },
];

export function listableSessionChildPredicate(columns: string[]): string {
  const names = new Set(columns);
  const clauses = names.has("parent_session_id")
    ? [
        `(${childRules
          .filter((rule) => rule.columns.every((name) => names.has(name)))
          .map((rule) => rule.sql)
          .join(" OR ")})`,
      ]
    : ["1 = 1"];
  // This marker survives native parent deletion and takes precedence over a
  // branch/reset marker, matching Agent's own session-picker contract.
  if (names.has("model_config"))
    clauses.push(`${marker("_delegate_from")} IS NULL`);
  return clauses.join(" AND ");
}

export function conversationPredicate(
  columns: string[],
  hasExclusions: boolean,
): string {
  const clauses = [listableSessionChildPredicate(columns)];
  if (columns.includes("archived")) clauses.push("s.archived = 0");
  if (columns.includes("hidden")) clauses.push("s.hidden = 0");
  if (columns.includes("source"))
    clauses.push(
      "LOWER(TRIM(COALESCE(s.source, ''))) NOT IN ('kanban', 'tool', 'oneshot')",
    );
  if (hasExclusions)
    clauses.push(
      "NOT EXISTS (SELECT 1 FROM desktop_session_conversation_exclusions e WHERE e.session_id = s.id)",
    );
  return clauses.join(" AND ");
}

/** SSH evaluates exactly the same SQL rules against its remote schema. */
export const SSH_SESSION_CONVERSATION_HELPERS = `
_child_rules = json.loads(${JSON.stringify(JSON.stringify(childRules))})
_delegate_marker = ${JSON.stringify(`${marker("_delegate_from")} IS NULL`)}
def listable_session_child_predicate(columns):
    clauses = ["(" + " OR ".join(rule["sql"] for rule in _child_rules if all(name in columns for name in rule["columns"])) + ")"] if "parent_session_id" in columns else ["1 = 1"]
    if "model_config" in columns:
        clauses.append(_delegate_marker)
    return " AND ".join(clauses)

def session_conversation_predicate(conn, columns):
    clauses = [listable_session_child_predicate(columns)]
    if "archived" in columns:
        clauses.append("s.archived = 0")
    if "hidden" in columns:
        clauses.append("s.hidden = 0")
    if "source" in columns:
        clauses.append("LOWER(TRIM(COALESCE(s.source, ''))) NOT IN ('kanban', 'tool', 'oneshot')")
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'desktop_session_conversation_exclusions'").fetchone():
        clauses.append("NOT EXISTS (SELECT 1 FROM desktop_session_conversation_exclusions e WHERE e.session_id = s.id)")
    return " AND ".join(clauses)

def preserve_hidden_session_children(conn, columns, session_id):
    if "parent_session_id" not in columns:
        return
    rows = conn.execute("SELECT s.id FROM sessions s WHERE s.parent_session_id = ? AND NOT (" + listable_session_child_predicate(columns) + ")", (session_id,)).fetchall()
    if not rows:
        return
    conn.execute("CREATE TABLE IF NOT EXISTS desktop_session_conversation_exclusions (session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE)")
    conn.executemany("INSERT OR IGNORE INTO desktop_session_conversation_exclusions(session_id) VALUES (?)", [(row[0],) for row in rows])
`;

/** Legacy SSH listing applies the same rule before pagination. */
export const SSH_SESSION_LIST_SCRIPT = `
import sqlite3, json, os, sys
${SSH_SESSION_CONVERSATION_HELPERS}
payload = json.load(sys.stdin)
profile = payload.get("profile")
limit = max(1, min(200, int(payload.get("limit") or 30)))
offset = max(0, int(payload.get("offset") or 0))
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
rows = conn.execute(
    "SELECT s.id, s.source, s.started_at, s.ended_at, s.message_count, s.model, s.title "
    "FROM sessions s WHERE " + session_conversation_predicate(conn, columns) + " ORDER BY s.started_at DESC LIMIT ? OFFSET ?",
    (limit, offset)
).fetchall()
result = []
for r in rows:
    result.append({
        "id": r["id"], "source": r["source"] or "cli",
        "startedAt": r["started_at"], "endedAt": r["ended_at"],
        "messageCount": r["message_count"] or 0, "model": r["model"] or "",
        "title": r["title"], "preview": ""
    })
print(json.dumps(result))
conn.close()
`;
