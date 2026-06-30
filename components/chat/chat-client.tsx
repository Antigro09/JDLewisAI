"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Paperclip,
  Send,
  X,
  Brain,
  ChevronDown,
  ChevronRight,
  Wrench,
  ExternalLink,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Button, Card, Select, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

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

type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  attachments?: { name: string; mime: string }[];
  activities?: Activity[];
  streaming?: boolean;
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="mb-2 rounded-lg border border-neutral-200 bg-neutral-50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-500"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Brain size={14} />
        Thinking
      </button>
      {open && (
        <div className="whitespace-pre-wrap px-3 pb-3 text-xs text-neutral-500">
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
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-neutral-200 bg-neutral-50 text-neutral-600",
          )}
        >
          {a.isError ? <AlertTriangle size={13} /> : <Wrench size={13} />}
          <span className="flex-1">{a.summary}</span>
          {a.link && (
            <a
              href={a.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
            >
              Open <ExternalLink size={12} />
            </a>
          )}
        </div>
      ))}
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
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const convIdRef = useRef<string | null>(conversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const currentModel = models.find((m) => m.id === model);
  const efforts = currentModel?.efforts ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

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
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending) return;
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

  const writes = pending.filter((p) => p.kind === "write");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-neutral-500">Model</span>
          <Select value={model} onChange={(e) => onModelChange(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.enabled}>
                {m.label}
                {!m.enabled ? " (unavailable)" : ""}
              </option>
            ))}
          </Select>
        </div>
        {efforts.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-neutral-500">Effort</span>
            <Select value={effort} onChange={(e) => setEffort(e.target.value)}>
              {efforts.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-neutral-500">Project</span>
          <Select
            value={projectId ?? ""}
            disabled={lockProject}
            onChange={(e) => setProjectId(e.target.value || null)}
          >
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        {availableSkills.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setSkillsOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100"
            >
              <Sparkles size={14} />
              Skills{skillIds.length ? ` (${skillIds.length})` : ""}
            </button>
            {skillsOpen && (
              <div className="absolute z-10 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
                {availableSkills.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-neutral-50"
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
                      <span className="text-[10px] text-blue-600">org</span>
                    )}
                  </label>
                ))}
                <p className="px-2 pt-1 text-[11px] text-neutral-400">
                  Applied to this conversation.
                </p>
              </div>
            )}
          </div>
        )}
        {!googleConnected && (
          <a
            href="/settings"
            className="ml-auto rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
          >
            Connect Google →
          </a>
        )}
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <div className="mt-20 text-center text-neutral-400">
              <p className="text-lg font-medium text-neutral-500">
                How can I help with the project?
              </p>
              <p className="mt-1 text-sm">
                Ask anything, attach a plan or invoice, generate a scope of work, or
                {googleConnected
                  ? " create a Google Doc/Sheet."
                  : " connect Google to create real Docs & Sheets."}
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn(m.role === "user" ? "flex justify-end" : "")}>
              <div
                className={cn(
                  m.role === "user"
                    ? "max-w-[80%] rounded-2xl bg-brand-600 px-4 py-2.5 text-white"
                    : "w-full",
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
            </div>
          ))}

          {/* Pending confirmation card */}
          {writes.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 p-4">
              <div className="mb-2 flex items-center gap-2 font-medium text-amber-900">
                <AlertTriangle size={16} />
                Approve {writes.length === 1 ? "this action" : "these actions"}?
              </div>
              <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
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
      <div className="border-t border-neutral-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {error && (
            <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs"
                >
                  {a.name}
                  <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-neutral-300 bg-white p-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100"
              title="Attach files"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf,text/*,.csv,.json,.md"
              className="hidden"
              onChange={onPickFiles}
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Message ContractorAI…"
              className="max-h-40 flex-1 resize-none bg-transparent py-2 text-sm outline-none"
            />
            <Button
              size="sm"
              onClick={send}
              disabled={sending || (!input.trim() && attachments.length === 0)}
            >
              {sending ? <Spinner className="border-white border-t-white/40" /> : <Send size={16} />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
