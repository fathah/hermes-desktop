export default {
  title: "Connected Apps",
  messagingGateway: "Messaging & Apps",
  platforms: "Platforms",
  status: "Status",
  running: "Running",
  stopped: "Stopped",
  gatewayHint:
    "Let My Assistant communicate through approved channels like Discord and Slack.",
  healthRecovering:
    "Connection service stopped responding — automatically restarting it…",
  healthDown:
    "Connection service is down. Automatic recovery gave up after several attempts — try Stop then Start, or check the logs.",
} as const;
