export default {
  title: "Connections",
  messagingGateway: "Messaging Connections",
  platforms: "Platforms",
  status: "Status",
  running: "Running",
  stopped: "Stopped",
  gatewayHint: "Connects SPS to Discord, Slack, and other platforms",
  healthRecovering:
    "Connection service stopped responding — automatically restarting it…",
  healthDown:
    "Connection service is down. Automatic recovery gave up after several attempts — try Stop then Start, or check the logs.",
} as const;
