"use client";

import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Textarea } from "@/components/ui";
import { Markdown } from "@/components/markdown";

/** Source passage the answer was grounded on (semantic search only). */
type Citation = {
  index: number;
  fileId: string;
  fileName: string;
  projectId: string;
  projectName: string;
  chunkIndex: number;
  page: number | null;
  snippet: string;
  score: number;
};

type RecordHit = {
  kind: "rfi" | "submittal" | "change_order";
  title: string;
  status: string;
  snippet: string;
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [filesSearched, setFilesSearched] = useState<number | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [records, setRecords] = useState<RecordHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setCitations([]);
    setRecords([]);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json() as {
        answer?: string;
        filesSearched?: number;
        citations?: Citation[];
        records?: RecordHit[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setAnswer(data.answer ?? "");
      setFilesSearched(data.filesSearched ?? 0);
      setCitations(data.citations ?? []);
      setRecords(data.records ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Project Knowledge Search"
      description="Ask questions across all your project files — specs, drawings indexes, notes, and more."
    >
      <Card className="mb-6 p-5">
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            placeholder="e.g. What are the concrete compressive strength requirements? What's the fire alarm system specification?"
          />
          <Button type="submit" disabled={loading || !query.trim()}>
            {loading ? "Searching…" : "Search Project Files"}
          </Button>
        </form>
      </Card>

      {error && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</Card>
      )}

      {answer !== null && (
        <Card className="p-5">
          {filesSearched !== null && (
            <p className="mb-3 text-xs text-neutral-400">
              {filesSearched > 0
                ? `Answer grounded on ${filesSearched} source file${filesSearched !== 1 ? "s" : ""}`
                : "No matching source files"}
            </p>
          )}
          <div className="overflow-x-auto">
            <Markdown content={answer} />
          </div>
          {(() => {
            // Only list sources the answer actually cited ([n] markers). If the
            // model cited nothing (e.g. "I could not find this"), show none —
            // an unreferenced Sources list reads as false grounding.
            const cited = new Set(
              [...(answer ?? "").matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
            );
            const shown = citations.filter((c) => cited.has(c.index));
            return shown.length > 0 ? (
            <div className="mt-4 border-t border-neutral-200 pt-3">
              <p className="text-xs font-medium text-neutral-500">Sources</p>
              <ul className="mt-2 space-y-2">
                {shown.map((c) => (
                  <li key={`${c.fileId}-${c.chunkIndex}`} className="text-xs text-neutral-500">
                    <span className="font-medium text-neutral-700">
                      [{c.index}] {c.fileName}
                      {c.page ? ` — p.${c.page}` : ""}
                    </span>
                    <span> — {c.projectName}</span>
                    <p className="mt-0.5 text-neutral-400">{c.snippet}</p>
                  </li>
                ))}
              </ul>
            </div>
            ) : null;
          })()}
          {records.length > 0 && (
            <div className="mt-4 border-t border-neutral-200 pt-3">
              <p className="text-xs font-medium text-neutral-500">Related records</p>
              <ul className="mt-2 space-y-2">
                {records.map((r, i) => (
                  <li key={`rec-${i}`} className="text-xs text-neutral-500">
                    <span className="font-medium text-neutral-700">{r.title}</span>
                    <span className="ml-1 rounded bg-neutral-100 px-1 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                      {r.kind.replace("_", " ")} · {r.status}
                    </span>
                    <p className="mt-0.5 text-neutral-400">{r.snippet}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {answer === null && !loading && !error && (
        <div className="mt-6 text-sm text-neutral-500">
          <p className="font-medium">Tips:</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>Text files, CSVs, and PDFs with selectable text are searchable; answers cite file and page.</li>
            <li>Scanned drawings and photos without embedded text are not indexed yet.</li>
            <li>Ask specific questions — sheet numbers, spec sections, and RFI numbers all help.</li>
          </ul>
        </div>
      )}
    </PageShell>
  );
}
