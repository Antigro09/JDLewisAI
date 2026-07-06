import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectFiles, projects } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/server";
import { generate } from "@/lib/claude/chat";
import { embeddingsConfigured } from "@/lib/embeddings";
import {
  ensureProjectFileEmbeddings,
  semanticSearchProjectFiles,
  isTextExtractableFile,
  type ProjectFileHit,
} from "@/lib/retrieval";

export const runtime = "nodejs";
export const maxDuration = 60;

/** A source passage the answer was grounded on, surfaced to the UI. */
type Citation = {
  index: number;
  fileId: string;
  fileName: string;
  projectId: string;
  projectName: string;
  chunkIndex: number;
  snippet: string;
  score: number;
};

const SEMANTIC_TOP_K = 12;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { query, projectId } = await req.json() as { query: string; projectId?: string };
  if (!query?.trim()) return NextResponse.json({ error: "Query required" }, { status: 400 });

  // Load all text-based project files for this user's project(s)
  const userProjects = projectId
    ? await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)))
    : await db.select().from(projects).where(eq(projects.ownerId, user.id));

  if (userProjects.length === 0) {
    return NextResponse.json({ results: [], answer: "No projects found." });
  }

  const projectIds = userProjects.map((p) => p.id);
  const allFiles = await Promise.all(
    projectIds.map((pid) =>
      db.select().from(projectFiles).where(eq(projectFiles.projectId, pid))
    )
  );
  const files = allFiles.flat();

  const textFiles = files.filter((f) => isTextExtractableFile(f.mime));

  if (textFiles.length === 0) {
    return NextResponse.json({
      results: [],
      answer: "No searchable text files found in your projects. Upload text, CSV, or JSON project files to enable knowledge search.",
    });
  }

  // Semantic path: rank chunks by relevance via pgvector and ground the answer
  // on cited passages. Falls through to the full-text dump when embeddings
  // aren't configured or the vector search comes back empty (e.g. pgvector
  // extension missing — semanticSearchProjectFiles logs and returns []).
  if (embeddingsConfigured()) {
    const hits: (ProjectFileHit & { projectId: string })[] = [];
    for (const pid of projectIds) {
      await ensureProjectFileEmbeddings(pid);
      const projectHits = await semanticSearchProjectFiles(pid, query, SEMANTIC_TOP_K);
      hits.push(...projectHits.map((h) => ({ ...h, projectId: pid })));
    }
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, SEMANTIC_TOP_K);

    if (top.length > 0) {
      const projectName = (pid: string) =>
        userProjects.find((p) => p.id === pid)?.name ?? "Unknown";
      const passages = top
        .map(
          (h, i) =>
            `[${i + 1}] File: ${h.fileName} (Project: ${projectName(h.projectId)})\n${h.content}`,
        )
        .join("\n\n---\n\n");

      const system = `You are a construction AI assistant with access to the company's project knowledge base.
Answer the user's question using only the numbered source passages provided.
Cite the passages you rely on inline with bracketed numbers like [1] or [2][3].
If the answer isn't in the passages, say so clearly. Be concise and specific.`;

      const result = await generate({
        effort: "medium",
        system,
        maxTokens: 2000,
        turns: [
          {
            role: "user",
            text: `Source passages from project files:\n\n${passages}\n\n---\n\nQuestion: ${query}`,
          },
        ],
      });

      const citations: Citation[] = top.map((h, i) => ({
        index: i + 1,
        fileId: h.fileId,
        fileName: h.fileName,
        projectId: h.projectId,
        projectName: projectName(h.projectId),
        chunkIndex: h.chunkIndex,
        snippet: h.content.slice(0, 240),
        score: Math.round(h.score * 1000) / 1000,
      }));

      return NextResponse.json({
        answer: result.text,
        filesSearched: textFiles.length,
        citations,
      });
    }
  }

  // Fallback (no embeddings key, or vector search unavailable): the original
  // unranked full-text dump, capped at 60k chars total.
  let budget = 60_000;
  const chunks: string[] = [];
  for (const f of textFiles) {
    if (budget <= 0) break;
    const proj = userProjects.find((p) => p.id === f.projectId);
    let content = "";
    try {
      content = Buffer.from(f.data, "base64").toString("utf8");
    } catch {
      continue;
    }
    const slice = content.slice(0, Math.min(budget, 10_000));
    budget -= slice.length;
    chunks.push(`[Project: ${proj?.name ?? "Unknown"} | File: ${f.name}]\n${slice}`);
  }

  const context = chunks.join("\n\n---\n\n");
  const system = `You are a construction AI assistant with access to the company's project knowledge base.
Answer the user's question using only the information found in the provided project files.
If the answer isn't in the files, say so clearly. Be concise and specific.`;

  const result = await generate({
    effort: "medium",
    system,
    maxTokens: 2000,
    turns: [
      {
        role: "user",
        text: `Project Knowledge Base:\n\n${context}\n\n---\n\nQuestion: ${query}`,
      },
    ],
  });

  return NextResponse.json({ answer: result.text, filesSearched: textFiles.length, citations: [] });
}
