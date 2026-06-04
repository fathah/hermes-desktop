export default {
  title: "Gateway",
  messagingGateway: "Messaging Gateway",
  platforms: "Platforms",
  status: "Status",
  running: "Running",
  stopped: "Stopped",
  working: "Working…",
  startFailed: "Gateway could not be started.",
  stopFailed: "Gateway could not be stopped.",
  startExited:
    "Gateway was started, but it stopped again before it became ready.",
  checkLog: "Check the gateway log:",
  gatewayHint:
    "Connects Hermes to Telegram, Discord, Slack, and other platforms",
} as const;
