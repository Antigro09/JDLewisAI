import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Writes electron/app-config.json — the build-time config baked into the
 * packaged exe (the runtime cannot read env vars on client machines).
 * Run before `electron-builder`; CI feeds the values from repo secrets.
 *
 *   DESKTOP_APP_URL      required — hosted origin the shell loads
 *   DESKTOP_GATE_SECRET  optional — handshake for the desktop-only gate
 *
 * The output contains a secret: it is gitignored and must stay that way.
 */
const appUrl = (process.env.DESKTOP_APP_URL || "").trim();
const gateSecret = (process.env.DESKTOP_GATE_SECRET || "").trim();

if (!appUrl) {
  console.error("write-app-config: DESKTOP_APP_URL is required");
  process.exit(1);
}
try {
  const parsed = new URL(appUrl);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("not http(s)");
} catch {
  console.error(`write-app-config: DESKTOP_APP_URL is not a valid URL: ${appUrl}`);
  process.exit(1);
}

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "app-config.json",
);
writeFileSync(out, `${JSON.stringify({ appUrl, gateSecret }, null, 2)}\n`);
console.log(`write-app-config: wrote ${out} (appUrl=${appUrl})`);
