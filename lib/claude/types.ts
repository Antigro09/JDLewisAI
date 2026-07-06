export type Attachment = {
  mime: string;
  name: string;
  dataBase64: string;
};

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  attachments?: Attachment[];
};

/** System prompt split for prompt caching: `stable` (base prompt, tool notes,
 * memory, skills, personalization, project context) is cached with a
 * cache_control breakpoint; `volatile` (per-message mode/toggle notes) is sent
 * as a separate block after the breakpoint so toggles don't bust the cache. */
export type SystemPromptParts = { stable: string; volatile: string };

/** Join parts back into one string (paths that can't use split blocks). */
export function joinSystemParts(system: string | SystemPromptParts): string {
  if (typeof system === "string") return system;
  return [system.stable, system.volatile].filter(Boolean).join("\n\n");
}

export type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string; retryable?: boolean }
  | {
      type: "done";
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    };
