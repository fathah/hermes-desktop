# Remote Management Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route supported remote management features through authenticated Hermes Agent dashboard APIs without local-state fallthrough.

**Architecture:** Main-process shared client selects OAuth-cookie or token authentication. Focused feature adapters normalize Agent responses; IPC selects adapters only in direct Remote mode; renderer unlocks completed features while hiding local-only actions.

**Tech Stack:** Electron 39, TypeScript 5.9, React 19, Vitest 4, Hermes Agent FastAPI dashboard, lat.md.

## Global Constraints

- Direct Remote mode never falls through to local Hermes state.
- OAuth cookies never cross IPC.
- SSH behavior remains unchanged.
- Older Agent 404 responses become feature-scoped unsupported errors.
- Production changes follow failing-test-first TDD.
- Existing `.npmrc` and `.omc/` remain untouched.

---

### Task 1: Shared authenticated remote API client

**Files:**

- Create: `src/main/remote-api.ts`
- Create: `src/main/remote-api.test.ts`

**Interfaces:**

- Produces: `remoteDashboardRequestJson<T>(connection, path, options, profile?)` and `RemoteDashboardApiError`.
- Consumes: `dashboardApiUrl`, `remoteRequestJson`, and `requestRemoteOAuthJson`.

- [x] Write token, OAuth, profile-scope, non-Remote, and status-normalization tests.
- [x] Run focused test and confirm missing-module RED failure.
- [x] Implement minimal client and structured error mapping.
- [x] Re-run focused test to GREEN.

### Task 2: Skills and Toolsets parity

**Files:**

- Modify: `src/main/remote-skills.ts`
- Modify: `src/main/remote-skills.test.ts`
- Create: `src/main/remote-toolsets.ts`
- Create: `src/main/remote-toolsets.test.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`
- Modify: `src/renderer/src/screens/Tools/Tools.tsx`

**Interfaces:**

- Skills operations consume explicit `ConnectionConfig`.
- Toolsets produce `ToolsetInfo[]` and boolean toggle result.

- [x] Write failing OAuth Skills and Toolset normalization/toggle tests.
- [x] Run focused tests and confirm RED failures.
- [x] Route Skills and Toolsets through shared client.
- [x] Remove completed Skills and Toolsets renderer gates.
- [x] Re-run focused tests and renderer typecheck.

### Task 3: Profiles parity

**Files:**

- Create: `src/main/remote-profiles.ts`
- Create: `src/main/remote-profiles.test.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`
- Modify profile screen components only where local-only controls need explicit Remote-mode hiding.

**Interfaces:**

- Produces remote list/create/delete/activate/Soul operations using existing `ProfileInfo` and `CreateProfileResult` contracts.

- [x] Write failing response-mapping, CRUD, active-profile, and Soul tests.
- [x] Run focused test and confirm RED.
- [x] Implement adapter and IPC routing.
- [x] Render Profiles in Remote mode with local-only actions hidden.
- [x] Re-run focused tests and renderer typecheck.

### Task 4: Gateway parity

**Files:**

- Create: `src/main/remote-gateway.ts`
- Create: `src/main/remote-gateway.test.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`
- Modify Gateway screen only where local-only key/filesystem controls require hiding.

**Interfaces:**

- Produces status/start/stop/restart operations; lifecycle mutations report accepted request and renderer refreshes authoritative status.

- [x] Write failing profile-scoped status and lifecycle endpoint tests.
- [x] Run focused test and confirm RED.
- [x] Implement adapter and IPC routing.
- [x] Render Gateway in Remote mode with local-only controls hidden.
- [x] Re-run focused tests and renderer typecheck.

### Task 5: Fallthrough regression guards and documentation

**Files:**

- Create or modify focused IPC routing tests.
- Create: `lat.md/remote-management.md`
- Add `@lat:` references beside relevant source tests.

**Interfaces:**

- Documents authenticated boundary, feature adapters, unsupported-version behavior, and no-local-fallback invariant.

- [x] Add negative IPC tests proving direct Remote mode does not call local Skills, Toolsets, Profiles, or Gateway implementations.
- [x] Add lat.md architecture and test specifications with code references.
- [x] Run focused tests and both typechecks.
- [x] Run build, `lat check`, and `git diff --check`.
- [x] Run full suite; distinguish new failures from recorded baseline failures.
