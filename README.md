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
with [matter-js](https://brm.io/matter-js/).

## Project structure

```
src/
  types/            shared types (Course, RoomState, BallState, ...)
  game/
    physics.ts       matter-js world setup, shot/rest/sink helpers
    courses/          3 built-in courses, 6 holes each
  firebase/
    config.ts         Firebase app/auth/database init (reads .env)
    auth.ts            anonymous sign-in
    rooms.ts           create/join room, turn state machine, score sync
  components/         GolfCourseView (SVG + gesture), ScoreTable, PrimaryButton
  screens/             Home, Host, Join, Lobby, Game, Results
  navigation/          React Navigation stack
```

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
