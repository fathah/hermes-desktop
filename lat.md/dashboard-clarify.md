---
lat:
  require-code-mention: true
---

# Dashboard clarification

Tests cover interactive gateway questions, transport-correct replies and the lifecycle of pending answers.

The original specifications below protect legacy event/RPC behavior. Current matching-ID request replies, batch forms, cancellation and authoritative reconnect restoration are additionally documented and tested through [[server-requests]].

## Interactive gateway requests

Gateway events preserve questions and choices as interactive cards rather than flattening them into text.

## Gateway answer delivery

Legacy choice, free-text and skip answers use clarify.respond on the originating dashboard session.

## Composer fallback

Composer answers share the card delivery path and resolve the visible question.

## Resolved current composer answers

A resolved current single-question card shows literal composer text, including JSON-looking text, while explicit skips and locked answers retain their meaning.

## Retry and duplicate answers

Failed replies remain retryable and concurrent submissions cannot send two answers.

## Expired answers

An expired gateway result is not displayed as a successfully delivered answer.

## Connection isolation

Connection changes invalidate pending questions before replies can reach another session.

## Completed turns and replay

Completed legacy questions remain unavailable when their notification is replayed; stale same-socket current snapshots cannot reopen a settled request either.

## Card transport routing

Gateway-generated choices render as buttons and submit through the supplied responder without falling back to local IPC.

## Unavailable card feedback

Expired cards disable answer controls and explain that the question no longer accepts input.

## Consecutive questions

A late acknowledgement resolves its original question without clearing the next pending question.

## Disconnect during answer

Closing the socket clears the pending turn and disables its card. Current open requests can restore after a new socket resumes the owner; stale replies cannot use that new socket.

## Stale request isolation

Replaying an answered or completed question cannot expire the newer question that is waiting for a response.

## In-flight request replay

Replaying a question while its answer is being delivered preserves the resumed turn and its busy state.

## Gateway expiration

A matching clarify.expire event disables the timed-out card and restores tracking of the resumed agent turn. Events for another request or session leave the current question untouched.

Current Agent `request.cancel` frames are adapted to the same request-specific expiry path. Batch answer validation, locked-answer restoration, multi-selection encoding and keyboard submission follow [[server-requests#Batch clarification]].
