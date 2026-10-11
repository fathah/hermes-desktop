---
lat:
  require-code-mention: true
---

# Speech Playback Tests

Actual IPC callbacks and rendered message rows protect local authority, cancellation ownership, encoded audio and stale completion behavior for [[speech-playback]].

## Selected local profile

A real synthesis IPC callback reads only the explicit Local profile's key and configuration, preserving the captured credential in the vendor request.

## Local authority refusal

Remote, SSH, inactive, changed and invalid-profile DTOs fail before any desktop speech credential or configuration read.

## Owned cancellation and replacement

Stop cancels the matching window/request, replacement aborts its predecessor, old cancellation cannot touch the replacement, and window destruction removes its pending listener.

## Targeted settings writes

Actual settings IPC validates both the captured Local target and allowed model/region values before updating only the explicit profile.

## MiniMax encoded request

Default synchronous synthesis requests non-streamed hex MP3 with the configured voice and decodes successful audio bytes.

## Regional key binding

The China endpoint receives only the China credential from the selected profile, preserving regional separation.

## Bounded cancellation

Stop aborts an unresponsive vendor request; fetch and body parsing are both bounded by the timeout and leave no pending timer.

## Playable formats and invalid responses

MP3, WAV and FLAC yield their encoded MIME types; raw PCM, invalid regions, oversized input and malformed or unsuccessful replies fail clearly.

## Two rendered rows share playback

Starting a second real message row pauses and releases the first audio, leaving only one active Listen owner for the selected profile.

## Superseded synthesis reply

A late first-row synthesis reply cannot create audio or stop the newer row after ownership changes.

## Stop cancels loading

The loading Stop action sends the exact admitted request ID and rejects a late audio result.

## Unmount releases audio

Unmounting the owning row pauses audio, revokes its blob URL and cancels only that request.

## Profile and connection lifecycle

Profile, connection, mode and configuration changes invalidate pending synthesis before its reply can create audio in the new scope.

## Actionable playback errors

Credential/synthesis errors, Audio errors and play rejections stay visible while restoring a retryable Listen action.

## Late play completion

A play promise and ended callback arriving after Stop cannot revive old playback or clear a newer owner's controls.

## Scoped settings screen

The settings view sends the captured Local target and selected profile on load and save instead of inferring the current connection after an await.

## Late settings hydration and save

Old profile hydration and old connection save outcomes cannot change settings after the screen moves to a new target.

## Serialized settings persistence

Real main configuration writes persist missing or existing model, region and provider mappings in only the selected profile, preserving comments, sibling fields and Automatic values across reopening.

## Unsafe speech mapping refusal

Scalar and flow YAML parents fail without acknowledging success or modifying the original configuration, preventing silent settings loss or duplicate mappings.

## Hidden chat playback release

The actual Layout and Chat retain background transcripts while switching profile or screen, but pause audio, revoke its URL and cancel the hidden run's matching speech request.

## Hidden pending chat synthesis

Profile and screen transitions cancel synthesis in the actual retained Chat, so a late vendor reply cannot allocate or play hidden audio.

## Unsafe multiline speech leaf refusal

Valid YAML speech leaves containing child mappings or continued text are refused before an atomic write, preserving the entire profile file rather than leaving invalid continuation lines.

## Visible speech content

Real rendered reply rows synthesize only their cleaned text segments, excluding hidden media paths, large image payloads and leaked tool wrappers while keeping their recovered readable answers.

## Media only reply speech omission

A reply containing only media has no Listen action and cannot send an invisible path to the speech provider.
