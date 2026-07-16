# Android release signing

Release APKs must be signed with a **private** keystore that is never committed.
Until one is configured, `./gradlew assembleRelease` falls back to the public
AOSP **debug** key and prints a warning — such an APK is trivially re-signed by
an attacker and **must not be published**.

The Gradle wiring lives in [`android/app/build.gradle`](../android/app/build.gradle)
(the "Release signing credentials" block + `signingConfigs.release`). You only
need to supply the key + credentials.

## One-time owner setup

1. **Generate a private keystore** (keep it somewhere safe and backed up — losing
   it means you can never ship an update that Android accepts):

   ```sh
   keytool -genkeypair -v \
     -keystore android/app/suvo-release.keystore \
     -alias suvo \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

   Answer the prompts and choose a strong store/key password.

2. **Create `android/keystore.properties`** (gitignored) from the template:

   ```sh
   cp android/keystore.properties.example android/keystore.properties
   ```

   Fill in the real `storePassword`, `keyAlias`, and `keyPassword`. `storeFile`
   is resolved relative to `android/app/`.

3. **Build** — signing now uses your key automatically, and the debug-key
   warning disappears:

   ```sh
   npm run apk        # or: npm run apk:demo
   ```

## CI

Instead of the properties file, export these before the build:

- `SUVO_RELEASE_STORE_FILE` (path, relative to `android/app/`)
- `SUVO_RELEASE_STORE_PASSWORD`
- `SUVO_RELEASE_KEY_ALIAS`
- `SUVO_RELEASE_KEY_PASSWORD`

Store the keystore itself as an encrypted CI secret (base64) and write it to
disk in a pre-build step.

## Notes

- The committed `android/app/debug.keystore` is the public AOSP debug key. It is
  fine for **debug** builds (never distributed). It is only a risk when it signs
  a **release**, which this setup no longer does once a private key is
  configured. Optionally purge it from git history if you want to stop tracking
  it — that is a destructive history rewrite and not required for release safety.
- Never paste the keystore or passwords into the repo, issues, or chat.
