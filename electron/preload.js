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
});
