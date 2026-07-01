/** Built-in construction workflow skills an admin can install org-wide with one
 * click. Each is a reusable instruction pack the AI follows when active. */
export type BuiltinSkill = {
  key: string; // stable identity for dedupe (stored as the skill name)
  name: string;
  description: string;
  instructions: string;
};

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    key: "Punch List Generator",
    name: "Punch List Generator",
    description: "Turn a walkthrough into an organized punch list.",
    instructions: `When asked to produce a punch list, output a table with columns: #, Location/Room,
Trade, Description of deficiency, Priority (High/Med/Low), Status (Open). Group by area, be
specific and actionable, and reference the responsible trade. End with a short summary count by
trade.`,
  },
  {
    key: "Meeting Minutes",
    name: "Meeting Minutes",
    description: "Structured OAC / coordination meeting minutes.",
    instructions: `Produce meeting minutes with: Project, Date/Time, Attendees, Old business (with
prior item numbers carried forward and status), New business, Decisions, Action items (Item #,
Description, Responsible party, Due date), and Next meeting. Number items continuously so they can
be tracked across meetings. Keep each item concise and factual.`,
  },
  {
    key: "Quantity Takeoff",
    name: "Quantity Takeoff",
    description: "Systematic material quantity takeoff.",
    instructions: `For a takeoff, work systematically by system/area. Output a table: Item, Spec
section (if known), Unit, Quantity, Basis/assumption, Waste %. Use the construction calculator tools
(concrete, rebar, pipe, etc.) for computed quantities rather than estimating by hand. State every
assumption and flag anything not dimensioned. End with a summary by CSI division where possible.`,
  },
  {
    key: "Safety Plan Generator",
    name: "Safety Plan Generator",
    description: "Site-specific safety plan aligned to OSHA.",
    instructions: `Generate a site-specific safety plan covering: project info, responsibilities,
hazard analysis by task (JHA-style: task, hazards, controls, PPE), fall protection, electrical
safety/LOTO, excavation/trenching if applicable, fire prevention, emergency procedures, and
inspection cadence. Reference relevant OSHA 1926 subparts where appropriate but never fabricate
citation numbers — say "verify applicable OSHA reference" if unsure.`,
  },
  {
    key: "Value Engineering",
    name: "Value Engineering",
    description: "VE alternatives with cost/schedule/risk.",
    instructions: `Produce value-engineering options as a table: VE #, Description, Original approach,
Proposed alternative, Est. cost impact (+/-), Schedule impact, Quality/performance impact, Risk.
Prioritize by net value. Be explicit that cost impacts are order-of-magnitude unless real pricing
was provided, and note what each option would need to be confirmed.`,
  },
  {
    key: "Material Order Generator",
    name: "Material Order Generator",
    description: "Consolidated material order from a scope/takeoff.",
    instructions: `From a scope or takeoff, generate a material order: Item, Spec/model, Unit,
Quantity (with waste), Vendor (use a remembered preferred vendor if one applies), Lead time, Notes.
Flag long-lead items prominently at the top. Use calculator tools for computed quantities.`,
  },
  {
    key: "Submittal Review",
    name: "Submittal Review",
    description: "Review a submittal against the spec.",
    instructions: `When reviewing a submittal, compare it against the referenced specification section
and drawings. Output: submittal item, spec section, conformance (Conforms / Conforms as noted /
Does not conform), specific deviations, and a recommended action (Approved / Approved as noted /
Revise & resubmit / Rejected) with reasons. Never approve when required data is missing — request it.`,
  },
  {
    key: "Schedule Recovery",
    name: "Schedule Recovery",
    description: "Options to recover lost schedule.",
    instructions: `Given a delay, propose schedule-recovery options: re-sequencing, added crews,
overtime, multiple shifts, fast-tracking/overlap, alternate methods, and procurement expediting.
For each: description, time recovered (estimate), cost impact, and risk. Recommend a combination and
note critical-path assumptions. Be clear these are planning estimates, not a CPM update.`,
  },
  {
    key: "Drawing Comparison",
    name: "Drawing Comparison",
    description: "Compare two drawing revisions and summarize changes.",
    instructions: `When given two drawing revisions (or asked to compare), identify added, removed, and
modified elements by area/system. Output a change log: Sheet, Location, Change type
(Added/Removed/Modified), Description, Potential cost/schedule impact, and whether it likely warrants
an RFI or change order. Flag anything ambiguous rather than assuming.`,
  },
];
