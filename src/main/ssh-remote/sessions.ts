import type { HistoryItem, SearchResult, SessionSummary } from "../sessions";
import type { SshConfig } from "../ssh-tunnel";
import { pythonJsonInput, sshPython } from "./core";

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function sshListSessions(
  config: SshConfig,
  limit = 30,
  offset = 0,
  profile?: string,
): Promise<SessionSummary[]> {
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
limit = max(1, min(200, int(payload.get("limit") or 30)))
offset = max(0, int(payload.get("offset") or 0))
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT id, source, started_at, ended_at, message_count, model, title "
    "FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?",
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
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, limit, offset }),
    );
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

export async function sshGetSessionMessages(
  config: SshConfig,
  sessionId: string,
  profile?: string,
): Promise<HistoryItem[]> {
  // Mirror the local getSessionMessages logic over SSH: widen the SELECT to
  // include tool_calls / tool_name / tool_call_id / reasoning columns, then
  // expand each row into one or more HistoryItem entries. Kept inline in
  // Python for transport simplicity. See src/main/sessions.ts for the
  // canonical implementation and column documentation.
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
session_id = payload.get("sessionId") or ""
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row

CONTENT_JSON_PREFIX = "\\x00json:"

def decode(raw):
    """Mirror src/main/sessions.ts::decodeContent — strip multimodal
    sentinel, concat text parts, ignore images here (SSH path drops
    attachments)."""
    if not raw or not raw.startswith(CONTENT_JSON_PREFIX):
        return raw or ""
    try:
        parts = json.loads(raw[len(CONTENT_JSON_PREFIX):])
    except Exception:
        return raw
    if isinstance(parts, str):
        return parts
    if not isinstance(parts, list):
        return raw
    texts = []
    for p in parts:
        if isinstance(p, str):
            if p: texts.append(p)
            continue
        if not isinstance(p, dict): continue
        t = str(p.get("type") or "").lower()
        if t in ("text", "input_text", "output_text"):
            v = p.get("text")
            if isinstance(v, str) and v: texts.append(v)
    return "\\n\\n".join(texts)

def pick_reasoning(row):
    for col in ("reasoning", "reasoning_content"):
        v = (row[col] or "").strip() if row[col] else ""
        if v: return v
    details = (row["reasoning_details"] or "").strip()
    if not details: return ""
    try:
        parsed = json.loads(details)
    except Exception:
        return ""
    if isinstance(parsed, str): return parsed
    if isinstance(parsed, list):
        texts = []
        for entry in parsed:
            if not isinstance(entry, dict): continue
            for k in ("text", "thinking"):
                v = entry.get(k)
                if isinstance(v, str) and v: texts.append(v); break
        if texts: return "\\n\\n".join(texts)
    return ""

def parse_tool_calls(raw):
    if not raw or not raw.strip(): return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list): return []
    out = []
    for entry in parsed:
        if not isinstance(entry, dict): continue
        fn = entry.get("function") or {}
        name = fn.get("name")
        if not isinstance(name, str) or not name: continue
        call_id = entry.get("call_id") or entry.get("id") or ""
        raw_args = fn.get("arguments")
        args = raw_args if isinstance(raw_args, str) else ""
        try:
            args = json.dumps(json.loads(args), indent=2)
        except Exception:
            pass
        out.append({"callId": call_id, "name": name, "args": args})
    return out

rows = conn.execute(
    "SELECT id, role, content, timestamp, tool_call_id, tool_calls, tool_name, "
    "reasoning, reasoning_content, reasoning_details "
    "FROM messages WHERE session_id = ? AND role IN ('user','assistant','tool') "
    "ORDER BY timestamp, id",
    (session_id,)
).fetchall()

items = []
for r in rows:
    text = decode(r["content"] or "")
    if r["role"] == "user":
        if not text: continue
        items.append({"kind":"user","id":r["id"],"content":text,"timestamp":r["timestamp"]})
        continue
    if r["role"] == "assistant":
        reasoning_text = pick_reasoning(r)
        if reasoning_text:
            items.append({"kind":"reasoning","id":r["id"],"assistantId":r["id"],"text":reasoning_text,"timestamp":r["timestamp"]})
        if text:
            items.append({"kind":"assistant","id":r["id"],"content":text,"timestamp":r["timestamp"]})
        for tc in parse_tool_calls(r["tool_calls"]):
            items.append({"kind":"tool_call","id":r["id"],"assistantId":r["id"],"callId":tc["callId"],"name":tc["name"],"args":tc["args"],"timestamp":r["timestamp"]})
        continue
    if r["role"] == "tool":
        items.append({"kind":"tool_result","id":r["id"],"callId":r["tool_call_id"] or "","name":r["tool_name"] or "tool","content":text,"timestamp":r["timestamp"]})
        continue

print(json.dumps(items))
conn.close()
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, sessionId }),
    );
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

export async function sshSearchSessions(
  config: SshConfig,
  query: string,
  limit = 20,
  profile?: string,
): Promise<SearchResult[]> {
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
query = payload.get("query") or ""
limit = max(1, min(200, int(payload.get("limit") or 20)))
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
try:
    rows = conn.execute(
        "SELECT DISTINCT s.id, s.title, s.started_at, s.source, s.message_count, s.model, m.content as snippet "
        "FROM sessions s JOIN messages m ON m.session_id = s.id "
        "WHERE m.content LIKE ? ORDER BY s.started_at DESC LIMIT ?",
        (f"%{query}%", limit)
    ).fetchall()
    print(json.dumps([{"sessionId": r["id"], "title": r["title"], "startedAt": r["started_at"], "source": r["source"] or "cli", "messageCount": r["message_count"] or 0, "model": r["model"] or "", "snippet": (r["snippet"] or "")[:200]} for r in rows]))
except Exception as e:
    print("[]")
conn.close()
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, query, limit }),
    );
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}
