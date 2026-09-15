---
lat:
  require-code-mention: true
---

# Dashboard clarification

Tests cover interactive gateway questions, transport-correct replies and the lifecycle of pending answers.

## Interactive gateway requests

Gateway events preserve questions and choices as interactive cards rather than flattening them into text.

## Gateway answer delivery

Choice, free-text and skip answers use clarify.respond on the originating dashboard session.

## Composer fallback

Composer answers share the card delivery path and resolve the visible question.

## Retry and duplicate answers

Failed replies remain retryable and concurrent submissions cannot send two answers.

## Expired answers

An expired gateway result is not displayed as a successfully delivered answer.

## Connection isolation

Connection changes invalidate pending questions before replies can reach another session.

## Completed turns and replay

Completed questions remain unavailable when a gateway request is replayed.

## Card transport routing

Gateway-generated choices render as buttons and submit through the supplied responder without falling back to local IPC.

## Unavailable card feedback

Expired cards disable answer controls and explain that the question no longer accepts input.

## Consecutive questions

A late acknowledgement resolves its original question without clearing the next pending question.

## Disconnect during answer

Closing the active socket while a clarification response is pending clears that turn and loading state, expires the card, and leaves the composer available for recovery.
