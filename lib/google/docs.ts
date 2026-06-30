import { gfetch } from "./http";

function docLink(documentId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

export async function docsCreate(
  token: string,
  title: string,
  content?: string,
): Promise<{ documentId: string; link: string }> {
  const created = await gfetch<{ documentId: string }>(
    token,
    "https://docs.googleapis.com/v1/documents",
    { method: "POST", body: JSON.stringify({ title }) },
  );
  const documentId = created.documentId;

  if (content && content.trim()) {
    await gfetch(
      token,
      `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({
          requests: [{ insertText: { location: { index: 1 }, text: content } }],
        }),
      },
    );
  }
  return { documentId, link: docLink(documentId) };
}

export async function docsAppendText(
  token: string,
  documentId: string,
  text: string,
): Promise<{ documentId: string; link: string }> {
  await gfetch(
    token,
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              endOfSegmentLocation: {},
              text: text.startsWith("\n") ? text : `\n${text}`,
            },
          },
        ],
      }),
    },
  );
  return { documentId, link: docLink(documentId) };
}

export async function docsReplaceText(
  token: string,
  documentId: string,
  find: string,
  replace: string,
): Promise<{ documentId: string; link: string; replacements: number }> {
  const res = await gfetch<{
    replies?: { replaceAllText?: { occurrencesChanged?: number } }[];
  }>(
    token,
    `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            replaceAllText: {
              containsText: { text: find, matchCase: false },
              replaceText: replace,
            },
          },
        ],
      }),
    },
  );
  const replacements =
    res.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
  return { documentId, link: docLink(documentId), replacements };
}
