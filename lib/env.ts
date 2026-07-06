import { z } from "zod";

/**
 * Validated server environment. Imported by lib/db, lib/crypto and
 * lib/auth/session (and re-imported from instrumentation.ts at boot), so a
 * missing or malformed variable fails fast with a readable message instead of
 * surfacing as a broken query or an undecryptable secret later.
 *
 * Edge-safe: also runs inside middleware, so no Node-only APIs here.
 */

/** Byte length of a base64 string, or null if it doesn't decode. */
function base64ByteLength(value: string): number | null {
  try {
    if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").length;
    return atob(value).length;
  } catch {
    return null;
  }
}

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\/.+/, "must be a postgres:// connection string");

const schema = z
  .object({
    DATABASE_URL: postgresUrl,
    DIRECT_URL: postgresUrl.optional(),
    AUTH_SECRET: z
      .string()
      .min(32, "must be at least 32 characters (openssl rand -base64 32)"),
    ENCRYPTION_KEY: z
      .string()
      .refine(
        (v) => base64ByteLength(v) === 32,
        "must be base64 that decodes to exactly 32 bytes (openssl rand -base64 32)",
      ),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    CRON_SECRET: z.string().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_REDIRECT_URI: z.string().url().optional(),
    GOOGLE_AUTH_REDIRECT_URI: z.string().url().optional(),
    EMBEDDINGS_API_KEY: z.string().min(1).optional(),
    EMBEDDINGS_MODEL: z.string().min(1).optional(),
    EMBEDDINGS_BASE_URL: z.string().url().optional(),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.GOOGLE_CLIENT_ID) !== Boolean(v.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_CLIENT_ID"],
        message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together",
      });
    }
  });

export type Env = z.infer<typeof schema>;

/** Treat empty strings (common in copied .env templates) as unset. */
function clean(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value : undefined;
}

// Static property access so bundlers can inline values for the edge runtime.
const raw = {
  DATABASE_URL: clean(process.env.DATABASE_URL),
  DIRECT_URL: clean(process.env.DIRECT_URL),
  AUTH_SECRET: clean(process.env.AUTH_SECRET),
  ENCRYPTION_KEY: clean(process.env.ENCRYPTION_KEY),
  ANTHROPIC_API_KEY: clean(process.env.ANTHROPIC_API_KEY),
  CRON_SECRET: clean(process.env.CRON_SECRET),
  GOOGLE_CLIENT_ID: clean(process.env.GOOGLE_CLIENT_ID),
  GOOGLE_CLIENT_SECRET: clean(process.env.GOOGLE_CLIENT_SECRET),
  GOOGLE_REDIRECT_URI: clean(process.env.GOOGLE_REDIRECT_URI),
  GOOGLE_AUTH_REDIRECT_URI: clean(process.env.GOOGLE_AUTH_REDIRECT_URI),
  EMBEDDINGS_API_KEY: clean(process.env.EMBEDDINGS_API_KEY),
  EMBEDDINGS_MODEL: clean(process.env.EMBEDDINGS_MODEL),
  EMBEDDINGS_BASE_URL: clean(process.env.EMBEDDINGS_BASE_URL),
};

function loadEnv(): Env {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const detail = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`)
    .join("\n");
  // `next build` imports route modules without runtime secrets (e.g. CI);
  // don't break the build — instrumentation.ts re-validates at server boot.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    console.warn(`Environment not fully configured (build phase):\n${detail}`);
    return raw as Env;
  }
  throw new Error(
    `Invalid environment configuration:\n${detail}\nSee .env.example for the expected format.`,
  );
}

export const env: Env = loadEnv();
