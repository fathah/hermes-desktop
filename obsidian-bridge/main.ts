import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from "obsidian";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";
import { randomBytes } from "crypto";
import {
  dispatchBridgeFunction,
  isAuthorizedBridgeRequest,
  type BridgeHandlers,
  type BridgePayload,
} from "./src/server";

interface HermesObsidianBridgeSettings {
  port: number;
  token: string;
}

const DEFAULT_SETTINGS: HermesObsidianBridgeSettings = {
  port: 27124,
  token: "",
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<BridgePayload> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as BridgePayload;
}

function stringPayload(payload: BridgePayload, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

export default class HermesObsidianBridgePlugin extends Plugin {
  settings: HermesObsidianBridgeSettings = DEFAULT_SETTINGS;
  server: Server | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    if (!this.settings.token) {
      this.settings.token = randomBytes(24).toString("hex");
      await this.saveSettings();
    }
    this.addSettingTab(new HermesObsidianBridgeSettingTab(this.app, this));
    await this.startServer();
  }

  onunload(): void {
    this.server?.close();
    this.server = null;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async restartServer(): Promise<void> {
    this.server?.close();
    this.server = null;
    await this.startServer();
  }

  async startServer(): Promise<void> {
    if (this.server) return;
    const handlers = this.bridgeHandlers();
    this.server = createServer(async (request, response) => {
      try {
        if (request.method !== "POST") {
          json(response, 405, { error: "Method not allowed" });
          return;
        }
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const match = url.pathname.match(/^\/function\/([^/]+)$/);
        if (!match) {
          json(response, 404, { error: "Not found" });
          return;
        }
        if (!isAuthorizedBridgeRequest(request.headers, this.settings.token)) {
          json(response, 401, { error: "Unauthorized" });
          return;
        }
        const result = await dispatchBridgeFunction(
          match[1],
          await readJson(request),
          handlers,
        );
        json(response, 200, result);
      } catch (error) {
        json(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.server.listen(this.settings.port, "127.0.0.1", () => {
      console.log(
        `Hermes Obsidian bridge listening on 127.0.0.1:${this.settings.port}`,
      );
    });
  }

  bridgeHandlers(): BridgeHandlers {
    return {
      status: () => ({
        ok: true,
        vaultName: this.app.vault.getName(),
      }),
      activeNote: () => {
        const file = this.app.workspace.getActiveFile();
        return file
          ? { path: file.path, basename: file.basename }
          : { path: "" };
      },
      openNote: async (payload) => {
        const path = normalizePath(stringPayload(payload, "path"));
        if (!path) throw new Error("path is required");
        await this.app.workspace.openLinkText(path, "", false);
        return { opened: true, path };
      },
      insertAtCursor: (payload) => {
        const editor = this.app.workspace.activeEditor?.editor;
        if (!editor) throw new Error("No active editor");
        editor.replaceSelection(stringPayload(payload, "text"));
        return { inserted: true };
      },
      replaceSelection: (payload) => {
        const editor = this.app.workspace.activeEditor?.editor;
        if (!editor) throw new Error("No active editor");
        editor.replaceSelection(stringPayload(payload, "text"));
        return { replaced: true };
      },
      runCommand: (payload) => {
        const id = stringPayload(payload, "id");
        if (!id) throw new Error("id is required");
        const ok = this.app.commands.executeCommandById(id);
        return { command: id, ok };
      },
      writeNote: async (payload) => {
        const path = normalizePath(stringPayload(payload, "path"));
        const content = stringPayload(payload, "content");
        const append = payload.append === true;
        if (!path) throw new Error("path is required");
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
          await this.app.vault.process(existing, (current) => {
            if (!append) return content;
            const separator = current && !current.endsWith("\n") ? "\n" : "";
            return `${current}${separator}${content.replace(/^\n+/, "")}`;
          });
        } else {
          await this.app.vault.create(path, content);
        }
        return { path, written: true };
      },
    };
  }
}

class HermesObsidianBridgeSettingTab extends PluginSettingTab {
  plugin: HermesObsidianBridgePlugin;

  constructor(app: App, plugin: HermesObsidianBridgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Hermes Obsidian Bridge" });
    new Setting(containerEl)
      .setName("Port")
      .setDesc("Localhost port Hermes Desktop calls.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.port))
          .onChange(async (value) => {
            const port = Number(value);
            if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
              this.plugin.settings.port = port;
              await this.plugin.saveSettings();
              await this.plugin.restartServer();
            }
          }),
      );
    new Setting(containerEl)
      .setName("Bridge token")
      .setDesc("Paste this token into Hermes Desktop's Obsidian settings.")
      .addText((text) => text.setValue(this.plugin.settings.token));
    new Setting(containerEl).setName("Regenerate token").addButton((button) =>
      button.setButtonText("Regenerate").onClick(async () => {
        this.plugin.settings.token = randomBytes(24).toString("hex");
        await this.plugin.saveSettings();
        new Notice("Hermes bridge token regenerated");
        this.display();
      }),
    );
  }
}
