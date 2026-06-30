import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    // Defer hard failure to query time so that `next build` (which does not
    // connect) succeeds without a database.
    return new Pool({ connectionString: "postgresql://invalid" });
  }
  if (!global.__pgPool) {
    global.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
  }
  return global.__pgPool;
}

export const db = drizzle(getPool(), { schema });
export { schema };
