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
