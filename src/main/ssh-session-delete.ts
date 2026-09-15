/** Native SSH fallback, mirroring sessions.ts deletion without requiring a dashboard. */
export const SSH_SESSION_DELETE_SCRIPT = String.raw`
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

payload = json.load(sys.stdin)
profile = payload.get("profile") or "default"
if not isinstance(profile, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", profile):
    raise ValueError("Invalid Hermes profile name")
ids = list(dict.fromkeys(item.strip() for item in payload.get("sessionIds", []) if isinstance(item, str) and item.strip()))
root = Path(os.path.expanduser("~/.hermes"))
if profile != "default":
    root = root / "profiles" / profile
db = root / "state.db"
result = {"requested": len(ids), "deleted": 0}
if not ids or not db.exists():
    print(json.dumps(result))
    sys.exit(0)

# rw refuses to create a database if it disappears after the existence check.
conn = sqlite3.connect(db.resolve().as_uri() + "?mode=rw", uri=True, timeout=5)
try:
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("BEGIN IMMEDIATE")
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
    for session_id in ids:
        # These optional desktop tables are absent from plain agent installs.
        for table in ("desktop_message_attachments", "desktop_session_continuations",
                      "desktop_session_local_errors", "desktop_session_context_folders",
                      "desktop_session_model_overrides"):
            if table in tables:
                conn.execute('DELETE FROM "' + table + '" WHERE session_id = ?', (session_id,))
        # Never cascade to unselected child sessions.
        if "parent_session_id" in columns:
            conn.execute("UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id = ?", (session_id,))
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        result["deleted"] += conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,)).rowcount
    conn.commit()
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
print(json.dumps(result))
`;
