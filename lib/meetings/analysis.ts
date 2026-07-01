/**
 * Meeting analysis entry points. The heavy lifting now lives in the modular
 * agent graph under `lib/meetings/agents/*` (Planner → specialists → Minutes →
 * QA) rather than a single LLM prompt — see
 * docs/meeting-intelligence/ARCHITECTURE.md. These re-exports keep the existing
 * route imports (`@/lib/meetings/analysis`) stable.
 */
export { analyzeMeeting, generateMeetingMinutes } from "@/lib/meetings/agents/orchestrator";
