import { gfetch } from "./http";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
};

const MAX_READ_CHARS = 100_000;

export async function driveSearch(
  token: string,
  query: string,
  pageSize = 10,
): Promise<DriveFile[]> {
  const safe = query.replace(/'/g, "\\'");
  const q = `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`;
  const params = new URLSearchParams({
    q,
    pageSize: String(pageSize),
    fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const data = await gfetch<{ files?: DriveFile[] }>(
    token,
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
  );
  return data.files ?? [];
}

export async function driveGetFile(
  token: string,
  fileId: string,
): Promise<DriveFile> {
  return gfetch<DriveFile>(
    token,
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink&supportsAllDrives=true`,
  );
}

export async function driveReadFile(
  token: string,
  fileId: string,
): Promise<{ name: string; mimeType: string; content: string }> {
  const meta = await driveGetFile(token, fileId);
  const mime = meta.mimeType;

  let content = "";
  if (mime === "application/vnd.google-apps.document") {
    content = await gfetch<string>(
      token,
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
    );
  } else if (mime === "application/vnd.google-apps.spreadsheet") {
    content = await gfetch<string>(
      token,
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`,
    );
  } else if (mime === "application/vnd.google-apps.presentation") {
    content = await gfetch<string>(
      token,
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
    );
  } else if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml"
  ) {
    content = await gfetch<string>(
      token,
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    );
  } else {
    content = `[File "${meta.name}" is ${mime}; not text-readable. Open it in Drive: ${meta.webViewLink ?? ""}]`;
  }

  if (content.length > MAX_READ_CHARS) {
    content = content.slice(0, MAX_READ_CHARS) + "\n…[truncated]";
  }
  return { name: meta.name, mimeType: mime, content };
}
