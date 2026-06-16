import { contextBridge } from "electron";
import { engineBridge } from "./bridges/engine";
import { configBridge } from "./bridges/config";
import { mediaBridge } from "./bridges/media";
import { agentBridge } from "./bridges/agent";
import { providersBridge } from "./bridges/providers";
import { systemBridge } from "./bridges/system";
import { kanbanBridge } from "./bridges/kanban";
import { toolsmiscBridge } from "./bridges/toolsmisc";
import { spsBridge } from "./bridges/sps";
import { externalContextBridge } from "./bridges/external-context";
import { healthRssBridge } from "./bridges/health-rss";
import { substackRadarBridge } from "./bridges/substack-radar";

const electronAPI = {
  process: {
    platform: process.platform,
    versions: {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
    },
  },
};

// The renderer-facing bridge. Each method is an `ipcRenderer.invoke`/`.on`
// pass-through, grouped by domain into ./bridges/* and merged here. The type
// contract (window.hermesAPI: HermesAPI) lives in index.d.ts — kept as a single
// declaration because the web/node tsconfig split (#367) makes per-file .d.ts
// fragments collide with their .ts implementations.
const hermesAPI = {
  ...engineBridge,
  ...configBridge,
  ...mediaBridge,
  ...agentBridge,
  ...providersBridge,
  ...systemBridge,
  ...kanbanBridge,
  ...toolsmiscBridge,
  ...spsBridge,
  ...externalContextBridge,
  ...healthRssBridge,
  ...substackRadarBridge,
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("hermesAPI", hermesAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.hermesAPI = hermesAPI;
}
