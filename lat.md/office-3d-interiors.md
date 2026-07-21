# Office 3D Interiors

Enterable building interiors on the Office tab: click the office, bank, or car showroom in the city view, press Enter, and the whole screen becomes that interior while the rest of the city stops rendering. Exiting restores the full city.

The feature spans the screen shell ([[src/renderer/src/screens/Office/Office.tsx]] owns the location state and DOM overlays) and the scene ([[src/renderer/src/screens/Office/office3d/Office3D.tsx]] mounts layers per location).

The same location state is also driven by [[office-3d-walk-mode|walk mode]], where the user's avatar enters buildings by walking through their doorways instead of click + Enter; the buildings additionally wear [[office-3d-walk-mode#Glass roofs|glass roofs]] in the city view.

## Locations & conditional rendering

`OfficeLocation` ("city" | "office" | "bank" | "showroom") lives in `office3d/core/locations.ts` with per-location camera presets, orbit clamps, and shadow centres. Buildings never move — entering only flies the camera and changes what's mounted.

Interior modes mount ONLY the active building plus [[src/renderer/src/screens/Office/office3d/objects/AgentsLayer.tsx#AgentsLayer]]; the city backdrop, distant skyline, connecting street, traffic, and the other buildings unmount entirely. React unmounting also stops their `useFrame` work, so the [[office-3d-traffic|traffic simulation]] pauses while indoors and resumes where it left off on exit. This is the efficiency contract: the GPU renders what the current context shows, never the whole world.

Entry flow: in city mode, clicking a building calls `onFocusBuilding` (wrapping `<group onClick>`s in Office3D); Office.tsx shows an "Enter …" button; clicking it sets the location. Exit via the top-left button or Escape. The dev building-mover keeps exclusive click ownership when active — no focus/enter in devMode.

## Camera rig

`CameraRig` (in Office3D.tsx) lerps the camera position and OrbitControls target to the new location's preset over ~0.8 s with cubic easing; afterwards the user orbits freely within the location's clamp box.

Controls are disabled during flight so damping doesn't fight the animation, and target clamping is skipped while disabled (mid-flight the target legitimately crosses out-of-bounds space).

[[src/renderer/src/screens/Office/office3d/objects/SceneEnvironment.tsx#SceneEnvironment]] takes a `center`/`shadowHalfExtent` so the key light's shadow camera follows the location — the bank (world x≈68) sits outside the default ±36 frustum and would get no shadows otherwise. The light remounts on frustum change (three reads shadow camera bounds only at creation).

## Interactables

`office3d/objects/Interactable.tsx` wraps interior objects: hover shows a billboard label (troika text, CSP-safe local font) and a ground ring, click fires the action. Disabled outside the matching interior so city-view click semantics are untouched.

Wired actions: bank ATMs open the profile modal on its wallet section (`OpenProfileOptions.initialSection`, threaded through [[src/renderer/src/components/profile/ProfileModalProvider.tsx#ProfileModalProvider]]); bank tellers open the space-representative menu (see [[office-interactions#Office Space Interactions#Teller Interactable]]); showroom cars open a spec card overlay in Office.tsx; office desks select their owner agent (details sidebar).

## People & staff

Every human in the world stands the same height: `PERSON_WORLD_HEIGHT` in `office3d/core/constants.ts` (≈1.65 world units). Ambient NPCs normalise to it, so a visiting agent never towers over the locals.

The value is derived, not chosen: profile agents render at their 0.65 normalised height × RiggedCharacter's 1.45 multiplier × `AGENT_SCALE` (1.75); the constant bakes that product so NPC scaling can't drift from the agent pipeline.

[[src/renderer/src/screens/Office/office3d/objects/StaffPerson.tsx#StaffPerson]] is a stationary tinted man.glb rig playing its idle clip, used for building staff: three bank tellers behind the counter stations ([[src/renderer/src/screens/Office/office3d/objects/Bank.tsx#BankTellers]]) and a showroom salesperson + manager. The tellers are interactive — clicking one opens the bank's representative menu ([[office-interactions#Office Space Interactions]]); the showroom staff are set dressing until car sales attach to them the same way.

All ambient people are coloured through [[src/renderer/src/screens/Office/office3d/core/glb.ts#tintCharacterClone]], which mirrors the agents' RiggedCharacter rule: only the rig's shirt materials take the tint (skin/hair/trousers keep their own colours), with an all-materials fallback — so NPCs never look like full-body colour casts next to an agent.

NPCs draw from a character pool in [[src/renderer/src/screens/Office/office3d/core/characters.ts#CHARACTER_MODELS]]: man.glb plus the Casual-family rigs (person.glb, person2.glb, women.glb). Shirt material names differ per model (man = "Shirt"; the Casual rigs use colour names like "LightBrown"/"Purple"/"White", identified from each rig's torso mesh), so each pool entry carries its own `shirtMaterials` list. Pedestrians pick a seeded random rig, tellers cycle through the pool, and the showroom pairs a female salesperson with a male manager.

### City pedestrians

Ambient people live on the streets, not in one building: [[src/renderer/src/screens/Office/office3d/objects/Pedestrians.tsx#PedestriansLayer]] runs seeded pedestrians on cyclic sidewalk loops that pop into the bank and the car showroom, with dwell stops inside. The office is agents-only — no pedestrian route enters it.

Each pedestrian tracks a `place` ("outside" | "bank" | "showroom") from its current waypoint, so interior views show exactly the people actually in that building and the city view shows everyone on the streets. Walk/idle clips crossfade at dwell stops. The layer is mounted in every location (like AgentsLayer) so interiors are already populated when entered; it replaced the old `BankFakePeople`, whose eight walkers were confined to the bank floor.

## Collision

People never pass through walls, furniture, or each other: a crowd registry separates overlapping people, and per-place static colliders (wall boxes with door gaps, furniture circles) push walkers out. Buildings are entered through doorways only.

Crowd separation is radial plus a tangential bias with fixed world handedness ([[src/renderer/src/screens/Office/office3d/core/collision.ts#applyCrowdSeparation]]): a purely radial push deadlocks two head-on walkers — separation shoves them apart, goal pull shoves them back, and the pair vibrates in place (the sidewalk-glitch bug). The tangent makes an approaching pair sidestep in opposite world directions, so both "pass on the right" and spiral past each other.

Everything lives in [[src/renderer/src/screens/Office/office3d/core/collision.ts]] and works in world coordinates; the office simulation converts its canvas positions at the boundary. Wall colliders mirror the visible geometry including every door gap — the office's south wall gained a real doorway (`OFFICE_DOOR_X` in cityPlan.ts, east of the HQ logo) that trips now walk through instead of phasing the wall. Seats (chairs, beanbags) are deliberately not colliders so agents can reach them, and desk boxes cover only the desk body away from the seat side.

Blocked walkers wall-follow: when the push-out cancels a step, the walker commits to a short slide along the blocking face's tangent — signed toward its goal, re-derived at corners — with goal steering suspended for the burst. (A per-frame perpendicular nudge is not enough: the goal pull re-pins the walker against the face each frame, walking in place forever — the original stuck-at-desk bug.) The static resolver exposes its push normal for this via `resolveStaticColliders`' `pushOut`.

Desk seats add a structural rule: agents approach the chair from the open side — up the desk-free aisle between desk columns, then across at seat height (`deskApproachByAgent` in AgentsLayer) — so the everyday sit-down never depends on obstacle avoidance at all. Trip/NPC waypoints sit clear of all colliders with looser arrival radii so a crowded waypoint can't strand anyone. Pedestrians register in the same crowd as visiting agents, so the two populations avoid each other too; standing staff participate as static circles.

## Agent trips

Idle agents occasionally walk out of the office to the bank or showroom, wander inside, and walk back. Routes live in `office3d/trips.ts` as canvas-space waypoint chains.

The canvas↔world mapping ([[src/renderer/src/screens/Office/office3d/core/geometry.ts#worldToCanvas]]) is linear, so waypoints far outside the office's 0..1800 rectangle work unchanged — no second coordinate system.

The controller in [[src/renderer/src/screens/Office/office3d/objects/AgentsLayer.tsx#AgentsLayer]] adds a "trip" mode (phases out → wander → back) beside toSeat/seated. Only idle (non-working) seated agents start trips, capped at `TRIP_MAX_TRAVELLERS`; if an agent's gateway starts mid-trip it walks the route home in reverse rather than teleporting. Each agent's `place` ("office" | "bank" | "showroom" | "outside") is derived from route progress.

The simulation always runs for every agent; the `visiblePlace` prop only toggles per-agent wrapper-group visibility each frame, so each interior view shows exactly the agents actually in that building and the city view shows everyone, including walkers on the street.
