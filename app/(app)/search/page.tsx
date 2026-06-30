"use client";

import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Button, Card, Textarea } from "@/components/ui";
import { Markdown } from "@/components/markdown";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [filesSearched, setFilesSearched] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json() as { answer?: string; filesSearched?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setAnswer(data.answer ?? "");
      setFilesSearched(data.filesSearched ?? 0);
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
              Searched {filesSearched} text file{filesSearched !== 1 ? "s" : ""} across your projects
            </p>
          )}
          <Markdown content={answer} />
        </Card>
      )}

      {answer === null && !loading && !error && (
        <div className="mt-6 text-sm text-neutral-500">
          <p className="font-medium">Tips:</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            <li>Upload text-based specs, notes, or CSV files to your projects for best results.</li>
            <li>PDFs and images are not searchable — convert them to text first.</li>
            <li>Ask specific questions for more precise answers.</li>
          </ul>
        </div>
      )}
    </PageShell>
  );
}
