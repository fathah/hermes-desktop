import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { Buffer } from "buffer";
import type { SshConfig } from "./ssh-tunnel";
import { HERMES_HOME, HERMES_REPO } from "./installer";
import { sshExec } from "./ssh-remote";

export const HERMES_AGENT_COMPAT_VERSION =
  "2026-09-07.dashboard-chat-model-library.v3";

export interface HermesAgentCompatResult {
  ok: boolean;
  target: "local" | "ssh" | "remote-http";
  compatible: boolean;
  applied: boolean;
  version: string;
  detail: string;
  path?: string;
  error?: string;
}

export interface DashboardSourcePatchResult {
  compatible: boolean;
  changed: boolean;
  source: string;
  detail: string;
}

export interface DashboardSourcePatchesResult {
  compatible: boolean;
  changed: boolean;
  source: string;
  detail: string;
}

const EMBEDDED_CHAT_FALSE_RE = /(\bembedded_chat\s*:\s*bool\s*=\s*)False\b/;
const EMBEDDED_CHAT_TRUE_RE = /\bembedded_chat\s*:\s*bool\s*=\s*True\b/;
const DASHBOARD_CHAT_ALWAYS_ON_RE =
  /\b_DASHBOARD_EMBEDDED_CHAT_ENABLED\s*=\s*True\b/;
const MODEL_LIBRARY_COMPAT_START =
  "# --- HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 -------------------------------------";
const MODEL_LIBRARY_COMPAT_END =
  "# --- /HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 ------------------------------------";
const DASHBOARD_SPA_MOUNT_ANCHOR = "mount_spa(app)";

const MODEL_LIBRARY_COMPAT_SOURCE = `

# --- HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 -------------------------------------
# Compatibility endpoint installed by Hermes One. Upstream Hermes Agent exposes
# /api/model/options and /api/model/set, but Hermes One also needs a small
# configured-model shortcut library for remote/SSH model pickers. The library is
# deliberately stored in this agent's HERMES_HOME so remote shortcuts stay on
# the remote host and survive desktop restarts without changing upstream model
# assignment semantics.
def _hermes_one_profile_home(profile=None):
    requested = str(profile or "").strip()
    if not requested or requested.lower() == "current":
        return get_hermes_home()
    if requested.lower() == "default":
        current_home = get_hermes_home()
        return current_home.parent.parent if current_home.parent.name == "profiles" else current_home
    from hermes_cli import profiles as profiles_mod
    try:
        profiles_mod.validate_profile_name(requested)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not profiles_mod.profile_exists(requested):
        raise HTTPException(status_code=404, detail=f"Profile '{requested}' does not exist.")
    return profiles_mod.get_profile_dir(requested)


def _hermes_one_model_library_path(profile=None):
    return _hermes_one_profile_home(profile) / "models.json"


def _hermes_one_short_model_label(model):
    text = str(model or "").strip()
    return (text.rsplit("/", 1)[-1] if text else "") or text


def _hermes_one_normalize_url_path(path):
    # Match the WHATWG URL path shortening used by the desktop's new URL().
    # Percent-encoded dot segments are structural, but every other encoded
    # segment and repeated slash remains part of the endpoint identity.
    segments = str(path or "").split("/")
    normalized = []
    for segment in segments:
        folded = segment.lower()
        if folded in (".", "%2e"):
            continue
        if folded in ("..", ".%2e", "%2e.", "%2e%2e"):
            if len(normalized) > 1:
                normalized.pop()
            continue
        normalized.append(segment)
    return "/".join(normalized)


def _hermes_one_normalize_base_url(value):
    from urllib.parse import urlsplit, urlunsplit
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        parsed = urlsplit(text)
        if not parsed.scheme or not parsed.hostname:
            return text.rstrip("/")
        scheme = parsed.scheme.lower()
        hostname = parsed.hostname.lower()
        if ":" in hostname:
            hostname = f"[{hostname}]"
        credentials = ""
        if parsed.username is not None:
            credentials = parsed.username
            if parsed.password is not None:
                credentials += f":{parsed.password}"
            credentials += "@"
        port = parsed.port
        default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
        netloc = credentials + hostname + (f":{port}" if port is not None and not default_port else "")
        path = _hermes_one_normalize_url_path(parsed.path).rstrip("/")
        return urlunsplit((scheme, netloc, path, parsed.query, parsed.fragment))
    except ValueError:
        return text.rstrip("/")


def _hermes_one_model_key(row):
    return (
        str(row.get("provider", "")).strip().lower(),
        str(row.get("model", "")).strip().lower(),
        _hermes_one_normalize_base_url(row.get("baseUrl", row.get("base_url", ""))),
    )


def _hermes_one_normalize_model_row(row, index=0):
    if not isinstance(row, dict):
        return None
    provider = str(row.get("provider", "")).strip()
    model = str(row.get("model", "")).strip()
    if not provider or not model:
        return None
    base_url = str(row.get("baseUrl", row.get("base_url", "")) or "").strip()
    return {
        "id": str(row.get("id") or f"remote:library:{provider}:{index}:{model}"),
        "name": str(row.get("name") or _hermes_one_short_model_label(model) or provider),
        "provider": provider,
        "model": model,
        "baseUrl": base_url,
        "createdAt": row.get("createdAt") if isinstance(row.get("createdAt"), (int, float)) else 0,
    }


def _hermes_one_read_model_library(profile=None):
    path = _hermes_one_model_library_path(profile)
    try:
        raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    except Exception:
        raw = []
    rows = []
    seen = set()
    for index, item in enumerate(raw if isinstance(raw, list) else []):
        row = _hermes_one_normalize_model_row(item, index)
        if not row:
            continue
        key = _hermes_one_model_key(row)
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)
    return rows


def _hermes_one_write_model_library(rows, profile=None):
    path = _hermes_one_model_library_path(profile)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    tmp.replace(path)


def _hermes_one_current_model_row(profile=None):
    requested = str(profile or "").strip().lower()
    if not requested or requested == "current":
        try:
            cfg = load_config()
        except Exception:
            return None
        return _hermes_one_model_row_from_config(cfg)
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    token = set_hermes_home_override(_hermes_one_profile_home(profile))
    try:
        cfg = load_config()
    except Exception:
        return None
    finally:
        reset_hermes_home_override(token)
    return _hermes_one_model_row_from_config(cfg)


def _hermes_one_model_row_from_config(cfg):
    model_cfg = cfg.get("model", {})
    if isinstance(model_cfg, dict):
        provider = str(model_cfg.get("provider", "") or "").strip()
        model = str(model_cfg.get("default", model_cfg.get("name", "")) or "").strip()
        base_url = str(model_cfg.get("base_url", "") or "").strip()
        try:
            context_length = int(model_cfg.get("context_length") or 0)
        except (TypeError, ValueError):
            context_length = 0
    else:
        provider = ""
        model = str(model_cfg or "").strip()
        base_url = ""
        context_length = 0
    if not provider or not model:
        return None
    row = {
        "id": f"remote:active:{provider}:{model}",
        "name": _hermes_one_short_model_label(model) or provider,
        "provider": provider,
        "model": model,
        "baseUrl": base_url,
        "createdAt": 0,
    }
    if context_length > 0:
        row["contextLength"] = context_length
    return row


@app.get("/api/model/library")
def hermes_one_get_model_library(profile: Optional[str] = None):
    rows = _hermes_one_read_model_library(profile)
    current = _hermes_one_current_model_row(profile)
    if current:
        current_key = _hermes_one_model_key(current)
        rows = [current] + [row for row in rows if _hermes_one_model_key(row) != current_key]
    return {"models": rows}


@app.post("/api/model/library")
def hermes_one_add_model_library_row(body: Dict[str, Any], profile: Optional[str] = None):
    provider = str(body.get("provider", "") or "").strip()
    model = str(body.get("model", "") or "").strip()
    if not provider or not model:
        raise HTTPException(status_code=400, detail="provider and model required")
    base_url = str(body.get("baseUrl", body.get("base_url", "")) or "").strip()
    name = str(body.get("name", "") or "").strip() or _hermes_one_short_model_label(model) or provider
    rows = _hermes_one_read_model_library(profile)
    key = (provider.lower(), model.lower(), _hermes_one_normalize_base_url(base_url))
    for row in rows:
        if _hermes_one_model_key(row) == key:
            return row
    row = {
        "id": f"remote:library:{secrets.token_hex(8)}",
        "name": name,
        "provider": provider,
        "model": model,
        "baseUrl": base_url,
        "createdAt": int(time.time() * 1000),
    }
    rows.append(row)
    _hermes_one_write_model_library(rows, profile)
    return row


@app.patch("/api/model/library/{model_id:path}")
def hermes_one_update_model_library_row(model_id: str, body: Dict[str, Any], profile: Optional[str] = None):
    rows = _hermes_one_read_model_library(profile)
    for index, row in enumerate(rows):
        if row.get("id") != model_id:
            continue
        next_row = dict(row)
        for key in ("name", "provider", "model"):
            if key in body:
                next_row[key] = str(body.get(key, "") or "").strip()
        if "baseUrl" in body or "base_url" in body:
            next_row["baseUrl"] = str(body.get("baseUrl", body.get("base_url", "")) or "").strip()
        normalized = _hermes_one_normalize_model_row(next_row, index)
        if not normalized:
            raise HTTPException(status_code=400, detail="provider and model required")
        rows[index] = normalized
        _hermes_one_write_model_library(rows, profile)
        return {"ok": True, "model": normalized}
    raise HTTPException(status_code=404, detail="model not found")


@app.delete("/api/model/library/{model_id:path}")
def hermes_one_delete_model_library_row(model_id: str, profile: Optional[str] = None):
    rows = _hermes_one_read_model_library(profile)
    filtered = [row for row in rows if row.get("id") != model_id]
    if len(filtered) == len(rows):
        raise HTTPException(status_code=404, detail="model not found")
    _hermes_one_write_model_library(filtered, profile)
    return {"ok": True}
# --- /HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 ------------------------------------
`;

function compatMarkerPath(): string {
  return join(HERMES_HOME, "desktop-compat", "dashboard-embedded-chat.json");
}

function writeLocalMarker(result: HermesAgentCompatResult): void {
  try {
    const marker = compatMarkerPath();
    mkdirSync(join(HERMES_HOME, "desktop-compat"), { recursive: true });
    writeFileSync(
      marker,
      JSON.stringify(
        {
          version: result.version,
          target: result.target,
          compatible: result.compatible,
          applied: result.applied,
          path: result.path,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
  } catch {
    // The marker is diagnostic only. A failed marker write must not block chat.
  }
}

export function patchDashboardEmbeddedChatSource(
  source: string,
): DashboardSourcePatchResult {
  if (DASHBOARD_CHAT_ALWAYS_ON_RE.test(source)) {
    return {
      compatible: true,
      changed: false,
      source,
      detail: "Dashboard embedded chat is always enabled by this Hermes Agent.",
    };
  }

  if (EMBEDDED_CHAT_TRUE_RE.test(source)) {
    return {
      compatible: true,
      changed: false,
      source,
      detail: "Dashboard embedded chat is already enabled by default.",
    };
  }

  if (!EMBEDDED_CHAT_FALSE_RE.test(source)) {
    return {
      compatible: false,
      changed: false,
      source,
      detail:
        "Could not find the Hermes Agent embedded_chat default in web_server.py.",
    };
  }

  return {
    compatible: true,
    changed: true,
    source: source.replace(EMBEDDED_CHAT_FALSE_RE, "$1True"),
    detail: "Patched Hermes Agent dashboard embedded_chat default to True.",
  };
}

export function patchDashboardModelLibrarySource(
  source: string,
): DashboardSourcePatchResult {
  const withoutExisting = removeModelLibraryCompatBlock(source);
  if (!withoutExisting.source.includes('@app.post("/api/model/set")')) {
    return {
      compatible: false,
      changed: false,
      source,
      detail:
        "Could not find Hermes Agent model REST endpoints in web_server.py.",
    };
  }

  const patched = insertModelLibraryCompatBlock(withoutExisting.source);
  if (patched === source) {
    return {
      compatible: true,
      changed: false,
      source,
      detail: "Hermes One model library endpoint is already installed.",
    };
  }

  return {
    compatible: true,
    changed: true,
    source: patched,
    detail: withoutExisting.removed
      ? "Moved Hermes One model library endpoint before the dashboard catch-all route."
      : "Installed Hermes One model library endpoint.",
  };
}

function removeModelLibraryCompatBlock(source: string): {
  source: string;
  removed: boolean;
} {
  const start = source.indexOf(MODEL_LIBRARY_COMPAT_START);
  if (start < 0) return { source, removed: false };
  const end = source.indexOf(MODEL_LIBRARY_COMPAT_END, start);
  if (end < 0) return { source, removed: false };
  const afterEnd = end + MODEL_LIBRARY_COMPAT_END.length;
  const before = source.slice(0, start).replace(/\n*$/, "\n");
  const after = source.slice(afterEnd).replace(/^\n*/, "");
  return { source: before + after, removed: true };
}

function insertModelLibraryCompatBlock(source: string): string {
  const block = MODEL_LIBRARY_COMPAT_SOURCE.trimEnd();
  const anchorIndex = source.indexOf(DASHBOARD_SPA_MOUNT_ANCHOR);
  if (anchorIndex >= 0) {
    const before = source.slice(0, anchorIndex).replace(/\n*$/, "\n");
    const after = source.slice(anchorIndex);
    return `${before}${block}\n\n${after}`;
  }
  return `${source.trimEnd()}\n${block}\n`;
}

export function patchDashboardCompatibilitySource(
  source: string,
): DashboardSourcePatchesResult {
  const details: string[] = [];
  let changed = false;

  const embedded = patchDashboardEmbeddedChatSource(source);
  details.push(embedded.detail);
  if (!embedded.compatible) {
    return { ...embedded, detail: details.join(" ") };
  }
  changed ||= embedded.changed;

  const modelLibrary = patchDashboardModelLibrarySource(embedded.source);
  details.push(modelLibrary.detail);
  if (!modelLibrary.compatible) {
    return {
      compatible: false,
      changed,
      source: modelLibrary.source,
      detail: details.join(" "),
    };
  }
  changed ||= modelLibrary.changed;

  return {
    compatible: true,
    changed,
    source: modelLibrary.source,
    detail: details.join(" "),
  };
}

export function writeCompatFileAtomically(path: string, source: string): void {
  const backupPath = `${path}.orig`;
  const tmpPath = `${path}.hermes-one-${process.pid}-${Date.now()}.tmp`;
  if (!existsSync(backupPath)) {
    copyFileSync(path, backupPath);
  }
  try {
    writeFileSync(tmpPath, source, "utf-8");
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best effort cleanup only; preserve the original write error.
    }
    throw err;
  }
}

export function ensureLocalDashboardCompatibility(): HermesAgentCompatResult {
  const path = join(HERMES_REPO, "hermes_cli", "web_server.py");
  try {
    const source = readFileSync(path, "utf-8");
    const patched = patchDashboardCompatibilitySource(source);
    if (!patched.compatible) {
      const result: HermesAgentCompatResult = {
        ok: false,
        target: "local",
        compatible: false,
        applied: false,
        version: HERMES_AGENT_COMPAT_VERSION,
        detail: patched.detail,
        path,
      };
      writeLocalMarker(result);
      return result;
    }

    if (patched.changed) {
      writeCompatFileAtomically(path, patched.source);
    }

    const result: HermesAgentCompatResult = {
      ok: true,
      target: "local",
      compatible: true,
      applied: patched.changed,
      version: HERMES_AGENT_COMPAT_VERSION,
      detail: patched.detail,
      path,
    };
    writeLocalMarker(result);
    return result;
  } catch (err) {
    const result: HermesAgentCompatResult = {
      ok: false,
      target: "local",
      compatible: false,
      applied: false,
      version: HERMES_AGENT_COMPAT_VERSION,
      detail: "Could not inspect local Hermes Agent dashboard source.",
      path,
      error: err instanceof Error ? err.message : String(err),
    };
    writeLocalMarker(result);
    return result;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export async function ensureSshDashboardCompatibility(
  config: SshConfig,
): Promise<HermesAgentCompatResult> {
  const modelLibraryCompatBase64 = Buffer.from(
    MODEL_LIBRARY_COMPAT_SOURCE,
    "utf-8",
  ).toString("base64");
  const script = String.raw`
import base64, json, os, re, sys
version = "2026-09-07.dashboard-chat-model-library.v3"
model_library_compat_source = base64.b64decode("__MODEL_LIBRARY_COMPAT_BASE64__").decode("utf-8")
candidates = []
try:
    import hermes_cli.web_server as ws
    p = getattr(ws, "__file__", None)
    if p:
        candidates.append(p)
except Exception:
    pass
candidates.extend([
    os.path.expanduser("~/hermes-agent/hermes_cli/web_server.py"),
    os.path.expanduser("~/.hermes/hermes-agent/hermes_cli/web_server.py"),
    "/opt/hermes/hermes_cli/web_server.py",
    "/opt/hermes/hermes-agent/hermes_cli/web_server.py",
])
seen = set()
paths = []
for p in candidates:
    if p and p not in seen:
        seen.add(p)
        paths.append(p)
path = next((p for p in paths if os.path.exists(p)), None)
if not path:
    print(json.dumps({
        "ok": False,
        "target": "ssh",
        "compatible": False,
        "applied": False,
        "version": version,
        "detail": "Could not find Hermes Agent hermes_cli/web_server.py on the SSH host.",
    }))
    sys.exit(0)
with open(path, "r", encoding="utf-8") as f:
    source = f.read()
details = []
changed = False
model_library_start = "# --- HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 -------------------------------------"
model_library_end = "# --- /HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 ------------------------------------"
dashboard_spa_mount_anchor = "mount_spa(app)"
def remove_model_library_compat_block(text):
    start = text.find(model_library_start)
    if start < 0:
        return text, False
    end = text.find(model_library_end, start)
    if end < 0:
        return text, False
    after_end = end + len(model_library_end)
    before = re.sub(r"\n*$", "\n", text[:start])
    after = re.sub(r"^\n*", "", text[after_end:])
    return before + after, True
def insert_model_library_compat_block(text):
    block = model_library_compat_source.rstrip()
    index = text.find(dashboard_spa_mount_anchor)
    if index >= 0:
        before = re.sub(r"\n*$", "\n", text[:index])
        after = text[index:]
        return before + block + "\n\n" + after
    return text.rstrip() + "\n" + block + "\n"
if re.search(r"\b_DASHBOARD_EMBEDDED_CHAT_ENABLED\s*=\s*True\b", source):
    compatible = True
    details.append("Dashboard embedded chat is always enabled by this Hermes Agent.")
elif re.search(r"\bembedded_chat\s*:\s*bool\s*=\s*True\b", source):
    compatible = True
    details.append("Dashboard embedded chat is already enabled by default.")
elif re.search(r"(\bembedded_chat\s*:\s*bool\s*=\s*)False\b", source):
    source = re.sub(r"(\bembedded_chat\s*:\s*bool\s*=\s*)False\b", r"\1True", source, count=1)
    changed = True
    compatible = True
    details.append("Patched Hermes Agent dashboard embedded_chat default to True.")
else:
    compatible = False
    details.append("Could not find the Hermes Agent embedded_chat default in web_server.py.")
if compatible:
    original_source = source
    source_without_model_library, removed_model_library = remove_model_library_compat_block(source)
    if '@app.post("/api/model/set")' in source_without_model_library:
        source = insert_model_library_compat_block(source_without_model_library)
        if source != original_source:
            changed = True
            if removed_model_library:
                details.append("Moved Hermes One model library endpoint before the dashboard catch-all route.")
            else:
                details.append("Installed Hermes One model library endpoint.")
        else:
            details.append("Hermes One model library endpoint is already installed.")
    else:
        compatible = False
        details.append("Could not find Hermes Agent model REST endpoints in web_server.py.")
if changed and compatible:
    backup_path = path + ".orig"
    tmp_path = path + ".hermes-one-%s.tmp" % os.getpid()
    if not os.path.exists(backup_path):
        with open(path, "rb") as src, open(backup_path, "wb") as dst:
            dst.write(src.read())
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(source)
    os.replace(tmp_path, path)
marker_dir = os.path.expanduser("~/.hermes/desktop-compat")
try:
    os.makedirs(marker_dir, exist_ok=True)
    with open(os.path.join(marker_dir, "dashboard-embedded-chat.json"), "w", encoding="utf-8") as f:
        json.dump({
            "version": version,
            "target": "ssh",
            "compatible": compatible,
            "applied": changed,
            "path": path,
        }, f, indent=2)
except Exception:
    pass
print(json.dumps({
    "ok": compatible,
    "target": "ssh",
    "compatible": compatible,
    "applied": changed,
    "version": version,
    "detail": " ".join(details),
    "path": path,
}))
`.replace("__MODEL_LIBRARY_COMPAT_BASE64__", modelLibraryCompatBase64);

  try {
    const out = await sshExec(
      config,
      `python3 -c ${shellQuote(script)}`,
      undefined,
      30_000,
    );
    const parsed = JSON.parse(out.trim()) as HermesAgentCompatResult;
    return {
      ...parsed,
      target: "ssh",
      version: parsed.version || HERMES_AGENT_COMPAT_VERSION,
    };
  } catch (err) {
    return {
      ok: false,
      target: "ssh",
      compatible: false,
      applied: false,
      version: HERMES_AGENT_COMPAT_VERSION,
      detail: "Could not apply Hermes Agent compatibility patch over SSH.",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function remoteHttpCompatibilityResult(): HermesAgentCompatResult {
  return {
    ok: false,
    target: "remote-http",
    compatible: false,
    applied: false,
    version: HERMES_AGENT_COMPAT_VERSION,
    detail:
      "Plain remote HTTP can be probed but not patched by Hermes One. Use SSH mode for deployable compatibility fixes or update the remote Hermes Agent directly.",
  };
}
