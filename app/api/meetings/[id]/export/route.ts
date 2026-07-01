import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { meetingArtifacts } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { loadMeetingBundle } from "@/lib/meetings/access";
import {
  actionItemsRows,
  meetingEmailSummary,
  meetingToHtml,
  meetingToMarkdown,
} from "@/lib/meetings/export";
import { getValidAccessToken, GoogleNotConnectedError } from "@/lib/google/client";
import { docsCreate } from "@/lib/google/docs";
import { sheetsCreate } from "@/lib/google/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Word/Excel downloads were dropped in favor of the app's existing Google
// connection: minutes export to a real Google Doc, action items to a Google
// Sheet. Plain downloads (markdown/html/email/json) and print-to-PDF remain.
type Format = "markdown" | "html" | "email" | "json" | "pdf" | "gdoc" | "gsheet";

function filename(title: string, ext: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "meeting"}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const bundle = await loadMeetingBundle(user, id);
  if (!bundle) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  let body: { format?: Format } = {};
  try {
    body = (await req.json()) as { format?: Format };
  } catch {
    body = {};
  }
  const format = body.format ?? "markdown";

  if (format === "pdf") {
    return NextResponse.json({ printUrl: `/print/meeting-minutes/${id}` });
  }

  // Google exports create real Drive files and return their links.
  if (format === "gdoc" || format === "gsheet") {
    let token: string;
    try {
      token = await getValidAccessToken(user.id);
    } catch (err) {
      if (err instanceof GoogleNotConnectedError) {
        return NextResponse.json(
          { error: "Connect Google in Settings to export to Docs & Sheets." },
          { status: 400 },
        );
      }
      throw err;
    }

    try {
      if (format === "gdoc") {
        const { link } = await docsCreate(
          token,
          `${bundle.meeting.title} — Minutes`,
          meetingToMarkdown(bundle),
        );
        await db.insert(meetingArtifacts).values({
          meetingId: id,
          type: "minutes",
          title: `${bundle.meeting.title} Google Doc`,
          mime: "application/vnd.google-apps.document",
          content: link,
        });
        return NextResponse.json({ link });
      }
      const { link } = await sheetsCreate(
        token,
        `${bundle.meeting.title} — Action Items`,
        actionItemsRows(bundle),
      );
      await db.insert(meetingArtifacts).values({
        meetingId: id,
        type: "spreadsheet",
        title: `${bundle.meeting.title} Google Sheet`,
        mime: "application/vnd.google-apps.spreadsheet",
        content: link,
      });
      return NextResponse.json({ link });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Google export failed" },
        { status: 502 },
      );
    }
  }

  const variants: Record<
    Exclude<Format, "pdf" | "gdoc" | "gsheet">,
    { content: string; mime: string; ext: string; type: "minutes" | "html" | "email" }
  > = {
    markdown: {
      content: meetingToMarkdown(bundle),
      mime: "text/markdown; charset=utf-8",
      ext: "md",
      type: "minutes",
    },
    html: {
      content: meetingToHtml(bundle),
      mime: "text/html; charset=utf-8",
      ext: "html",
      type: "html",
    },
    email: {
      content: meetingEmailSummary(bundle),
      mime: "text/plain; charset=utf-8",
      ext: "txt",
      type: "email",
    },
    json: {
      content: JSON.stringify(bundle, null, 2),
      mime: "application/json; charset=utf-8",
      ext: "json",
      type: "minutes",
    },
  };
  const selected = variants[format as keyof typeof variants] ?? variants.markdown;
  await db.insert(meetingArtifacts).values({
    meetingId: id,
    type: selected.type,
    title: `${bundle.meeting.title} ${format}`,
    mime: selected.mime,
    content: selected.content,
  });

  return new Response(selected.content, {
    headers: {
      "Content-Type": selected.mime,
      "Content-Disposition": `attachment; filename="${filename(bundle.meeting.title, selected.ext)}"`,
      "Cache-Control": "no-store",
    },
  });
}
