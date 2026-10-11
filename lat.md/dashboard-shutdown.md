---
lat:
  require-code-mention: true
---

# Dashboard shutdown

Local dashboards started by Desktop are owned by profile key and must all be stopped on app quit, regardless of which profile is currently active.

[[src/main/app/start.ts#startMainProcess]] invokes [[src/main/dashboard.ts#stopAllDashboards]] during quit. Shutdown preserves the explicit `default` key because an omitted profile resolves to the active named profile. Remote and SSH services are not owned by this local process registry.

## All managed profiles

Start isolated HTTP/WebSocket child-process fixtures through the dashboard launcher, switch to a named profile, then verify shutdown terminates the default and all named processes.

## Explicit and implicit targets

An omitted single-stop target still stops the active profile; an explicit default target stops the root process. Repeated global shutdown is harmless after both have exited.

## Confirmed forced termination

An owned dashboard that ignores SIGTERM receives SIGKILL after two seconds; shutdown waits for its actual exit, including a stop already admitted after its profile entry was removed.

[[src/main/dashboard-process-stop.ts#stopDashboardProcess]] bounds graceful and forced waiting. A sent signal is never treated as confirmed exit. Failed launch probes use the same stop path; Remote and SSH services are excluded.

## Windows process tree

Windows termination invokes taskkill with an argument array and /T /F, waits for the owned child's exit, and falls back once if taskkill fails. All timers and listeners are cleared on completion.

## Electron waits for cleanup

Electron prevents initial and repeated quit events while asynchronous cleanup runs, then retries quit once after cleanup settles so force-kill timers can execute before the event loop ends.

[[src/main/app/managed-quit.ts#registerManagedQuit]] gates shutdown. Closed windows release the main reference; macOS can still create a fresh window on activation. No unused approval keepalive broadcast is installed: server approval expiry remains governed by its actual transport contract.

## Installer recovery follows the platform

Actual Windows and Unix installer failures preserve their exit status and log, point to the proper terminal and supported installation instructions, and avoid guessing a failure cause or deleting existing configuration and conversations.

[[src/main/installer-errors.ts#buildInstallErrorMessage]] is shared by both install paths. Interrupted processes have no invented exit code; checksum verification still fails closed even when old binaries exist.
