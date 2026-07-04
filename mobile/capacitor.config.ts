import type { CapacitorConfig } from "@capacitor/cli";

// Read at `npx cap sync` time and BAKED into the native projects.
// Default reaches the host machine's `next dev` from the Android emulator.
const serverUrl = process.env.CAP_SERVER_URL || "http://10.0.2.2:3000";

if (!process.env.CAP_SERVER_URL) {
  console.warn("[capacitor] CAP_SERVER_URL not set — using dev default " + serverUrl);
}

const config: CapacitorConfig = {
  appId: "com.contractorai.mobile",
  appName: "ContractorAI",
  webDir: "www",
  server: { url: serverUrl, cleartext: serverUrl.startsWith("http://") },
};

export default config;
