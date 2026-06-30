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
  **Ramps** (orange boost pads) give the ball a speed kick in whatever
  direction it's already moving, often used to help carry a well-powered shot
  across a water gap — so the power of your drag really matters.

Physics (gravity-free top-down rolling, wall bounces, friction) are simulated
with [matter-js](https://brm.io/matter-js/) entirely in a flat 2D `(x, y)`
plane — there's no real elevation. The course is *rendered* in 3D (see below),
but that's a visual layer on top: physics, hazard detection, ramp boosts, and
Firebase multiplayer sync all stay 2D. Course geometry (`x`, `y`, `width`,
`height`, `angle`, etc.) in `src/game/courses/*` is unitless 2D game-plane
data, not 3D scene data — don't add elevation/`z` fields to it expecting
physics to use them.

## Project structure

```
src/
  types/            shared types (Course, RoomState, BallState, ...)
  game/
    physics.ts       matter-js world setup, shot/rest/sink helpers (2D only)
    courses/          3 built-in courses, 6 holes each
  firebase/
    config.ts         Firebase app/auth/database init (reads .env)
    auth.ts            anonymous sign-in
    rooms.ts           create/join room, turn state machine, score sync
  components/         GolfCourseView (3D render + gesture), ScoreTable, PrimaryButton
  screens/             Home, Host, Join, Lobby, Game, Results
  navigation/          React Navigation stack
```

### 2D physics, 3D rendering

`GolfCourseView.tsx` renders the course with `three.js` via `expo-gl` and
`@react-three/fiber/native` (`<Canvas>`), but the *only* numbers driving ball
movement, collisions, hazards, and network sync are the same flat 2D
`(x, y)` coordinates physics has always used. The mapping from game data to
the 3D scene is:

- physics `x` → 3D `x`
- physics `y` → 3D `z` (depth, "away from camera")
- 3D `y` (height) is always `0` for the ball and ground — physics has no
  concept of elevation. Only static decorative meshes (walls, rocks, the cup
  rim, the flagpole) get nonzero height, purely for visual bulk.

The camera is a static per-hole rig (no orbit/touch controls, so it can't
fight the shot-aim drag gesture), framing the tee-to-cup line and recomputed
whenever the hole changes.

If you're tweaking gameplay, edit `physics.ts` / `courses/*` as before and
the 3D view will reflect it automatically. If you're tweaking visuals (mesh
colors, heights, camera framing, lighting), that's all contained in
`GolfCourseView.tsx`'s render layer and doesn't touch gameplay.

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
