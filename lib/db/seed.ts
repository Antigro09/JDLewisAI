import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { users } from "./schema";
import { hashPassword } from "../auth/password";

async function main() {
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "";
  const name = process.env.ADMIN_NAME || "Administrator";

  if (!email || !password) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in your environment.");
  }

  const existing = (
    await db.select().from(users).where(eq(users.email, email))
  )[0];

  if (existing) {
    await db
      .update(users)
      .set({ role: "ADMIN", disabled: false })
      .where(eq(users.id, existing.id));
    console.log(`Updated existing user ${email} -> ADMIN`);
  } else {
    await db.insert(users).values({
      email,
      name,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
    });
    console.log(`Created admin user ${email}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
