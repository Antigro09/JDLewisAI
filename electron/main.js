const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile } = require("node:child_process");
const path = require("node:path");

const APP_URL = process.env.CONTRACTOR_AI_URL || "http://localhost:3000";
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(APP_URL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin !== new URL(APP_URL).origin) {
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
      const screen = sources[0];
      if (!screen) {
        callback({});
        return;
      }
      callback(
        desktopAudioEnabled
          ? { video: screen, audio: "loopback" }
          : { video: screen },
      );
    } catch {
      callback({});
    }
  }, { useSystemPicker: false });
}

app.whenReady().then(() => {
  configureDisplayMediaCapture();
  createWindow();
  if (app.isPackaged) {
    // Without a listener, electron-updater's async "error" emits (e.g. a
    // download failing mid-flight) become uncaught exceptions and crash the app.
    autoUpdater.on("error", () => {});
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 4 * 60 * 60 * 1000);
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
