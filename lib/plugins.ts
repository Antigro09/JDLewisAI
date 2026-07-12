import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { pluginSettings } from "@/lib/db/schema";

export type PluginDef = {
  id: string;
  label: string;
  description: string;
  default: boolean;
};

export const PLUGINS: PluginDef[] = [
  {
    id: "google",
    label: "Google Workspace",
    description:
      "Drive, Docs, Sheets, and Gmail tools in chat (requires connecting your Google account in Settings).",
    default: true,
  },
  {
    id: "web_search",
    label: "Web Search",
    description:
      "Let the AI search the web for current information. May add a small per-search cost.",
    default: false,
  },
  {
    id: "material_takeoff",
    label: "Material Takeoff",
    description:
      "Let the AI run a material takeoff from drawings you attach in chat (detects and measures walls, doors, flooring, and columns via the takeoff engine).",
    default: true,
  },
];

export function getPlugin(id: string): PluginDef | undefined {
  return PLUGINS.find((p) => p.id === id);
}

export async function getOrgDefaults(): Promise<Record<string, boolean>> {
  const rows = await db
    .select()
    .from(pluginSettings)
    .where(eq(pluginSettings.scope, "org"));
  const m: Record<string, boolean> = {};
  for (const r of rows) m[r.pluginId] = r.enabled;
  return m;
}

export async function getUserOverrides(
  userId: string,
): Promise<Record<string, boolean>> {
  const rows = await db
    .select()
    .from(pluginSettings)
    .where(
      and(eq(pluginSettings.scope, "user"), eq(pluginSettings.userId, userId)),
    );
  const m: Record<string, boolean> = {};
  for (const r of rows) m[r.pluginId] = r.enabled;
  return m;
}

/** Effective plugin state for a user: user override → org default → built-in default. */
export async function effectivePlugins(
  userId: string,
): Promise<Record<string, boolean>> {
  const [org, user] = await Promise.all([
    getOrgDefaults(),
    getUserOverrides(userId),
  ]);
  const out: Record<string, boolean> = {};
  for (const p of PLUGINS) {
    out[p.id] = user[p.id] ?? org[p.id] ?? p.default;
  }
  return out;
}

export async function setUserPlugin(
  userId: string,
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  const existing = (
    await db
      .select()
      .from(pluginSettings)
      .where(
        and(
          eq(pluginSettings.scope, "user"),
          eq(pluginSettings.userId, userId),
          eq(pluginSettings.pluginId, pluginId),
        ),
      )
  )[0];
  if (existing) {
    await db
      .update(pluginSettings)
      .set({ enabled })
      .where(eq(pluginSettings.id, existing.id));
  } else {
    await db
      .insert(pluginSettings)
      .values({ scope: "user", userId, pluginId, enabled });
  }
}

export async function setOrgPlugin(
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  const existing = (
    await db
      .select()
      .from(pluginSettings)
      .where(
        and(
          eq(pluginSettings.scope, "org"),
          isNull(pluginSettings.userId),
          eq(pluginSettings.pluginId, pluginId),
        ),
      )
  )[0];
  if (existing) {
    await db
      .update(pluginSettings)
      .set({ enabled })
      .where(eq(pluginSettings.id, existing.id));
  } else {
    await db
      .insert(pluginSettings)
      .values({ scope: "org", userId: null, pluginId, enabled });
  }
}
