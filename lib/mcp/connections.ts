import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpConnections, type McpConnection } from "@/lib/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

/** Server + toolset entries for the Messages API (mcp-client-2025-11-20). */
export type ResolvedMcp = {
  servers: {
    type: "url";
    url: string;
    name: string;
    authorization_token?: string;
  }[];
  // Allowlist mode mirrors BetaMCPToolset: default-off + per-tool enable,
  // with `configs` keyed by tool name.
  toolsets: {
    type: "mcp_toolset";
    mcp_server_name: string;
    default_config?: { enabled: boolean };
    configs?: Record<string, { enabled: boolean }>;
  }[];
};

export async function listMcpConnections(
  userId: string,
): Promise<McpConnection[]> {
  return db
    .select()
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, userId))
    .orderBy(mcpConnections.createdAt);
}

/** Turn "My Server 2" into a request-safe, unique-per-user mcp_server_name. */
export async function uniqueMcpName(
  userId: string,
  desired: string,
): Promise<string> {
  const base =
    desired
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "mcp-server";
  const existing = new Set(
    (await listMcpConnections(userId)).map((c) => c.name),
  );
  if (!existing.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function addMcpConnection(
  userId: string,
  opts: { serverId: string; name: string; url: string; token?: string },
): Promise<void> {
  await db.insert(mcpConnections).values({
    userId,
    serverId: opts.serverId,
    name: opts.name,
    url: opts.url,
    authTokenEnc: opts.token ? encryptSecret(opts.token) : null,
    enabled: true,
  });
}

export async function removeMcpConnection(
  userId: string,
  id: string,
): Promise<void> {
  await db
    .delete(mcpConnections)
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.userId, userId)));
}

export async function setMcpConnectionEnabled(
  userId: string,
  id: string,
  enabled: boolean,
): Promise<void> {
  await db
    .update(mcpConnections)
    .set({ enabled })
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.userId, userId)));
}

/** Per-connection write policy + explicit tool allowlist (null = all tools). */
export async function setMcpToolPolicy(
  userId: string,
  id: string,
  opts: { allowWrites: boolean; allowedTools: string[] | null },
): Promise<void> {
  await db
    .update(mcpConnections)
    .set({ allowWrites: opts.allowWrites, allowedTools: opts.allowedTools })
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.userId, userId)));
}

/**
 * Enabled connections shaped for a Messages API request. Tokens are decrypted
 * here (server-side only). Returns empty arrays when nothing is connected, so
 * callers can cheaply skip the MCP beta path.
 *
 * MCP tools execute server-side (Anthropic connects to the server), so gating
 * means restricting what each request exposes: a connection with an explicit
 * allowedTools list gets an allowlist toolset (everything else disabled), and
 * unattended contexts only ever see connections marked allowWrites — no human
 * is available there to confirm anything.
 */
export async function resolveActiveMcpServers(
  userId: string,
  opts?: { unattended?: boolean },
): Promise<ResolvedMcp> {
  let rows = (await listMcpConnections(userId)).filter((r) => r.enabled);
  if (opts?.unattended) rows = rows.filter((r) => r.allowWrites);
  const servers = rows.map((r) => ({
    type: "url" as const,
    url: r.url,
    name: r.name,
    ...(r.authTokenEnc
      ? { authorization_token: decryptSecret(r.authTokenEnc) }
      : {}),
  }));
  const toolsets = rows.map((r) => {
    const allowed = (r.allowedTools ?? []).map((t) => t.trim()).filter(Boolean);
    if (allowed.length === 0) {
      return { type: "mcp_toolset" as const, mcp_server_name: r.name };
    }
    return {
      type: "mcp_toolset" as const,
      mcp_server_name: r.name,
      default_config: { enabled: false },
      configs: Object.fromEntries(allowed.map((t) => [t, { enabled: true }])),
    };
  });
  return { servers, toolsets };
}
