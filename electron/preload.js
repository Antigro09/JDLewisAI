const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("contractorAI", {
  meetings: {
    startDetection: () => ipcRenderer.invoke("detect:start"),
    stopDetection: () => ipcRenderer.invoke("detect:stop"),
    listDevices: () => ipcRenderer.invoke("audio:listDevices"),
    startMeetingAudio: (payload) => ipcRenderer.invoke("audio:startMeeting", payload),
    stopMeetingAudio: (payload) => ipcRenderer.invoke("audio:stopMeeting", payload),
    enableLoopbackAudio: () => ipcRenderer.invoke("audio:enableLoopback"),
    disableLoopbackAudio: () => ipcRenderer.invoke("audio:disableLoopback"),
    onDetected: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("meeting.detected", listener);
      return () => ipcRenderer.removeListener("meeting.detected", listener);
    },
    onDeviceChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("audio:deviceChanged", listener);
      return () => ipcRenderer.removeListener("audio:deviceChanged", listener);
    },
  },
  desktop: {
    isDesktop: true,
    getAppInfo: () => ipcRenderer.invoke("app:getInfo"),
    setTitleBarOverlay: (opts) => ipcRenderer.invoke("window:setTitleBarOverlay", opts),
    registerDeviceToken: (token) => ipcRenderer.invoke("update:setDeviceToken", String(token)),
    // Updates download quietly but only install when the user asks.
    getUpdateStatus: () => ipcRenderer.invoke("update:status"),
    installUpdate: () => ipcRenderer.invoke("update:install"),
    onUpdateReady: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("update:ready", listener);
      return () => ipcRenderer.removeListener("update:ready", listener);
    },
  },
});

// Mark the document before hydration so the web app renders its desktop
// titlebar from first paint (html has suppressHydrationWarning — same
// mechanism next-themes relies on). Preload can run before documentElement
// exists, hence the fallback listener.
const markDesktopShell = () => document.documentElement?.classList.add("desktop-shell");
if (document.documentElement) {
  markDesktopShell();
} else {
  document.addEventListener("DOMContentLoaded", markDesktopShell);
}
