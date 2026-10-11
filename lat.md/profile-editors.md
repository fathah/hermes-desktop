# Profile editors

Soul and Memory editors bind each operation to a validated connection and profile so delayed work cannot hydrate or mutate a newly selected target.

## Profile editors

The main process captures an opaque editor scope; renderer lifetimes use that scope and configuration events to invalidate pending work.

### Captured request target

A main-issued target binds connection ID, canonical profile, mode, private configuration identity and the shared origin OAuth epoch.

Sign-in changes block capture and invalidate old targets. Stale targets fail before dispatch; accepted operations receive cloned connection snapshots.

[[src/main/profile-editor-target.ts#captureProfileEditorTarget]] and [[src/main/profile-editor-target.ts#resolveProfileEditorTarget]] keep credentials inside main. Optional target arguments preserve legacy Local and SSH callers.

### Renderer lifetime

Editors wait for target capture, remount when profile or configuration changes, and guard reads, saves and timers. Hydration does not autosave; Soul writes are serialized and stale results do not display Saved or errors.

Same-target Memory refresh preserves Soul's independent autosave lifetime. Refreshed entries, user text and providers remount together so positional edits, delete confirmations and provider drafts cannot outlive the data they describe.

An admitted Memory write blocks refresh and tab changes until its result is handled. Successful mutation refreshes wait for the write to settle, then replace the snapshot before positional controls become editable. Target changes still invalidate all callbacks.

[[src/renderer/src/hooks/useProfileEditorTarget.ts#useProfileEditorTarget]] invalidates its current target synchronously on configuration events. The global profile modal closes on these events and passes the validated target to Memory operations. Remote modal navigation exposes only Persona and read-only Memory; it never loads desktop profile metadata or local appearance, sync and delete controls.

### Remote capabilities

Remote Soul uses the authenticated profile Soul API and checks write confirmation. Remote Memory stays read-only and reads the selected profile's resolved configuration path and provider schema.

The Agent's `/api/config/raw?profile=default|name` resolves that profile's configuration path; `/api/config/schema?profile=...` supplies provider options. `/api/status` may redact home paths and `/api/memory` is process-scoped, so neither identifies selected-profile files or metadata. Managed-file refusals show unavailable content without invented sizes or counts; authentication failures remain errors. Remote reset and Memory mutations never fall through to desktop files.

## Tests

Actual editor rendering, global modal integration and extracted production IPC branches verify target isolation and supported capabilities.

### Immutable connection dispatch

An actual Soul IPC call receives a cloned private snapshot and a canonical profile while the public target contains no credentials.

### Reject stale queued mutations

Connection, URL, key, mode or profile changes reject an old editor request before any local or remote backend is called.

### Remote memory mutation boundary

Actual Remote Memory and reset IPC branches reject unsupported mutations without touching desktop files or credentials.

### Local and SSH compatibility

Legacy optional-target callers keep their profile behavior, while an explicit local editor captures its active profile and malformed targets reject.

### Delayed Soul hydration

A slow old-profile Soul read cannot replace the new editor or autosave its text under the new profile.

### Cancelled draft timers

A same-ID configuration or mode change cancels the old draft timer and resolves a fresh editor scope before editing resumes.

### Late save results

A delayed save error or Saved timer from the old editor cannot affect the newly selected profile or trigger follow-up writes.

### Out of order target capture

A late target-capture reply from a previous profile cannot start a read after a newer target becomes current.

### Delayed Memory hydration

A failed new-profile read stays uneditable when an older profile read eventually resolves.

### Memory drafts follow their target

Local entry drafts disappear when the connection mode changes; Remote controls stay disabled and no old mutation dispatches.

### Global modal editor lifecycle

The actual global opener and Soul editor discard old-profile hydration, cancel autosave on connection changes and clean up subscriptions.

### Remote modal memory boundary

A global Remote Persona editor reads the captured profile and remains editable without offering unsupported reset.

### Scoped remote metadata

Remote Memory reads selected-profile configuration paths and schemas, including explicit default scope, without using process-scoped metadata.

### Reject malformed remote responses

Missing configuration paths, authentication refusals and unconfirmed Soul responses stay errors instead of empty content or false save success.

### Late memory mutation results

An old entry mutation's rejection or refresh callback cannot update the new profile after the editor target changes.

### Serialized Soul writes

A slow save completes before a newer draft is written, and only the latest edited draft can display Saved.

### Global modal memory hydration

An old modal Memory read cannot restore entries or edit controls after the global opener switches to a profile whose load failed.

### OAuth account changes fence admission

A delayed automatic authentication probe cannot admit a Soul write after cookies change to a different account at the same origin.

### OAuth account changes fence followups

Memory metadata read before an OAuth account change cannot start file reads or hydrate an editor after that change.

### OAuth account changes invalidate queued targets

A captured main-process editor target rejects after same-origin cookie changes, and capture stays blocked while sign-in is pending.

### Same target refresh preserves Soul drafts

Refreshing Memory within the captured target keeps its real Soul editor and pending autosave mounted. Only target changes clear the lifetime; memory controls wait for the refreshed data.

### Unavailable modal memory is not empty

The global profile modal explains unavailable Remote contents and does not render an empty entry list or zero-memory message.

### Refresh resets positional entry drafts

Refreshing reordered entries removes the previous index-based edit before controls become enabled. Saving a new edit writes the newly displayed entry, never a draft from its prior occupant.

### Refresh replaces memory tab state

Same-target refresh replaces user text and provider activation state and discards their old drafts. Soul stays mounted separately with its pending autosave intact.

### Refresh waits for admitted memory mutations

A delayed SSH deletion cannot be overtaken by Refresh. Its completion reloads the new positions before the next edit is admitted, while failed writes retain their error and release controls for retry.

### Modal memory completion follows the parent target

The modal keeps re-entered Memory controls disabled during an admitted write and refreshes after completion even when its pane unmounted. Switching profiles cancels that continuation and cannot refresh the new target.

### Failed refresh cannot enable old positions

If the read after a successful mutation fails, old positional controls remain unavailable. A later successful retry installs the new snapshot and enables editing again.
