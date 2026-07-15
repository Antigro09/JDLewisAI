# ContractorAI Desktop

Electron package for the downloadable ContractorAI app. It is a thin shell that loads
the deployed ContractorAI web app with professional window chrome (custom branded
titlebar, no OS menu bar), the desktop-only gate handshake, license-gated auto-update,
and meeting-detection + loopback-audio IPC.

## Development

This package has its own `node_modules` — run `npm install` in `electron/` first
(downloads Electron, ~100 MB).

```powershell
# from the repo root, with the Next dev server running on :3000
npm --prefix electron run dev

# point the shell at a different server
$env:CONTRACTOR_AI_URL = 'http://localhost:3109'; npm --prefix electron run dev

# exercise the desktop-only gate locally (set the same value in the web app's .env.local)
$env:DESKTOP_GATE_SECRET = '<same value as the server>'; npm --prefix electron run dev
```

`CONTRACTOR_AI_URL` / `DESKTOP_GATE_SECRET` env overrides are **dev-only** conveniences —
end users don't have them set (see below).

## Production configuration (app-config.json)

Packaged builds read `electron/app-config.json` — **environment variables do not exist
on user machines**. The file is generated at build time by
`scripts/write-app-config.mjs` from `DESKTOP_APP_URL` (the hosted origin) and
`DESKTOP_GATE_SECRET` (the desktop-only gate handshake); CI feeds both from repo
secrets. It contains a secret, so it is gitignored — never commit it.

A packaged build without `app-config.json` refuses to start with an error dialog
(instead of silently loading localhost forever).

## Building the installer

```powershell
# generate app-config.json first (packaged builds require it)
$env:DESKTOP_APP_URL = 'https://app.example.com'; $env:DESKTOP_GATE_SECRET = '<secret>'
node electron/scripts/write-app-config.mjs
npm --prefix electron run build
```

Output lands in `electron/dist/` (`ContractorAI Setup <version>.exe`, NSIS installer).
The build is currently **unsigned**: Windows SmartScreen shows an "unrecognized app"
warning on install — users click "More info" → "Run anyway". Auto-updates still
download and apply normally on unsigned builds.

If `build/icon.ico` / `build/icon.png` exist, electron-builder picks them up
automatically; without them it uses the default Electron icon (no config needed).

## Auto-update (license-gated)

Installers are still **published** to GitHub Releases (`publish` block in
`package.json`, `Antigro09/JDLewisAI` — works after the repo goes private), but
installed apps do **not** talk to GitHub. At runtime the updater uses a generic feed
served by the hosted app at `/api/desktop/update/<installedMajor>/…`, which reads the
(private) GitHub releases server-side and applies the license gate:

- Patch/minor releases within the installed major flow to **every** client.
- A higher **major** is only offered when the client company's entitled major
  (set on the `/owner` console) covers it. Everyone else keeps their version,
  still receiving patches.
- After sign-in the web app hands the shell a device token
  (`update:setDeviceToken` IPC, stored via `safeStorage`) that proves the
  company entitlement to the feed.

**Installs are user-initiated.** On launch — and every 4 hours after — a packaged
app checks the feed and downloads a newer installer quietly in the background,
but nothing is ever installed behind the user's back (`autoInstallOnAppQuit` is
off). Once a build is staged, an unobtrusive **Update** pill appears in the app's
titlebar (`components/desktop-titlebar.tsx`); clicking it shows the version and a
"Restart and update" button. Ignoring it is fine — the client keeps working on
their current version indefinitely.

- Update checks only run in **packaged** builds (`app.isPackaged`); `npm run dev`
  never checks (unpackaged runs have no `app-update.yml` and would throw). To work
  on the update UI, fake a staged update:
  `$env:CONTRACTOR_AI_FAKE_UPDATE = '9.9.9'; npm --prefix electron run dev`
- **Auto-update only works for NSIS installs.** Never switch `win.target` away from
  `["nsis"]` — portable/zip targets can't self-update.

## Release procedure

1. Bump `version` in `electron/package.json` (e.g. `0.1.0` → `0.2.0`).
2. Commit the bump.
3. Tag `desktop-v<version>` (e.g. `desktop-v0.2.0`) and push the tag — a GitHub
   Actions release workflow builds and publishes the installer + `latest.yml`.

**Tagging without bumping the version ships an update users never receive:**
`electron-updater` compares the installed version against `latest.yml`, so a release
that re-publishes the same version number is ignored by every installed copy.

**Major releases are the paid tier.** Publishing `2.0.0` does nothing for clients
until you raise their company's entitled major to 2 on `/owner`. To keep shipping
fixes to 1.x clients afterwards, tag `desktop-v1.x.y` maintenance releases from a
branch — the feed serves each client the newest release within their allowed major.

## Current scope

- Loads the existing ContractorAI web app from `CONTRACTOR_AI_URL` or the fallback URL.
- Opens links to other origins in the default browser; shows a branded error screen
  (`error.html`) with a Retry button when the app URL can't be reached.
- Exposes the Meeting Intelligence IPC contract:
  - `detect:start`
  - `detect:stop`
  - `audio:listDevices`
  - `audio:startMeeting`
  - `audio:stopMeeting`
  - `audio:deviceChanged`
- Includes a lightweight Windows process/window detector for meeting apps.

## Native audio adapter

The next layer is a native Windows audio helper that captures:

- microphone input
- WASAPI loopback speaker output
- device-change events

That helper should stream finalized PCM chunks to the app's `/api/meetings/:id/transcript`
pipeline through the transcription provider adapter.

The server-side live transcription endpoints now exist:

- `POST /api/meetings/:id/stream/start`
- `POST /api/meetings/:id/stream/audio`
- `POST /api/meetings/:id/stream/stop`

Audio chunks should be mono PCM16 little-endian at 16 kHz for the AssemblyAI adapter.

The web meeting workspace can already capture the user's microphone, downsample it to
16 kHz PCM16, and stream it into these endpoints. In the Electron app, the desktop
bridge enables Chromium loopback audio for `getDisplayMedia`, removes the unused
video track, mixes the user's mic plus system audio, and streams one mono PCM feed to
AssemblyAI.

For deeper production capture, the remaining native layer is a dedicated WASAPI helper
that captures individual endpoint devices and handles device switching without relying
on Chromium display capture.
