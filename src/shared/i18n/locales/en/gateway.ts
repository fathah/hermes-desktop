export default {
  title: "Gateway",
  messagingGateway: "Messaging Gateway",
  platforms: "Platforms",
  status: "Status",
  running: "Running",
  stopped: "Stopped",
  gatewayHint:
    "Connects Hermes to Discord, Slack, and other platforms",
  healthRecovering: "Gateway stopped responding — automatically restarting it…",
  healthDown:
    "Gateway is down. Automatic recovery gave up after several attempts — try Stop then Start, or check the gateway logs.",
} as const;
