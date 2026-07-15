import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { users } from "../lib/db/schema";

/**
 * Promote an existing user to SUPERADMIN (the app owner's role — sees the
 * /owner console and everything ADMIN sees). Bumps tokenVersion so stale
 * sessions are revoked; the user must sign in again to pick up the role.
 *
 * Usage: npm run db:promote-superadmin -- you@example.com
 *        (or set SUPERADMIN_EMAIL in the environment)
 */
async function main() {
  const email = (process.argv[2] || process.env.SUPERADMIN_EMAIL || "")
    .toLowerCase()
    .trim();
  if (!email) {
    throw new Error(
      "Pass an email: npm run db:promote-superadmin -- you@example.com",
    );
  }

  const existing = (
    await db.select().from(users).where(eq(users.email, email))
  )[0];
  if (!existing) {
    throw new Error(`No user with email ${email} — create the account first.`);
  }

  await db
    .update(users)
    .set({
      role: "SUPERADMIN",
      disabled: false,
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.id, existing.id));
  console.log(`Promoted ${email} -> SUPERADMIN (sign in again to apply).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
