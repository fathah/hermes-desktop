# Shared Pets

Hermes One reads and changes each profile's pet through the same gateway RPCs as the official desktop, so installation and selection are never duplicated in client-owned storage.

## Profile and connection authority

Every request carries an explicit profile and uses the selected machine's authenticated dashboard WebSocket. [[src/renderer/src/components/pet/petGateway.ts#openPetGateway]] obtains a fresh ticket for each socket; [[src/renderer/src/components/pet/petGateway.ts#petRequest]] scopes even the default profile. An unavailable remote dashboard never falls back to local files.

## Gallery and preferences

Settings → Pets lists installed pets immediately, merges the online gallery when reachable, and asks the backend for thumbnails.

Selecting, disabling, scaling, renaming, exporting and removing call the upstream `pet.*` RPCs; changes are visible to CLI/TUI/official desktop in the same profile. [[src/renderer/src/components/pet/PetSettings.tsx#PetSettings]] owns this UI, refreshes while open, retries failed thumbnails on later refreshes, and reconnects after a dropped gateway. Generated pets use their existing manifests rather than a new Hermes One format.

## Live mascot

[[src/renderer/src/components/pet/FloatingPet.tsx#FloatingPet]] polls pet metadata and refreshes the revisioned sprite when another Hermes surface changes selection.

The `pet.changed` event is an immediate hint; focus/poll reconnects a dropped socket, and an in-flight metadata read rechecks after a newer change. [[src/renderer/src/components/pet/PetSprite.tsx#PetSprite]] renders both legacy and current state rows using the gateway's geometry and real frame counts. The displayed run owns activity; legacy and dashboard failures use the failed pose rather than a success wave. Saved drag positions are clamped when the window shrinks. Only drag position is local to this device; profile selection and size remain in shared Hermes config.

The mascot is inside the Hermes One window. Official-desktop pop-out, roaming, and pet-generation UI are separate presentation features, not alternate storage formats.

## Connection edit regressions

Editing a connection in place releases its socket and rejects old reads, so the gallery and mascot follow the edited endpoint rather than a cached machine identity.

### Handshake fencing

A config change while Dashboard startup or ticket issuance is pending aborts the handshake before another endpoint can supply the socket URL. Covered by [[src/renderer/src/components/pet/petGateway.test.ts]].

### Settings refresh

The settings gallery reconnects on a config revision even when the connection ID is unchanged, and discards a delayed previous gallery read. Covered by [[src/renderer/src/components/pet/PetSettings.test.tsx]].

### Mascot refresh

The floating pet closes the old socket and ignores its pending sprite after an endpoint edit. Covered by [[src/renderer/src/components/pet/FloatingPet.test.tsx]].

## Settings navigation

A real settings dialog opened from a conversation keeps its explicit machine and profile through pet selection, and releases its old socket when reopened for another conversation. Covered by [[src/renderer/src/components/settings/PetSettings.navigation.test.tsx]].

## Recovery regressions

Pet controls use desktop-compatible forms, preserve slow authoritative gallery reads, and distinguish a paused clarification from a completed turn.

### Generated pet rename

Generated pets are renamed with an in-app form; failed RPCs preserve the entered name for retry. Covered by [[src/renderer/src/components/pet/PetSettings.test.tsx]].

Pet control rows use their own flex layout outside the settings subgrid, keeping labels, switches and sliders readable in a short window. Actual Chromium settings-dialog acceptance covers rename errors, retries, and composer-independent scrolling.

### Slow online gallery

Ordinary polls wait through the entire local and online gallery request, while explicit changes and mutations can supersede it. Covered by [[src/renderer/src/components/pet/PetSettings.test.tsx]].

### Clarification waiting

A loading pause for clarification keeps the waiting pose until the answer resumes the run or a terminal event finishes it. Covered by [[src/renderer/src/components/pet/FloatingPet.test.tsx]].

### Obsolete native replies

A delayed native prompt reply cannot fail a replacement turn, clear its loading state or project a failure pose. Runtime recovery and attachment replies retain the same submitted-turn and connection lifetime.

### Current native failure

A failure of the currently submitted turn still clears its loading state, displays its error and projects one failure event for that turn's pet owner.

### Connection teardown retires its turn

A connection edit immediately fails only the still-current originating UI turn, including pending session creation or prompt submission. Old replies cannot mutate the new runtime, persist old-target errors or project a current-authority pet failure.

### Initial handshake teardown settles its turn

Editing the connection during initial Dashboard startup releases the originating turn's loading state. A delayed handshake cannot dispatch its session or prompt on the edited target.
