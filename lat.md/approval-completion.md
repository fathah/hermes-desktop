---
lat:
  require-code-mention: true
---

# Approval completion ordering

A legacy dashboard turn can complete before its approval response RPC is acknowledged. The originating decision stays addressable until that reply settles.

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] preserves the legacy acknowledgement ordering tested below. Current matching-ID JSON-RPC responses have no separate response acknowledgement; their immediate adapter result confirms socket delivery. Their settlement and reconnect rules are documented in [[server-requests#Resume restoration]].

## Confirmed decisions

Legacy allow and deny responses succeed after early completion when the gateway resolves exactly one request. Unanswered queued approvals still expire; duplicate submission remains blocked while the response is pending.

## Failed and obsolete decisions

A lost or unresolved legacy acknowledgement cannot revive a completed approval. Abort, disconnect, connection changes and a new prompt invalidate retained requests; a late reply cannot stop a new turn on the same runtime session.
