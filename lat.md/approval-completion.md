---
lat:
  require-code-mention: true
---
# Approval completion ordering

A dashboard turn can complete before its approval response RPC is acknowledged. [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#useDashboardChatTransport]] keeps an in-flight decision addressable until the reply settles.

## Confirmed decisions

Allow and deny responses succeed after early completion when the gateway resolves exactly one request. Unanswered queued approvals still expire; duplicate submission remains blocked while the response is pending.

## Failed and obsolete decisions

A lost or unresolved acknowledgement cannot revive a completed approval. Abort, disconnect, connection changes and a new prompt invalidate retained requests; a late reply cannot stop a new turn on the same runtime session.
