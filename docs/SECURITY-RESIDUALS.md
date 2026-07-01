# Hermes Desktop Security Residuals

This document records intentionally accepted security compatibility boundaries.
These are not missing controls; they are places where Hermes Desktop keeps
product behavior that would otherwise break local-first workflows.

## Outbound Network Policy

Main-process outbound HTTP should route through one of these helpers:

- `publicFetch`: untrusted or user-supplied public URLs. Uses SSRF-pinned
  `safeFetch`.
- `providerFetch`: model/provider endpoints. Public URLs use `safeFetch`;
  explicit local/private URLs are allowed so LM Studio, Ollama, vLLM,
  llama.cpp, LAN gateways, and other self-hosted providers keep working.
- `gatewayFetch`: intentional Hermes gateway calls. This centralizes local,
  remote, and SSH-tunnel gateway traffic while preserving local/private gateway
  support.

Provider API keys must not be placed in URLs. Gemini requests use the
`x-goog-api-key` header.

## Calendar Feed Authentication

`/calendar.ics` accepts:

- `Authorization: Bearer <control token>` for authenticated local callers.
- `?feedToken=<calendarFeedToken>` for calendar clients that cannot send custom
  headers.
- `?token=<control token>` only as a legacy calendar-feed compatibility path.

The legacy query control-token path is calendar-only. General control-server
routes continue to require the Authorization header.

## CSP Exceptions

The renderer CSP remains intentionally narrow, with existing exceptions for
bundled runtime needs:

- `script-src 'self' 'wasm-unsafe-eval' blob:` for packaged renderer/runtime
  behavior.
- `font-src 'self' data:` for bundled/local font loading.

These exceptions should not be broadened unless a focused change proves the new
source is required.

## Updater Trust Chain

Auto-update remains delegated to Electron's updater/signing flow. Windows
auto-update is disabled for unsigned packaged builds, and Fedora `.rpm` builds
remain manual-update only. This pass does not add an independent transparency or
signature-pinning layer.

## Shell Compatibility Exceptions

Installer and SSH flows may still use a shell when shell profiles or remote
execution require it. Paths in these command strings must be generated through
the tested command builders/quoting helpers. Local app actions should use
`execFile` without shell interpolation unless explicitly justified.
