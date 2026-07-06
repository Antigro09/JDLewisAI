// Runs before every test file. lib/env validates and snapshots the
// environment at import time, so required vars must exist before any module
// under test (lib/crypto, lib/db, ...) is loaded.

/** Valid 32-byte base64 key for lib/crypto (deterministic, test-only). */
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
