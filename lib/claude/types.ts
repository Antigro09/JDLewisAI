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

export type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; inputTokens: number; outputTokens: number };
