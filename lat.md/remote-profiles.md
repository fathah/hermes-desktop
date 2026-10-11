# Remote profiles

Agents lists and creates profiles on the selected Hermes dashboard while Desktop keeps profile selection and late UI work scoped to that connection.

## Remote profiles

Remote profile operations use the dashboard's authenticated profile routes with immutable request snapshots; unsupported desktop edits never fall through to local profile files.

[[src/main/remote-profiles.ts#remoteListProfiles]] maps `/api/profiles` without reading same-named local appearance metadata. Creation validates the requested and clone names and requires the server's matching `{ok:true,name}` acknowledgement. Explicit or auto-resolved anonymous token dashboards use strict JSON requests; OAuth remains on its cookie-session transport. Authentication account changes fence admission and replies through [[remote-providers#Stale authentication revisions are rejected]].

### Desktop selection

Remote selection is a desktop preference owned by connection id and dashboard URL. It neither invokes the local Hermes CLI nor changes the server's sticky default profile.

[[src/main/remote-profile-selection.ts#getRemoteSelectedProfile]] restores the saved selection from `desktop.json`. If the server no longer lists that name, no profile is marked active and status metadata stays unknown; the list read does not rewrite the selection. [[src/main/remote-profile-selection.ts#setRemoteSelectedProfile]] preserves other preferences. Local and SSH selection retain their existing persisted active-profile behavior and gateway startup.

### Authority and lifetimes

Agents, the sidebar picker and Layout restore share the main-issued target authority from [[profile-editors#Profile editors#Captured request target]]. Configuration changes cancel old callbacks, forms and polling.

Profile IPC validates captured targets before list, create, select, delete, appearance and sync operations. Remote creation and selection require explicit authority. Async SSH status cannot admit a follow-up start after target invalidation. Admitted requests retain their own connection snapshot; renderer read, create, selection and polling generations suppress late results and parent navigation.

Layout restores each connection's selected profile onto a scratch chat run using the existing [[sidebar-navigation#Profile switch and active chat]] transition. A delayed restore cannot undo a newer user choice. Remote Agents exposes list/create/select/chat; profile editing and desktop/cloud sync controls remain unavailable there. Global editor modal invalidation is documented in [[profile-editors#Profile editors#Renderer lifetime]].

Request authority is invalidated on every configuration notification. Layout resets selection only when the selected connection or its recaptured opaque settings token changes. Label-only renames and unrelated edits preserve the current conversation and draft; same-scope restoration cannot switch it to a scratch run.

### Native chat connection authority

A main-issued private configuration and OAuth revision decides whether a notification changes an existing Chat transport. Display labels and unrelated connection edits preserve the native client, transcript and live accounting.

[[src/renderer/src/screens/Chat/Chat.tsx#Chat]] captures [[src/main/provider-request-target.ts#providerTargetRevision]] without exposing keys. Pending recaptures gate prompt admission, native RPCs and replies; equal authority resumes admitted work. Changed, unavailable or superseded authority rejects old writes and stream events without falling through to Legacy. Latest-read and client generations fence delayed captures and replies, while true changes retain the existing transport reset. Registry notifications recapture each retained chat's own private revision; a different selected machine's public settings never retarget that chat. A per-client closed fence rejects buffered replies and retained RPC callbacks after a socket closes, even if its replacement has equal authority. Gated stream events retain native receipt order. A newer capture wakes superseded waiters, so an obsolete IPC reply cannot stall valid work.

### Local cloud sync boundary

Automatic and manual cloud agent sync reconcile desktop files only in Local mode. Remote and SSH Agents do not mount sync controls; main rejects unsupported sync admission.

The profile modal's Sync pane is also Local only; unsupported Remote deletion and appearance reject instead of touching local files. Current Local deletion exclusions and SSH deletion remain intact, as described in [[agent-sync#Local deletion exclusions]].

## Tests

Actual components, the real Layout parent, production IPC callbacks and API helpers verify request ownership and the supported capability boundary.

### Server profiles stay separate from local metadata

A server list maps display identity and selection without consulting a same-named desktop profile's avatar or color.

### Missing saved selections stay unresolved

When a saved name is absent from the server list, every active flag stays false and the list read leaves desktop preferences unchanged. Invalid response shapes still fail instead of supplying replacement profiles.

### Missing profile footer cannot borrow default status

Actual Remote list mapping and StatusBar rendering omit model, gateway and skill metadata for an absent saved profile. Initial loads, profile changes and a later server deletion cannot show another profile's status or fabricate an offline state.

### Creation acknowledgement and input validation

Creation accepts only the matching server acknowledgement and rejects unsafe destination or clone names before dispatch.

### Captured authentication admission

A queued authentication probe cannot admit a profile write after cookie-account changes; requests retain their captured server identity.

### Anonymous dashboard boundary

Explicit anonymous dashboards use the dashboard route, reject successful HTML, and never replace an OAuth request with bare fetch.

### Anonymous URL normalization

Anonymous GET and POST use the shared dashboard URL builder, removing API base suffixes, query strings and hashes consistently with authenticated requests.

### Anonymous reverse proxy authentication

Basic proxy credentials are decoded into an Authorization header and removed from the bare fetch URL, preserving encoded passwords without invalid URL userinfo.

### Desktop preference ownership

Remote selection restores only for its recorded connection and URL while preserving unrelated desktop preferences and rejecting invalid names.

### Remote selection never invokes local profile use

The actual Remote selection IPC writes only the desktop preference, never local CLI selection or gateway lifecycle controls.

### Unsupported mutations cannot fall through

Actual Remote sync, deletion and appearance handlers reject without calling desktop or cloud mutation helpers.

### Queued and SSH follow-up requests keep authority

Stale queued creation is rejected; an SSH status read cannot start a gateway after its captured target becomes obsolete.

### Remote Agents capability and automatic sync

Before authority resolves, actions stay unavailable. Remote Agents then permits list/create while omitting local editors and automatic/manual cloud sync.

### Late lists and create results

Switching targets clears creation drafts and prevents obsolete lists or creation results from hydrating or refreshing the new target.

### Late selection and chat callbacks

A delayed selection or Chat action cannot call its parent or start follow-up reads and polls after the target changes.

### Action failures remain retryable

Creation and selection rejections are caught and shown; the current creation draft remains intact and retryable.

### Local cloud sync remains available

A signed-in Local visit still runs one automatic sync pass with captured authority and exposes the existing manual controls.

### Gateway polls stop at target changes

An admitted old SSH poll cannot hydrate the new target or schedule another readiness read after invalidation.

### Sidebar picker callback isolation

The actual sidebar picker rejects failed and obsolete selections without optimistically changing its parent profile.

### Real Layout selection and chat acceptance

Actual Agents and sidebar flow reach the real Layout parent; selected profile, active chat target and captured IPC authority remain aligned.

### Real Layout stale callback isolation

An old Agents selection resolving after a connection switch cannot retarget the real Layout profile or active chat.

### Restoration cannot undo a newer choice

A delayed initial restore cannot reset the active profile and scratch chat after the user selects another profile.

### Failed reload keeps the shell target aligned

Changed settings on the selected connection select a default scratch chat together with the footer fallback. A failed profile restore cannot leave the old named chat visible under the default label.

### Connection renames preserve the visible conversation

Actual Layout resumes a named-profile conversation with an unsent draft. Selected-label and unrelated connection renames recapture unchanged authority without replacing its active run, durable session or draft.

### Selected settings still reset profile restoration

Changing the selected endpoint or authentication changes its opaque authority token. Actual Layout then resets the selected profile and visible scratch chat together, while old editor actions remain invalidated.

### Renames during pending restoration preserve user choices

A rename can invalidate an initial profile read without changing its settings scope. Fresh authority retries that read, but a newer user selection keeps ownership and cannot be undone by the retry or the old response.

### Harmless connection notifications preserve native chat

Actual Chat keeps its running native client, saved transcript and draft after a selected display rename or an unrelated connection notification, then accepts the continued native reply.

### Private connection authority changes invalidate chat

Actual main-issued HMAC revisions detect address changes, equal-length secret rotations and OAuth epochs, closing the old native client despite identical public credential lengths.

### Unknown connection authority invalidates chat

OAuth account changes make capture unavailable; Chat invalidates the previous native authority rather than treating an unknown revision as a harmless display edit.

### Late connection capture cannot replace newer authority

An old label capture resolving after secret rotation cannot close or hydrate the newly connected native runtime.

### Pending label authority preserves admitted native work

A deferred equal-authority read holds native writes and completion events, then releases them on the existing client after identity is proven.

### Deferred private change rejects old native callbacks

A deferred private change rejects captured native writes and late completions, including callbacks retained after client teardown, without dispatching a Legacy request.

### Pending chat submission waits for private authority

Actual Send remains undispatched during a deferred revision read. Equal authority resumes submission; changed authority rejects the obsolete action without native or Legacy dispatch.

### Retained chat validates its own changed authority

A notification naming another selected machine still revalidates a retained chat's own private configuration. Changed authority closes its old client; its next native request uses its own settings without falling through to Legacy.

### Closed native client cannot deliver buffered replies

An equal-authority reconnect cannot accept an old closed client's buffered completion or RPC callback. Pending recaptures preserve the new running prompt and do not transfer old socket ownership.

### Failed retained settings cannot borrow selected mode

A failed retained-chat settings read revokes admission and preserves that chat's prior mode. It cannot adopt another selected machine's Local mode, dispatch a prompt or fall through to Legacy.

### Real native connection setup remains admitted

The actual DashboardGatewayClient closes its previous socket before opening a new one. A synthetic WebSocket proves authority fencing permits that setup cleanup and the first native prompt without contacting a real server.

### Pending native events retain receipt order

Equal-authority recaptures preserve approval-before-terminal receipt order. A valid newer capture wakes waiters on the obsolete read; an earlier approval cannot become actionable after its completed turn.
