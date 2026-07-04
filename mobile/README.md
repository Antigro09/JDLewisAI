# ContractorAI Mobile (Capacitor)

Thin native shells for **iOS and Android** that load the ContractorAI web app from a
server URL. This is a separate npm package (like `electron/`) — it has its own
`node_modules` and never touches the root build.

## The hosted-URL model (and why)

ContractorAI **cannot be statically exported**: it relies on Next.js SSR, `middleware.ts`
for page guards, streaming API routes, and httpOnly-cookie auth. So the Capacitor shells
do **not** bundle the web app. Instead, `capacitor.config.ts` sets `server.url` and the
native WebView loads the deployed (or dev) web app directly — the same way `electron/`
`loadURL()`s the site.

Two consequences to keep in mind:

- **The URL is baked at sync time.** `capacitor.config.ts` is read when you run
  `npx cap sync` and written into the native projects (`capacitor.config.json` inside
  `android/` and `ios/`). Changing the env var later does nothing until you re-sync.
- `www/` contains only a tiny placeholder page. `cap sync` requires `webDir` to exist
  even in `server.url` mode; the placeholder is what users would see if the server URL
  were ever unreachable at the native layer. It is committed on purpose — don't ignore it.

`server.url` selection:

| Env | Result |
| --- | --- |
| `CAP_SERVER_URL` unset | `http://10.0.2.2:3000` (Android-emulator alias for the host machine's `next dev`) + a console warning |
| `CAP_SERVER_URL` set | that URL; `cleartext` is enabled automatically only for `http://` URLs |

## Prerequisites / toolchain

- Node 22+, npm
- **JDK 21** (Android Studio's bundled JBR works: `C:\Program Files\Android\Android Studio\jbr`)
- Android Studio with **SDK 35** (AGP 8.7 / Gradle 8.11; min SDK 23, target SDK 35)
- iOS: a Mac with Xcode 16+ and CocoaPods (iOS 14+ deployment target)

One-time setup:

```powershell
cd mobile
npm install          # or: npm --prefix mobile install (from repo root)
```

Do **not** add mobile scripts to the root `package.json`; from the repo root use
`npm --prefix mobile run sync`, `npm --prefix mobile run android`, etc.

## Dev workflow (Windows + Android)

1. Start the web app at the repo root: `npm run dev` (listens on :3000).
2. In `mobile/`:

   ```powershell
   npx cap sync android
   npx cap run android      # or: npm run android / npm run open:android
   ```

   The **emulator** reaches the host machine via `http://10.0.2.2:3000` — that's the
   dev default, no env var needed (the `[capacitor] CAP_SERVER_URL not set` warning is
   informational).

3. **Physical devices** can't use `10.0.2.2`. Point them at your machine's LAN IP and
   re-sync:

   ```powershell
   $env:CAP_SERVER_URL = 'http://<LAN-IP>:3000'
   npx cap sync android
   npx cap run android
   ```

   (Phone and PC must be on the same network; allow :3000 through the Windows firewall.)

`android/local.properties` (gitignored) must point at your SDK if Android Studio hasn't
created it for you:

```
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

## Release checklist

1. **Set the production URL before syncing** — it is BAKED into the native projects at
   sync time. Use a stable custom domain (not a per-deploy `*.vercel.app` preview URL —
   shipping a URL that later changes bricks the installed app until an update):

   ```powershell
   $env:CAP_SERVER_URL = 'https://<production-domain>'
   npx cap sync
   ```

   With `https://` the config sets `cleartext: false` automatically.

2. Android: `npm run open:android`, then in Android Studio **Build → Generate Signed
   App Bundle** (AAB) with your release keystore; upload to Play Console.
3. iOS: on the Mac (below), archive in Xcode (**Product → Archive**) and distribute
   via App Store Connect.
4. Bump versions first: `android/app/build.gradle` (`versionCode`/`versionName`) and
   the Xcode target (`MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`).

## iOS on a Mac

`npx cap add ios` was run on Windows, so the Xcode project is committed but CocoaPods
was skipped (the `Skipping pod install` warning is expected). On the Mac:

```bash
cd mobile
npm ci
npx cap sync ios          # runs pod install
npx cap open ios          # opens ios/App/App.xcworkspace in Xcode 16+
```

In Xcode: select the `App` target → Signing & Capabilities → set your team, then build
(iOS 14+ target). Always open the **`.xcworkspace`**, not the `.xcodeproj`.

## Permissions

- **Android** (`android/app/src/main/AndroidManifest.xml`): `RECORD_AUDIO` +
  `MODIFY_AUDIO_SETTINGS` for meeting capture / voice dictation. **CAMERA is deliberately
  NOT declared** — the web app's `<input capture>` camera intent needs no permission,
  and declaring CAMERA would make that intent require a runtime grant. Don't add it.
  No `MainActivity` changes: Capacitor 7's `BridgeActivity` already bridges WebView
  `getUserMedia` permission requests.
- **iOS** (`ios/App/App/Info.plist`): `NSMicrophoneUsageDescription` and
  `NSCameraUsageDescription` are set. No `AppDelegate` changes.

## App icons / splash screens

The native projects currently ship Capacitor's default icons. Brand source images land
in `mobile/assets/` on a separate branch; once they're merged, run:

```powershell
cd mobile
npm run assets    # capacitor-assets generate (brand orange #ea580c / dark #431407)
npx cap sync
```

Note for Windows: npm runs scripts through `cmd.exe`, which treats single quotes
literally. If the generated icons come out with the wrong background color, run the
command directly in PowerShell with double quotes instead:

```powershell
npx capacitor-assets generate --assetPath assets --iconBackgroundColor "#ea580c" --iconBackgroundColorDark "#431407"
```

## Known limitations / future work

- **Google OAuth sign-in is blocked inside embedded WebViews** — Google rejects it with
  `disallowed_useragent`. **Password login works.** Future work: open the OAuth flow in
  the system browser via `@capacitor/browser` + a deep-link redirect back into the app.
- Live meeting audio capture depends on WebView `getUserMedia`; test on real devices.

## What's committed vs. generated

`android/` and `ios/` are **committed** (Capacitor convention — they're source, edited
directly for permissions/signing). Build outputs (`android/app/build/`, `ios/App/Pods/`,
`android/local.properties`, …) are gitignored via `mobile/.gitignore` plus the
platform-level `.gitignore`s Capacitor generates.
