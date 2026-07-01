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
  Wrench,
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
  FolderKanban,
  Plug,
  Blocks,
  FileText,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Button, Card, Select, Spinner, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { switchBranch, deleteMessage } from "@/app/(app)/chat/branch-actions";

export type ModelOption = {
  id: string;
  label: string;
  blurb: string;
  enabled: boolean;
  efforts: string[];
  adaptiveThinking: boolean;
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
    <div className="mb-2 rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Brain size={14} />
        Thinking
      </button>
      {open && (
        <div className="whitespace-pre-wrap px-3 pb-3 text-xs text-neutral-500 dark:text-neutral-400">
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
            "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
            a.isError
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400",
          )}
        >
          {a.isError ? <AlertTriangle size={13} /> : <Wrench size={13} />}
          <span className="flex-1">{a.summary}</span>
          {a.link && (
            <a
              href={a.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Open <ExternalLink size={12} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

/** Compact model + effort picker (bottom-right of the composer), opens upward. */
function ModelPicker({
  models,
  model,
  effort,
  efforts,
  onModelChange,
  onEffortChange,
}: {
  models: ModelOption[];
  model: string;
  effort: string;
  efforts: string[];
  onModelChange: (id: string) => void;
  onEffortChange: (effort: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentModel = models.find((m) => m.id === model);
  const effortLabel = effort ? effort[0].toUpperCase() + effort.slice(1) : "";

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {currentModel?.label ?? model}
        {effortLabel && <span className="text-neutral-400">{effortLabel}</span>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-full right-0 z-20 mb-1 w-56 space-y-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
        >
          <div>
            <span className="mb-1 block text-[11px] font-medium uppercase text-neutral-400">
              Model
            </span>
            <Select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.enabled}>
                  {m.label}
                  {!m.enabled ? " (unavailable)" : ""}
                </option>
              ))}
            </Select>
          </div>
          {efforts.length > 0 && (
            <div>
              <span className="mb-1 block text-[11px] font-medium uppercase text-neutral-400">
                Effort
              </span>
              <Select
                value={effort}
                onChange={(e) => onEffortChange(e.target.value)}
                className="w-full"
              >
                {efforts.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </Select>
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
  const [webSearch, setWebSearch] = useState(initialWebSearch);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Composer "+" menu
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState<"project" | "skills" | "prompts" | null>(null);
  // Voice
  const [listening, setListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const convIdRef = useRef<string | null>(conversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const baseInputRef = useRef("");
  const voiceModeRef = useRef(false);

  const currentModel = models.find((m) => m.id === model);
  const efforts = currentModel?.efforts ?? [];
  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => {
      setMenuOpen(false);
      setMenuSection(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  // Stop any in-flight speech / recognition on unmount.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop?.();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  function onModelChange(id: string) {
    setModel(id);
    const m = models.find((x) => x.id === id);
    if (m && m.efforts.length > 0 && !m.efforts.includes(effort)) setEffort("high");
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const next: Attachment[] = [];
    for (const f of files) {
      const dataBase64 = await readFileAsBase64(f);
      next.push({ name: f.name, mime: f.type || "application/octet-stream", dataBase64 });
    }
    setAttachments((prev) => [...prev, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  }

  // --- Voice: dictation (speech-to-text) ---
  function toggleListening() {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("Voice input isn't supported in this browser.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    baseInputRef.current = input ? input + " " : "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setInput(baseInputRef.current + transcript);
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  // --- Voice: read responses aloud (text-to-speech) ---
  function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const clean = stripMarkdown(text);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }

  function toggleVoiceMode() {
    const next = !voiceMode;
    setVoiceMode(next);
    voiceModeRef.current = next;
    if (!next && typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
    }
  }

  function setLast(fn: (m: ChatMsg) => ChatMsg) {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });
  }

  async function consumeResponse(res: Response) {
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
    if (voiceModeRef.current && assistantText.trim()) speak(assistantText);
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending) return;
    if (listening) recognitionRef.current?.stop?.();
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

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        }),
      });
      await consumeResponse(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
      setLast((m) => ({ ...m, streaming: false }));
    } finally {
      setSending(false);
      router.refresh();
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
    try {
      const res = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convIdRef.current, decisions }),
      });
      await consumeResponse(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
      setLast((m) => ({ ...m, streaming: false }));
    } finally {
      setSending(false);
      router.refresh();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function submitEdit(messageId: string, index: number) {
    const text = editText.trim();
    if (!text || sending) return;
    setEditingId(null);
    setError(null);
    setPending([]);
    setSending(true);
    setMessages((prev) => [
      ...prev.slice(0, index),
      { role: "user", text },
      { role: "assistant", text: "", thinking: "", activities: [], streaming: true },
    ]);

    try {
      const res = await fetch("/api/chat/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convIdRef.current,
          editMessageId: messageId,
          newText: text,
          model,
          effort,
        }),
      });
      await consumeResponse(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save edit");
      setLast((m) => ({ ...m, streaming: false }));
    } finally {
      setSending(false);
      router.refresh();
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

  return (
    <div className="flex h-full flex-col bg-neutral-50 dark:bg-neutral-950">
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
                    <div className="w-80 max-w-full space-y-2 rounded-2xl border border-brand-300 bg-white p-3 dark:border-brand-700 dark:bg-neutral-800">
                      <Textarea
                        autoFocus
                        rows={3}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={() => submitEdit(m.id!, i)}>
                          <Check size={14} /> Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        m.role === "user"
                          ? "rounded-2xl bg-brand-600 px-4 py-2.5 text-white"
                          : "text-neutral-900 dark:text-neutral-100",
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
                        <div className="flex items-center gap-2 text-neutral-400">
                          <Spinner /> Working…
                        </div>
                      ) : null}
                    </div>
                  )}

                  {m.role === "user" && m.id && !isEditing && (
                    <div className="absolute -top-3 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => {
                          setEditingId(m.id!);
                          setEditText(m.text);
                        }}
                        className="rounded-full border border-neutral-200 bg-white p-1.5 text-neutral-500 shadow-sm hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => onDeleteMessage(m.id!)}
                        className="rounded-full border border-neutral-200 bg-white p-1.5 text-neutral-500 shadow-sm hover:bg-red-50 hover:text-red-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-red-950"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>

                {m.branchInfo && m.branchInfo.total > 1 && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
                    <button
                      type="button"
                      disabled={m.branchInfo.current <= 1}
                      onClick={() =>
                        onSwitchBranch(m.branchInfo!.siblingIds[m.branchInfo!.current - 2])
                      }
                      className="rounded p-0.5 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span>
                      {m.branchInfo.current}/{m.branchInfo.total}
                    </span>
                    <button
                      type="button"
                      disabled={m.branchInfo.current >= m.branchInfo.total}
                      onClick={() =>
                        onSwitchBranch(m.branchInfo!.siblingIds[m.branchInfo!.current])
                      }
                      className="rounded p-0.5 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                    >
                      <ChevronRight size={14} />
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

          <div className="rounded-3xl border border-neutral-300 bg-white px-3 pb-2 pt-3 shadow-sm transition-colors focus-within:border-brand-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:border-brand-600">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Message ContractorAI…"
              className="max-h-48 w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-neutral-400 dark:text-neutral-100"
            />

            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf,text/*,.csv,.json,.md"
              className="hidden"
              onChange={onPickFiles}
            />

            {/* Controls row */}
            <div className="mt-1 flex items-center justify-between">
              {/* Left: "+" menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
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
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                  >
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
                  </div>
                )}
              </div>

              {/* Right: model picker + voice + send */}
              <div className="flex items-center gap-1">
                <ModelPicker
                  models={models}
                  model={model}
                  effort={effort}
                  efforts={efforts}
                  onModelChange={onModelChange}
                  onEffortChange={setEffort}
                />
                <button
                  type="button"
                  onClick={toggleListening}
                  title={listening ? "Stop dictation" : "Dictate (speech to text)"}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                    listening
                      ? "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"
                      : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
                  )}
                >
                  <Mic size={17} className={listening ? "animate-pulse" : ""} />
                </button>
                <button
                  type="button"
                  onClick={toggleVoiceMode}
                  title={voiceMode ? "Voice replies on (read responses aloud)" : "Read responses aloud"}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                    voiceMode
                      ? "bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                      : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
                  )}
                >
                  <AudioLines size={17} className={speaking ? "animate-pulse" : ""} />
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  title="Send"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
                >
                  {sending ? <Spinner className="border-white border-t-white/40" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </div>

          {!googleConnected && (
            <p className="mt-2 text-center text-xs text-neutral-400">
              <Link href="/customize?tab=connections" className="text-brand-600 hover:underline dark:text-brand-400">
                Connect Google
              </Link>{" "}
              to create real Docs, Sheets & send email from chat.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
