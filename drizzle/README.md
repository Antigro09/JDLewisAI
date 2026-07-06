# Migrations

Schema changes are now committed SQL (generated with `npm run db:generate`)
and applied with `npm run db:migrate` (tracked in `drizzle.__drizzle_migrations`).
`db:push` remains for local prototyping only — don't push against production.

## Fresh database

```bash
npm run db:migrate   # applies 0000_init.sql (includes CREATE EXTENSION vector)
npm run db:seed
```

## Existing database (created with db:push before migrations existed)

The tables already exist, so `db:migrate` must not re-run `0000_init.sql`.
One-time baseline:

1. Bring the DB up to date with the current schema once more: `npm run db:push`.
2. Mark migration 0000 as already applied (hash = the `tag`'s entry in
   `drizzle/meta/_journal.json` doesn't matter — drizzle keys on hash of the
   SQL file):

   ```sql
   CREATE SCHEMA IF NOT EXISTS drizzle;
   CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
     id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
   );
   -- hash = sha256 hex of drizzle/0000_init.sql contents; created_at = the
   -- "when" value for tag 0000_init in drizzle/meta/_journal.json
   INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
   VALUES ('<sha256-of-0000_init.sql>', <when-from-journal>);
   ```

   (Or simply keep using `db:push` for this deployment and start applying
   generated migrations from `0001_*` onward after baselining.)

From here on: edit `lib/db/schema.ts` → `npm run db:generate` → review the
new SQL file → commit it → `npm run db:migrate` on deploy.
