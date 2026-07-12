# Office 3D Traffic

Backdrop cars and trucks looping on the Office tab's city roads. Vehicles follow the car ahead in their lane, yield at junctions, and the whole fleet renders with GPU instancing driven by one per-frame update in [[src/renderer/src/screens/Office/office3d/objects/Traffic.tsx#TrafficLayer]].

TrafficLayer is mounted only in the city view: entering a building interior (see [[office-3d-interiors]]) unmounts it, which pauses the simulation and its draw calls entirely; on exit it resumes from where it stopped.

Roads stay physically clear of scenery: the detailed backdrop grid excludes road corridors when placing buildings, and the [[src/renderer/src/screens/Office/office3d/objects/CityBackdrop.tsx#DistantSkyline]] ring rejection-resamples each silhouette tower's polar position (using its half-diagonal as clearance) until it misses every corridor — the roads run the full ROAD_LEN out into the skyline band, so without this, cars drove straight through distant towers.

The road network itself (8 roads, two-way lanes, loop length) comes from the city master plan in `src/renderer/src/screens/Office/office3d/core/cityPlan.ts`; traffic reads `ROADS`, `ROAD_WIDTH` and `TRAFFIC_LEN` from there.

## Fleet generation

[[src/renderer/src/screens/Office/office3d/objects/Traffic.tsx#makeTraffic]] builds 7 vehicles per road (56 total) from fixed seeds — like the rest of world-gen, traffic is deterministic and every load produces the same fleet, tints, and starting positions.

Each vehicle carries static config (model URL, tint, lane, cruise speed, precomputed heading index) plus live simulation state (`s` position along the road, current `speed`). Directions alternate per slot so each road has traffic in both lanes.

## Driving simulation

[[src/renderer/src/screens/Office/office3d/objects/Traffic.tsx#stepTraffic]] advances all vehicles once per frame in three passes: junction occupancy, target-speed selection, then integration. Cars never drive through each other.

Car-following: within a lane each vehicle finds the nearest vehicle ahead (wrapped over the traffic loop). Inside `SLOW_GAP` it matches the leader's speed; inside `MIN_GAP` it targets zero — so cars brake, queue behind a stopped leader, and pull away again once it moves. Speeds ease toward the target with separate acceleration/braking rates so stops look like braking rather than snapping.

### Junction yielding

Every E-W/N-S road crossing is a "junction box" (crossing road width plus clearance). A vehicle approaching a box stops before it while cross-axis traffic occupies it, and proceeds once clear.

A vehicle already inside a box is committed and never told to stop there.

Deadlock avoidance is by axis priority: N-S traffic also yields while E-W traffic is merely *approaching* the box (`YIELD_DIST`), whereas E-W traffic only stops for N-S vehicles actually inside it — so the two axes can't wait on each other symmetrically.

## Instanced rendering

The fleet renders as one `THREE.InstancedMesh` per model sub-mesh — about a dozen draw calls for all 56 vehicles — with a single `useFrame` loop that simulates and writes instance matrices.

The previous approach cloned the GLB per vehicle: hundreds of draw calls (each clone has ~5-10 meshes with unique materials) plus 56 separate `useFrame` subscriptions.

[[src/renderer/src/screens/Office/office3d/objects/Traffic.tsx#buildPartTemplates]] flattens each vehicle GLB into parts, baking the same recentre/ground/scale/align transform as [[src/renderer/src/screens/Office/office3d/core/glb.ts#normalizeFootprint]] into a per-part matrix. Per-vehicle paint uses `instanceColor`: tintable (light) materials get a white base colour so the instance colour is the final paint, while dark trim (tyres, glass) keeps its source colour — matching what [[src/renderer/src/screens/Office/office3d/core/glb.ts#vehicleClone]] does for the showroom's individually-cloned cars.

Per-frame matrix work is allocation-free: each part precomputes its four possible heading matrices (`ROT_YAWS`), so placing an instance is a matrix copy plus a translation add.

## Model nose orientation

`normalizeFootprint` aligns a vehicle's long axis to +Z but cannot know which end is the front, so `MODEL_NOSE_YAW` in Traffic.tsx adds a 180° yaw for models whose nose points -Z in the GLB — without it those cars drive tail-first.

Currently only car1 needs the flip: its GLB has front wheels at -Z, while car2 and truck1 already face +Z.

The correction is applied in both pipelines — the instanced traffic templates and [[src/renderer/src/screens/Office/office3d/objects/Traffic.tsx#VehicleModel]] (used by the car showroom) — so a model faces the same way everywhere.
