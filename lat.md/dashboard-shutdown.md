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

## Same-profile launch ownership

Concurrent local launches for one profile share one startup promise and child, preserving complete process ownership before global shutdown snapshots the registry.

## Quit launch admission

Quit permanently blocks new dashboard launches and pre-spawn requests awaiting a port. Already spawned children remain owned, their readiness retries stop, and global cleanup drains their startup promises after confirming exit.

[[src/main/dashboard.ts#beginDashboardShutdown]] is quit-specific; ordinary [[src/main/dashboard.ts#stopAllDashboards]] calls remain reusable. Real HTTP child fixtures cover launches before spawn, during readiness, and while forced termination is pending.

## Synchronous quit admission

The first Electron quit event closes launch admission synchronously before scheduling cleanup, so pending renderer requests cannot launch during the cleanup microtask gap.

## Ordinary tunnel stop and restart

Stopping a local SSH tunnel invalidates a pending port selection before it can spawn. A later normal start remains supported because ordinary stop does not close quit admission.

## Queued tunnel quit admission

Quit permanently rejects pending, queued and new local SSH tunnel requests. Port selection must recheck admission and generation before spawning so a child cannot appear after cleanup.

[[src/main/ssh-tunnel.ts#beginSshTunnelShutdown]] closes admission synchronously alongside the dashboard gate. It stops only the desktop-owned local tunnel, preserving remote-owned Agent services.

## Tunnel health continuation on quit

A health result arriving after quit cannot declare the stopped tunnel usable or start a replacement. The owned local tunnel receives its ordinary stop signal.

## SSH dashboard continuation on quit

A delayed remote dashboard reply cannot begin a new local tunnel after quit. Start, status and fresh WebSocket requests reject the stale continuation before tunnel creation.

## Admitted tunnel continuation on quit

If a tunnel request was admitted before quit, its late completion cannot return a running dashboard connection. Remote services remain owned by the remote host.
