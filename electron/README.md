# ContractorAI Desktop

Electron package for the downloadable ContractorAI app. It is a thin shell that loads
the deployed ContractorAI web app and adds meeting-detection + loopback-audio IPC.

## Development

This package has its own `node_modules` — run `npm install` in `electron/` first
(downloads Electron, ~100 MB).

```powershell
# from the repo root, with the Next dev server running on :3000
npm --prefix electron run dev

# point the shell at a different server
$env:CONTRACTOR_AI_URL = 'http://localhost:3109'; npm --prefix electron run dev
```

`CONTRACTOR_AI_URL` overrides the URL the shell loads. It is a **dev-only** convenience —
end users don't have it set (see below).

## IMPORTANT: production URL before shipping to end users

The shell falls back to `http://localhost:3000` when `CONTRACTOR_AI_URL` is unset.
**Environment variables do not exist on user machines** — an installed build with the
localhost fallback shows the connection-error screen forever. Before cutting an
end-user release, flip the fallback literal in `main.js` to the deployed https URL:

```diff
-const APP_URL = process.env.CONTRACTOR_AI_URL || "http://localhost:3000";
+const APP_URL = process.env.CONTRACTOR_AI_URL || "https://app.contractorai.example.com";
```

(One line. Keep the env override — it's still how devs point local builds elsewhere.)

## Building the installer

```powershell
npm --prefix electron run build
```

Output lands in `electron/dist/` (`ContractorAI Setup <version>.exe`, NSIS installer).
The build is currently **unsigned**: Windows SmartScreen shows an "unrecognized app"
warning on install — users click "More info" → "Run anyway". Auto-updates still
download and apply normally on unsigned builds.

If `build/icon.ico` / `build/icon.png` exist, electron-builder picks them up
automatically; without them it uses the default Electron icon (no config needed).

## Auto-update

The app uses `electron-updater` with the GitHub provider (`publish` block in
`package.json`, pointing at `Antigro09/JDLewisAI` releases). On launch — and every
4 hours after — a packaged app checks the latest GitHub release's `latest.yml`,
downloads a newer installer in the background, and installs it on quit.

- Update checks only run in **packaged** builds (`app.isPackaged`); `npm run dev`
  never checks (unpackaged runs have no `app-update.yml` and would throw).
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
