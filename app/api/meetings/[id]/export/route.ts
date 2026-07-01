import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { meetingArtifacts } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { loadMeetingBundle } from "@/lib/meetings/access";
import {
  actionItemsCsv,
  meetingEmailSummary,
  meetingToHtml,
  meetingToMarkdown,
} from "@/lib/meetings/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Format = "markdown" | "html" | "word" | "csv" | "email" | "json" | "pdf";

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

  const variants: Record<
    Exclude<Format, "pdf">,
    { content: string; mime: string; ext: string; type: "minutes" | "html" | "word" | "spreadsheet" | "email" }
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
    word: {
      content: meetingToHtml(bundle),
      mime: "application/msword; charset=utf-8",
      ext: "doc",
      type: "word",
    },
    csv: {
      content: actionItemsCsv(bundle),
      mime: "text/csv; charset=utf-8",
      ext: "csv",
      type: "spreadsheet",
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
  const selected = variants[format] ?? variants.markdown;
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
