import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ASKPASS_SUBMIT_CHANNEL } from "../src/shared/askpass";

const ROOT = join(__dirname, "..");
const askpassMainSrc = readFileSync(join(ROOT, "src/main/askpass.ts"), "utf-8");
const sudoCredsSrc = readFileSync(join(ROOT, "src/main/sudoCreds.ts"), "utf-8");
const gatewayPromptSrc = readFileSync(
  join(ROOT, "src/main/gatewayPrompt.ts"),
  "utf-8",
);
const hermesSrc = readFileSync(join(ROOT, "src/main/hermes.ts"), "utf-8");
const askpassPreloadSrc = readFileSync(
  join(ROOT, "src/preload/askpass.ts"),
  "utf-8",
);
const electronViteConfigSrc = readFileSync(
  join(ROOT, "electron.vite.config.ts"),
  "utf-8",
);

describe("askpass Electron hardening", () => {
  it("keeps the password dialog renderer isolated from Node privileges", () => {
    expect(askpassMainSrc).toContain(
      'preload: join(__dirname, "../preload/askpass.js")',
    );
    expect(askpassMainSrc).toContain("nodeIntegration: false");
    expect(askpassMainSrc).toContain("contextIsolation: true");
    expect(askpassMainSrc).toContain("sandbox: true");
    expect(askpassMainSrc).toContain("webSecurity: true");
    expect(askpassMainSrc).toContain("allowRunningInsecureContent: false");
    expect(askpassMainSrc).toContain("webviewTag: false");
    expect(askpassMainSrc).not.toMatch(/nodeIntegration:\s*true/);
    expect(askpassMainSrc).not.toMatch(/contextIsolation:\s*false/);
  });

  it("keeps the sudo precache dialog isolated from Node privileges", () => {
    expect(sudoCredsSrc).toContain(
      'preload: join(__dirname, "../preload/askpass.js")',
    );
    expect(sudoCredsSrc).toContain("nodeIntegration: false");
    expect(sudoCredsSrc).toContain("contextIsolation: true");
    expect(sudoCredsSrc).toContain("sandbox: true");
    expect(sudoCredsSrc).toContain("webSecurity: true");
    expect(sudoCredsSrc).toContain("allowRunningInsecureContent: false");
    expect(sudoCredsSrc).toContain("webviewTag: false");
    expect(sudoCredsSrc).not.toMatch(/nodeIntegration:\s*true/);
    expect(sudoCredsSrc).not.toMatch(/contextIsolation:\s*false/);
  });

  it("keeps password submission bound to the dialog webContents", () => {
    expect(ASKPASS_SUBMIT_CHANNEL).toBe("askpass-submit");
    expect(askpassMainSrc).toContain("ASKPASS_SUBMIT_CHANNEL");
    expect(askpassMainSrc).toContain("event.sender !== win.webContents");
    expect(askpassMainSrc).toContain(
      "ipcMain.removeListener(ASKPASS_SUBMIT_CHANNEL, onSubmit)",
    );
    expect(sudoCredsSrc).toContain("ASKPASS_SUBMIT_CHANNEL");
    expect(sudoCredsSrc).toContain("event.sender !== win.webContents");
    expect(sudoCredsSrc).toContain(
      "ipcMain.removeListener(ASKPASS_SUBMIT_CHANNEL, onSubmit)",
    );
  });

  it("blocks navigation, popups, and webviews in the password dialog", () => {
    expect(askpassMainSrc).toContain("win.webContents.setWindowOpenHandler");
    expect(askpassMainSrc).toContain('"will-navigate"');
    expect(askpassMainSrc).toContain('"will-attach-webview"');
    expect(askpassMainSrc).toContain("event.preventDefault()");
    expect(sudoCredsSrc).toContain("win.webContents.setWindowOpenHandler");
    expect(sudoCredsSrc).toContain('"will-navigate"');
    expect(sudoCredsSrc).toContain('"will-attach-webview"');
  });

  it("uses CSP and preload-owned DOM wiring instead of inline renderer script", () => {
    expect(askpassMainSrc).toContain("Content-Security-Policy");
    expect(askpassMainSrc).toContain("script-src 'none'");
    expect(askpassMainSrc).not.toContain("<script>");
    expect(askpassMainSrc).not.toContain('require("electron")');
    expect(sudoCredsSrc).toContain("Content-Security-Policy");
    expect(sudoCredsSrc).toContain("script-src 'none'");
    expect(sudoCredsSrc).not.toContain("<script>");
    expect(sudoCredsSrc).not.toContain('require("electron")');

    expect(askpassPreloadSrc).toContain(
      'import { ipcRenderer } from "electron"',
    );
    expect(askpassPreloadSrc).toContain("DOMContentLoaded");
    expect(askpassPreloadSrc).toContain(
      "ipcRenderer.send(ASKPASS_SUBMIT_CHANNEL, value)",
    );
  });

  it("builds the dedicated askpass preload entry", () => {
    expect(electronViteConfigSrc).toContain("src/preload/index.ts");
    expect(electronViteConfigSrc).toContain("src/preload/askpass.ts");
  });
});

describe("gateway sudo/secret prompt handling", () => {
  it("collects sudo/secret via the hardened askpass modal, not the chat transcript", () => {
    // Reuses the shared hardened dialog rather than a bespoke window.
    expect(gatewayPromptSrc).toContain(
      'import { showPasswordDialog } from "./askpass"',
    );
    expect(gatewayPromptSrc).toContain("showPasswordDialog(");
    // Sensitive values must never be rendered as a chat message / clarify card.
    expect(gatewayPromptSrc).not.toMatch(/onClarify|ClarifyMessage|safeSend/);
  });

  it("never logs or persists the collected secret", () => {
    expect(gatewayPromptSrc).not.toMatch(/console\.(log|warn|error|info)/);
    expect(gatewayPromptSrc).not.toMatch(/writeFile|appendFile|setEnvValue/);
  });

  it("forwards answers with the gateway's exact respond shapes", () => {
    // sudo.respond carries `password`; secret.respond carries `value`.
    expect(hermesSrc).toContain('"sudo.respond"');
    expect(hermesSrc).toContain('"secret.respond"');
    expect(hermesSrc).toContain("password: answer");
    expect(hermesSrc).toContain("value: answer");
    // Both keyed by request_id, mirroring clarify.respond.
    expect(hermesSrc).toContain("request_id: requestId, password");
    expect(hermesSrc).toContain("request_id: requestId, value");
  });

  it("maps cancel to an empty answer (safe skip), never blocking the turn", () => {
    // showPasswordDialog resolves null on cancel; the prompt helpers coerce to "".
    expect(gatewayPromptSrc).toContain('return value ?? "";');
  });
});
