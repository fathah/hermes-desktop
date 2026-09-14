# Office 3D Walk Mode

GTA-style walk mode on the Office tab: a "Walk around" toggle spawns the user's own avatar outside HQ, WASD/arrows walk it through the city, doorways load interiors, and nearby objects show a Press-E prompt. Esc returns to the sky/orbit view.

Walk mode is a toggle, not a replacement — the classic orbit camera, click-to-focus buildings and the Enter button all still exist when it's off. The two schemes share one location state, so everything the [[office-3d-interiors|interior system]] mounts per location is identical in both.

## Glass roofs

The three enterable buildings wear glass roofs so the sky view reads as a finished city block while interiors (and their agents) stay visible through the panes — a terrarium of agents.

[[src/renderer/src/screens/Office/office3d/objects/Roofs.tsx#GlassRoof]] is one transparent pane plus a metal frame (border beams + mullion grid), mounted per building: the office roof sits beside `Room` in Office3D, the bank and showroom take a `roof` prop on [[src/renderer/src/screens/Office/office3d/objects/Bank.tsx#BankSection]] and [[src/renderer/src/screens/Office/office3d/objects/CarShowroom.tsx#CarShowroom]].

Every wall touches its roof: the office's perimeter walls are all 3.6 (matching the north wall) with the roof flush at 3.62 — the doorway keeps a human-scale 2.2 opening with solid wall above it — and the bank/showroom roofs sit on their own wall tops. A floating gap band here is exactly what street-level walking exposes.

## Street-level scale

The world is proportioned for a walking 1.65-unit person, not just the sky camera: cars ~2.5 person-heights long, 7-unit roads, and backdrop buildings stretched vertically (`BUILDING_Y_STRETCH` in [[src/renderer/src/screens/Office/office3d/objects/CityBackdrop.tsx]]) so a ground floor tops the player.

Footprint normalisation squashes the backdrop GLBs' storeys to person height; stretching height-only restores floor proportions without widening footprints beyond their 5-unit grid cells (which would need a full grid re-lay and invalidate the curated `BACKDROP_OVERRIDES`). Road centres moved one unit outward with the widening so the sidewalk strip (z≈17.2) in front of each lot stays off the asphalt.

Mount rule: always in the city view; kept indoors in walk mode (looking up shows the skylight grid); dropped in orbit-interior mode so the top-down camera stays unobstructed. Glass casts no shadow and writes no depth, so it never occludes the CEO glass walls or the storefront beneath it.

## Player avatar & controller

[[src/renderer/src/screens/Office/office3d/objects/Player.tsx#PlayerLayer]] spawns a gold-tinted man.glb rig with a "You" nameplate at `PLAYER_SPAWN` (outside the HQ south doorway) and runs the whole controller in one `useFrame`.

Input is window-level keydown/keyup by `KeyboardEvent.code` (WASD + arrows, Shift runs), ignoring editable targets and cleared on window blur. Movement is camera-relative: the ground-projected camera forward defines "W", so steering always matches what's on screen. The rig blends idle/walk/run clips by weight, falling back to a faster walk timeScale if the model has no run clip.

The player is a first-class crowd citizen: it registers a crowd body (`setCrowdBody("player", …)`), gets separated from agents/pedestrians, and resolves against the same per-place static colliders via [[src/renderer/src/screens/Office/office3d/core/collision.ts#collidersForPlace]] — so walls, desks and door gaps behave exactly as they do for agents.

Outdoors, cars are solid too: the player pushes out of the live vehicle circles the [[office-3d-traffic#Driving simulation#Braking for people|traffic sim]] publishes (`TRAFFIC_OBSTACLES`), and traffic in turn brakes for the player like for any other person on a road.

Office.tsx exits walk mode automatically when the tab loses visibility, so the window-level key listeners never capture typing elsewhere in the app.

## Chase camera

The third-person camera is the scene's OrbitControls with its target glued to the avatar: each frame the player shifts the camera by the target's delta and re-centres the target at chest height, so mouse orbit and wheel zoom keep working for free.

Walk mode reconfigures the controls (pan off, zoom-to-cursor off, distance clamped to 2.2–11) and skips the location target clamp. `CameraRig` in [[src/renderer/src/screens/Office/office3d/Office3D.tsx]] gains walk-aware rules: engaging walk mode flies down behind the spawn point, doorway transitions mid-walk fly nothing (the camera is already at the player), and disengaging flies back to the location preset.

## Door-triggered interiors

Walking through a doorway swaps the mounted location: the player's `place` is derived each frame from building footprints, and a change is reported to Office.tsx, which maps it onto the `location` state the Enter button sets.

Because collision only admits people through real door gaps, crossing a footprint boundary is only possible at a doorway — the interior mounts exactly as you step inside, and the city returns as you step out. In walk mode the click-to-focus/Enter/Exit-to-city UI is hidden and building clicks don't focus.

## Proximity Press-E interactions

Walking near an ATM, bank teller, showroom car or agent desk shows a bottom-centre `[E]` chip; pressing E fires the same action the click-Interactable fires in orbit mode (wallet section, teller menu, car card, agent sidebar).

Points live in [[src/renderer/src/screens/Office/office3d/interactions/proximity.ts#buildPlayerInteractions]], mirroring the collider constants (ATMs, tellers) and exported car/desk positions; [[src/renderer/src/screens/Office/office3d/interactions/proximity.ts#nearestInteraction]] picks the closest in-range point in the player's current place each frame, reported to the shell only on change. Desk radii (2.3) deliberately overlap along a desk row — columns repeat every 3.78 world units, and nearest-wins keeps the prompt unambiguous. The E handler in Office.tsx dispatches on the point's `kind` and ignores editable targets, so typing in modals never triggers it.

Pressing E on an ATM or teller opens the rep interaction modal, which owns Escape while it's up: Office's walk-mode/interior Escape handler stays detached whenever a rep panel is open (gated on `activeRepId`), so one Escape dismisses only the modal instead of also dropping out of walk mode. Closing the modal re-attaches the handler, so the next Escape exits walk mode as usual.
