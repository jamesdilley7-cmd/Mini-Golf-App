# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

This project is pinned to **Expo SDK 54**, not the latest SDK. The Expo Go app
on app stores lags behind brand-new SDK releases by days to weeks, so pinning
to whatever SDK the installed Expo Go app actually reports avoids "Project is
incompatible with this version of Expo Go" errors on real devices. Don't bump
`expo`/`react-native`/the Expo-bundled native module versions in
`package.json` without first confirming the target SDK against the installed
Expo Go app's reported SDK version (visible in the Expo Go app's
Settings/Profile screen). We've now had to walk this pin back twice (56 -> 55
-> 54) chasing the real device's Expo Go version — always confirm the device's
reported SDK version directly rather than assuming `latest` or `latest - 1` on
npm matches it.
