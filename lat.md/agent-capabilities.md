---
lat:
  require-code-mention: true
---

# Agent Capability Compatibility

The desktop derives feature availability from Agent evidence so newer UI can coexist with older system-installed Hermes Agent versions.

## Capability snapshot

The renderer receives one normalized, non-secret snapshot instead of interpreting versions or backend payloads independently.

[[src/shared/agent-capabilities.ts#buildAgentCapabilitySnapshot]] combines the Agent's desktop contract, API capability probe, version metadata, update hint, and connection mode. Each feature is supported, unsupported, or unknown; absence never becomes an unsupported claim.

The desktop contract is monotonic. Contract 1 proves dashboard chat, 2 adds `file.attach`, 3 adds approval-mode management, 4 adds explicit normal-tier sessions, 5 raises attachment frame capacity, and 6 adds key-addressed plugin management.

Command-specific features use the Agent's existing `commands.catalog` response instead of version guesses. Background prompts, queues, tool-call steering, session loops, voice commands, and automation blueprints are supported only when their canonical command is present.

## Bounded runtime evidence

Only compatibility metadata from `session.info` crosses back into the main-process evidence cache.

[[src/main/hermes.ts#recordAgentRuntimeInfo]] retains `desktop_contract`, `version`, `release_date`, `update_behind`, and `update_command`. Model state, tools, prompts, paths, and other session data are discarded by [[src/shared/agent-capabilities.ts#sanitizeAgentRuntimeInfo]].

[[src/main/hermes.ts#getAgentCapabilityEvidence]] combines the cached runtime evidence with the existing `/v1/capabilities` probe. Evidence is keyed by stable connection ID plus profile; configuration changes clear only that record, while inactive status snapshots reuse bounded cached evidence without probing the active endpoint.

## Bounded command inventory

Only normalized command names are retained from the Agent command catalog so feature gates do not persist descriptions, aliases, skill metadata, or user quick-command bodies.

[[src/main/hermes.ts#recordAgentCommandInventory]] passes the runtime catalog through [[src/shared/agent-capabilities.ts#sanitizeAgentCommandInventory]], which accepts canonical command pairs, rejects malformed names, deduplicates them, and caps the cache at 512 names.

The catalog is a conservative probe: a returned catalog can prove a command supported or unsupported, while an unavailable catalog clears prior inventory and leaves every command-derived feature unknown. A changed Agent version or desktop contract also invalidates prior command evidence.

## Compatibility policy

Older Agents keep the existing experience while newer surfaces gate themselves on explicit evidence.

A missing desktop contract is `legacy`, not a hard failure. A contract below the recommended value suggests an Agent update, while direct Remote connections disable the local update action because that process is not owned by this desktop.

[[src/main/ipc/register.ts#registerIpcHandlers]] exposes the snapshot plus bounded runtime-info and command-inventory recorders through preload. [[src/renderer/src/components/settings/AboutPane.tsx#AboutPane]] shows the observed and recommended desktop contracts alongside the independent Agent update action.

## Test specifications

Focused tests protect normalization, legacy fallback, bounded evidence, and representative old/current Agent contracts.

### Current contract normalization

The current desktop contract and advertised API transport produce supported feature states with normalized version and update metadata.

### Legacy capability fallback

Missing capability evidence remains unknown while legacy version output is still presented and direct Remote updating stays disabled.

### Runtime evidence boundary

Runtime evidence keeps compatibility fields and drops prompts, tools, models, paths, and other session data.

### Command inventory gates

A valid command catalog enables only named Agent features, rejects malformed command names, and leaves every command-derived gate unknown when discovery is unavailable.

### Older Agent contract

A pre-desktop-contract Agent keeps every unproven feature unknown while preserving its version metadata and disabling host-local updates for a direct Remote connection.

### Current Agent contract

The current Agent's runtime info, API capability response, and command catalog combine into a compatible snapshot whose advertised features are supported.

### Evidence invalidation

Cached command evidence is discarded after catalog discovery fails or a replacement Agent reports a different version or desktop contract, preventing stale feature gates after reconnect.
