---
lat:
  require-code-mention: true
---

# SSH session deletion

Tests cover native SSH deletion, transactional data integrity and recoverable session-list feedback.

## Legacy routing

Single-session deletion in legacy mode invokes native SSH on the selected connection and profile.

## Batch fallback routing

Auto mode uses the scoped native SSH batch operation when dashboard access fails.

## Explicit dashboard mode

Explicit dashboard mode preserves its error instead of silently changing transports.

## Selected rows and child retention

Deleting selected sessions removes messages and desktop overlays, detaches unselected children, and preserves unrelated history.

## Profile isolation and idempotence

Only the selected profile changes; duplicate, blank and already-deleted identifiers are handled idempotently.

## Batch rollback

A later constraint failure rolls back messages, overlays, parent links and all earlier deletions in the batch.

## Missing database and invalid profile

Deletion cannot create a missing database or escape the selected profile path.

## Concurrent requests

Concurrent processes serialize writes and count each deleted session only once.

## Legacy schema and opaque ids

Plain agent schemas without optional desktop tables are supported; identifiers remain SQL parameters.

## Visible deletion failure

Failed deletion followed by a failed refresh retains the original row and displays retry guidance.

## Pending deletion and duplicate clicks

Rows remain until acknowledgement and repeated confirmation cannot submit concurrent deletions.

## Late response isolation

A previous connection or profile deletion cannot remove rows from the newly selected profile.

## Visible batch failure

Failed batch deletion retains visible history and displays an error.

## Deletion supersedes visible loading

A quiet refresh after deletion owns the loading state of any superseded visibility reload, including when refresh fails, so the list cannot remain stuck behind a spinner.
