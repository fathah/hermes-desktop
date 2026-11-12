# Agent blocking requests

Current Agent blocking prompts use peer-to-peer JSON-RPC while older Agents keep their notification and response-method protocol.

## Matching request replies

Replies return the exact server-issued ID on the socket that received the question; response frames never become new model turns or command calls.

[[src/shared/gateway-server-requests.ts#parseGatewayServerRequest]] identifies current frames. [[src/renderer/src/screens/Chat/dashboardGatewayClient.ts#DashboardGatewayClient]] advertises support, retains bounded pending requests and adapts approval and clarification requests to the existing chat presentation. Legacy notifications remain usable when an older Agent rejects the capability method.

## Request cancellation

Cancellation or a closed connection invalidates pending answers before late UI actions can grant permission or answer another session's question.

The client maps `request.cancel` to a request-specific expiry event. A disconnected or superseded socket cannot deliver questions or accept answers through a replacement socket.

## Resume restoration

Unanswered requests returned by resume or activation are restored only after the view adopts the matching runtime session identity.

The Agent's `open_requests` snapshot is authoritative for unanswered questions. Replayed requests can restore a card disabled by disconnect; duplicate live delivery cannot append another card. Legacy terminal-card replays remain closed.

Within one socket, settled IDs stay retired even when an older replay response arrives later. An outstanding approval's identity and choices cannot change behind its visible card. Clarification replay may add typed locked answers without changing its question set. A real reconnect clears socket-local tombstones so an answer lost with the connection can be restored.

Before runtime adoption, requests may wait for a create/resume handoff. Once the caller adopts a session, requests belonging to another session are explicitly declined with the not-shown code rather than left waiting.

If the last pending handoff fails or times out, buffered requests are reconciled against the retained owner immediately; requests without an adopted owner are declined instead of waiting indefinitely.

## Unsupported requests

Unsupported request methods receive an explicit error instead of silently leaving the Agent waiting; unavailable window-owned bridges decline with the Agent's not-shown code.

Password and secret values remain in the main-process relay. The renderer never renders or answers secret requests. New product surfaces such as onboarding and browser-vault management are not inferred from transport support.

## Batch clarification

One clarification card presents the Agent's question set and submits one answer map keyed by the original question IDs.

[[src/renderer/src/screens/Chat/ClarifyCard.tsx#ClarifyCard]] retains locked answers on replay, supports multiple selections and free text, and can skip unanswered questions. [[src/shared/gateway-server-requests.ts#gatewayClarifyResult]] validates the complete result only for a known current request; legacy literal answers are never parsed as protocol objects.

Selected multi-choice answers use the Agent's JSON-array string representation, while the card displays readable choice labels. Selection does not submit prematurely: Send or Ctrl/Command+Enter sends the whole form, and Skip preserves locked answers while leaving the rest null.

[[src/shared/gateway-server-requests.ts#normalizeGatewayClarifyQuestions]] bounds distinct question IDs, question text and choices before controls are created. [[src/shared/gateway-server-requests.ts#normalizeGatewayClarifyAnswers]] admits only typed, bounded answers for those IDs. IDs remain data, including prototype-looking names; malformed locks and oversized labels are rejected before presentation.

## Backend launch scope

Managed local Agent installations run the headless server while legacy installations retain their existing dashboard command and explicit profile isolation.

[[src/main/dashboard-launch.ts#buildLocalDashboardCliArgs]] selects `serve` only for a resolved managed runtime. The desktop owns only the child it launches; this compatibility slice does not change system-service ownership or introduce connection pooling.
