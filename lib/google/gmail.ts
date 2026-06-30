import { gfetch, b64urlEncode, b64urlDecode } from "./http";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailSummary = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: GmailHeader[];
};
type GmailMessage = {
  id: string;
  snippet?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
};

function header(headers: GmailHeader[] | undefined, name: string): string {
  return (
    headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

function extractBody(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return b64urlDecode(part.body.data);
  }
  if (part.parts) {
    // Prefer text/plain, then fall back to any text.
    const plain = part.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return b64urlDecode(plain.body.data);
    for (const sub of part.parts) {
      const t = extractBody(sub);
      if (t) return t;
    }
  }
  if (part.body?.data) return b64urlDecode(part.body.data);
  return "";
}

export async function gmailSearch(
  token: string,
  query: string,
  maxResults = 10,
): Promise<GmailSummary[]> {
  const list = await gfetch<{ messages?: { id: string }[] }>(
    token,
    `${API}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  const out: GmailSummary[] = [];
  for (const id of ids) {
    const msg = await gfetch<GmailMessage>(
      token,
      `${API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    out.push({
      id,
      from: header(msg.payload?.headers, "From"),
      subject: header(msg.payload?.headers, "Subject"),
      date: header(msg.payload?.headers, "Date"),
      snippet: msg.snippet ?? "",
    });
  }
  return out;
}

export async function gmailReadMessage(
  token: string,
  id: string,
): Promise<{
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
}> {
  const msg = await gfetch<GmailMessage>(
    token,
    `${API}/messages/${id}?format=full`,
  );
  let body = extractBody(msg.payload);
  if (body.length > 50_000) body = body.slice(0, 50_000) + "\n…[truncated]";
  return {
    from: header(msg.payload?.headers, "From"),
    to: header(msg.payload?.headers, "To"),
    subject: header(msg.payload?.headers, "Subject"),
    date: header(msg.payload?.headers, "Date"),
    body,
  };
}

function buildRaw(opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
}): string {
  const lines = [
    `To: ${opts.to}`,
    opts.cc ? `Cc: ${opts.cc}` : "",
    `Subject: ${opts.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    opts.body,
  ].filter((l) => l !== "");
  return b64urlEncode(lines.join("\r\n"));
}

export async function gmailSend(
  token: string,
  opts: { to: string; subject: string; body: string; cc?: string },
): Promise<{ id: string; threadId: string }> {
  return gfetch<{ id: string; threadId: string }>(
    token,
    `${API}/messages/send`,
    { method: "POST", body: JSON.stringify({ raw: buildRaw(opts) }) },
  );
}

export async function gmailCreateDraft(
  token: string,
  opts: { to: string; subject: string; body: string; cc?: string },
): Promise<{ id: string }> {
  return gfetch<{ id: string }>(token, `${API}/drafts`, {
    method: "POST",
    body: JSON.stringify({ message: { raw: buildRaw(opts) } }),
  });
}
