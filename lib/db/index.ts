import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
// Relative so non-Next entrypoints (tsx scripts like db:seed) resolve it too.
import { env } from "../env";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function getPool(): Pool {
  // env throws at import (and at boot via instrumentation.ts) when
  // DATABASE_URL is missing/malformed — no masked fallback pool anymore.
  if (!global.__pgPool) {
    global.__pgPool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 5,
    });
  }
  return global.__pgPool;
}

export const db = drizzle(getPool(), { schema });
export { schema };
