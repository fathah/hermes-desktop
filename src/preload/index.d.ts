import type { AgentBridgeApi } from "./bridges/agent.types";
import type { AppLauncherBridgeApi } from "./bridges/app-launcher.types";
import type { ConfigBridgeApi } from "./bridges/config.types";
import type { EngineBridgeApi } from "./bridges/engine.types";
import type { ExternalContextBridgeApi } from "./bridges/external-context.types";
import type { HealthRssBridgeApi } from "./bridges/health-rss.types";
import type { KanbanBridgeApi } from "./bridges/kanban.types";
import type { MediaBridgeApi } from "./bridges/media.types";
import type { ProvidersBridgeApi } from "./bridges/providers.types";
import type { SourceIntakeBridgeApi } from "./bridges/source-intake.types";
import type { SpsBridgeApi } from "./bridges/sps.types";
import type { SubstackRadarBridgeApi } from "./bridges/substack-radar.types";
import type { SystemBridgeApi } from "./bridges/system.types";
import type { ToolsmiscBridgeApi } from "./bridges/toolsmisc.types";

interface ElectronAPI {
  process: {
    platform: NodeJS.Platform;
    versions: {
      chrome: string;
      electron: string;
      node: string;
    };
  };
}

type HermesAPI = AgentBridgeApi &
  AppLauncherBridgeApi &
  ConfigBridgeApi &
  EngineBridgeApi &
  ExternalContextBridgeApi &
  HealthRssBridgeApi &
  KanbanBridgeApi &
  MediaBridgeApi &
  ProvidersBridgeApi &
  SourceIntakeBridgeApi &
  SpsBridgeApi &
  SubstackRadarBridgeApi &
  SystemBridgeApi &
  ToolsmiscBridgeApi;

declare global {
  interface Window {
    electron: ElectronAPI;
    hermesAPI: HermesAPI;
  }
}

export {};
