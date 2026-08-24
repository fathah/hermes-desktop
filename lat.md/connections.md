---
lat:
  require-code-mention: true
---

# Connections

Desktop connections use main-process-owned, versioned records so durable identities can be introduced without exposing credentials or breaking existing runtime callers.

## Versioned registry

`desktop.json` stores `connectionRegistry` version 1 with an active connection ID and named records. [[src/main/config.ts#getConnectionConfig]] remains the compatibility adapter for code that needs the active configuration.

[[src/main/config.ts#writeDesktopConfig]] uses a same-directory temporary file and atomic rename so registry and preference updates cannot leave partially written JSON.

The renderer receives the active `connectionId`, name, and SSH target metadata through [[src/main/config.ts#getPublicConnectionConfig]]. [[src/main/config.ts#getPublicConnectionRegistry]] applies the same redaction to every saved record. API keys, private-key contents, OAuth cookies, and tunnel tokens remain outside those bounded public shapes; see [[remote-dashboard-oauth#Credential boundary]].

## Named connection management

Settings can create, rename, select, edit, test, and remove saved Local, Remote/cloud, and SSH connections while the main process retains credentials and validates record mutations.

[[src/renderer/src/components/settings/ConnectionPane.tsx]] places the saved-connection selector above the existing mode editor, so editing and testing continue through one established form. The final record cannot be removed.

Selecting or removing the active record stops the one global SSH tunnel before later work reconnects it to the new target, preserving [[main-process#SSH dashboard transport]]. Removing a record aborts only legacy runs keyed to that connection.

## Per-connection status

Settings can manually refresh bounded health, latency, authentication, Agent version, and capability snapshots for every saved record without exposing credentials.

[[src/main/connection-status.ts#getConnectionStatuses]] probes records independently. Remote probes use each main-process-owned API key or OAuth cookie, while SSH probes run direct status and version commands without retargeting the shared tunnel.

The renderer shows the selected record's snapshot and does not poll automatically, avoiding repeated background SSH processes. Inactive records reuse only bounded capability evidence already observed for their stable connection ID; unobserved features remain unknown.

## Legacy migration

The first registry read converts former top-level Local, Remote, or SSH fields into one active record, removes stale singleton fields, and atomically replaces `desktop.json` with the complete migrated document.

### Preserves existing configurations

Migration retains connection mode, Remote authentication and transport preferences, API keys, SSH routing fields, and unrelated desktop preferences.

## Stable active identity

Each migrated or fresh connection gets one random `connectionId`; changing its mode or configuration updates the same record, and its generated display name follows mode changes.

## Session locations

Desktop chat identity is the tuple `{ connectionId, profile, sessionId }`, preventing equal Agent session IDs on different machines or profiles from being treated as one live run.

[[src/renderer/src/screens/Layout/chatRuns.ts#ChatRun]] carries an immutable connection and profile before its Agent session ID resolves. [[src/renderer/src/screens/Layout/chatRuns.ts#findRunByLocation]] reattaches only on an exact tuple match.

Legacy `send-message` IPC scopes its abort handle by connection plus renderer run ID and rejects a run whose connection is no longer active. Dashboard chats resolve their saved direct-Remote record by `connectionId`, so selecting another connection does not retarget an existing client. Inactive SSH chats cannot retarget the singleton tunnel. Both transports persist the tuple when [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] learns a session ID.

### Connection-explicit dashboard transport

Dashboard startup and WebSocket refresh resolve the chat's stable connection ID instead of consulting whichever record is currently selected.

[[src/main/dashboard.ts#startDashboard]] and [[src/main/dashboard.ts#freshDashboardWebSocketUrl]] allow direct-Remote clients to remain independent. An inactive SSH record returns a bounded unavailable status rather than stealing the one shared tunnel described by [[main-process#SSH dashboard transport]].

### Desktop metadata

[[src/main/session-location-store.ts#recordSessionLocation]] stores validated tuples in the global desktop directory, independent of the currently selected profile database, and uses atomic writes without credentials.

### Composite identity persistence

Persisted metadata retains separate records when two connections or profiles produce the same Agent session ID, survives module reloads, deduplicates exact tuples, and rejects incomplete identities.

### Run identity isolation

Live-run lookup requires connection, profile, and session ID to match, so a colliding session ID cannot activate a run belonging to another machine or profile.

## Test specifications

Focused checks cover independent status classification and the credential boundary for the new registry snapshot.

### Isolated status probes

Local, Remote, and SSH records report separate health and authentication outcomes, retain connection-specific capability evidence, and never return stored API keys.

### Connection-explicit dashboard routing

Direct-Remote dashboard status and WebSocket lookup use the chat's saved connection ID instead of the currently selected record, while inactive SSH records cannot retarget the singleton tunnel.
