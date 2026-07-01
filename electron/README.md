# ContractorAI Desktop

Electron package for the downloadable ContractorAI app.

## Current scope

- Loads the existing ContractorAI web app from `CONTRACTOR_AI_URL` or `http://localhost:3000`.
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
