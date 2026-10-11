# Speech Playback

Agent message Listen actions synthesize MiniMax audio from the selected local profile and share one cancellable playback owner per desktop window.

[[main-process#MiniMax speech synthesis]] describes the IPC entry point. [[speech-playback-tests]] records the actual main-process and rendered-message regressions.

## Local target authority

Speech and its configuration require an explicit profile and the main-issued revision of the selected Local connection before any credential or configuration read.

[[src/main/speech.ts#assertSpeechTarget]] rejects Remote, SSH, inactive and changed targets. A result is checked again before returning audio. Region/model writes use the same authority boundary instead of the generic mode-dependent configuration API.

Remote and SSH chat hide Listen, and their Providers views cannot load or save desktop speech settings. The renderer still checks a freshly issued target before dispatch; a late Local-to-Remote transition cannot fall back to desktop credentials.

## Owned synthesis cancellation

Each desktop window owns at most one admitted synthesis request, and cancellation must match both its window and request ID.

[[src/main/speech.ts#runSpeechRequest]] aborts the previous request when admitting a replacement, observes window destruction and releases only its own pending entry. [[src/main/speech.ts#cancelSpeechRequest]] ignores old IDs and other windows, so a delayed Stop cannot cancel a newer request.

## Bounded encoded synthesis

A speech request captures the profile's regional credential, model, voice and encoded format before awaiting the vendor and times out after 45 seconds.

[[src/main/minimax-speech.ts#synthesizeMiniMaxSpeech]] aborts fetch on Stop or timeout, bounds both fetch and body parsing, validates complete hex audio and supports MP3, WAV and FLAC. Raw PCM is refused because browser Audio needs an encoded container. Errors explain missing keys, unsupported settings and request failures.

Explicit global/China selection binds its matching key to the fixed regional endpoint. An empty region retains the Agent's automatic global-key then China-key behavior; invalid configured regions fail. Text must be shorter than 10,000 characters, matching [MiniMax's synchronous speech contract](https://platform.minimax.io/docs/api-reference/speech-t2a-http).

Cancellation stops desktop waiting and aborts its outgoing request. A vendor may already have accepted generation; the desktop does not claim that cancellation reverses provider billing.

## One playback owner

Starting another message stops the previous audio and synthesis; late results cannot allocate audio, revive playback or change the newer owner's state.

[[src/renderer/src/screens/Chat/speech-playback.ts#startSpeechPlayback]] owns Audio and blob URLs across message rows. Stop, unmount, profile/connection changes and connection configuration events release ownership. Stale play promises and old media callbacks are ignored; failed synthesis or playback leaves a visible, retryable Listen action.

Layout marks a Chat active only when its run and the chat screen are visible. Hidden, retained Chat instances unmount Listen actions, cancelling synthesis and releasing audio while preserving their conversation and background agent transport.

## Scoped speech settings

The Providers selectors load and save through the captured Local connection and selected profile, with no generic Remote-to-Local fallback.

[[src/renderer/src/screens/Providers/MiniMaxSpeechSettings.tsx#MiniMaxSpeechSettings]] serializes changes, preserves the last confirmed value on failure and discards old hydration or save replies after scope changes. Choosing a valid model or region also selects MiniMax as the profile's TTS provider. The Automatic option persists an empty region, retaining the Agent's global-key then China-key fallback.

[[src/main/config.ts#setMiniMaxSpeechConfigValue]] inserts missing nested speech mappings, preserves comments and siblings, verifies the serialized YAML and writes model/region plus provider atomically to the explicit profile. Unsupported scalar or flow parents fail visibly without rewriting the file.
