import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  patchDashboardCompatibilitySource,
  patchDashboardEmbeddedChatSource,
  patchDashboardModelLibrarySource,
  writeCompatFileAtomically,
} from "../src/main/hermes-agent-compat";
import { normalizeModelEndpointUrl } from "../src/shared/model-endpoint";

function resolvePython3(): string | null {
  if (process.platform === "win32") return null;
  try {
    const out = execFileSync("/bin/sh", ["-c", "command -v python3"], {
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

const python3Path = resolvePython3();
const itPython = python3Path ? it : it.skip;

function normalizeWithInjectedPython(values: string[]): string[] {
  const patched = patchDashboardModelLibrarySource(`
@app.post("/api/model/set")
async def set_model_assignment(body):
    return {"ok": True}

mount_spa(app)
`).source;
  const start = patched.indexOf("def _hermes_one_normalize_url_path(path):");
  const end = patched.indexOf("\n\ndef _hermes_one_model_key", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const helperSource = patched.slice(start, end);
  const output = execFileSync(
    python3Path as string,
    [
      "-c",
      `${helperSource}\n\nimport json, sys\nfor value in json.load(sys.stdin):\n    print(json.dumps(_hermes_one_normalize_base_url(value)))`,
    ],
    { input: JSON.stringify(values), encoding: "utf8" },
  );
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string);
}

describe("Hermes Agent dashboard compatibility patcher", () => {
  it("leaves already-compatible embedded chat defaults unchanged", () => {
    const source = `
async def start_server(
    host: str = "127.0.0.1",
    embedded_chat: bool = True,
):
    pass
`;

    const result = patchDashboardEmbeddedChatSource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });

  it("recognizes current upstream always-on dashboard chat as compatible", () => {
    const source = `
# In-browser Chat tab (/chat, /api/pty, /api/ws, ...). Always enabled.
_DASHBOARD_EMBEDDED_CHAT_ENABLED = True

def start_server(
    host: str = "127.0.0.1",
    port: int = 9119,
    open_browser: bool = True,
    allow_public: bool = False,
):
    pass
`;

    const result = patchDashboardEmbeddedChatSource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });

  it("patches older embedded chat defaults", () => {
    const source = `
async def start_server(
    host: str = "127.0.0.1",
    embedded_chat: bool = False,
):
    pass
`;

    const result = patchDashboardEmbeddedChatSource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("embedded_chat: bool = True");
    expect(result.source).not.toContain("embedded_chat: bool = False");
  });

  it("reports incompatible source instead of making an unsafe edit", () => {
    const source = "async def start_server(): pass";

    const result = patchDashboardEmbeddedChatSource(source);

    expect(result.compatible).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });

  it("installs the Hermes One configured model library endpoint when model REST exists", () => {
    const source = `
@app.post("/api/model/set")
async def set_model_assignment(body):
    return {"ok": True}

mount_spa(app)
`;

    const result = patchDashboardModelLibrarySource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("HERMES_ONE_MODEL_LIBRARY_COMPAT_V1");
    expect(result.source).toContain('@app.get("/api/model/library")');
    expect(result.source).toContain('@app.post("/api/model/library")');
    expect(result.source).toContain('row["contextLength"] = context_length');
    expect(result.source).toContain(
      "def _hermes_one_model_library_path(profile=None)",
    );
    expect(result.source).toContain(
      "def _hermes_one_current_model_row(profile=None)",
    );
    expect(result.source).toContain(
      "token = set_hermes_home_override(_hermes_one_profile_home(profile))",
    );
    expect(result.source).toContain(
      "def hermes_one_get_model_library(profile: Optional[str] = None)",
    );
    expect(result.source).toContain(
      "rows = _hermes_one_read_model_library(profile)",
    );
    expect(result.source).toContain(
      "current = _hermes_one_current_model_row(profile)",
    );
    expect(result.source).toContain(
      "def hermes_one_add_model_library_row(body: Dict[str, Any], profile: Optional[str] = None)",
    );
    expect(result.source).toContain(
      "def hermes_one_update_model_library_row(model_id: str, body: Dict[str, Any], profile: Optional[str] = None)",
    );
    expect(result.source).toContain(
      "def hermes_one_delete_model_library_row(model_id: str, profile: Optional[str] = None)",
    );
    expect(result.source).toContain(
      "_hermes_one_write_model_library(rows, profile)",
    );
    expect(result.source).toContain("def _hermes_one_normalize_url_path");
    expect(result.source).toContain("def _hermes_one_normalize_base_url");
    expect(result.source).toContain(
      '_hermes_one_normalize_url_path(parsed.path).rstrip("/")',
    );
    expect(result.source).toContain(
      '@app.patch("/api/model/library/{model_id:path}")',
    );
    expect(result.source).toContain(
      '@app.delete("/api/model/library/{model_id:path}")',
    );
    expect(
      result.source.indexOf('@app.get("/api/model/library")'),
    ).toBeLessThan(result.source.indexOf("mount_spa(app)"));
  });

  itPython("normalizes path dot segments like the desktop URL parser", () => {
    const values = [
      "https://host/a/../v1",
      "https://host/a/./v1",
      "https://host/a/%2e/v1",
      "https://host/a/%2E/v1",
      "https://host/a/.%2e/v1",
      "https://host/a/%2e./v1",
      "https://host/a/%2e%2e/v1",
      "https://host/%2e%2e/v1",
      "https://host/a//../v1",
      "https://host/a///../v1",
      "https://host//a/../v1",
      "https://host/a/b/../../v1",
      "https://host/a/../../v1",
      "https://host/../../v1",
      "https://host/a/..//v1",
      "https://host/a/.//v1",
      "https://host/a/.",
      "https://host/a/..",
      "https://host/a//v1",
      "https://host/a/%2f/v1",
      "https://host/a/%2Ehidden/v1",
    ];

    expect(normalizeWithInjectedPython(values)).toEqual(
      values.map((value) => normalizeModelEndpointUrl(value)),
    );
  });

  // @lat: [[provider-setup#Provider setup#Models live under each provider (OpenCode-style)#Transport-consistent attachment identity#Explicit endpoint ports]]
  itPython("preserves explicit endpoint ports in both runtimes", () => {
    const values = [
      "http://localhost:0/v1",
      "http://localhost/v1",
      "http://localhost:80/v1",
      "https://localhost:443/v1",
      "https://localhost:8443/v1",
    ];
    const normalized = normalizeWithInjectedPython(values);
    expect(normalized).toEqual(
      values.map((value) => normalizeModelEndpointUrl(value)),
    );
    expect(normalized[0]).not.toBe(normalized[1]);
  });

  it("does not install the model library endpoint twice", () => {
    const source = `
@app.post("/api/model/set")
async def set_model_assignment(body):
    return {"ok": True}

mount_spa(app)
`;

    const installed = patchDashboardModelLibrarySource(source);
    const result = patchDashboardModelLibrarySource(installed.source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(installed.source);
  });

  it("moves a previously appended model library endpoint before the dashboard catch-all", () => {
    const source = `
@app.post("/api/model/set")
async def set_model_assignment(body):
    return {"ok": True}

mount_spa(app)

# --- HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 -------------------------------------
@app.get("/api/model/library")
def hermes_one_get_model_library():
    return {"models": []}
# --- /HERMES_ONE_MODEL_LIBRARY_COMPAT_V1 ------------------------------------
`;

    const result = patchDashboardModelLibrarySource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(true);
    expect(
      result.source.indexOf('@app.get("/api/model/library")'),
    ).toBeLessThan(result.source.indexOf("mount_spa(app)"));
    expect(result.detail).toContain("Moved");
  });

  it("applies all safe dashboard compatibility patches together", () => {
    const source = `
async def start_server(
    host: str = "127.0.0.1",
    embedded_chat: bool = False,
):
    pass

@app.post("/api/model/set")
async def set_model_assignment(body):
    return {"ok": True}

mount_spa(app)
`;

    const result = patchDashboardCompatibilitySource(source);

    expect(result.compatible).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("embedded_chat: bool = True");
    expect(result.source).toContain("HERMES_ONE_MODEL_LIBRARY_COMPAT_V1");
  });

  it("writes patched local source through a temp file and keeps a first-run backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-compat-"));
    try {
      const target = join(dir, "web_server.py");
      writeFileSync(target, "original", "utf-8");

      writeCompatFileAtomically(target, "patched");

      expect(readFileSync(target, "utf-8")).toBe("patched");
      expect(readFileSync(`${target}.orig`, "utf-8")).toBe("original");
      expect(
        readdirSync(dir).filter((name) => name.includes(".hermes-one-")),
      ).toEqual([]);

      writeCompatFileAtomically(target, "patched-again");

      expect(readFileSync(target, "utf-8")).toBe("patched-again");
      expect(readFileSync(`${target}.orig`, "utf-8")).toBe("original");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
