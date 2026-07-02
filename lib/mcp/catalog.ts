/**
 * Curated list of well-known remote MCP servers a user can connect from the
 * Connections marketplace. URLs are pre-filled but editable at connect time, so
 * a drifted endpoint can be corrected without a code change. Most of these use
 * OAuth — the user obtains an access token from the service (or via the MCP
 * inspector) and pastes it; the app stores it encrypted per-user.
 *
 * `auth: "token"` → a bearer/OAuth token is required. `"none"` → open server.
 */
export type McpCatalogEntry = {
  id: string;
  label: string;
  description: string;
  url: string;
  auth: "token" | "none";
  /** Short hint shown next to the token field. */
  tokenHint?: string;
};

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "notion",
    label: "Notion",
    description: "Search and edit your Notion pages, wikis, and databases.",
    url: "https://mcp.notion.com/mcp",
    auth: "token",
    tokenHint: "Notion OAuth access token",
  },
  {
    id: "asana",
    label: "Asana",
    description: "Read and update Asana projects, tasks, and assignments.",
    url: "https://mcp.asana.com/sse",
    auth: "token",
    tokenHint: "Asana OAuth access token",
  },
  {
    id: "linear",
    label: "Linear",
    description: "Manage Linear issues, projects, and cycles.",
    url: "https://mcp.linear.app/sse",
    auth: "token",
    tokenHint: "Linear OAuth access token",
  },
  {
    id: "atlassian",
    label: "Atlassian (Jira & Confluence)",
    description: "Work with Jira issues and Confluence pages.",
    url: "https://mcp.atlassian.com/v1/sse",
    auth: "token",
    tokenHint: "Atlassian OAuth access token",
  },
  {
    id: "zapier",
    label: "Zapier",
    description:
      "Connect 6,000+ apps (QuickBooks, Slack, spreadsheets, and more) through Zapier.",
    url: "https://mcp.zapier.com/api/mcp/mcp",
    auth: "token",
    tokenHint: "Your Zapier MCP token (from the Zapier MCP settings)",
  },
  {
    id: "stripe",
    label: "Stripe",
    description: "Look up customers, invoices, and payments in Stripe.",
    url: "https://mcp.stripe.com",
    auth: "token",
    tokenHint: "Stripe secret or OAuth token",
  },
  {
    id: "square",
    label: "Square",
    description: "Access Square payments, invoices, and customers.",
    url: "https://mcp.squareup.com/sse",
    auth: "token",
    tokenHint: "Square OAuth access token",
  },
  {
    id: "github",
    label: "GitHub",
    description: "Search repos, read code, and manage issues and PRs.",
    url: "https://api.githubcopilot.com/mcp/",
    auth: "token",
    tokenHint: "GitHub personal access token",
  },
];

export function getCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id);
}
