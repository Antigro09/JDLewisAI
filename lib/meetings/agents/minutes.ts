import { runAgent, text, type AgentContext } from "./base";

/**
 * Meeting Minutes agent + Quality Assurance agent (spec §14). These are two
 * distinct agents run in sequence: Minutes drafts company-format minutes from
 * the consolidated brief; QA verifies completeness/dedupe/formatting/tone and
 * returns the corrected final plus its QA notes.
 */

export async function runMinutesAgent(
  ctx: AgentContext,
  structuredBrief: string,
): Promise<string> {
  const system = `You are the Meeting Minutes agent for a general construction company. Write
professional, well-structured meeting minutes in company format from the structured brief and
transcript. Include: header (title, date, attendees, project), summary, discussion by topic,
decisions, action items (owner / task / due / priority), risks, and follow-ups. Use clear headings
and tables where helpful. Do not invent attendees, dates, or approvals.
Return STRICT JSON only: {"minutesMarkdown":"..."}.`;

  const raw = await runAgent<{ minutesMarkdown?: string }>({
    ctx,
    agent: "minutes",
    system,
    maxTokens: 4000,
    user: `STRUCTURED BRIEF:\n${structuredBrief}\n\nTRANSCRIPT:\n${ctx.transcript}`,
  });
  return text(raw?.minutesMarkdown);
}

export async function runQaAgent(
  ctx: AgentContext,
  draftMinutes: string,
  structuredBrief: string,
): Promise<{ minutesMarkdown: string; qaNotes: string[] }> {
  const system = `You are the Quality Assurance agent for meeting minutes. Verify the draft against
the brief and fix issues: no missing attendees, projects, action items, or decisions; no duplicate
information; consistent formatting; professional language. Return the corrected FINAL minutes and a
short list of what you checked or changed.
Return STRICT JSON only: {"minutesMarkdown":"...","qaNotes":["..."]}.`;

  const raw = await runAgent<{ minutesMarkdown?: string; qaNotes?: string[] }>({
    ctx,
    agent: "qa",
    system,
    maxTokens: 4000,
    user: `STRUCTURED BRIEF:\n${structuredBrief}\n\nDRAFT MINUTES:\n${draftMinutes}`,
  });

  const minutesMarkdown = text(raw?.minutesMarkdown) || draftMinutes;
  const qaNotes = Array.isArray(raw?.qaNotes)
    ? raw!.qaNotes.map((n) => text(n)).filter(Boolean)
    : [];
  return { minutesMarkdown, qaNotes };
}
