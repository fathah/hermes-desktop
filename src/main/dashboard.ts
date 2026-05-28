import { ipcMain } from "electron";
import { listCachedSessions } from "./session-cache";
import { getModelConfig } from "./config";
import { isGatewayRunning } from "./hermes";
import { listCronJobs } from "./cronjobs";

export function registerDashboardHandlers(): void {
  ipcMain.handle("dashboard-stats", async (_event, profile?: string) => {
    const sessions = listCachedSessions(1000, 0);
    const model = getModelConfig(profile);
    let cronJobCount = 0;
    try {
      const jobs = await listCronJobs(false, profile);
      cronJobCount = jobs.length;
    } catch {
      cronJobCount = 0;
    }

    return {
      sessionCount: sessions.length,
      modelProvider: model.provider,
      modelName: model.model,
      gatewayRunning: isGatewayRunning(),
      cronJobCount,
    };
  });
}

export function registerMcpHandlers(): void {
  ipcMain.handle("mcp-catalog", async (_event, profile?: string) => {
    const { listMcpServers } = await import("./installer");
    const { getActiveProfileNameSync } = await import("./utils");
    const p = profile || getActiveProfileNameSync();
    const servers = await listMcpServers(p);
    const catalog = [
      { name: "filesystem", description: "Local filesystem access", installed: false },
      { name: "github", description: "GitHub API integration", installed: false },
      { name: "postgres", description: "PostgreSQL database queries", installed: false },
      { name: "brave-search", description: "Web search via Brave", installed: false },
    ];
    const installedNames = new Set(servers.map((s) => s.name.toLowerCase()));
    return catalog.map((c) => ({
      ...c,
      installed: installedNames.has(c.name),
    }));
  });
}
