import { anthropic } from "./client";
import { resolveModel } from "./models";
import type { Attachment, ChatTurn, StreamEvent } from "./types";

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = [
  "application/json",
  "application/xml",
  "application/csv",
  "text/csv",
  "application/javascript",
];
const MAX_INLINE_TEXT = 200_000; // chars

function isTextual(mime: string): boolean {
  return (
    TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p)) ||
    TEXT_MIME_EXACT.includes(mime)
  );
}

/** Convert an attachment to one or more Anthropic content blocks. */
function attachmentBlocks(a: Attachment): unknown[] {
  if (a.mime.startsWith("image/")) {
    return [
      {
        type: "image",
        source: { type: "base64", media_type: a.mime, data: a.dataBase64 },
      },
    ];
  }
  if (a.mime === "application/pdf") {
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: a.dataBase64,
        },
      },
    ];
  }
  if (isTextual(a.mime)) {
    let text = "";
    try {
      text = Buffer.from(a.dataBase64, "base64").toString("utf8");
    } catch {
      text = "";
    }
    if (text.length > MAX_INLINE_TEXT) text = text.slice(0, MAX_INLINE_TEXT) + "\n…[truncated]";
    return [{ type: "text", text: `Attached file "${a.name}":\n\n${text}` }];
  }
  return [
    {
      type: "text",
      text: `[Attached file "${a.name}" (${a.mime}) — binary content not directly readable.]`,
    },
  ];
}

function toMessages(turns: ChatTurn[]): unknown[] {
  return turns.map((t) => {
    if (t.role === "assistant") {
      return { role: "assistant", content: t.text };
    }
    const content: unknown[] = [];
    for (const a of t.attachments ?? []) content.push(...attachmentBlocks(a));
    if (t.text) content.push({ type: "text", text: t.text });
    if (content.length === 0) content.push({ type: "text", text: "" });
    return { role: "user", content };
  });
}

export type StreamChatOptions = {
  model: string;
  effort: string;
  system: string;
  turns: ChatTurn[];
  maxTokens?: number;
};

/** Stream a chat completion, yielding incremental events. */
export async function* streamChat(
  opts: StreamChatOptions,
): AsyncGenerator<StreamEvent> {
  const { model, effort } = resolveModel(opts.model, opts.effort);

  const params: Record<string, unknown> = {
    model: model.id,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    messages: toMessages(opts.turns),
  };
  if (model.adaptiveThinking) {
    params.thinking = { type: "adaptive", display: "summarized" };
  }
  if (effort) {
    params.output_config = { effort };
  }

  try {
    // Cast: cutting-edge fields (output_config, adaptive thinking) may not be in
    // the installed SDK's static types, but are valid at runtime.
    const stream = (anthropic().messages as unknown as {
      stream: (p: unknown) => AsyncIterable<unknown> & {
        finalMessage: () => Promise<unknown>;
      };
    }).stream(params);

    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      if (event.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "thinking_delta") {
          yield { type: "thinking", text: String(delta.thinking ?? "") };
        } else if (delta?.type === "text_delta") {
          yield { type: "text", text: String(delta.text ?? "") };
        }
      }
    }

    const final = (await stream.finalMessage()) as {
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    yield {
      type: "done",
      inputTokens: final.usage?.input_tokens ?? 0,
      outputTokens: final.usage?.output_tokens ?? 0,
    };
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export type GenerateResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** Non-streaming, one-shot generation used by construction features. */
export async function generate(opts: {
  model?: string;
  effort?: string;
  system: string;
  turns: ChatTurn[];
  maxTokens?: number;
}): Promise<GenerateResult> {
  const { model, effort } = resolveModel(
    opts.model ?? "claude-opus-4-8",
    opts.effort ?? "high",
  );

  const params: Record<string, unknown> = {
    model: model.id,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    messages: toMessages(opts.turns),
  };
  if (model.adaptiveThinking) params.thinking = { type: "adaptive" };
  if (effort) params.output_config = { effort };

  const msg = (await (anthropic().messages as unknown as {
    create: (p: unknown) => Promise<unknown>;
  }).create(params)) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = (msg.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();

  return {
    text,
    model: model.id,
    inputTokens: msg.usage?.input_tokens ?? 0,
    outputTokens: msg.usage?.output_tokens ?? 0,
  };
}

/** Extract the first JSON object/array from a model response. */
export function extractJson<T = unknown>(text: string): T | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.search(/[{[]/);
  if (start === -1) return null;
  // Walk to the matching closing bracket.
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === open) depth++;
    else if (candidate[i] === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
