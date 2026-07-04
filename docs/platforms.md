# Platforms: one product, three channels

ContractorAI is a single hosted Next.js application reachable three ways:

| Channel | What it is | Where it lives |
| --- | --- | --- |
| **Web** | The Next.js app on Vercel (responsive down to 375px, PWA-installable) | this repo, deployed |
| **Mobile** | Thin Capacitor 7 shells (iOS + Android) that load the deployed HTTPS origin | `mobile/` |
| **Desktop** | Electron shell (Windows NSIS installer, auto-updating) that loads the same origin | `electron/` |

## Architecture: the hosted-URL model

The Next.js app **cannot be statically exported** — it depends on SSR, `middleware.ts`, server
actions, and httpOnly-cookie auth. So there is no "bundle the frontend into the app" option:
**every native channel is a thin shell that loads the deployed HTTPS origin in a WebView.**

Consequences of this model:

- **Auth just works.** The shells load the real origin, so the `session` cookie is first-party.
  No CORS configuration, no token bridging, no separate mobile API.
- **One deploy updates every channel's content.** Shipping to Vercel updates web, mobile, and
  desktop simultaneously — only shell-level changes (icons, permissions, window chrome, updater)
  require a new native release.
- **Connectivity is required.** There is no offline mode (see
  [Known limitations](#known-limitations)).

The web app additionally provides, in support of all channels:

- **PWA installability** — a manifest at `/manifest.webmanifest` and icons under `/icons/`.
  There is deliberately **no service worker**: aggressive caching breaks the streaming chat
  (NDJSON over long-lived responses), so "Add to Home Screen" installability is provided without
  offline caching.
- **Health endpoint** — `GET /api/health` returns `{ok, version}`; the shells and uptime checks
  use it to verify the origin is reachable.

## Web

Deployed to Vercel exactly as described in the [README](../README.md) (Neon Postgres,
`db:push` + `db:seed`, env vars from `.env.example`). The responsive shell works down to 375px
wide — on small screens the sidebar becomes a slide-out drawer. Users can install the PWA from
the browser menu on any platform.

## Mobile (Capacitor 7, `mobile/` package)

The `mobile/` directory is a standalone npm package (appId `com.contractorai.mobile`) containing
the Capacitor config and the generated `android/` and `ios/` native projects.

### How the server URL is wired

`mobile/capacitor.config.ts` reads **`CAP_SERVER_URL`** at `npx cap sync` time. The value is
**baked into the native projects by sync** — changing it requires re-running sync, not just
restarting the app.

- Default: `http://10.0.2.2:3000` — this is how the Android emulator reaches the dev server
  running on the host machine.
- Physical device on your LAN: `CAP_SERVER_URL=http://<LAN-IP>:3000` before sync.
- Release builds: set `CAP_SERVER_URL` to the production domain **before** sync (see
  [Release](#release-builds)).

### Android development (on this PC)

Prerequisites: Android Studio, JDK 21, Android SDK 35.

```bash
# terminal 1 — the web app
npm run dev

# terminal 2 — the shell
cd mobile
npm install
npx cap sync android
npx cap run android
```

### iOS development

The iOS project is scaffolded on Windows but must be **built on a Mac** (Xcode 16+):

```bash
cd mobile
npm ci
npx cap sync ios        # runs pod install
```

Then open `ios/App/App.xcworkspace` in Xcode and set the signing team before running on a
device.

### Release builds

1. Set `CAP_SERVER_URL` to the production domain, then `npx cap sync android` / `npx cap sync ios`
   (the URL is baked in at sync time — never ship a build synced against a dev URL).
2. **Android:** build a signed AAB in Android Studio and upload to the Play Console.
3. **iOS:** archive in Xcode and upload to App Store Connect.

### Icons and permissions

- Icons/splash: `npm run assets` inside `mobile/` (uses `@capacitor/assets` with the
  `mobile/assets/icon-*.png` source images).
- Permissions already declared:
  - **Android:** `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`. Deliberately **no** `CAMERA`
    permission — the app uses `<input capture="environment">` file-input camera capture
    (Field Capture, invoice photos), which does not require the CAMERA permission on Android.
  - **iOS:** `NSMicrophoneUsageDescription` + `NSCameraUsageDescription` (iOS *does* prompt for
    camera on file-input capture).

## Desktop (Electron, `electron/` package)

`electron/` is a separate npm package with its own `node_modules` (`npm install` inside it
first). It does not bundle Next — `main.js` calls `loadURL()` on **`CONTRACTOR_AI_URL`**
(default `http://localhost:3000`) and adds meeting-detection + loopback-audio IPC via
`preload.js`. If the origin is unreachable it shows a retry screen instead of a blank window.

- **Dev:** `npm --prefix electron run dev` (or `npm run desktop:dev` from the repo root)
  against a running `npm run dev`.
- **Build:** `npm run desktop:build` from the root (runs `electron-builder`) produces the NSIS
  Windows installer.
- **Auto-update:** electron-updater checks GitHub Releases (publish config
  `Antigro09/JDLewisAI`) on launch; installed apps download and apply new releases
  automatically.

### Release procedure (desktop)

1. Bump `version` in `electron/package.json`. **This is mandatory** — electron-updater compares
   semver versions; republishing the same version means installed apps never see the update.
2. Commit the bump.
3. Tag `desktop-v<version>` (e.g. `desktop-v0.2.0`) and push the tag.
4. The [`release-desktop.yml`](../.github/workflows/release-desktop.yml) workflow
   (`windows-latest`) runs `npm ci` + `npm run build -- --publish always` in `electron/` and
   publishes the installer + update metadata to a GitHub Release.
5. Installed apps self-update on next launch.

Warnings:

- The **NSIS target must never change** — electron-updater's Windows update path is tied to the
  NSIS installer format; switching targets orphans existing installs.
- Builds are **unsigned**, so Windows SmartScreen shows an "unrecognized app" warning on first
  install. Code signing is a future (paid-certificate) step.

## Production URL checklist

The app is not yet deployed to a production domain. Once it is deployed to Vercel:

1. **Electron:** set the fallback URL literal in `electron/main.js` (the
   `CONTRACTOR_AI_URL || "http://localhost:3000"` default) to the production origin **before**
   cutting an end-user desktop release — end users don't set env vars.
2. **Mobile:** set `CAP_SERVER_URL` to the production domain for every release sync.
3. **Google OAuth:** register the production redirect URIs in the Google Cloud console —
   `https://<domain>/api/google/callback` and `https://<domain>/api/auth/google/callback`
   (see the README's Google integration section).

## Known limitations

- **Google OAuth sign-in is blocked inside embedded WebViews.** Google returns
  `disallowed_useragent` in the Electron shell and the Capacitor apps. **Email/password login
  works everywhere.** Future fix: open OAuth in the system browser and return via deep link.
- **No offline mode.** Hosted-URL shells need connectivity; the Electron shell shows a retry
  screen when the origin is unreachable, and there is no service worker by design.
- **Voice dictation** (`webkitSpeechRecognition`) is unavailable in mobile WebViews — the
  composer's dictation control degrades gracefully (hidden/disabled); read-aloud and everything
  else still works.
- **Store distribution needs human steps:** an Apple Developer account and a Play Console
  account, plus signing certificates/keystores — none of that is automatable from this repo.

## Store submission checklist

**Google Play Console:**

- Upload a **signed AAB** (release-synced against the production `CAP_SERVER_URL`).
- Provide a **privacy policy URL**.
- Complete the **data-safety form** — declare microphone usage (meeting/voice features) and
  account data collected by the app.

**Apple App Store Connect:**

- Upload via **Xcode archive** (signing team set, production sync).
- Complete **App Privacy** — declare microphone and camera usage.
- Add a **review note that an account is required** and provide a **demo login** for the review
  team (self-registration may be domain-restricted via `ALLOWED_SIGNUP_DOMAIN`).
