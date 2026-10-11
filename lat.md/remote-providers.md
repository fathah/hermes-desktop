---
lat:
  require-code-mention: true
---

# Remote Providers

Remote provider keys and default-server credential pools use the selected Agent dashboard, keeping desktop credentials and account controls out of Remote operations.

## Screen target ownership

The Remote screen resets on connection, profile, or configuration revision. Explicit saves retain their public connection identity; discarded screens neither apply late replies nor start another refresh.

## Pool removal requires atomic identity

Pool removal is unavailable because the current Agent accepts only a list index. A fresh ID lookup cannot prevent concurrent reordering from deleting another account; the server must atomically compare the selected credential ID.

## Late preview ownership

An environment reply retains its captured server, profile, authentication mode and token account when registering display-only previews, so a later selected target cannot inherit its preview state.

## Pool add retains original target

A default-profile pool addition and its awaited list refresh retain one captured connection configuration, including endpoint and authentication, even if the user selects another server meanwhile.

## Named pool operations fail closed

The current Agent pool read and add routes ignore profile parameters. Named-profile operations are refused before HTTP, while profile-aware environment key management remains available.

## Deletion race refuses HTTP

Remote pool replacement and deletion are refused without any HTTP request, including after an A-to-B connection change. No local credential file is used as a fallback.

## Agent owned discovery

Remote model discovery reads the selected Agent's profile-scoped catalog without desktop key lookup, local Python discovery, or desktop account caches. Catalog presence does not claim that a redacted key was verified.

## Explicit IPC routing

Provider IPC resolves the public connection ID once and rejects mismatched mode or Remote URL. Key and pool operations keep that configuration through awaits; implicit Remote writes are refused.

## Healthy Remote load

The Remote screen reads only its selected environment and pool, leaves editing fields empty rather than prefilled with previews, and exposes neither desktop account controls nor unsafe pool deletion.

## Late screen reads are discarded

A delayed environment or pool reply from a discarded server or profile cannot repopulate the newly selected Remote screen.

## Late writes cannot refresh another target

A save admitted for A remains scoped to A. Once B mounts, A's completion cannot trigger a new read, replace B's preview, or expose A's draft.

## Configuration changes clear secrets

A configuration revision clears drafts and previews even when the connection ID stays the same. A subsequent Local mode cannot be used to read or write credentials through the Remote screen.

## Stale authentication revisions are rejected

Main issues opaque provider target revisions without exposing credential fingerprints. Token, authentication-mode, or OAuth-session changes invalidate queued old drafts before any HTTP or local write; auth transitions also stop later refreshes.

## Local drafts do not flush into Remote

A Local Providers draft is canceled when connection configuration changes, preventing its unmount flush from saving a desktop secret to the newly selected Remote target. Ordinary navigation within the same target still flushes the pending edit.
