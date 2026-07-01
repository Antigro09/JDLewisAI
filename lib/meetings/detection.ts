export type BrowserSignal = {
  title?: string;
  url?: string;
  audible?: boolean;
  hasWebRtc?: boolean;
};

export type DetectorInput = {
  processes?: string[];
  activeWindowTitle?: string;
  browserTabs?: BrowserSignal[];
  microphoneActive?: boolean;
  speakerActive?: boolean;
  calendarLikely?: boolean;
};

export type DetectionResult = {
  likely: boolean;
  confidence: number;
  app?: string;
  reasons: string[];
};

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

const MEETING_DOMAINS = [
  "meet.google.com",
  "teams.microsoft.com",
  "zoom.us",
  "webex.com",
  "slack.com",
  "discord.com",
];

function includesAny(value: string | undefined, terms: string[]) {
  const normalized = (value ?? "").toLowerCase();
  return terms.find((t) => normalized.includes(t));
}

export function scoreMeetingDetection(input: DetectorInput): DetectionResult {
  let score = 0;
  const reasons: string[] = [];
  let app: string | undefined;

  const processHit = (input.processes ?? [])
    .map((p) => includesAny(p, MEETING_APPS))
    .find(Boolean);
  if (processHit) {
    score += 25;
    app = processHit;
    reasons.push(`Meeting process detected: ${processHit}`);
  }

  const windowHit = includesAny(input.activeWindowTitle, [
    ...MEETING_APPS,
    "meeting",
    "call",
    "huddle",
  ]);
  if (windowHit) {
    score += 20;
    app = app ?? windowHit;
    reasons.push(`Active window looks like a meeting: ${windowHit}`);
  }

  const tab = (input.browserTabs ?? []).find(
    (t) =>
      includesAny(t.url, MEETING_DOMAINS) ||
      includesAny(t.title, ["meet", "meeting", "call", "huddle"]) ||
      t.hasWebRtc,
  );
  if (tab) {
    score += tab.hasWebRtc ? 35 : 22;
    app = app ?? includesAny(tab.url, MEETING_DOMAINS) ?? "browser meeting";
    reasons.push(tab.hasWebRtc ? "Active WebRTC tab detected" : "Meeting browser tab detected");
    if (tab.audible) {
      score += 8;
      reasons.push("Meeting tab is producing audio");
    }
  }

  if (input.microphoneActive) {
    score += 18;
    reasons.push("Microphone is active");
  }
  if (input.speakerActive) {
    score += 12;
    reasons.push("Speaker output is active");
  }
  if (input.calendarLikely) {
    score += 10;
    reasons.push("Calendar context suggests a meeting");
  }

  const confidence = Math.max(0, Math.min(100, score));
  return {
    likely: confidence >= 70,
    confidence,
    app,
    reasons,
  };
}
