import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ensureProjectFileEmbeddings,
  searchProjectKnowledge,
  planQuery,
} from "../lib/retrieval";
import {
  scoreCase,
  aggregate,
  type GoldenCase,
} from "../lib/retrieval-eval";
import { embeddingsConfigured } from "../lib/embeddings";

/**
 * Retrieval eval runner (spec §10). Scores the golden Q&A set in
 * content/eval/rag-golden.json against the live hybrid retrieval pipeline for
 * a given project.
 *
 *   npm run rag:eval -- <projectId> [path/to/golden.json]
 *
 * Requires DATABASE_URL and (for the semantic half) EMBEDDINGS_API_KEY. Seed
 * the project with the referenced documents first. Manual tool — not CI.
 */

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("Usage: npm run rag:eval -- <projectId> [goldenPath]");
    process.exit(1);
  }
  const goldenPath =
    process.argv[3] ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content", "eval", "rag-golden.json");

  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as { cases: GoldenCase[] };
  if (!embeddingsConfigured()) {
    console.warn("⚠  EMBEDDINGS not configured — evaluating the keyword-only path.");
  }

  console.log(`Indexing project ${projectId}…`);
  await ensureProjectFileEmbeddings(projectId);

  const results = [];
  for (const gold of golden.cases) {
    const plan = await planQuery(gold.question);
    const hits = await searchProjectKnowledge([projectId], gold.question, { k: 8, plan });
    const result = scoreCase(gold, hits.map((h) => ({ content: h.content, fileName: h.fileName })));
    results.push(result);
    const mark = result.hit ? "✓" : "✗";
    const detail = gold.expectNoAnswer
      ? result.hit
        ? "correctly abstained"
        : `LEAKED ${hits.length} passages`
      : result.rank > 0
        ? `rank ${result.rank}`
        : "not found";
    console.log(`  ${mark} [${gold.id}] ${detail}`);
  }

  const report = aggregate(golden.cases, results);
  console.log("\n── Retrieval eval ──");
  console.log(`recall@8:        ${(report.recall * 100).toFixed(1)}%  (${report.hits}/${report.total - (report.abstainAccuracy === null ? 0 : golden.cases.filter((c) => c.expectNoAnswer).length)} answerable)`);
  console.log(`MRR:             ${report.mrr.toFixed(3)}`);
  if (report.abstainAccuracy !== null) {
    console.log(`abstain accuracy: ${(report.abstainAccuracy * 100).toFixed(1)}%`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
