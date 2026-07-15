const {
  app,
  BrowserWindow,
  Menu,
  desktopCapturer,
  dialog,
  ipcMain,
  safeStorage,
  screen,
  session,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// ---- Build-time configuration -------------------------------------------
// Packaged builds read app-config.json (written by scripts/write-app-config.mjs
// at build time — client machines have no env vars). Dev falls back to
// CONTRACTOR_AI_URL / localhost. A packaged build without config must fail
// loudly rather than silently loading localhost.
function loadAppConfig() {
  try {
    return require("./app-config.json");
  } catch {
    return null;
  }
}
const cfg = loadAppConfig();
const APP_URL =
  (app.isPackaged
    ? cfg?.appUrl
    : process.env.CONTRACTOR_AI_URL || cfg?.appUrl) || "http://localhost:3000";
const GATE_SECRET = cfg?.gateSecret || process.env.DESKTOP_GATE_SECRET || "";
const ORIGIN = new URL(APP_URL).origin;

// Must match the web app's titlebar (components/desktop-titlebar.tsx): hex
// renderings of the light-theme --ember-surface / --ember-text oklch tokens
// in app/globals.css. The renderer re-syncs these on theme change.
const TITLEBAR_HEIGHT = 40;
const OVERLAY_DEFAULT = { color: "#fffdfb", symbolColor: "#281c17" };

let mainWindow = null;
let detectTimer = null;
let desktopAudioEnabled = false;

const MEETING_APPS = [
  "teams",
  "zoom",
  "discord",
  "slack",
  "webex",
  "gotomeeting",
  "ringcentral",
  "teamviewer",
];

function includesAny(value, terms) {
  const normalized = String(value || "").toLowerCase();
  return terms.find((term) => normalized.includes(term));
}

function scoreDetection({ processes = [], activeWindowTitle = "" }) {
  let confidence = 0;
  const reasons = [];
  let appName;
  const processHit = processes.map((p) => includesAny(p, MEETING_APPS)).find(Boolean);
  if (processHit) {
    confidence += 35;
    appName = processHit;
    reasons.push(`Meeting process detected: ${processHit}`);
  }
  const windowHit = includesAny(activeWindowTitle, [
    ...MEETING_APPS,
    "meeting",
    "call",
    "huddle",
  ]);
  if (windowHit) {
    confidence += 25;
    appName = appName || windowHit;
    reasons.push(`Active meeting window detected: ${windowHit}`);
  }
  // Corroboration bonus: a meeting app process WITH a meeting-looking window
  // in the foreground is the strongest signal this detector can observe
  // (35 + 25 alone would sit at 60, below the 70 auto-start threshold — a
  // desktop meeting could otherwise never trigger). Single weak signals still
  // stay below the threshold.
  if (processHit && windowHit) {
    confidence += 10;
    reasons.push("Process and window signals corroborate");
  }
  return {
    likely: confidence >= 70,
    confidence: Math.min(100, confidence),
    app: appName,
    reasons,
  };
}

function listWindowsAndProcesses() {
  return new Promise((resolve) => {
    const script = [
      "Get-Process |",
      "Select-Object ProcessName,MainWindowTitle |",
      "ConvertTo-Json -Compress",
    ].join(" ");
    execFile("powershell.exe", ["-NoProfile", "-Command", script], (error, stdout) => {
      if (error) {
        resolve({ processes: [], activeWindowTitle: "" });
        return;
      }
      try {
        const parsed = JSON.parse(stdout || "[]");
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        resolve({
          processes: rows.map((r) => r.ProcessName).filter(Boolean),
          activeWindowTitle:
            rows.map((r) => r.MainWindowTitle).find((title) => String(title || "").trim()) ||
            "",
        });
      } catch {
        resolve({ processes: [], activeWindowTitle: "" });
      }
    });
  });
}

async function runDetectionOnce() {
  const snapshot = await listWindowsAndProcesses();
  const result = scoreDetection(snapshot);
  if (result.likely && mainWindow) {
    mainWindow.webContents.send("meeting.detected", result);
  }
  return result;
}

// ---- Window-state persistence --------------------------------------------
function windowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(windowStatePath(), "utf8"));
    if (typeof state.width !== "number" || typeof state.height !== "number") {
      return null;
    }
    // Discard positions that no longer intersect a live display (unplugged
    // monitor) so the window can't restore off-screen.
    if (typeof state.x === "number" && typeof state.y === "number") {
      const wa = screen.getDisplayMatching(state).workArea;
      const visible =
        state.x < wa.x + wa.width &&
        state.x + state.width > wa.x &&
        state.y < wa.y + wa.height &&
        state.y + state.height > wa.y;
      if (!visible) {
        delete state.x;
        delete state.y;
      }
    }
    return state;
  } catch {
    return null;
  }
}

let saveStateTimer = null;
function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    fs.writeFileSync(
      windowStatePath(),
      JSON.stringify({ ...bounds, isMaximized: mainWindow.isMaximized() }),
    );
  } catch {
    // Best-effort; never break the app over window-state persistence.
  }
}
function saveWindowStateDebounced() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveWindowState, 400);
}

// ---- Device token (license-gated updates) ---------------------------------
// Minted by the web app after sign-in (see components/desktop-bridge.tsx),
// stored encrypted at rest, attached to update checks so the proxy can apply
// the company's major-version entitlement.
function deviceTokenPath() {
  return path.join(app.getPath("userData"), "device-token.dat");
}

let deviceToken = "";

function loadDeviceToken() {
  try {
    const buf = fs.readFileSync(deviceTokenPath());
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
  } catch {
    // Missing/corrupt token file — updates continue unentitled.
  }
  return "";
}

function storeDeviceToken(token) {
  deviceToken = String(token || "");
  try {
    if (deviceToken && safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(deviceTokenPath(), safeStorage.encryptString(deviceToken));
    }
  } catch {
    // In-memory token still applies for this run.
  }
  applyUpdaterHeaders();
}

function applyUpdaterHeaders() {
  autoUpdater.requestHeaders = {
    ...(GATE_SECRET ? { "x-desktop-key": GATE_SECRET } : {}),
    "x-desktop-version": app.getVersion(),
    // Never "Authorization": electron-updater re-sends these headers on the
    // 302 to signed storage, and S3 rejects signed-URL + Authorization.
    ...(deviceToken ? { "x-device-token": deviceToken } : {}),
  };
}

// ---- Staged update (installed only when the user asks) --------------------
// Version of a downloaded-and-waiting update, or "" when none. The renderer
// both listens for the event and polls once on mount (update:status), so a
// build that finishes downloading before the UI is ready is never missed.
let pendingUpdate = "";

function setPendingUpdate(version) {
  pendingUpdate = version;
  if (!version || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("update:ready", { version });
}

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state?.width ?? 1440,
    height: state?.height ?? 960,
    x: state?.x,
    y: state?.y,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    // Professional chrome: no native titlebar or menu bar. The web app draws
    // a branded bar (components/desktop-titlebar.tsx); the OS overlays native
    // caption buttons on it, keeping Win11 Snap Layouts working.
    titleBarStyle: "hidden",
    titleBarOverlay: { ...OVERLAY_DEFAULT, height: TITLEBAR_HEIGHT },
    // Matches the titlebar/light theme so launch doesn't flash white.
    backgroundColor: OVERLAY_DEFAULT.color,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (state?.isMaximized) mainWindow.maximize();
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("resize", saveWindowStateDebounced);
  mainWindow.on("move", saveWindowStateDebounced);
  mainWindow.on("close", saveWindowState);
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = String(input.key || "").toLowerCase();
    // Menu removal drops the default accelerators; restore the useful ones.
    if ((input.control && key === "r") || key === "f5") {
      mainWindow.webContents.reload();
      event.preventDefault();
    } else if (key === "f12" && !app.isPackaged) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  mainWindow.loadURL(APP_URL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin !== ORIGIN) {
        shell.openExternal(url);
        return { action: "deny" };
      }
    } catch {
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ERR_ABORTED */) return;
    mainWindow.loadFile(path.join(__dirname, "error.html"), {
      query: { url: APP_URL, code: String(code), desc },
    });
  });
}

function configureDisplayMediaCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });
      const screenSource = sources[0];
      if (!screenSource) {
        callback({});
        return;
      }
      callback(
        desktopAudioEnabled
          ? { video: screenSource, audio: "loopback" }
          : { video: screenSource },
      );
    } catch {
      callback({});
    }
  }, { useSystemPicker: false });
}

app.whenReady().then(() => {
  if (app.isPackaged && !cfg?.appUrl) {
    dialog.showErrorBox(
      "ContractorAI",
      "This build is missing its app configuration. Please reinstall the application or contact support.",
    );
    app.quit();
    return;
  }

  // No File/Edit/View menu bar (macOS keeps its menu for clipboard shortcuts).
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);

  // Desktop-only gate handshake: every request to the app origin carries the
  // shared secret so production middleware serves the shell and nothing else.
  if (GATE_SECRET) {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: [`${ORIGIN}/*`] },
      (details, callback) => {
        details.requestHeaders["x-desktop-key"] = GATE_SECRET;
        callback({ requestHeaders: details.requestHeaders });
      },
    );
  }

  configureDisplayMediaCapture();
  createWindow();

  if (app.isPackaged) {
    // License-gated update feed proxied by the hosted app; the installed
    // major is part of the URL so patches always flow without a token.
    const major = Number.parseInt(app.getVersion().split(".")[0], 10) || 0;
    autoUpdater.setFeedURL({
      provider: "generic",
      url: `${ORIGIN}/api/desktop/update/${major}`,
    });
    // Full-installer downloads only — the proxy 302s to signed storage and
    // does not implement blockmap/Range differential semantics.
    autoUpdater.disableDifferentialDownload = true;
    // User-initiated installs. The update downloads quietly in the background
    // so installing is instant, but nothing is ever installed behind the
    // user's back — not even on quit. Once a build is staged, the renderer
    // shows an unobtrusive "Update" button (components/desktop-titlebar.tsx)
    // and the user picks the moment to restart.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    deviceToken = loadDeviceToken();
    applyUpdaterHeaders();
    // Without a listener, electron-updater's async "error" emits (e.g. a
    // download failing mid-flight) become uncaught exceptions and crash the app.
    autoUpdater.on("error", () => {});
    autoUpdater.on("update-downloaded", (info) => {
      setPendingUpdate(info && info.version ? String(info.version) : "");
    });
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => {
      // Nothing to look for once a build is staged and waiting on the user.
      if (!pendingUpdate) autoUpdater.checkForUpdates().catch(() => {});
    }, 4 * 60 * 60 * 1000);
  } else if (process.env.CONTRACTOR_AI_FAKE_UPDATE) {
    // Dev-only: the updater is inert in unpackaged runs, so this lets the
    // update button be developed/verified against a real IPC round trip.
    // e.g. CONTRACTOR_AI_FAKE_UPDATE=9.9.9 npm run desktop:dev
    setPendingUpdate(String(process.env.CONTRACTOR_AI_FAKE_UPDATE));
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("detect:start", async () => {
  if (detectTimer) clearInterval(detectTimer);
  detectTimer = setInterval(() => runDetectionOnce().catch(() => {}), 5000);
  return runDetectionOnce();
});

ipcMain.handle("detect:stop", async () => {
  if (detectTimer) clearInterval(detectTimer);
  detectTimer = null;
  return { stopped: true };
});

ipcMain.handle("audio:listDevices", async () => ({
  input: [],
  output: [],
  status: "native-audio-adapter-required",
}));

ipcMain.handle("audio:startMeeting", async (_event, payload) => ({
  meetingId: payload && payload.meetingId,
  status: "desktop-loopback-enabled",
}));

ipcMain.handle("audio:stopMeeting", async (_event, payload) => ({
  meetingId: payload && payload.meetingId,
  status: "stopped",
}));

ipcMain.handle("audio:enableLoopback", async () => {
  desktopAudioEnabled = true;
  return { enabled: true };
});

ipcMain.handle("audio:disableLoopback", async () => {
  desktopAudioEnabled = false;
  return { enabled: false };
});

ipcMain.handle("app:getInfo", async () => ({ version: app.getVersion() }));

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
ipcMain.handle("window:setTitleBarOverlay", async (_event, opts) => {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) {
    return { applied: false };
  }
  const color = String(opts?.color ?? "");
  const symbolColor = String(opts?.symbolColor ?? "");
  if (!HEX_COLOR.test(color) || !HEX_COLOR.test(symbolColor)) {
    return { applied: false };
  }
  mainWindow.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
  return { applied: true };
});

ipcMain.handle("update:setDeviceToken", async (_event, token) => {
  storeDeviceToken(typeof token === "string" ? token : "");
  return { stored: Boolean(deviceToken) };
});

/** Polled by the renderer on mount — covers an update that finished
 * downloading before the UI existed (or before a page reload). */
ipcMain.handle("update:status", async () => ({
  version: pendingUpdate || null,
}));

/** The user pressed "Restart and update". Reply first, then quit + install:
 * quitAndInstall() tears the window down, so the IPC response has to flush. */
ipcMain.handle("update:install", async () => {
  if (!pendingUpdate) return { installing: false };
  if (!app.isPackaged) {
    // Dev simulation (CONTRACTOR_AI_FAKE_UPDATE): there's nothing to install.
    return { installing: false, dev: true };
  }
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall();
    } catch {
      // Nothing sensible to do — the app stays on the current version.
    }
  });
  return { installing: true };
});
