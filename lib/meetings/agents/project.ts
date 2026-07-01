import { runAgent, text, clampConfidence, type AgentContext } from "./base";

/**
 * Project Detection agent (spec §8). Detects the project named in the meeting
 * with a "sticky context" rule and tracks sub-context (building / floor / area /
 * trade / contractor / equipment / materials). Reconciles spoken names against
 * the tenant's known project rows.
 */
export type ProjectDetectionResult = {
  matchedProjectId: string | null;
  projectName: string;
  building: string;
  floor: string;
  area: string;
  trades: string[];
  contractors: string[];
  equipment: string[];
  materials: string[];
  confidence: number;
};

type Raw = {
  matchedProjectId?: string | null;
  projectName?: string;
  building?: string;
  floor?: string;
  area?: string;
  trades?: string[];
  contractors?: string[];
  equipment?: string[];
  materials?: string[];
  confidence?: number;
};

const list = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean).slice(0, 25) : [];

export async function runProjectDetectionAgent(
  ctx: AgentContext,
): Promise<ProjectDetectionResult> {
  const system = `You are the Project Detection agent for a general contractor. Determine which
construction project the meeting is about. Apply a STICKY rule: once a project is named, everything
afterward belongs to it until another project is clearly named or the topic shifts.
Match the spoken project to one of the known projects when possible and return its id in
matchedProjectId (else null). Also capture sub-context actually mentioned: building, floor, area,
trades, contractors, equipment, materials. Do not invent details.
Return STRICT JSON only:
{"matchedProjectId":"id-or-null","projectName":"...","building":"","floor":"","area":"",
"trades":[],"contractors":[],"equipment":[],"materials":[],"confidence":0-100}.`;

  const raw = await runAgent<Raw>({
    ctx,
    agent: "project",
    system,
    maxTokens: 900,
    user: `Known projects (name (id)):\n${ctx.knownProjects}\n\nCurrently linked project: ${
      ctx.linkedProjectName ?? "none"
    }\n\nTranscript:\n${ctx.transcript}`,
  });

  const matchedProjectId = text(raw?.matchedProjectId) || null;
  return {
    matchedProjectId,
    projectName: text(raw?.projectName),
    building: text(raw?.building),
    floor: text(raw?.floor),
    area: text(raw?.area),
    trades: list(raw?.trades),
    contractors: list(raw?.contractors),
    equipment: list(raw?.equipment),
    materials: list(raw?.materials),
    confidence: clampConfidence(raw?.confidence),
  };
}
