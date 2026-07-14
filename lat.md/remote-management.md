# Remote Management

Direct Remote mode manages supported Hermes Agent state through authenticated dashboard APIs without falling back to local Hermes files or CLI commands.

## Authenticated request boundary

One main-process boundary selects token headers or Electron-owned OAuth cookies while preserving profile scoping.

[[src/main/remote-api.ts#remoteDashboardRequestJson]] sends OAuth requests through the persistent Electron session and token requests through the existing dashboard HTTP client. Renderer code never receives cookies or reusable OAuth material.

## Feature adapters

Focused adapters normalize Hermes Agent responses into existing Desktop contracts and keep renderer components independent from server response shapes.

### Skills and toolsets

Remote Skills and platform Toolsets use authenticated Agent endpoints for reads and mutations.

[[src/main/remote-skills.ts#remoteListInstalledSkills]] preserves profile identity in remote skill marker paths. [[src/main/remote-toolsets.ts#remoteGetToolsets]] maps Agent toolset rows into Desktop cards.

### Profiles

Remote Profiles use server profile state as authority while Desktop-only appearance and cloud sync controls remain hidden.

[[src/main/remote-profiles.ts#remoteListProfiles]] combines profile rows with server active-profile state. Create, delete, activation, and Soul operations never write local Hermes profile state.

### Gateway

Remote Gateway lifecycle and messaging configuration use profile-scoped authenticated dashboard endpoints.

[[src/main/remote-gateway.ts#remoteGatewayStatus]] reads server status. Lifecycle requests report request acceptance, then UI polling observes authoritative running state. Local API-server-key generation stays hidden remotely.

## Failure behavior

Missing or incompatible Agent endpoints fail within affected feature and never select local state as fallback.

OAuth authentication failures retain reauthentication semantics from [[remote-dashboard-oauth#Failure behavior]]. Network and server errors surface through existing feature error states.

Remote status metadata uses [[src/main/remote-metadata.ts#remoteGetHermesHome]] through the same cookie-aware boundary, while SSH dashboard bridges retain token transport.

## Test specifications

Focused tests protect authentication routing, adapter response mapping, mutations, and renderer feature gates.

### Authentication routing

Token connections use session-token transport, OAuth connections use Electron cookie transport, and non-Remote calls are rejected.

### Feature adapter contracts

Skills, Toolsets, Profiles, Gateway, and messaging tests verify endpoint, method, body, profile scope, and normalized Desktop result.

### Renderer feature gates

Completed remote features render normally while unfinished features retain scoped notices and local-only controls remain unavailable.
