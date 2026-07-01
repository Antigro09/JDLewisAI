import { formatDate } from "@/lib/utils";

type Bundle = {
  meeting: {
    title: string;
    status: string;
    summary: string | null;
    minutesMarkdown: string | null;
    startedAt: Date;
    endedAt: Date | null;
  };
  project: { name: string } | null;
  participants: { displayName: string; speakerLabel: string; role: string | null }[];
  segments: {
    speakerName: string | null;
    speakerLabel: string;
    text: string;
    startMs: number;
  }[];
  actionItems: {
    ownerName: string | null;
    task: string;
    priority: string;
    dueDate: string | null;
    status: string;
    confidence: number;
  }[];
  decisions: {
    decision: string;
    reason: string | null;
    approvedBy: string | null;
    confidence: number;
  }[];
  risks: {
    riskType: string;
    description: string;
    severity: string;
    mitigation: string | null;
    confidence: number;
  }[];
};

function formatMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function csvCell(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function actionItemsCsv(bundle: Bundle) {
  const rows = [
    ["Owner", "Task", "Priority", "Due Date", "Status", "Confidence"],
    ...bundle.actionItems.map((a) => [
      a.ownerName ?? "",
      a.task,
      a.priority,
      a.dueDate ?? "",
      a.status,
      `${a.confidence}%`,
    ]),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

export function meetingToMarkdown(bundle: Bundle) {
  if (bundle.meeting.minutesMarkdown) return bundle.meeting.minutesMarkdown;
  const participants = bundle.participants.length
    ? bundle.participants
        .map((p) => `- ${p.displayName} (${p.speakerLabel}${p.role ? `, ${p.role}` : ""})`)
        .join("\n")
    : "- Attendees not confirmed";
  const actionItems = bundle.actionItems.length
    ? bundle.actionItems
        .map(
          (a, i) =>
            `| ${i + 1} | ${a.task} | ${a.ownerName ?? "Unassigned"} | ${a.dueDate ?? "TBD"} | ${a.priority} | ${a.status} |`,
        )
        .join("\n")
    : "| - | No action items captured | - | - | - | - |";
  const decisions = bundle.decisions.length
    ? bundle.decisions
        .map(
          (d, i) =>
            `${i + 1}. ${d.decision}${d.reason ? `\n   - Reason: ${d.reason}` : ""}${
              d.approvedBy ? `\n   - Approved by: ${d.approvedBy}` : ""
            }`,
        )
        .join("\n")
    : "No decisions captured.";
  const risks = bundle.risks.length
    ? bundle.risks
        .map(
          (r, i) =>
            `${i + 1}. **${r.severity.toUpperCase()} ${r.riskType}:** ${r.description}${
              r.mitigation ? `\n   - Mitigation: ${r.mitigation}` : ""
            }`,
        )
        .join("\n")
    : "No risks captured.";
  const transcript = bundle.segments.length
    ? bundle.segments
        .map((s) => {
          const speaker = s.speakerName || s.speakerLabel;
          return `- ${formatMs(s.startMs)} ${speaker}: ${s.text}`;
        })
        .join("\n")
    : "- No transcript segments captured.";

  return `# ${bundle.meeting.title}

**Project:** ${bundle.project?.name ?? "Not assigned"}  
**Date:** ${formatDate(bundle.meeting.startedAt)}  
**Status:** ${bundle.meeting.status}

## Summary

${bundle.meeting.summary ?? "Summary not generated yet."}

## Attendees

${participants}

## Decisions

${decisions}

## Risks

${risks}

## Action Items

| # | Description | Responsible Party | Due Date | Priority | Status |
|---|---|---|---|---|---|
${actionItems}

## Transcript

${transcript}
`;
}

export function meetingToHtml(bundle: Bundle) {
  const md = meetingToMarkdown(bundle);
  const html = md
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("- ")) return `<li>${escapeHtml(line.slice(2))}</li>`;
      if (!line.trim()) return "";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(bundle.meeting.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.45; margin: 40px; color: #171717; }
    h1, h2 { color: #c2410c; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ddd; padding: 6px; }
  </style>
</head>
<body>${html}</body>
</html>`;
}

export function meetingEmailSummary(bundle: Bundle) {
  const actions = bundle.actionItems.length
    ? bundle.actionItems.map((a) => `- ${a.task} — ${a.ownerName ?? "Unassigned"} (${a.dueDate ?? "TBD"})`).join("\n")
    : "- No action items captured";
  return `Subject: Meeting Summary - ${bundle.meeting.title}

Here is the summary for ${bundle.meeting.title}.

${bundle.meeting.summary ?? "Summary not generated yet."}

Action items:
${actions}
`;
}
