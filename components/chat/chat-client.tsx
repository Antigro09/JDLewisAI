"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Send,
  X,
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Zap,
  ExternalLink,
  AlertTriangle,
  Sparkles,
  Telescope,
  Globe,
  Pencil,
  Trash2,
  Check,
  Mic,
  AudioLines,
  Image as ImageIcon,
  Paperclip,
  FolderKanban,
  Plug,
  Blocks,
  FileText,
  ShieldCheck,
  Users,
  SlidersHorizontal,
  Square,
  Info,
  Copy,
  RotateCcw,
  Volume2,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Button, Card, Spinner, Textarea } from "@/components/ui";
import { EmberThinking } from "@/components/ember-thinking";
import { cn } from "@/lib/utils";
import { AI_CHAT_CAPTION } from "@/lib/legal/disclaimers";
import { REASONING_MODES } from "@/lib/claude/modes";
import { switchBranch, deleteMessage } from "@/app/(app)/chat/branch-actions";

export type ModelOption = {
  id: string;
  label: string;
  blurb: string;
  enabled: boolean;
  efforts: string[];
  adaptiveThinking: boolean;
  tier?: "primary" | "more";
};

export type PendingTool = {
  id: string;
  name: string;
  kind: "read" | "write";
  summary: string;
};

type Attachment = { name: string; mime: string; dataBase64: string };
type Activity = { tool: string; summary: string; link?: string; isError?: boolean };
type BranchInfo = { current: number; total: number; siblingIds: string[] };

type ChatMsg = {
  id?: string;
  parentId?: string | null;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  attachments?: { name: string; mime: string }[];
  activities?: Activity[];
  streaming?: boolean;
  branchInfo?: BranchInfo;
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Mirrors the file input's accept list (image/*,application/pdf,text/*,.csv,.json,.md)
// so dropped/pasted files admit exactly what the picker does.
function isAcceptedFile(f: File): boolean {
  const mime = f.type;
  if (mime.startsWith("image/") || mime === "application/pdf" || mime.startsWith("text/")) {
    return true;
  }
  // .csv/.json/.md can arrive with a non-text mime (application/json) or none.
  return /\.(csv|json|md)$/i.test(f.name);
}

/** Light markdown → plain text for text-to-speech. */
function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " (code block) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[#>\-*+]\s+/gm, "")
    .replace(/[*_~#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="mb-2.5 inline-block w-full rounded-[14px] bg-ember-subtle">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium text-ember-muted"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Brain size={14} className="text-ember-accent" />
        Thought process
      </button>
      {open && (
        <div className="whitespace-pre-wrap px-3 pb-3 text-[13px] text-ember-muted">
          {text}
        </div>
      )}
    </div>
  );
}

function ActivityList({ activities }: { activities?: Activity[] }) {
  if (!activities || activities.length === 0) return null;
  return (
    <div className="mb-2 space-y-1">
      {activities.map((a, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center gap-2.5 rounded-[14px] px-3 py-2 text-[13px]",
            a.isError
              ? "bg-ember-danger-bg text-ember-danger"
              : "bg-ember-subtle text-ember-muted",
          )}
        >
          {a.isError ? (
            <AlertTriangle size={14} className="shrink-0" />
          ) : (
            <Zap size={14} className="shrink-0 text-ember-accent" fill="currentColor" />
          )}
          <span className="flex-1">{a.summary}</span>
          {a.link && (
            <a
              href={a.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-ember-accent hover:underline"
            >
              Open <ExternalLink size={12} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

/** Short taglines to match the model-picker design. Falls back to `blurb`. */
const MODEL_TAGLINES: Record<string, string> = {
  "claude-fable-5": "For your toughest challenges",
  "claude-opus-4-8": "For complex tasks",
  "claude-sonnet-5": "Most efficient for everyday tasks",
  "claude-haiku-4-5-20251001": "Fastest for quick answers",
};

function fmtEffort(e: string) {
  if (!e) return "";
  if (e === "xhigh") return "Extra";
  return e[0].toUpperCase() + e.slice(1);
}

/** Small pill toggle used for Extended / Thinking. */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        on ? "bg-brand-600" : "bg-neutral-300 dark:bg-neutral-600",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </span>
  );
}

/** Compact model + effort picker (bottom-right of the composer), opens upward. */
function ModelPicker({
  models,
  model,
  effort,
  efforts,
  thinking,
  onModelChange,
  onEffortChange,
  onThinkingChange,
}: {
  models: ModelOption[];
  model: string;
  effort: string;
  efforts: string[];
  thinking: boolean;
  onModelChange: (id: string) => void;
  onEffortChange: (effort: string) => void;
  onThinkingChange: (thinking: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<"effort" | "more" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentModel = models.find((m) => m.id === model);
  const primary = models.filter((m) => (m.tier ?? "primary") !== "more");
  const more = models.filter((m) => m.tier === "more");
  // Models without granular effort levels (Haiku) show an "Extended" toggle
  // instead; it's on whenever a reasoning effort is set.
  const hasEfforts = efforts.length > 0;
  const extendedOn = Boolean(effort);
  const secondary = hasEfforts ? fmtEffort(effort) : extendedOn ? "Extended" : "";

  useEffect(() => {
    if (!open) return;
    // Close only on clicks outside the picker (including its flyouts, which are
    // rendered inside rootRef). Using contains() instead of a bare document
    // listener keeps the popover open when an effort/model option is clicked.
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useEffect(() => {
    if (!open) setSub(null);
  }, [open]);

  const rowCls =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700/60";

  function modelRow(m: ModelOption) {
    const selected = m.id === model;
    const tagline = MODEL_TAGLINES[m.id] ?? m.blurb;
    return (
      <button
        key={m.id}
        type="button"
        disabled={!m.enabled}
        onClick={() => {
          if (!m.enabled) return;
          onModelChange(m.id);
          setOpen(false);
        }}
        className={cn(
          "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left",
          m.enabled ? "hover:bg-neutral-100 dark:hover:bg-neutral-700/60" : "cursor-default",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm font-medium",
                m.enabled
                  ? "text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-400 dark:text-neutral-500",
              )}
            >
              {m.label}
            </span>
            {!m.enabled && (
              <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 dark:bg-neutral-700 dark:text-neutral-400">
                <Info size={11} />
                Currently unavailable
              </span>
            )}
          </div>
          <div
            className={cn(
              "mt-0.5 text-xs",
              m.enabled
                ? "text-neutral-500 dark:text-neutral-400"
                : "text-neutral-400 dark:text-neutral-600",
            )}
          >
            {tagline}
          </div>
        </div>
        {selected && (
          <Check size={16} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
        )}
      </button>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {currentModel?.label ?? model}
        {secondary && <span className="text-neutral-400">{secondary}</span>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn(
            // The trigger sits left of the mic/voice/send buttons, so neither
            // left-0 nor right-0 keeps a 288px panel on a 360px screen — anchor
            // to the viewport on mobile, to the trigger from sm: up.
            "fixed inset-x-4 bottom-24 z-20 max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800 sm:absolute sm:inset-x-auto sm:bottom-full sm:right-0 sm:mb-1 sm:w-72",
            // Scrolling would clip the effort / more-models flyouts (they hang
            // outside this panel), so only cap and scroll when no flyout is open.
            sub === null && "max-h-[60vh] overflow-y-auto",
          )}
        >
          {primary.map(modelRow)}

          <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />

          {hasEfforts ? (
            <button
              type="button"
              className={rowCls}
              onClick={() => setSub((s) => (s === "effort" ? null : "effort"))}
            >
              <span className="flex-1 font-medium">Effort</span>
              <span className="text-neutral-400">{fmtEffort(effort)}</span>
              <ChevronRight
                size={15}
                className={cn("text-neutral-400", sub === "effort" && "text-brand-500")}
              />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onEffortChange(extendedOn ? "" : "high")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700/60"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  Extended
                </div>
                <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  Always uses deep reasoning
                </div>
              </div>
              <Switch on={extendedOn} />
            </button>
          )}

          <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />

          <button
            type="button"
            className={rowCls}
            onClick={() => setSub((s) => (s === "more" ? null : "more"))}
          >
            <span className="flex-1 font-medium">More models</span>
            <ChevronRight
              size={15}
              className={cn("text-neutral-400", sub === "more" && "text-brand-500")}
            />
          </button>

          {/* Effort flyout */}
          {sub === "effort" && hasEfforts && (
            <div className="absolute bottom-full right-0 mb-2 max-h-[60vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800 sm:bottom-auto sm:right-full sm:top-0 sm:mb-0 sm:mr-2">
              <p className="px-3 pb-2 pt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Higher effort means more thorough responses, but takes longer and uses your
                limits faster.
              </p>
              {efforts.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onEffortChange(e)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-700/60"
                >
                  <span className="font-medium">{fmtEffort(e)}</span>
                  {e === "medium" && (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 dark:bg-neutral-700">
                      Default
                    </span>
                  )}
                  {e === "max" && <Info size={12} className="text-neutral-400" />}
                  <span className="flex-1" />
                  {effort === e && (
                    <Check size={16} className="text-brand-600 dark:text-brand-400" />
                  )}
                </button>
              ))}
              {currentModel?.adaptiveThinking && (
                <>
                  <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />
                  <button
                    type="button"
                    onClick={() => onThinkingChange(!thinking)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        Thinking
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                        Can think for more complex tasks
                      </div>
                    </div>
                    <Switch on={thinking} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* More models flyout */}
          {sub === "more" && (
            <div className="absolute bottom-full right-0 mb-2 max-h-[60vh] w-52 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800 sm:bottom-auto sm:right-full sm:top-0 sm:mb-0 sm:mr-2">
              {more.length === 0 ? (
                <div className="px-3 py-2 text-sm text-neutral-400">No additional models.</div>
              ) : (
                more.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!m.enabled}
                    onClick={() => {
                      if (!m.enabled) return;
                      onModelChange(m.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-100 dark:hover:bg-neutral-700/60"
                  >
                    <span className="flex-1">{m.label}</span>
                    {m.id === model && (
                      <Check size={16} className="text-brand-600 dark:text-brand-400" />
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatClient({
  conversationId,
  initialMessages,
  models,
  initialModel,
  initialEffort,
  projects,
  initialProjectId,
  lockProject,
  initialPending = [],
  googleConnected,
  availableSkills = [],
  initialActiveSkillIds = [],
  initialWebSearch = false,
  savedPrompts = [],
}: {
  conversationId: string | null;
  initialMessages: ChatMsg[];
  models: ModelOption[];
  initialModel: string;
  initialEffort: string;
  projects: { id: string; name: string }[];
  initialProjectId: string | null;
  lockProject: boolean;
  initialPending?: PendingTool[];
  googleConnected: boolean;
  availableSkills?: { id: string; name: string; scope: string }[];
  initialActiveSkillIds?: string[];
  initialWebSearch?: boolean;
  savedPrompts?: { id: string; title: string; body: string }[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [model, setModel] = useState(initialModel);
  const [effort, setEffort] = useState(initialEffort);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<PendingTool[]>(initialPending);
  const [skillIds, setSkillIds] = useState<string[]>(initialActiveSkillIds);
  const [error, setError] = useState<string | null>(null);
  const [researchMode, setResearchMode] = useState(false);
  const [thinking, setThinking] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(initialWebSearch);
  const [selfCheck, setSelfCheck] = useState(false);
  const [mode, setMode] = useState("standard");
  const [team, setTeam] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Composer "+" menu
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState<
    "project" | "skills" | "prompts" | "mode" | null
  >(null);
  // Voice: dictation (mic → text) and voice conversation (AudioLines)
  const [listening, setListening] = useState(false); // dictation bar active
  const [voiceChat, setVoiceChat] = useState(false); // full voice conversation
  // File drag in progress over the window (shows the drop overlay)
  const [dragActive, setDragActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<"listening" | "thinking" | "speaking">(
    "listening",
  );
  const [liveTranscript, setLiveTranscript] = useState("");

  const convIdRef = useRef<string | null>(conversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child element crossed; the counter
  // keeps the overlay from flickering.
  const dragDepthRef = useRef(0);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const baseInputRef = useRef("");
  const voiceChatRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Live mic waveform
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const currentModel = models.find((m) => m.id === model);
  const efforts = currentModel?.efforts ?? [];
  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  // Re-sync from the server after a refresh (edits/sends/branch switches) so
  // messages regain their ids, branch info, and canonical content.
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (!menuOpen) return;
    // Close only on clicks outside the "+" menu. A bare document listener
    // also fires for clicks inside the popover (stopPropagation can't block
    // it — React delegates events on the document itself), which closed the
    // menu before submenus like Mode could open.
    const close = (e: Event) => {
      if (plusMenuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
      setMenuSection(null);
    };
    // focusin covers keyboard users: tabbing/activating outside closes too.
    document.addEventListener("mousedown", close);
    document.addEventListener("focusin", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("focusin", close);
    };
  }, [menuOpen]);

  // Stop any in-flight speech / recognition / mic on unmount.
  useEffect(() => {
    return () => {
      // Kill the voice loop first so any pending speak()/recognition callbacks
      // that fire during teardown don't restart listening on a dead instance.
      voiceChatRef.current = false;
      recognitionRef.current?.stop?.();
      abortRef.current?.abort();
      stopWaveform();
      audioRef.current?.pause();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag-and-drop anywhere over the chat column. Window-level listeners (with
  // preventDefault) also stop the browser from navigating to a dropped file.
  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      // Voice conversation hides the composer (and the "+" menu), so no
      // overlay / attaching there.
      if (!voiceChatRef.current) setDragActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      dragDepthRef.current = 0;
      setDragActive(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (voiceChatRef.current) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) void addFiles(files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // addFiles only touches state setters, which are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onModelChange(id: string) {
    setModel(id);
    const m = models.find((x) => x.id === id);
    if (m && m.efforts.length > 0 && !m.efforts.includes(effort)) setEffort("high");
  }

  // Single attach path shared by the "+" file picker, paste, and drag-drop.
  async function addFiles(files: File[]) {
    const accepted = files.filter(isAcceptedFile);
    if (accepted.length < files.length) {
      setError("Only images, PDFs, and text files (.csv, .json, .md) can be attached.");
    }
    if (accepted.length === 0) return;
    const next: Attachment[] = [];
    for (const f of accepted) {
      const dataBase64 = await readFileAsBase64(f);
      next.push({ name: f.name, mime: f.type || "application/octet-stream", dataBase64 });
    }
    setAttachments((prev) => [...prev, ...next]);
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    await addFiles(Array.from(e.target.files ?? []));
    if (fileRef.current) fileRef.current.value = "";
  }

  // Attach pasted images (screenshots). Plain-text paste is untouched.
  function onComposerPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (images.length === 0) return;
    // Clipboard screenshots all arrive as "image.png"; timestamp them so
    // multiple pastes stay distinguishable in the attachment row.
    const stamp = Date.now();
    void addFiles(
      images.map((f, i) =>
        f.name && f.name !== "image.png"
          ? f
          : new File([f], `pasted-${stamp}${i > 0 ? `-${i}` : ""}.${f.type.split("/")[1] || "png"}`, {
              type: f.type || "image/png",
            }),
      ),
    );
    // Suppress the default paste only for image-only clipboards; mixed
    // image+text copies still paste their text normally.
    if (!Array.from(e.clipboardData.types).includes("text/plain")) e.preventDefault();
  }

  function getSR() {
    if (typeof window === "undefined") return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
  }

  // --- Live mic waveform (voice-memo style) ---
  async function startWaveform() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        const canvas = waveCanvasRef.current;
        rafRef.current = requestAnimationFrame(draw);
        if (!canvas) return;
        const g = canvas.getContext("2d");
        if (!g) return;
        analyser.getByteFrequencyData(data);
        const w = canvas.width;
        const h = canvas.height;
        g.clearRect(0, 0, w, h);
        const bars = 32;
        const step = Math.floor(data.length / bars);
        const bw = w / bars;
        g.fillStyle = "#ea580c";
        for (let i = 0; i < bars; i++) {
          const v = data[i * step] / 255;
          const bh = Math.max(2, v * h);
          g.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh);
        }
      };
      draw();
    } catch {
      // mic denied — waveform just won't show; dictation may still work
    }
  }

  function stopWaveform() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }

  // --- Dictation (mic → text, with waveform + confirm/cancel) ---
  function startDictation() {
    const SR = getSR();
    if (!SR) {
      setError("Voice input isn't supported in this browser.");
      return;
    }
    if (voiceChatRef.current) stopVoiceChat();
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    baseInputRef.current = input ? input + " " : "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setInput(baseInputRef.current + transcript);
    };
    rec.onerror = () => {};
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      /* already started */
    }
    setListening(true);
    startWaveform();
  }

  function stopDictation(action: "send" | "cancel") {
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    stopWaveform();
    setListening(false);
    if (action === "cancel") {
      setInput(baseInputRef.current.trimEnd());
    } else {
      // give the recognizer a beat to flush the final result, then send
      setTimeout(() => send(), 150);
    }
  }

  // --- Text-to-speech: high-quality server voice, browser fallback ---
  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }

  function browserSpeak(clean: string, onEnd?: () => void) {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      onEnd?.();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
  }

  async function speak(text: string, onEnd?: () => void) {
    const clean = stripMarkdown(text);
    if (!clean) {
      onEnd?.();
      return;
    }
    setVoiceStatus("speaking");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onEnd?.();
    };
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean }),
      });
      if (!res.ok) throw new Error("tts unavailable");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        finish();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        finish();
      };
      await audio.play();
    } catch {
      // Not configured / network / autoplay blocked → browser voice.
      audioRef.current = null;
      browserSpeak(clean, finish);
    }
  }

  // --- Voice conversation (hands-free: listen → send → speak → repeat) ---
  function startVoiceListen() {
    const SR = getSR();
    if (!SR || !voiceChatRef.current) return;
    setVoiceStatus("listening");
    setLiveTranscript("");
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      setLiveTranscript((finalText + " " + interim).trim());
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        setError("Microphone access is blocked. Enable it to use voice.");
        stopVoiceChat();
      }
    };
    rec.onend = () => {
      recognitionRef.current = null;
      const said = finalText.trim();
      if (!voiceChatRef.current) return;
      if (said) {
        setLiveTranscript("");
        setVoiceStatus("thinking");
        send(said);
      } else {
        // nothing heard — keep listening
        startVoiceListen();
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      /* ignore */
    }
  }

  function startVoiceChat() {
    const SR = getSR();
    if (!SR) {
      setError("Voice conversation isn't supported in this browser.");
      return;
    }
    if (listening) stopDictation("cancel");
    setVoiceChat(true);
    voiceChatRef.current = true;
    startVoiceListen();
  }

  function stopVoiceChat() {
    voiceChatRef.current = false;
    setVoiceChat(false);
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    stopAudio();
    setLiveTranscript("");
    // Reconcile with the server now that the loop is done: for a brand-new chat this
    // performs the deferred navigation to /chat/[id]; for an existing one it refreshes
    // so the just-spoken turns regain their ids/branch info for edit/delete.
    if (convIdRef.current) router.replace(`/chat/${convIdRef.current}`);
    else router.refresh();
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  function setLast(fn: (m: ChatMsg) => ChatMsg) {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });
  }

  async function consumeResponse(res: Response): Promise<string | null> {
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Request failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let newId: string | null = null;
    let assistantText = "";

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        switch (ev.type) {
          case "meta":
            if (!convIdRef.current && typeof ev.conversationId === "string") {
              convIdRef.current = ev.conversationId;
              newId = ev.conversationId;
            }
            break;
          case "text":
            assistantText += String(ev.text);
            setLast((m) => ({ ...m, text: m.text + String(ev.text) }));
            break;
          case "thinking":
            setLast((m) => ({ ...m, thinking: (m.thinking ?? "") + String(ev.text) }));
            break;
          case "tool_activity":
            setLast((m) => ({
              ...m,
              activities: [
                ...(m.activities ?? []),
                {
                  tool: String(ev.tool),
                  summary: String(ev.summary),
                  link: ev.link as string | undefined,
                  isError: Boolean(ev.isError),
                },
              ],
            }));
            break;
          case "tool_request":
            setPending((ev.pending as PendingTool[]) ?? []);
            break;
          case "error":
            setError(String(ev.message));
            break;
        }
      }
    }
    setLast((m) => ({ ...m, streaming: false }));
    if (newId) window.history.replaceState({}, "", `/chat/${newId}`);
    if (voiceChatRef.current) {
      if (assistantText.trim()) {
        speak(assistantText, () => {
          if (voiceChatRef.current) startVoiceListen();
        });
      } else {
        startVoiceListen();
      }
    }
    return newId;
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if ((!text && attachments.length === 0) || sending) return;
    const wasNew = !convIdRef.current;
    setError(null);
    setPending([]);
    setSending(true);

    const userMsg: ChatMsg = {
      role: "user",
      text,
      attachments: attachments.map((a) => ({ name: a.name, mime: a.mime })),
    };
    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: "assistant", text: "", thinking: "", activities: [], streaming: true },
    ]);
    const sentAttachments = attachments;
    setInput("");
    setAttachments([]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let createdId: string | null = null;
    let aborted = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          conversationId: convIdRef.current,
          projectId,
          model,
          effort,
          message: text,
          attachments: sentAttachments,
          skillIds,
          researchMode,
          webSearch,
          selfCheck,
          mode,
          team,
          thinking,
          voice: voiceChatRef.current,
        }),
      });
      createdId = await consumeResponse(res);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        aborted = true;
      } else {
        setError(err instanceof Error ? err.message : "Failed to send");
      }
      setLast((m) => ({ ...m, streaming: false }));
      if (voiceChatRef.current) startVoiceListen();
    } finally {
      setSending(false);
      abortRef.current = null;
      // On a manual stop, keep the partial reply rather than reloading the full one.
      // During a voice conversation, never navigate/refresh — that would remount this
      // component and orphan the listen→speak loop. We reconcile once, on End voice.
      if (!aborted && !voiceChatRef.current) {
        if (wasNew && createdId) router.replace(`/chat/${createdId}`);
        else if (convIdRef.current) router.refresh();
      }
    }
  }

  async function confirmPending(approve: boolean) {
    if (!convIdRef.current || pending.length === 0 || sending) return;
    setSending(true);
    setError(null);
    const decisions: Record<string, "approve" | "reject"> = {};
    for (const p of pending)
      if (p.kind === "write") decisions[p.id] = approve ? "approve" : "reject";
    setPending([]);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: "", thinking: "", activities: [], streaming: true },
    ]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let aborted = false;
    try {
      const res = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({ conversationId: convIdRef.current, decisions, mode }),
      });
      await consumeResponse(res);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        aborted = true;
      } else {
        setError(err instanceof Error ? err.message : "Failed to confirm");
      }
      setLast((m) => ({ ...m, streaming: false }));
    } finally {
      setSending(false);
      abortRef.current = null;
      if (!aborted) router.refresh();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Re-run a turn from a user message (edit or retry). `index` is that user
  // message's position in the active path.
  async function runEdit(messageId: string, index: number, text: string) {
    if (!text.trim() || sending) return;
    setEditingId(null);
    setError(null);
    setPending([]);
    setSending(true);
    setMessages((prev) => [
      ...prev.slice(0, index),
      { role: "user", text },
      { role: "assistant", text: "", thinking: "", activities: [], streaming: true },
    ]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let aborted = false;
    try {
      const res = await fetch("/api/chat/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          conversationId: convIdRef.current,
          editMessageId: messageId,
          newText: text,
          model,
          effort,
          mode,
        }),
      });
      await consumeResponse(res);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        aborted = true;
      } else {
        setError(err instanceof Error ? err.message : "Failed to save edit");
      }
      setLast((m) => ({ ...m, streaming: false }));
    } finally {
      setSending(false);
      abortRef.current = null;
      if (!aborted) router.refresh();
    }
  }

  function submitEdit(messageId: string, index: number) {
    void runEdit(messageId, index, editText.trim());
  }

  // Retry regenerates the assistant reply: from a user message it re-runs that
  // message; from an assistant message it re-runs the preceding user message.
  function retryMessage(index: number) {
    if (sending) return;
    let userIdx = index;
    if (messages[index]?.role === "assistant") userIdx = index - 1;
    const um = messages[userIdx];
    if (!um || um.role !== "user" || !um.id) return;
    void runEdit(um.id, userIdx, um.text);
  }

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function onDeleteMessage(messageId: string) {
    if (!convIdRef.current || sending) return;
    if (!window.confirm("Delete this message and everything after it?")) return;
    await deleteMessage(convIdRef.current, messageId);
    router.refresh();
  }

  async function onSwitchBranch(siblingId: string) {
    if (!convIdRef.current || sending) return;
    await switchBranch(convIdRef.current, siblingId);
    router.refresh();
  }

  const writes = pending.filter((p) => p.kind === "write");
  const canSend = !sending && (input.trim().length > 0 || attachments.length > 0);

  // A menu row + optional trailing check
  const menuRowCls =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700/60";
  // Compact icon button used in the per-message action rows.
  const msgActionCls =
    "rounded p-1 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

  return (
    <div className="relative flex h-full flex-col bg-neutral-50 dark:bg-neutral-950">
      {/* Drop overlay — pointer-events-none so the drop still reaches the
          window listeners underneath */}
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-white/75 backdrop-blur-sm dark:bg-neutral-950/75">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand-400 bg-white px-10 py-8 shadow-lg dark:border-brand-600 dark:bg-neutral-900">
            <Paperclip size={28} className="text-brand-600 dark:text-brand-400" />
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Drop files to attach
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Images, PDFs & text files
            </p>
          </div>
        </div>
      )}
      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <div className="flex min-h-[40vh] flex-col items-center justify-center text-center text-neutral-400">
              <p className="text-2xl font-medium text-neutral-500 dark:text-neutral-300">
                How can I help with the project?
              </p>
              <p className="mt-2 text-sm">
                Ask anything, attach a plan or invoice, generate a scope of work, or
                {googleConnected
                  ? " create a Google Doc/Sheet."
                  : " connect Google to create real Docs & Sheets."}
              </p>
            </div>
          )}
          {messages.map((m, i) => {
            const isEditing = m.id != null && editingId === m.id;
            return (
              <div key={m.id ?? i} className={cn(m.role === "user" ? "flex flex-col items-end" : "")}>
                <div
                  className={cn(
                    "group relative",
                    m.role === "user" ? "max-w-[80%]" : "w-full",
                  )}
                >
                  {isEditing ? (
                    <div className="w-96 max-w-full space-y-2 rounded-2xl border border-brand-300 bg-white p-3 dark:border-brand-700 dark:bg-neutral-900">
                      <Textarea
                        autoFocus
                        rows={3}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            submitEdit(m.id!, i);
                          }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <div className="flex items-start justify-between gap-3">
                        <p className="flex items-start gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                          <Info size={13} className="mt-0.5 shrink-0" />
                          Editing this message will create a new conversation branch. You can switch
                          between branches using the arrow navigation buttons.
                        </p>
                        <div className="flex shrink-0 gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={() => submitEdit(m.id!, i)}>
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        m.role === "user"
                          ? "rounded-[22px_22px_6px_22px] bg-ember-accent-solid px-[18px] py-3 text-[15px] text-white shadow-ember-bubble"
                          : "text-[16px] leading-[1.7] text-ember-text",
                      )}
                    >
                      {m.role === "assistant" && <ThinkingBlock text={m.thinking ?? ""} />}
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="mb-1 flex flex-wrap gap-1">
                          {m.attachments.map((a, j) => (
                            <span key={j} className="rounded bg-black/10 px-2 py-0.5 text-xs">
                              {a.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.role === "assistant" && <ActivityList activities={m.activities} />}
                      {m.role === "user" ? (
                        <p className="whitespace-pre-wrap">{m.text}</p>
                      ) : m.text ? (
                        <Markdown content={m.text} />
                      ) : m.streaming ? (
                        <EmberThinking
                          label={
                            m.activities && m.activities.length > 0
                              ? "Checking project context"
                              : "Thinking"
                          }
                        />
                      ) : null}
                    </div>
                  )}

                </div>

                {/* User message action row: copy / retry / edit / delete + branch nav */}
                {m.role === "user" && m.id && !isEditing && (
                  <div className="mt-1 flex items-center gap-1 pr-1 text-neutral-400 opacity-60 transition-opacity hover:opacity-100">
                    {m.branchInfo && m.branchInfo.total > 1 && (
                      <div className="mr-1 flex items-center gap-0.5 text-xs">
                        <button
                          type="button"
                          disabled={m.branchInfo.current <= 1}
                          onClick={() =>
                            onSwitchBranch(m.branchInfo!.siblingIds[m.branchInfo!.current - 2])
                          }
                          className="rounded p-0.5 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                          title="Previous branch"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <span className="tabular-nums">
                          {m.branchInfo.current}/{m.branchInfo.total}
                        </span>
                        <button
                          type="button"
                          disabled={m.branchInfo.current >= m.branchInfo.total}
                          onClick={() =>
                            onSwitchBranch(m.branchInfo!.siblingIds[m.branchInfo!.current])
                          }
                          className="rounded p-0.5 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                          title="Next branch"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      title="Copy"
                      onClick={() => copyText(m.id!, m.text)}
                      className={msgActionCls}
                    >
                      {copiedId === m.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      type="button"
                      title="Retry"
                      disabled={sending}
                      onClick={() => retryMessage(i)}
                      className={msgActionCls}
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      type="button"
                      title="Edit"
                      disabled={sending}
                      onClick={() => {
                        setEditingId(m.id!);
                        setEditText(m.text);
                      }}
                      className={msgActionCls}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      disabled={sending}
                      onClick={() => onDeleteMessage(m.id!)}
                      className="rounded p-1 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}

                {/* Assistant message action row: copy / retry / read aloud */}
                {m.role === "assistant" && m.id && !m.streaming && m.text && (
                  <div className="mt-1 flex items-center gap-1 text-neutral-400 opacity-60 transition-opacity hover:opacity-100">
                    <button
                      type="button"
                      title="Copy"
                      onClick={() => copyText(m.id!, m.text)}
                      className={msgActionCls}
                    >
                      {copiedId === m.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      type="button"
                      title="Retry"
                      disabled={sending}
                      onClick={() => retryMessage(i)}
                      className={msgActionCls}
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      type="button"
                      title="Read aloud"
                      onClick={() => speak(m.text)}
                      className={msgActionCls}
                    >
                      <Volume2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pending confirmation card */}
          {writes.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
              <div className="mb-2 flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                <AlertTriangle size={16} />
                Approve {writes.length === 1 ? "this action" : "these actions"}?
              </div>
              <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
                {writes.map((p) => (
                  <li key={p.id}>{p.summary}</li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  disabled={sending}
                  onClick={() => confirmPending(true)}
                >
                  Approve {writes.length > 1 ? "all" : ""}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={sending}
                  onClick={() => confirmPending(false)}
                >
                  Reject
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="px-4 pb-4 pt-1">
        <div className="mx-auto max-w-3xl">
          {error && (
            <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          {voiceChat && (
            <div className="flex flex-col items-center gap-4 rounded-3xl border border-brand-200 bg-white p-8 shadow-sm dark:border-brand-800 dark:bg-neutral-900">
              <div
                className={cn(
                  "flex h-20 w-20 items-center justify-center rounded-full transition-colors",
                  voiceStatus === "listening"
                    ? "animate-pulse bg-brand-100 text-brand-600 dark:bg-brand-950 dark:text-brand-300"
                    : voiceStatus === "speaking"
                      ? "animate-pulse bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-300"
                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
                )}
              >
                {voiceStatus === "speaking" ? (
                  <AudioLines size={32} />
                ) : voiceStatus === "thinking" ? (
                  <Spinner />
                ) : (
                  <Mic size={32} />
                )}
              </div>
              <div className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                {voiceStatus === "listening"
                  ? "Listening…"
                  : voiceStatus === "thinking"
                    ? "Thinking…"
                    : "Speaking…"}
              </div>
              <p className="min-h-[1.5rem] max-w-md text-center text-sm text-neutral-500 dark:text-neutral-400">
                {liveTranscript || "Say something — I'll reply out loud."}
              </p>
              <button
                type="button"
                onClick={stopVoiceChat}
                className="rounded-full bg-neutral-800 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-white"
              >
                End voice
              </button>
            </div>
          )}

          {!voiceChat && (
          <>
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {a.name}
                  <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="rounded-[28px] border border-ember-border bg-ember-surface/80 px-3.5 pb-2 pt-3.5 shadow-ember-composer backdrop-blur-xl transition-shadow focus-within:border-ember-accent focus-within:shadow-[var(--ember-glow-ring),var(--ember-shadow-composer)]">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onComposerPaste}
              rows={1}
              placeholder="Ask ContractorAI anything…"
              className="max-h-48 w-full resize-none bg-transparent px-1 text-[15px] text-ember-text outline-none placeholder:text-ember-faint"
            />

            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf,text/*,.csv,.json,.md"
              className="hidden"
              onChange={onPickFiles}
            />

            {/* Dictation recording bar */}
            {listening ? (
            <div className="mt-1 flex items-center gap-3">
              <button
                type="button"
                onClick={() => stopDictation("cancel")}
                title="Cancel"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                <X size={18} />
              </button>
              <div className="flex flex-1 items-center gap-2">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
                <canvas
                  ref={waveCanvasRef}
                  width={280}
                  height={32}
                  className="h-8 w-full"
                />
              </div>
              <button
                type="button"
                onClick={() => stopDictation("send")}
                title="Finish & send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700"
              >
                <Check size={18} />
              </button>
            </div>
            ) : (
            /* Controls row */
            <div className="mt-1 flex flex-wrap items-center justify-between gap-y-1">
              {/* Left: "+" menu */}
              <div className="flex min-w-0 items-center gap-1.5">
              <div className="relative" ref={plusMenuRef}>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen((o) => !o);
                    setMenuSection(null);
                  }}
                  title="Add context & tools"
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                    menuOpen
                      ? "border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-300"
                      : "border-neutral-300 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800",
                  )}
                >
                  <Plus size={18} />
                </button>

                {menuOpen && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 max-h-[60vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
                    <button
                      type="button"
                      className={menuRowCls}
                      onClick={() => {
                        fileRef.current?.click();
                        setMenuOpen(false);
                      }}
                    >
                      <ImageIcon size={16} className="text-neutral-400" />
                      <span className="flex-1">Add files or photos</span>
                    </button>

                    {!lockProject && projects.length > 0 && (
                      <div>
                        <button
                          type="button"
                          className={menuRowCls}
                          onClick={() =>
                            setMenuSection((s) => (s === "project" ? null : "project"))
                          }
                        >
                          <FolderKanban size={16} className="text-neutral-400" />
                          <span className="flex-1">
                            Add to project
                            {selectedProject && (
                              <span className="ml-1 text-xs text-brand-600 dark:text-brand-400">
                                · {selectedProject.name}
                              </span>
                            )}
                          </span>
                          <ChevronRight
                            size={14}
                            className={cn(
                              "text-neutral-400 transition-transform",
                              menuSection === "project" && "rotate-90",
                            )}
                          />
                        </button>
                        {menuSection === "project" && (
                          <div className="mb-1 ml-8 mr-1 space-y-0.5 border-l border-neutral-200 pl-2 dark:border-neutral-700">
                            <button
                              type="button"
                              onClick={() => setProjectId(null)}
                              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
                            >
                              <span className="flex-1">None</span>
                              {projectId === null && <Check size={14} className="text-brand-600" />}
                            </button>
                            {projects.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setProjectId(p.id)}
                                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
                              >
                                <span className="flex-1 truncate">{p.name}</span>
                                {projectId === p.id && <Check size={14} className="text-brand-600" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {lockProject && selectedProject && (
                      <div className="flex items-center gap-2.5 px-2.5 py-2 text-sm text-neutral-500 dark:text-neutral-400">
                        <FolderKanban size={16} className="text-neutral-400" />
                        Project: {selectedProject.name}
                      </div>
                    )}

                    <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />

                    {availableSkills.length > 0 && (
                      <div>
                        <button
                          type="button"
                          className={menuRowCls}
                          onClick={() =>
                            setMenuSection((s) => (s === "skills" ? null : "skills"))
                          }
                        >
                          <Sparkles size={16} className="text-neutral-400" />
                          <span className="flex-1">
                            Skills
                            {skillIds.length > 0 && (
                              <span className="ml-1 text-xs text-brand-600 dark:text-brand-400">
                                · {skillIds.length}
                              </span>
                            )}
                          </span>
                          <ChevronRight
                            size={14}
                            className={cn(
                              "text-neutral-400 transition-transform",
                              menuSection === "skills" && "rotate-90",
                            )}
                          />
                        </button>
                        {menuSection === "skills" && (
                          <div className="mb-1 ml-8 mr-1 max-h-48 space-y-0.5 overflow-y-auto border-l border-neutral-200 pl-2 dark:border-neutral-700">
                            {availableSkills.map((s) => (
                              <label
                                key={s.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
                              >
                                <input
                                  type="checkbox"
                                  checked={skillIds.includes(s.id)}
                                  onChange={(e) =>
                                    setSkillIds((prev) =>
                                      e.target.checked
                                        ? [...prev, s.id]
                                        : prev.filter((x) => x !== s.id),
                                    )
                                  }
                                />
                                <span className="flex-1 truncate">{s.name}</span>
                                {s.scope === "org" && (
                                  <span className="text-[10px] text-blue-600 dark:text-blue-400">org</span>
                                )}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {savedPrompts.length > 0 && (
                      <div>
                        <button
                          type="button"
                          className={menuRowCls}
                          onClick={() =>
                            setMenuSection((s) => (s === "prompts" ? null : "prompts"))
                          }
                        >
                          <FileText size={16} className="text-neutral-400" />
                          <span className="flex-1">Prompts</span>
                          <ChevronRight
                            size={14}
                            className={cn(
                              "text-neutral-400 transition-transform",
                              menuSection === "prompts" && "rotate-90",
                            )}
                          />
                        </button>
                        {menuSection === "prompts" && (
                          <div className="mb-1 ml-8 mr-1 max-h-48 space-y-0.5 overflow-y-auto border-l border-neutral-200 pl-2 dark:border-neutral-700">
                            {savedPrompts.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  setInput((prev) => (prev ? prev + "\n\n" : "") + p.body);
                                  setMenuOpen(false);
                                  setMenuSection(null);
                                }}
                                className="block w-full truncate rounded px-2 py-1 text-left text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
                                title={p.body}
                              >
                                {p.title}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <Link href="/customize?tab=connections" className={menuRowCls}>
                      <Plug size={16} className="text-neutral-400" />
                      <span className="flex-1">Connectors</span>
                      {!googleConnected && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400">
                          Connect
                        </span>
                      )}
                      <ExternalLink size={13} className="text-neutral-400" />
                    </Link>

                    <Link href="/customize?tab=plugins" className={menuRowCls}>
                      <Blocks size={16} className="text-neutral-400" />
                      <span className="flex-1">Plugins</span>
                      <ExternalLink size={13} className="text-neutral-400" />
                    </Link>

                    <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />

                    <button
                      type="button"
                      className={menuRowCls}
                      onClick={() => setResearchMode((r) => !r)}
                    >
                      <Telescope size={16} className={researchMode ? "text-brand-600" : "text-neutral-400"} />
                      <span className="flex-1">Research</span>
                      {researchMode && <Check size={16} className="text-brand-600" />}
                    </button>
                    <button
                      type="button"
                      className={menuRowCls}
                      onClick={() => setWebSearch((w) => !w)}
                    >
                      <Globe size={16} className={webSearch ? "text-brand-600" : "text-neutral-400"} />
                      <span className="flex-1">Web search</span>
                      {webSearch && <Check size={16} className="text-brand-600" />}
                    </button>
                    <button
                      type="button"
                      className={menuRowCls}
                      onClick={() => setSelfCheck((s) => !s)}
                    >
                      <ShieldCheck size={16} className={selfCheck ? "text-brand-600" : "text-neutral-400"} />
                      <span className="flex-1">Self-check</span>
                      {selfCheck && <Check size={16} className="text-brand-600" />}
                    </button>
                    <button
                      type="button"
                      className={menuRowCls}
                      onClick={() => setTeam((t) => !t)}
                    >
                      <Users size={16} className={team ? "text-brand-600" : "text-neutral-400"} />
                      <span className="flex-1">
                        Team mode
                        <span className="ml-1 text-[10px] text-neutral-400">multi-agent</span>
                      </span>
                      {team && <Check size={16} className="text-brand-600" />}
                    </button>

                    <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" />

                    <div>
                      <button
                        type="button"
                        className={menuRowCls}
                        onClick={() => setMenuSection((s) => (s === "mode" ? null : "mode"))}
                      >
                        <SlidersHorizontal size={16} className="text-neutral-400" />
                        <span className="flex-1">
                          Mode
                          <span className="ml-1 text-xs text-brand-600 dark:text-brand-400">
                            · {REASONING_MODES.find((m) => m.id === mode)?.label ?? "Standard"}
                          </span>
                        </span>
                        <ChevronRight
                          size={14}
                          className={cn(
                            "text-neutral-400 transition-transform",
                            menuSection === "mode" && "rotate-90",
                          )}
                        />
                      </button>
                      {menuSection === "mode" && (
                        <div className="mb-1 ml-8 mr-1 max-h-56 space-y-0.5 overflow-y-auto border-l border-neutral-200 pl-2 dark:border-neutral-700">
                          {REASONING_MODES.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                setMode(m.id);
                                setMenuOpen(false);
                                setMenuSection(null);
                              }}
                              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
                            >
                              <span className="flex-1">{m.label}</span>
                              {mode === m.id && <Check size={14} className="text-brand-600" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Active mode pill — click to clear back to Standard */}
              {mode !== "standard" && (
                <button
                  type="button"
                  onClick={() => setMode("standard")}
                  title="Mode active — click to clear"
                  className="flex min-w-0 items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300 dark:hover:bg-brand-900"
                >
                  <SlidersHorizontal size={12} className="shrink-0" />
                  <span className="truncate">
                    {REASONING_MODES.find((m) => m.id === mode)?.label ?? mode}
                  </span>
                  <X size={12} className="shrink-0" />
                </button>
              )}
              </div>

              {/* Right: model picker + voice + send/stop */}
              <div className="flex items-center gap-1">
                <ModelPicker
                  models={models}
                  model={model}
                  effort={effort}
                  efforts={efforts}
                  thinking={thinking}
                  onModelChange={onModelChange}
                  onEffortChange={setEffort}
                  onThinkingChange={setThinking}
                />
                <button
                  type="button"
                  onClick={startDictation}
                  title="Dictate (speech to text)"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Mic size={17} />
                </button>
                <button
                  type="button"
                  onClick={startVoiceChat}
                  title="Voice conversation (talk with the AI)"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <AudioLines size={17} />
                </button>
                {sending ? (
                  <button
                    type="button"
                    onClick={stopGeneration}
                    title="Stop generating"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-white"
                  >
                    <Square size={13} className="fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => send()}
                    disabled={!canSend}
                    title="Send"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
                  >
                    <Send size={16} />
                  </button>
                )}
              </div>
            </div>
            )}
          </div>

          <p className="mt-2 text-center text-xs text-neutral-400">
            {AI_CHAT_CAPTION}
            {!googleConnected && (
              <>
                {" · "}
                <Link href="/customize?tab=connections" className="text-brand-600 hover:underline dark:text-brand-400">
                  Connect Google
                </Link>{" "}
                to create real Docs, Sheets & send email from chat.
              </>
            )}
          </p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
