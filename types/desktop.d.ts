/**
 * The `window.contractorAI` bridge exposed by the Electron shell's preload
 * script (electron/preload.js). Everything is optional: in a plain browser
 * the object is absent entirely, and shell versions in the field may predate
 * newer namespaces.
 */
declare global {
  interface Window {
    contractorAI?: {
      meetings?: {
        startMeetingAudio?: (payload: Record<string, unknown>) => Promise<unknown>;
        stopMeetingAudio?: (payload: Record<string, unknown>) => Promise<unknown>;
        enableLoopbackAudio?: () => Promise<unknown>;
        disableLoopbackAudio?: () => Promise<unknown>;
        startDetection?: () => Promise<unknown>;
        stopDetection?: () => Promise<unknown>;
        onDetected?: (callback: (payload: unknown) => void) => () => void;
      };
      desktop?: {
        isDesktop?: boolean;
        getAppInfo?: () => Promise<{ version: string }>;
        setTitleBarOverlay?: (opts: {
          color: string;
          symbolColor: string;
        }) => Promise<{ applied: boolean }>;
        registerDeviceToken?: (token: string) => Promise<{ stored: boolean }>;
        /** A staged update waiting for the user, or null. */
        getUpdateStatus?: () => Promise<{ version: string | null }>;
        /** Quits and installs the staged update (restarts the app). */
        installUpdate?: () => Promise<{ installing: boolean; dev?: boolean }>;
        /** Fires when a background download finishes. Returns an unsubscriber. */
        onUpdateReady?: (
          callback: (payload: { version: string }) => void,
        ) => () => void;
      };
    };
  }
}

export {};
