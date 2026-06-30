# Pocket Putt — Mini Golf with Friends

A mobile mini golf app built with Expo / React Native. Host a game, share a room
code, and putt through 3 courses (6 holes each) with friends in real time.

## Gameplay

- **Drag back, release to shoot**: touch anywhere on the green and drag away
  from the direction you want to putt. The further you drag, the more power
  the shot has. Moving your finger left/right while dragging continuously
  re-aims the shot, just like pulling back a slingshot.
- Players take turns one shot at a time, looping around the table until
  everyone has holed out (or hit the 10-stroke cap for that hole).
- Scores are tracked per hole across all 18 holes; lowest total wins.
- Some holes have **water hazards**: roll into one and stop, and you take a
  1-stroke penalty and your ball is replaced where the shot started, to retry.
  **Ramps** are real sloped colliders now — roll onto one with enough speed
  and the ball climbs the slope (slowing down going up, speeding up coming
  down), and a fast enough shot can launch off the top edge airborne, often
  used to help carry a well-powered shot across a water gap.

Physics are simulated in real 3D with
[cannon-es](https://github.com/pmndrs/cannon-es): real gravity, a ball that
actually gains/loses height, and true 3D colliders for boundary walls,
obstacles, and ramps (ramps are sloped wedge colliders, not a flat
speed-boost hack). Course geometry (`x`, `y`, `width`, `height`, `angle`,
etc.) in `src/game/courses/*` is still authored as flat 2D ground-plane data
— `x`/`y` map to the 3D `x`/`z` ground axes, and elevation (a ramp's `rise`,
the ball's height) is derived/simulated rather than hand-authored per
course. Hazard detection (water) stays a ground-plane `(x, z)` check, only
evaluated once the ball has settled, so a ball briefly airborne over water
from a ramp launch isn't penalized until it actually lands there.

## Project structure

```
src/
  types/            shared types (Course, RoomState, BallState, ...)
  game/
    physics.ts       cannon-es 3D world setup, shot/rest/sink helpers
    courses/          3 built-in courses, 6 holes each
  firebase/
    config.ts         Firebase app/auth/database init (reads .env)
    auth.ts            anonymous sign-in
    rooms.ts           create/join room, turn state machine, score sync
  components/         GolfCourseView (3D render + gesture), ScoreTable, PrimaryButton
  screens/             Home, Host, Join, Lobby, Game, Results
  navigation/          React Navigation stack
```

### Real 3D physics, 2D-authored course data

`GolfCourseView.tsx` renders the course with `three.js` via `expo-gl` and
`@react-three/fiber/native` (`<Canvas>`), and unlike the old 2D physics, the
3D scene now renders the *real* simulated state — including real elevation
— not a flat visual layer on top of 2D numbers. The mapping from game data
to the 3D scene is:

- physics `x` → 3D `x`
- physics `y` (ground-plane game data) → 3D `z` (depth, "away from camera")
- 3D `y` is real height: gravity, ball bounce/airtime, and ramp slopes all
  drive a genuine `y` position, fed straight from `cannon-es`'s simulated
  body positions into the ball mesh and synced over Firebase as `BallState.z`
  (height) / `vz` (vertical velocity) alongside the existing `x`/`y`/`vx`/`vy`.
- Ramps, boundary walls, and obstacles (`wall`, `rockBlock`, `rock`) are all
  real 3D colliders (`cannon-es` `Box`/`Cylinder`/`ConvexPolyhedron` shapes)
  extruded to the same heights (`WALL_MESH_HEIGHT`, `ROCK_MESH_HEIGHT`,
  `BOUNDARY_WALL_HEIGHT`) the renderer draws, all defined once in
  `physics.ts` and imported into `GolfCourseView.tsx` so visual and physical
  geometry can't drift apart. A ramp's collider and mesh are both a wedge
  (entry edge at ground level tapering up to a sloped exit edge at height
  `rise`) — not a tilted box — so the ball rolls smoothly onto the slope
  instead of bouncing off an end-cap.
- The cup is still a heuristic trigger (distance + speed check, now also
  requiring the ball be near ground height), not real pit collision geometry
  — sinking eases the ball's rendered height down over a few frames instead
  of teleporting it.

The camera is a static per-hole rig (no orbit/touch controls, so it can't
fight the shot-aim drag gesture), framing the tee-to-cup line and recomputed
whenever the hole changes.

If you're tweaking gameplay, edit `physics.ts` / `courses/*` as before and
the 3D view will reflect it automatically. If you're tweaking visuals (mesh
colors, camera framing, lighting, materials/textures/shadows), that's all
contained in `GolfCourseView.tsx`'s render layer and doesn't touch gameplay
— note that mesh *heights/shapes* for ramps and obstacles are physics-driven
(see above) and shouldn't be hand-tuned independently of `physics.ts`.

Physics constants (gravity, max shot speed, friction, restitution, sleep
thresholds, ramp rise-per-boost-unit) are collected in one block near the
top of `physics.ts`. They're a first-pass estimate ported from the old 2D
tuning and verified only via a numeric smoke test and a web-platform visual
check — not real on-device play in Expo Go. Expect to retune them (shot
power, friction, ramp steepness, bounce) after trying the game on a real
device.

## Setup

1. Install dependencies (already done if you cloned this repo with
   `node_modules` removed, run `npm install`).
2. Create a free [Firebase](https://console.firebase.google.com/) project.
   - Add a **Web app** to the project (you don't need iOS/Android apps in
     Firebase — the Web SDK config works fine for Expo).
   - Enable **Authentication -> Sign-in method -> Anonymous**.
   - Enable **Realtime Database** (start in test mode while developing).
3. Copy `.env.example` to `.env` and fill in the values from
   *Project settings -> General -> Your apps -> SDK setup and configuration*:

   ```
   EXPO_PUBLIC_FIREBASE_API_KEY=...
   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
   EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
   EXPO_PUBLIC_FIREBASE_DATABASE_URL=...
   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
   EXPO_PUBLIC_FIREBASE_APP_ID=...
   ```

4. Recommended Realtime Database security rules (replace the test-mode
   defaults once you're ready — these still keep things simple for a casual
   party game, only requiring that writers are signed in):

   ```json
   {
     "rules": {
       "rooms": {
         "$code": {
           ".read": "auth != null",
           ".write": "auth != null"
         }
       }
     }
   }
   ```

5. Run the app:

   ```bash
   npm install
   npm start
   ```

   Then scan the QR code with **Expo Go** (iOS/Android), or press `a` / `i`
   for an emulator/simulator.

   This project targets **Expo SDK 54**. If Expo Go reports "Project is
   incompatible with this version of Expo Go," check the SDK version shown
   in Expo Go's Settings/Profile screen and make sure it matches the `expo`
   version in `package.json` — Expo Go on app stores can lag a release or
   two behind the latest SDK on npm.

## Known v1 simplifications

- Balls don't collide with each other, only with walls/obstacles — this keeps
  the turn-based netcode simple (only the active player's ball needs physics
  simulation; everyone else's ball is rendered from its last known resting
  position).
- The shooting player's device is authoritative for their own shot (no
  server-side validation) — fine for a casual game among friends, not
  designed to resist cheating.
- Disconnects mark a player as `connected: false` but don't remove them from
  the score table, so a dropped connection mid-round doesn't break scoring
  for everyone else.

## Typechecking

```bash
npx tsc --noEmit
```
