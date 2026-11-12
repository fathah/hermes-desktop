# Main process server requests

Main-process gateway chat supports Agent's peer-to-peer blocking requests while preserving legacy notification-based interactions and keeping credentials out of the chat renderer.

[[src/main/hermes.ts#TuiGatewayClient]] distinguishes requests from responses, advertises `client.capabilities`, and retains bounded request identities per socket. Unhandled requests receive an explicit refusal; unsupported window-owned requests use the protocol's not-shown error.

## Correlated replies

Approval controls resolve exactly one server request by its wire ID, never an approval queue head or a newly minted client RPC ID.

The UI still receives opaque main-process request IDs. [[src/main/hermes.ts#resolvePendingApproval]] validates the renderer/run owner and the offered choice before the transport sends a matching-ID JSON-RPC result. Server-request duplicates cannot create another card or another response. Legacy `approval.respond` remains available only for legacy events.

## Batch clarification

One clarification request carries up to five questions and receives one answer map keyed by their stable question IDs.

The main callback forwards normalized questions and restored locked answers to the existing card channel. [[src/main/hermes.ts#resolvePendingClarify]] only decodes JSON for a known server request; ordinary legacy answer text remains literal. Invalid incomplete batches retain their resolver for retry.

## Cancellation isolation

Cancellation invalidates only the matching request in its originating session and leaves unrelated questions and the live model turn intact.

`request.cancel` clears the pending main resolver and emits the opaque card ID through `chat-request-cancelled`. The preload listener carries the original run ID. A delayed user answer cannot reach a replacement request or socket.

## Resume restoration

Unanswered requests from resume snapshots become interactive only after the resumed runtime session owns their handler.

Live requests arriving before resume acknowledgement are deferred. Once session identity is known, the transport activates those requests and restores `open_requests`, deduplicating pending or already answered identities.

## Unsupported interactions

Advertised clients explicitly decline request methods they cannot present instead of leaving the Agent waiting for an answer that can never arrive.

Malformed requests receive an invalid-parameters response. Unsupported or unrelated-session requests receive a method refusal; window-owned requests receive the protocol's not-shown response. The main transport does not infer an unscoped request's owner from the currently selected conversation.

## Interactive turns never replay

Any interactive request fences automatic transport fallback, because replaying its original prompt could repeat already completed effects.

Approval, clarification, sudo and secret interactions retain that fence through lost submit acknowledgements and disconnects. Closing a turn clears its card resolvers and pending native prompts; ordinary non-interactive fallback behavior is preserved.

## Main-only secret transport

Renderer dashboard sockets pass through a one-use main-process loopback relay so password and secret answers stay between a hardened modal and Agent.

[[src/main/dashboard-websocket-relay.ts#createLoopbackWebSocketRelay]] intercepts sudo, secret, vault-unlock and one-time-code requests. [[src/main/gatewayPrompt.ts#collectGatewayRequestValue]] collects them through the sandboxed password dialog. The chat renderer receives neither the sensitive request nor its answer, and cannot submit a competing response. Unsupported save-login flows are refused explicitly.

The same relay applies to Local, SSH and direct Remote dashboard connections, including loopback and TLS targets. Sensitive requests without an owning session are refused before a dialog opens. Main-process gateway chat collects supported credentials directly through the same native helper. Cancelling a visible dialog submits an empty value, while withdrawal or socket loss invalidates the request and sends no late answer.

## Secret cancellation

Withdrawal or socket closure aborts the originating native prompt and prevents a late value from being sent to another connection.

[[src/main/askpass.ts#showPasswordDialog]] accepts an abort signal, closes the dialog and removes its IPC submission listener on cancellation. The relay validates session ownership when applying request cancellation, serializes modal prompts and suppresses duplicate deliveries.

## Sensitive replay snapshots

Reconnect snapshots restore sensitive prompts in main while preserving non-sensitive open requests for the chat renderer.

The relay filters sensitive entries from `session.resume`, `session.activate` and `session.events.since` results' `open_requests`. Those entries use the same main-only collection and cancellation path as live requests, preventing credential prompts from falling through to renderer error handling.

## Native prompt cancellation

An aborted native dialog removes its own submission listener, and a retired dialog cannot answer a later credential request.

Executable dialog-lifecycle fixtures verify abort, pre-abort and stale-sender behavior without opening a native window or collecting real credentials.
