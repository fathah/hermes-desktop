# Office World Actions

Chat-commanded errands in the Office 3D world: tell an agent "go to the bank and check my balance" and its avatar walks the trip route to the bank, stops at the teller or ATM, and the interaction modal opens with the requested action already running.

The agent's own LLM does the understanding — the chat injects a vocabulary of world abilities, the model emits a machine-readable action block alongside its natural reply, and the renderer executes it. Adding a future ability (transfers, car purchase, other rooms) is one vocabulary entry plus a handler, not a new pipeline.

The pipeline has four stages, deliberately decoupled: protocol ([[src/renderer/src/screens/Office/office3d/interactions/worldActions.ts]]) → orchestration ([[src/renderer/src/screens/Office/Office.tsx]]) → bus ([[src/renderer/src/screens/Office/office3d/interactions/missionBus.ts]]) → simulation ([[src/renderer/src/screens/Office/office3d/objects/AgentsLayer.tsx#AgentsLayer]]).

## Action protocol

The office chat prepends a request-side system message describing the abilities; when the user's request maps to one, the model appends a fenced ```world-action JSON block to its reply, which the renderer strips from the visible text and validates.

[[src/renderer/src/screens/Office/office3d/interactions/worldActions.ts#buildWorldActionSystemPrompt]] generates the vocabulary from a declarative `ABILITIES` list (one entry per ability, so prompt and parser can't drift apart). Abilities today: `go_to` (bank, showroom) and `bank` operations (check_balance / account_status / create_account, via teller or ATM — create_account normalises to the teller, its only flow). [[src/renderer/src/screens/Office/office3d/interactions/worldActions.ts#parseWorldActions]] is tolerant by design: malformed JSON and unknown `do` values are stripped from the text but run nothing, so a newer prompt never breaks an older desktop. [[src/renderer/src/screens/Office/office3d/interactions/worldActions.ts#planWorldActions]] reduces a validated action list to one plan — a walking destination plus at most one facility interaction; bank operations force the bank as destination.

The system message is injected into `sendMessage`'s history array (role "system") in [[src/renderer/src/screens/Office/OneChatModal.tsx]], so it is never persisted; transcripts stay clean and reloads only strip blocks (via `toChatMessages`) without re-running them — a reopened chat can never replay an old errand.

## Mission bus

A tiny module-level pub/sub bridging the DOM side (chat, modals, camera) and the r3f Canvas simulation, which mutates refs per-frame and can't share React context across the Canvas boundary.

A `Mission` is one commanded errand: agent id, destination, and an optional interaction (rep id + panel action). [[src/renderer/src/screens/Office/office3d/interactions/missionBus.ts#dispatchMission]] hands it to the simulation, [[src/renderer/src/screens/Office/office3d/interactions/missionBus.ts#completeMission]] tells the sim the modal closed, and [[src/renderer/src/screens/Office/office3d/interactions/missionBus.ts#emitMissionEvent]] reports progress back ("arrived", "ended"). Plain Sets, no React, no allocations in the frame path — the low-end-device rule for all of Office 3D.

## Commanded trips

A mission reuses the existing trip machinery ([[office-3d-interiors#Office 3D Interiors#Agent trips]]) — same routes, collision, crowd separation — with a "visit" phase instead of random wandering.

On dispatch, [[src/renderer/src/screens/Office/office3d/objects/AgentsLayer.tsx#AgentsLayer]] puts the agent's controller into trip mode on [[src/renderer/src/screens/Office/office3d/trips.ts#getTripRoute]], joining at [[src/renderer/src/screens/Office/office3d/trips.ts#nearestRouteIdx]] so a mission can start from a desk, the rest room, or mid-trip anywhere; an agent already inside the destination skips straight to the visit. Office-interior legs route through the partition/CEO doorways via [[src/renderer/src/screens/Office/office3d/core/routing.ts#routeTarget]]'s door gates (missions can start at any desk — random trips only ever started in the rest room, which is why single-hop routing used to suffice; see [[office-3d-interiors#Office 3D Interiors#Collision]]). Unlike random trips, a working agent is not turned around: being sent on an errand while working is the point.

The visit phase walks to the interaction's named stop — `TripRoute.stops`, keyed by rep id, reusing proven collision-clear wander points (teller counter, ATM row) — emits "arrived", then stands holding until `completeMission` or a timeout (2 min with a modal pending, 15 s for a plain go_to), and finally walks the route home in reverse. A superseding mission for the same agent ends the previous one first.

## Orchestration

Office.tsx owns the mission lifecycle: it turns parsed actions into a mission, points the camera, and opens the interaction modal on arrival.

`handleWorldActions` (in [[src/renderer/src/screens/Office/Office.tsx]]) plans the actions, dispatches the mission, closes the chat, and pulls back to the city view to watch the walk (walk mode keeps its own camera). On "arrived" it selects the agent, flies into the destination interior, and — when the mission has an interaction — opens [[src/renderer/src/screens/Office/RepInteractionPanel.tsx#RepInteractionPanel]] with an `autoAction`, which the panel runs exactly once after its account scope resolves (running earlier would race the cache-key change that bumps `requestSeq` and drops in-flight results). Whichever way the modal goes away (close, Escape, exiting the interior, walk-mode movement), an effect watching `activeRepId` completes the mission so the agent heads home. The reverse direction holds too: if the simulation times out the interaction hold and emits "ended" while the panel is still open, the panel is closed with it — UI and mission state always describe the same interaction.

## Tests

Vitest suites covering the protocol and the bus; the walking behaviour rides on the existing trip machinery covered by the interiors docs.

- [[src/renderer/src/screens/Office/office3d/interactions/worldActions.test.ts]] — prompt/parse/plan
- [[src/renderer/src/screens/Office/office3d/interactions/missionBus.test.ts]] — pub/sub contract

### Prompt advertises every ability

Every JSON example the vocabulary prompt shows must itself parse as a valid action — a vocabulary the parser rejects would teach the model dead syntax.

### Parses and strips action blocks

A reply carrying a world-action block yields the validated actions and clean display text; a bare object is accepted as a one-item array.

### Tolerates malformed blocks

Malformed JSON and unknown abilities are stripped from the visible text but produce no actions — bad model output degrades to a normal chat reply, never a crash or a wrong errand.

### Bank operations force the bank

Planning maps a bank operation to the bank destination and the right representative (teller vs ATM), overriding any conflicting go_to, and a plain go_to yields a walk with no interaction.

### Bus delivers and unsubscribes

Missions, completions, and events reach subscribers; unsubscribed listeners stop receiving so a torn-down AgentsLayer never acts on a mission with a stale controller map.
