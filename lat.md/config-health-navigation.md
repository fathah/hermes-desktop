---
lat:
  require-code-mention: true
---

# Configuration health navigation

Regression coverage for opening scoped configuration details and recovering from asynchronous audit or fix failures.

## Banner opens scoped details

A real banner click opens the existing About health report for the selected profile without passing a React event into section resolution.

## Repeated details navigation

Repeated details actions reuse the global settings dialog and retain the scoped report.

## Failed audit recovery

An explicit details view shows loading, failure, retry, and clean states rather than an empty pane.

## Profile request isolation

A late audit from a previous profile cannot replace the current report or publish an obsolete update.

## Fix delivery recovery

Failed fixes remain retryable and concurrent clicks cannot submit duplicate mutations.

## Partial success remains visible

A successful fix followed by an audit failure retains its result and offers an audit retry without repeating the mutation.

## Unmount ignores pending work

Leaving the pane suppresses obsolete component state updates. A successful mutation still reruns its profile-scoped audit and publishes the result to mounted observers.

## Audit request deduplication

Audit retries cannot overlap and fixes are disabled until the audit completes.
