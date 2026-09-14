// @vitest-environment node
import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";
import { patchDashboardModelLibrarySource } from "../src/main/hermes-agent-compat";

describe("Dashboard model profile isolation", () => {
  // @lat: [[model-context#Model context window#Dashboard default profile isolation]]
  it.skipIf(process.platform === "win32")(
    "reads the root config for default while retaining the current named profile",
    () => {
      const source = patchDashboardModelLibrarySource(`
@app.post("/api/model/set")
async def set_model_assignment(body):
    return {"ok": True}

mount_spa(app)
`).source;
      // The boundary supplies the same context-local home API as upstream.
      // Execute the actual injected handlers against separate files on disk.
      const script = String.raw`
import contextvars, json, secrets, sys, tempfile, time, types
from pathlib import Path
from typing import Any, Dict, Optional

class App:
    def __getattr__(self, name):
        return lambda *args, **kwargs: lambda handler: handler

app = App()
mount_spa = lambda app: None
override = contextvars.ContextVar("home", default=None)
constants = types.ModuleType("hermes_constants")
constants.set_hermes_home_override = override.set
constants.reset_hermes_home_override = override.reset
sys.modules["hermes_constants"] = constants

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    process_home = root / "profiles" / "work"
    process_home.mkdir(parents=True)
    def get_hermes_home():
        return override.get() or process_home
    def load_config():
        return json.loads((get_hermes_home() / "config.yaml").read_text())
    for home, window in [(root, 32768), (process_home, 1000000)]:
        (home / "config.yaml").write_text(json.dumps({"model": {
            "provider": "custom", "default": "same-model", "context_length": window
        }}))
        (home / "models.json").write_text("[]")
    exec(json.load(sys.stdin), globals())
    default_row = hermes_one_get_model_library("default")["models"][0]
    current_row = hermes_one_get_model_library("current")["models"][0]
    default_path = _hermes_one_model_library_path("default")
    for endpoint in ["https://host/TenantA", "https://host/tenanta", "https://HOST/TenantA/"]:
        hermes_one_add_model_library_row({
            "provider": "custom", "model": "same-model", "baseUrl": endpoint
        }, "default")
    saved_default = json.loads(default_path.read_text())
    (root / "config.yaml").unlink()
    failed = _hermes_one_current_model_row("default")
    print(json.dumps({
        "defaultWindow": default_row["contextLength"],
        "currentWindow": current_row["contextLength"],
        "defaultLibraryAtRoot": default_path == root / "models.json",
        "failedRead": failed,
        "homeRestored": get_hermes_home() == process_home,
        "currentAfterFailure": _hermes_one_current_model_row()["contextLength"],
        "rootEndpoints": [row["baseUrl"] for row in saved_default],
        "namedAttachments": json.loads((process_home / "models.json").read_text()),
    }))
`;
      const output = execFileSync("python3", ["-c", script], {
        input: JSON.stringify(source),
        encoding: "utf8",
      });
      expect(JSON.parse(output)).toEqual({
        defaultWindow: 32768,
        currentWindow: 1000000,
        defaultLibraryAtRoot: true,
        failedRead: null,
        homeRestored: true,
        currentAfterFailure: 1000000,
        rootEndpoints: ["https://host/TenantA", "https://host/tenanta"],
        namedAttachments: [],
      });
    },
  );
});
