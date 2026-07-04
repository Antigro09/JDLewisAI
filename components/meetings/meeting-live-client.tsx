"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  ListChecks,
  Mic,
  MicOff,
  RefreshCw,
  Send,
  ShieldAlert,
  Square,
  Users,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Badge, Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

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
    };
  }
}

type Bundle = {
  meeting: {
    id: string;
    title: string;
    status: string;
    summary: string | null;
    minutesMarkdown: string | null;
    state?: {
      currentProject?: string;
      currentTopic?: string;
      currentSpeaker?: string;
      currentDiscussion?: string;
      meetingStage?: string;
      confidence?: number;
      categories?: string[];
      relatedKnowledge?: { label: string; detail?: string; refType?: string; source?: string }[];
    } | null;
  };
  project: { name: string } | null;
  participants: { id: string; displayName: string; speakerLabel: string; confidence: number }[];
  segments: {
    id: string;
    speakerLabel: string;
    speakerName: string | null;
    text: string;
    startMs: number;
    confidence: number;
  }[];
  actionItems: {
    id: string;
    ownerName: string | null;
    task: string;
    priority: string;
    dueDate: string | null;
    status: string;
    confidence: number;
  }[];
  decisions: { id: string; decision: string; approvedBy: string | null; confidence: number }[];
  risks: {
    id: string;
    riskType: string;
    severity: string;
    description: string;
    mitigation: string | null;
    confidence: number;
  }[];
  events: { id: string; type: string; title: string; confidence: number }[];
};

function confidenceClass(value: number) {
  if (value >= 80) return "text-green-600 dark:text-green-400";
  if (value >= 55) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function downloadName(title: string, fallback: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
}

function downsample(input: Float32Array, inputRate: number, outputRate: number) {
  if (outputRate === inputRate) return input;
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function floatToPcm16(input: Float32Array) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

export function MeetingLiveClient({
  initialBundle,
  googleConnected = false,
  speakerProfiles = [],
  autoStart = false,
}: {
  initialBundle: Bundle;
  googleConnected?: boolean;
  speakerProfiles?: { id: string; displayName: string }[];
  autoStart?: boolean;
}) {
  const [bundle, setBundle] = useState(initialBundle);
  const [speakerLabel, setSpeakerLabel] = useState("Speaker A");
  const [speakerName, setSpeakerName] = useState("");
  const [assignNames, setAssignNames] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [systemAudioActive, setSystemAudioActive] = useState(false);
  const [sentAudioBytes, setSentAudioBytes] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const mixerRef = useRef<GainNode | null>(null);
  const captureNodesRef = useRef<MediaStreamAudioSourceNode[]>([]);
  const captureStreamsRef = useRef<MediaStream[]>([]);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const flushingRef = useRef(false);
  const liveActiveRef = useRef(false);

  async function refresh() {
    const res = await fetch(`/api/meetings/${bundle.meeting.id}`, { cache: "no-store" });
    if (!res.ok) return;
    setBundle((await res.json()) as Bundle);
  }

  async function assignSpeaker(label: string) {
    const displayName = (assignNames[label] ?? "").trim();
    if (!displayName) return;
    setBusy(`speaker-${label}`);
    setError(null);
    try {
      const match = speakerProfiles.find(
        (p) => p.displayName.toLowerCase() === displayName.toLowerCase(),
      );
      const res = await fetch(`/api/meetings/${bundle.meeting.id}/speakers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speakerLabel: label, displayName, profileId: match?.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not assign speaker");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign speaker");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    setDesktopAvailable(Boolean(window.contractorAI?.meetings));
    const off = window.contractorAI?.meetings?.onDetected?.((payload) => {
      setLiveStatus(`Desktop meeting signal: ${JSON.stringify(payload)}`);
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    if (!["active", "processing"].includes(bundle.meeting.status)) return;
    const t = window.setInterval(() => refresh().catch(() => {}), 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.meeting.id, bundle.meeting.status]);

  // Automatic note-taking: while a meeting is being transcribed, periodically run
  // the full analysis so action items, decisions, risks and notes populate on
  // their own — no one has to click "Analyze". Runs silently (doesn't block the
  // UI) and only when enough new transcript has arrived.
  const segCountRef = useRef(bundle.segments.length);
  useEffect(() => {
    segCountRef.current = bundle.segments.length;
  }, [bundle.segments.length]);
  const lastAutoAnalyzedRef = useRef(0);
  const autoAnalyzingRef = useRef(false);
  useEffect(() => {
    async function autoAnalyze() {
      if (autoAnalyzingRef.current) return;
      autoAnalyzingRef.current = true;
      try {
        await fetch(`/api/meetings/${bundle.meeting.id}/analyze`, { method: "POST" });
        lastAutoAnalyzedRef.current = segCountRef.current;
        await refresh();
      } catch {
        // best-effort; will retry next interval
      } finally {
        autoAnalyzingRef.current = false;
      }
    }
    const t = window.setInterval(() => {
      if (!liveActiveRef.current) return;
      if (segCountRef.current - lastAutoAnalyzedRef.current < 4) return;
      void autoAnalyze();
    }, 120_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.meeting.id]);

  useEffect(() => {
    return () => {
      stopAllAudioCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-begin capture when opened from desktop auto-detect (?autostart=1).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    if (!["active", "processing"].includes(bundle.meeting.status)) return;
    autoStartedRef.current = true;
    void startLiveTranscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  async function flushAudioQueue() {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (liveActiveRef.current && audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift();
        if (!chunk) continue;
        const res = await fetch(`/api/meetings/${bundle.meeting.id}/stream/audio`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: chunk,
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || "Audio streaming failed");
        }
        setSentAudioBytes((n) => n + chunk.byteLength);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audio streaming failed");
      liveActiveRef.current = false;
      stopAllAudioCapture();
    } finally {
      flushingRef.current = false;
      if (liveActiveRef.current && audioQueueRef.current.length > 0) {
        void flushAudioQueue();
      }
    }
  }

  function ensureAudioGraph() {
    if (audioCtxRef.current && mixerRef.current && processorRef.current) {
      return {
        audioCtx: audioCtxRef.current,
        mixer: mixerRef.current,
      };
    }
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error("Web Audio is not supported in this browser.");
    const audioCtx = new Ctx();
    const mixer = audioCtx.createGain();
    mixer.gain.value = 0.8;
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    const inputRate = audioCtx.sampleRate;

    processor.onaudioprocess = (event) => {
      if (!liveActiveRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = floatToPcm16(downsample(input, inputRate, 16000));
      const buffer = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
      audioQueueRef.current.push(buffer);
      if (audioQueueRef.current.length > 80) {
        audioQueueRef.current.splice(0, audioQueueRef.current.length - 80);
      }
      void flushAudioQueue();
    };

    mixer.connect(processor);
    // ScriptProcessor only runs while connected. The output buffer remains silent.
    processor.connect(audioCtx.destination);
    audioCtxRef.current = audioCtx;
    mixerRef.current = mixer;
    processorRef.current = processor;
    return { audioCtx, mixer };
  }

  function addStreamToMixer(stream: MediaStream) {
    const { audioCtx, mixer } = ensureAudioGraph();
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) throw new Error("No audio track was available.");
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(mixer);
    captureNodesRef.current.push(source);
    captureStreamsRef.current.push(stream);
  }

  async function startMicrophoneCapture() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not supported in this browser.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    addStreamToMixer(stream);
    setMicActive(true);
  }

  async function startSystemAudioCapture() {
    if (!window.contractorAI?.meetings?.enableLoopbackAudio) return false;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Desktop loopback capture is not supported in this runtime.");
    }

    await window.contractorAI.meetings.enableLoopbackAudio();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
      }
      addStreamToMixer(stream);
      setSystemAudioActive(true);
      return true;
    } finally {
      await window.contractorAI.meetings.disableLoopbackAudio?.();
    }
  }

  function stopAllAudioCapture() {
    processorRef.current?.disconnect();
    processorRef.current = null;
    mixerRef.current?.disconnect();
    mixerRef.current = null;
    for (const node of captureNodesRef.current) node.disconnect();
    captureNodesRef.current = [];
    for (const stream of captureStreamsRef.current) {
      stream.getTracks().forEach((track) => track.stop());
    }
    captureStreamsRef.current = [];
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    audioQueueRef.current = [];
    setMicActive(false);
    setSystemAudioActive(false);
  }

  async function addSegment() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy("segment");
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${bundle.meeting.id}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speakerLabel,
          speakerName: speakerName.trim() || undefined,
          text: content,
          startMs: bundle.segments.length * 30_000,
          confidence: 90,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not add transcript segment");
      setText("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add transcript segment");
    } finally {
      setBusy(null);
    }
  }

  async function runAction(kind: "analyze" | "end") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${bundle.meeting.id}/${kind}`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `${kind} failed`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${kind} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function startLiveTranscription() {
    if (busy) return;
    setBusy("stream-start");
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${bundle.meeting.id}/stream/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "assemblyai", sampleRate: 16000, channels: 1 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not start live transcription");
      liveActiveRef.current = true;
      setSentAudioBytes(0);
      await startMicrophoneCapture();
      let status = "Microphone capture is streaming to live transcription.";
      if (desktopAvailable) {
        try {
          const systemStarted = await startSystemAudioCapture();
          if (systemStarted) {
            status = "Microphone and desktop system audio are streaming to live transcription.";
          }
        } catch (systemErr) {
          status = `Microphone is streaming. Desktop audio was not started: ${
            systemErr instanceof Error ? systemErr.message : "unknown error"
          }`;
        }
      }
      setLiveStatus(status);
      await window.contractorAI?.meetings?.startMeetingAudio?.({
        meetingId: bundle.meeting.id,
        sampleRate: 16000,
        channels: 1,
      });
    } catch (err) {
      liveActiveRef.current = false;
      stopAllAudioCapture();
      await fetch(`/api/meetings/${bundle.meeting.id}/stream/stop`, {
        method: "POST",
      }).catch(() => {});
      setError(err instanceof Error ? err.message : "Could not start live transcription");
    } finally {
      setBusy(null);
    }
  }

  async function stopLiveTranscription() {
    if (busy) return;
    setBusy("stream-stop");
    setError(null);
    try {
      liveActiveRef.current = false;
      stopAllAudioCapture();
      await window.contractorAI?.meetings?.stopMeetingAudio?.({ meetingId: bundle.meeting.id });
      const res = await fetch(`/api/meetings/${bundle.meeting.id}/stream/stop`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not stop live transcription");
      setLiveStatus("Live transcription session stopped.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop live transcription");
    } finally {
      setBusy(null);
    }
  }

  async function exportFormat(
    format: "markdown" | "html" | "email" | "json" | "pdf" | "gdoc" | "gsheet",
  ) {
    setBusy(`export-${format}`);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${bundle.meeting.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      if (format === "pdf") {
        const json = await res.json();
        if (json.printUrl) window.open(json.printUrl, "_blank", "noreferrer");
        return;
      }
      if (format === "gdoc" || format === "gsheet") {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Google export failed");
        if (json.link) window.open(json.link, "_blank", "noreferrer");
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Export failed");
      }
      const blob = await res.blob();
      const ext = format === "markdown" ? "md" : format === "email" ? "txt" : format;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${downloadName(bundle.meeting.title, "meeting")}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  const state = bundle.meeting.state;
  const canEnd = bundle.meeting.status === "active" || bundle.meeting.status === "ended";
  const knownSpeakers = Array.from(
    new Set(["Speaker A", "Speaker B", "Speaker C", ...bundle.participants.map((p) => p.speakerLabel)]),
  );

  // Distinct diarization labels actually present, with any resolved name.
  const detectedSpeakers = Array.from(
    new Set([
      ...bundle.segments.map((s) => s.speakerLabel),
      ...bundle.participants.map((p) => p.speakerLabel),
    ]),
  )
    .filter(Boolean)
    .sort()
    .map((label) => {
      const named = bundle.segments.find((s) => s.speakerLabel === label && s.speakerName)
        ?.speakerName;
      const participant = bundle.participants.find((p) => p.speakerLabel === label);
      return { label, name: named || participant?.displayName || null };
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm text-neutral-500 dark:text-neutral-400">
            {bundle.project?.name ?? "No project assigned"}
          </div>
          <h1 className="break-words text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            {bundle.meeting.title}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => refresh()} disabled={Boolean(busy)}>
            <RefreshCw size={16} />
            Refresh
          </Button>
          <Button variant="secondary" onClick={() => runAction("analyze")} disabled={Boolean(busy)}>
            <ListChecks size={16} />
            Analyze
          </Button>
          <Button variant="secondary" onClick={startLiveTranscription} disabled={Boolean(busy)}>
            <Mic size={16} />
            Start live capture
          </Button>
          <Button variant="secondary" onClick={stopLiveTranscription} disabled={Boolean(busy)}>
            <MicOff size={16} />
            Stop capture
          </Button>
          {canEnd && (
            <Button onClick={() => runAction("end")} disabled={Boolean(busy)}>
              <Square size={14} />
              End & minutes
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
      {liveStatus && (
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
          {(micActive || systemAudioActive) && (
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
          )}
          {liveStatus}
          {micActive ? " Mic on." : ""}
          {systemAudioActive ? " System audio on." : ""}
          {micActive || systemAudioActive ? ` Sent ${(sentAudioBytes / 1024).toFixed(1)} KB.` : ""}
          {desktopAvailable
            ? " Desktop bridge detected."
            : " System audio capture requires the desktop bridge."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase text-neutral-400">Stage</div>
          <div className="mt-1 font-medium text-neutral-900 dark:text-neutral-100">
            {state?.meetingStage ?? bundle.meeting.status}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-neutral-400">Topic</div>
          <div className="mt-1 font-medium text-neutral-900 dark:text-neutral-100">
            {state?.currentTopic ?? "Not detected"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-neutral-400">Speaker</div>
          <div className="mt-1 font-medium text-neutral-900 dark:text-neutral-100">
            {state?.currentSpeaker ?? "Listening"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-neutral-400">Confidence</div>
          <div
            className={cn(
              "mt-1 font-medium",
              confidenceClass(state?.confidence ?? 0),
            )}
          >
            {state?.confidence ?? 0}%
          </div>
        </Card>
      </div>

      {(state?.categories?.length || state?.relatedKnowledge?.length) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {state?.categories?.length ? (
            <Card className="p-4">
              <div className="text-xs uppercase text-neutral-400">Detected topics</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {state.categories.map((c) => (
                  <span
                    key={c}
                    className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  >
                    {c.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </Card>
          ) : null}
          {state?.relatedKnowledge?.length ? (
            <Card className="p-4">
              <div className="text-xs uppercase text-neutral-400">Surfaced company knowledge</div>
              <ul className="mt-2 space-y-1 text-sm text-neutral-700 dark:text-neutral-200">
                {state.relatedKnowledge.slice(0, 6).map((k, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="mt-1 text-neutral-400">📎</span>
                    <span>
                      {k.label}
                      {k.refType && (
                        <span className="ml-1 text-xs text-neutral-400">
                          · {k.refType.replace(/_/g, " ")}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr),minmax(360px,0.8fr)]">
        <div className="space-y-5">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-medium text-neutral-900 dark:text-neutral-100">
                Transcript
              </h2>
              <Badge className="bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {bundle.segments.length} turns
              </Badge>
            </div>
            <div className="max-h-[440px] space-y-3 overflow-y-auto pr-1">
              {bundle.segments.length === 0 && (
                <p className="text-sm text-neutral-500">No transcript yet.</p>
              )}
              {bundle.segments.map((s) => (
                <div key={s.id} className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate font-medium text-brand-700 dark:text-brand-300">
                      {s.speakerName || s.speakerLabel}
                    </span>
                    <span className={cn("shrink-0", confidenceClass(s.confidence))}>
                      {s.confidence}%
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-100">
                    {s.text}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-medium text-neutral-900 dark:text-neutral-100">
              Add transcript turn
            </h2>
            <div className="grid gap-3 sm:grid-cols-[140px,1fr]">
              <div>
                <Label>Speaker</Label>
                <Select value={speakerLabel} onChange={(e) => setSpeakerLabel(e.target.value)} className="w-full">
                  {knownSpeakers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Speaker name</Label>
                <Input
                  value={speakerName}
                  onChange={(e) => setSpeakerName(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <Textarea
              rows={4}
              className="mt-3"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste or dictate a finalized transcript turn..."
            />
            <div className="mt-3 flex justify-end">
              <Button onClick={addSegment} disabled={!text.trim() || Boolean(busy)}>
                <Send size={16} />
                Add turn
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
              <ListChecks size={17} />
              Action items
            </h2>
            <div className="space-y-2">
              {bundle.actionItems.length === 0 && (
                <p className="text-sm text-neutral-500">None captured.</p>
              )}
              {bundle.actionItems.map((a) => (
                <div key={a.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">
                    {a.task}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {a.ownerName ?? "Unassigned"} · {a.dueDate ?? "TBD"} · {a.priority}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
              <CheckCircle2 size={17} />
              Decisions
            </h2>
            <div className="space-y-2">
              {bundle.decisions.length === 0 && (
                <p className="text-sm text-neutral-500">None captured.</p>
              )}
              {bundle.decisions.map((d) => (
                <div key={d.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">
                    {d.decision}
                  </div>
                  {d.approvedBy && (
                    <div className="mt-1 text-xs text-neutral-500">Approved by {d.approvedBy}</div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
              <ShieldAlert size={17} />
              Risks
            </h2>
            <div className="space-y-2">
              {bundle.risks.length === 0 && (
                <p className="text-sm text-neutral-500">None captured.</p>
              )}
              {bundle.risks.map((r) => (
                <div key={r.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <div className="flex items-center gap-2">
                    {r.severity === "high" && <AlertTriangle size={15} className="text-red-600" />}
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">
                      {r.description}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {r.riskType} · {r.severity}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
              <Users size={17} />
              Speakers
            </h2>
            <p className="mb-3 text-xs text-neutral-400">
              Name each detected speaker once — the name is written onto the transcript and
              remembered for your company.
            </p>
            {detectedSpeakers.length === 0 ? (
              <p className="text-sm text-neutral-500">No speakers detected yet.</p>
            ) : (
              <div className="space-y-2">
                {detectedSpeakers.map((s) => (
                  <div key={s.label} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-neutral-500">{s.label}</span>
                    <input
                      list="speaker-profiles"
                      defaultValue={s.name ?? ""}
                      placeholder="Assign a name"
                      onChange={(e) =>
                        setAssignNames((prev) => ({ ...prev, [s.label]: e.target.value }))
                      }
                      className="h-8 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === `speaker-${s.label}`}
                      onClick={() => assignSpeaker(s.label)}
                    >
                      Save
                    </Button>
                  </div>
                ))}
                <datalist id="speaker-profiles">
                  {speakerProfiles.map((p) => (
                    <option key={p.id} value={p.displayName} />
                  ))}
                </datalist>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
              <Download size={17} />
              Export
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {(["gdoc", "gsheet", "markdown", "html", "email", "json", "pdf"] as const).map((f) => (
                <Button
                  key={f}
                  variant="secondary"
                  size="sm"
                  onClick={() => exportFormat(f)}
                  disabled={Boolean(busy)}
                >
                  {f === "gdoc"
                    ? "Google Doc"
                    : f === "gsheet"
                      ? "Actions Sheet"
                      : f.toUpperCase()}
                </Button>
              ))}
            </div>
            {!googleConnected && (
              <p className="mt-2 text-xs text-neutral-400">
                Connect Google in Settings to export minutes to Docs and action items to Sheets.
              </p>
            )}
            <Link
              href={`/print/meeting-minutes/${bundle.meeting.id}`}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              <FileText size={15} />
              Print minutes
            </Link>
          </Card>
        </div>
      </div>

      {bundle.meeting.minutesMarkdown && (
        <Card className="p-5">
          <h2 className="mb-3 font-medium text-neutral-900 dark:text-neutral-100">
            Meeting minutes
          </h2>
          <Markdown content={bundle.meeting.minutesMarkdown} />
        </Card>
      )}
    </div>
  );
}
