"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";

type McpConnectState = { error?: string };

/**
 * Connect form for one MCP server (a catalog entry or a custom server). The
 * server action is passed in as a prop so this client component never imports
 * the "use server" module directly.
 */
export function McpConnectForm({
  action,
  serverId,
  defaultUrl,
  tokenHint,
  custom = false,
}: {
  action: (prev: McpConnectState, fd: FormData) => Promise<McpConnectState>;
  serverId: string;
  defaultUrl?: string;
  tokenHint?: string;
  custom?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="serverId" value={serverId} />
      {custom && (
        <Input name="name" placeholder="Display name (e.g. Procore)" required />
      )}
      <Input
        name="url"
        defaultValue={defaultUrl}
        placeholder="https://mcp.example.com/sse"
        required
      />
      <Input
        name="token"
        type="password"
        placeholder={tokenHint ? `${tokenHint}` : "Access token (leave blank for open servers)"}
      />
      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Connecting…" : "Connect"}
      </Button>
    </form>
  );
}
