import crypto from "node:crypto";
import { Column, Param, SQL, StringChunk, getTableColumns } from "drizzle-orm";
import { conversations, messages } from "@/lib/db/schema";

/**
 * In-memory stand-in for the drizzle `db` export, for unit tests that
 * `vi.mock("@/lib/db")`. Supports exactly the query shapes used by
 * lib/chat/branches.ts: select/insert/update on `messages`/`conversations`
 * with `eq`/`and`/`isNull` filters, `asc`/`desc` ordering and `limit`.
 * Conditions are evaluated by walking the drizzle SQL chunk tree, so the
 * real schema column objects (and thus the real query code) are exercised.
 */

export type Row = Record<string, unknown>;
export type MockDbState = { messages: Row[]; conversations: Row[] };

type Token =
  | { kind: "col"; key: string }
  | { kind: "param"; value: unknown }
  | { kind: "text"; text: string };

// Identity map from schema Column objects to their TS row keys.
const columnKeys = new Map<Column, string>();
for (const table of [messages, conversations]) {
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    columnKeys.set(col, key);
  }
}

function keyOf(col: Column): string {
  const key = columnKeys.get(col);
  if (!key) throw new Error("mock db: column from an unsupported table");
  return key;
}

function flatten(node: unknown, out: Token[]): void {
  if (node instanceof SQL) {
    for (const chunk of (node as unknown as { queryChunks: unknown[] }).queryChunks) {
      flatten(chunk, out);
    }
    return;
  }
  if (node instanceof Column) {
    out.push({ kind: "col", key: keyOf(node) });
    return;
  }
  if (node instanceof StringChunk) {
    out.push({ kind: "text", text: (node as unknown as { value: string[] }).value.join("") });
    return;
  }
  if (node instanceof Param) {
    out.push({ kind: "param", value: (node as unknown as { value: unknown }).value });
    return;
  }
  throw new Error(`mock db: unsupported SQL chunk ${String(node)}`);
}

/** Compiles an eq/and/isNull condition into a row predicate. */
function compileWhere(cond: SQL | undefined): (row: Row) => boolean {
  if (!cond) return () => true;
  const toks: Token[] = [];
  flatten(cond, toks);
  const preds: ((row: Row) => boolean)[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== "col") continue;
    const next = toks[i + 1];
    if (next?.kind === "text" && next.text.trim() === "=") {
      const p = toks[i + 2];
      if (p?.kind !== "param") throw new Error("mock db: expected param after '='");
      const { key } = t;
      const { value } = p;
      preds.push((row) => row[key] === value);
      i += 2;
    } else if (next?.kind === "text" && next.text.includes("is null")) {
      const { key } = t;
      preds.push((row) => row[key] == null);
      i += 1;
    } else {
      throw new Error("mock db: unsupported where operator");
    }
  }
  return (row) => preds.every((p) => p(row));
}

function compileOrder(exprs: SQL[]): (a: Row, b: Row) => number {
  const specs = exprs.map((expr) => {
    const toks: Token[] = [];
    flatten(expr, toks);
    const col = toks.find((t) => t.kind === "col");
    if (col?.kind !== "col") throw new Error("mock db: orderBy without a column");
    const dir = toks.some((t) => t.kind === "text" && t.text.includes("desc")) ? -1 : 1;
    return { key: col.key, dir };
  });
  return (a, b) => {
    for (const { key, dir } of specs) {
      const av = a[key] as number;
      const bv = b[key] as number;
      if (av < bv) return -dir;
      if (av > bv) return dir;
    }
    return 0;
  };
}

function project(row: Row, fields: Record<string, Column> | undefined): Row {
  if (!fields) return { ...row };
  const out: Row = {};
  for (const [alias, col] of Object.entries(fields)) out[alias] = row[keyOf(col)];
  return out;
}

export function createMockDb(state: MockDbState) {
  const rowsFor = (table: unknown): Row[] => {
    if (table === messages) return state.messages;
    if (table === conversations) return state.conversations;
    throw new Error("mock db: unsupported table");
  };

  function selectChain(fields?: Record<string, Column>) {
    let rows: Row[] = [];
    let where: (row: Row) => boolean = () => true;
    let sort: ((a: Row, b: Row) => number) | null = null;
    let take: number | null = null;
    const exec = (): Row[] => {
      let result = rows.filter(where);
      if (sort) result = [...result].sort(sort);
      if (take !== null) result = result.slice(0, take);
      return result.map((r) => project(r, fields));
    };
    const chain = {
      from(table: unknown) {
        rows = rowsFor(table);
        return chain;
      },
      where(cond: SQL | undefined) {
        where = compileWhere(cond);
        return chain;
      },
      orderBy(...exprs: SQL[]) {
        sort = compileOrder(exprs);
        return chain;
      },
      limit(n: number) {
        take = n;
        return chain;
      },
      // Awaitable at any point in the chain, like the real builder.
      then<T>(resolve: (rows: Row[]) => T, reject?: (err: unknown) => T) {
        return Promise.resolve().then(exec).then(resolve, reject);
      },
    };
    return chain;
  }

  return {
    select: (fields?: Record<string, Column>) => selectChain(fields),
    insert: (table: unknown) => ({
      values: (values: Row) => ({
        returning: async (fields?: Record<string, Column>) => {
          const row: Row = { id: crypto.randomUUID(), createdAt: new Date(), ...values };
          rowsFor(table).push(row);
          return [project(row, fields)];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Row) => ({
        where: async (cond: SQL | undefined) => {
          const match = compileWhere(cond);
          for (const row of rowsFor(table)) {
            if (match(row)) Object.assign(row, patch);
          }
        },
      }),
    }),
  };
}
