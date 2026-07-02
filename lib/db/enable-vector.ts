import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required.");

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log("pgvector extension is enabled.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
