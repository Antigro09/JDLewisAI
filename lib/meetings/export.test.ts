import { describe, expect, it } from "vitest";
import { MINUTES_CAVEAT } from "@/lib/legal/disclaimers";
import {
  actionItemsCsv,
  meetingEmailSummary,
  meetingToHtml,
  meetingToMarkdown,
} from "./export";

const bundle = {
  meeting: {
    title: "Site coordination",
    status: "complete",
    summary: "Discussed slab pour schedule.",
    minutesMarkdown: null,
    startedAt: new Date("2026-07-01T15:00:00Z"),
    endedAt: new Date("2026-07-01T15:30:00Z"),
  },
  project: { name: "Lot 12" },
  participants: [{ displayName: "Pat", speakerLabel: "Speaker A", role: null }],
  segments: [
    { speakerName: "Pat", speakerLabel: "Speaker A", text: "Pour Friday.", startMs: 0 },
  ],
  actionItems: [
    {
      ownerName: "Pat",
      task: "Order rebar",
      priority: "high",
      dueDate: "2026-07-03",
      status: "open",
      confidence: 90,
    },
  ],
  decisions: [
    { decision: "Pour Friday", reason: null, approvedBy: "Pat", confidence: 90 },
  ],
  risks: [],
};

describe("meeting export caveats", () => {
  it("markdown export ends with the AI caveat", () => {
    const md = meetingToMarkdown(bundle);
    expect(md).toContain(MINUTES_CAVEAT);
    expect(md.trimEnd().endsWith(`_${MINUTES_CAVEAT}_`)).toBe(true);
  });

  it("markdown caveat also applies to pre-generated minutes", () => {
    const withMinutes = {
      ...bundle,
      meeting: { ...bundle.meeting, minutesMarkdown: "# Minutes\n\nAll good." },
    };
    const md = meetingToMarkdown(withMinutes);
    expect(md).toContain("All good.");
    expect(md).toContain(MINUTES_CAVEAT);
  });

  it("html export contains a single escaped caveat paragraph", () => {
    const html = meetingToHtml(bundle);
    expect(html).toContain(MINUTES_CAVEAT);
    expect(html.match(new RegExp(MINUTES_CAVEAT.slice(0, 30), "g"))?.length).toBe(1);
    expect(html).toContain('class="caveat"');
  });

  it("email summary carries the caveat", () => {
    expect(meetingEmailSummary(bundle)).toContain(MINUTES_CAVEAT);
  });

  it("action-items CSV appends the caveat row after a blank line", () => {
    const csv = actionItemsCsv(bundle);
    expect(csv).toContain("Order rebar");
    expect(csv.trimEnd().endsWith(`"${MINUTES_CAVEAT}"`)).toBe(true);
  });
});
