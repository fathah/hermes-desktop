export default {
  title: "Connected Apps",
  messagingGateway: "Messaging & Apps",
  platforms: "Platforms",
  status: "Status",
  running: "Running",
  stopped: "Stopped",
  working: "Working...",
  startFailed: "Couldn't start the connection service.",
  stopFailed: "Couldn't stop the connection service.",
  startExited: "Connection service did not stay running after start.",
  checkLog: "Check {{path}} for startup details.",
  gatewayHint:
    "Let My Assistant communicate through approved channels like Discord and Slack.",
  healthRecovering:
    "Connection service stopped responding — automatically restarting it…",
  healthDown:
    "Connection service is down. Automatic recovery gave up after several attempts — try Stop then Start, or check the logs.",
} as const;
