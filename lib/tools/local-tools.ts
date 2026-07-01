import { createMemory, MEMORY_CATEGORIES } from "@/lib/memory";
import type { MemoryCategory } from "@/lib/db/schema";

export type LocalToolResult = {
  output: string;
  summary: string;
  link?: string;
  isError?: boolean;
};

type Input = Record<string, unknown>;

export type LocalTool = {
  name: string;
  definition: {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  };
  run: (userId: string, input: Input) => Promise<LocalToolResult>;
};

const num = (v: unknown, d = 0) =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : d;
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

// --- Reference tables ---
const REBAR_LBS_PER_FT: Record<string, number> = {
  "#3": 0.376, "#4": 0.668, "#5": 1.043, "#6": 1.502, "#7": 2.044,
  "#8": 2.67, "#9": 3.4, "#10": 4.303, "#11": 5.313,
};
// AWG → circular mils (for voltage drop)
const AWG_CMIL: Record<string, number> = {
  "14": 4110, "12": 6530, "10": 10380, "8": 16510, "6": 26240, "4": 41740,
  "3": 52620, "2": 66360, "1": 83690, "1/0": 105600, "2/0": 133100,
  "3/0": 167800, "4/0": 211600,
};

export const LOCAL_TOOLS: LocalTool[] = [
  {
    name: "calculate_concrete",
    definition: {
      name: "calculate_concrete",
      description:
        "Compute concrete volume in cubic yards for a slab/footing given length (ft), width (ft), and thickness (inches). Returns cubic yards and a suggested order qty with waste.",
      input_schema: {
        type: "object",
        properties: {
          lengthFt: { type: "number" },
          widthFt: { type: "number" },
          thicknessIn: { type: "number" },
          wastePct: { type: "number", description: "Waste % to add (default 10)" },
        },
        required: ["lengthFt", "widthFt", "thicknessIn"],
      },
    },
    run: async (_u, i) => {
      const L = num(i.lengthFt), W = num(i.widthFt), T = num(i.thicknessIn);
      const waste = num(i.wastePct, 10);
      const cy = (L * W * (T / 12)) / 27;
      const withWaste = cy * (1 + waste / 100);
      return {
        output: JSON.stringify({
          cubicYards: +cy.toFixed(2),
          orderQtyWithWaste: +withWaste.toFixed(2),
          wastePct: waste,
        }),
        summary: `Concrete: ${cy.toFixed(2)} CY (${withWaste.toFixed(2)} CY w/ ${waste}% waste)`,
      };
    },
  },
  {
    name: "calculate_rebar",
    definition: {
      name: "calculate_rebar",
      description:
        "Compute total rebar weight (lbs) given a bar size (#3–#11) and total linear feet.",
      input_schema: {
        type: "object",
        properties: {
          barSize: { type: "string", description: "e.g. #4, #5, #6" },
          totalLengthFt: { type: "number" },
        },
        required: ["barSize", "totalLengthFt"],
      },
    },
    run: async (_u, i) => {
      const size = str(i.barSize).replace(/\s/g, "");
      const perFt = REBAR_LBS_PER_FT[size];
      if (!perFt) {
        return {
          output: `Unknown bar size "${size}". Use #3–#11.`,
          summary: "Unknown rebar size",
          isError: true,
        };
      }
      const L = num(i.totalLengthFt);
      const lbs = perFt * L;
      return {
        output: JSON.stringify({ barSize: size, totalLengthFt: L, weightLbs: +lbs.toFixed(1), tons: +(lbs / 2000).toFixed(3) }),
        summary: `${size} × ${L} ft = ${lbs.toFixed(0)} lbs (${(lbs / 2000).toFixed(2)} tons)`,
      };
    },
  },
  {
    name: "calculate_pipe_volume",
    definition: {
      name: "calculate_pipe_volume",
      description:
        "Compute the internal volume of a pipe in gallons given inside diameter (inches) and length (feet).",
      input_schema: {
        type: "object",
        properties: {
          diameterIn: { type: "number", description: "Inside diameter (in)" },
          lengthFt: { type: "number" },
        },
        required: ["diameterIn", "lengthFt"],
      },
    },
    run: async (_u, i) => {
      const d = num(i.diameterIn), L = num(i.lengthFt);
      const areaSqFt = Math.PI * Math.pow(d / 2 / 12, 2);
      const cuFt = areaSqFt * L;
      const gallons = cuFt * 7.480519;
      return {
        output: JSON.stringify({ cubicFeet: +cuFt.toFixed(3), gallons: +gallons.toFixed(2) }),
        summary: `Pipe volume: ${gallons.toFixed(1)} gal (${cuFt.toFixed(2)} cu ft)`,
      };
    },
  },
  {
    name: "calculate_voltage_drop",
    definition: {
      name: "calculate_voltage_drop",
      description:
        "Estimate conductor voltage drop. Inputs: amps, one-way length (ft), conductor size (AWG e.g. 12, 10, 2, 1/0, 4/0), system voltage, phase (1 or 3), material (copper|aluminum). Returns volts dropped and %.",
      input_schema: {
        type: "object",
        properties: {
          amps: { type: "number" },
          lengthFt: { type: "number" },
          conductorAwg: { type: "string" },
          voltage: { type: "number" },
          phase: { type: "number", description: "1 or 3" },
          material: { type: "string", description: "copper or aluminum" },
        },
        required: ["amps", "lengthFt", "conductorAwg", "voltage"],
      },
    },
    run: async (_u, i) => {
      const amps = num(i.amps), L = num(i.lengthFt), V = num(i.voltage, 120);
      const phase = num(i.phase, 1);
      const material = str(i.material, "copper").toLowerCase();
      const cmil = AWG_CMIL[str(i.conductorAwg).replace(/\s/g, "")];
      if (!cmil) {
        return {
          output: `Unknown conductor size. Use AWG like 12, 10, 2, 1/0, 4/0.`,
          summary: "Unknown conductor size",
          isError: true,
        };
      }
      const K = material.startsWith("al") ? 21.2 : 12.9;
      const factor = phase === 3 ? Math.sqrt(3) : 2;
      const vd = (factor * K * amps * L) / cmil;
      const pct = (vd / V) * 100;
      return {
        output: JSON.stringify({
          voltageDrop: +vd.toFixed(2),
          percent: +pct.toFixed(2),
          acceptable: pct <= 3,
          note: "NEC recommends ≤3% for branch circuits, ≤5% total.",
        }),
        summary: `Voltage drop: ${vd.toFixed(1)} V (${pct.toFixed(1)}%)${pct > 3 ? " — exceeds 3%" : ""}`,
      };
    },
  },
  {
    name: "calculate_hvac_load",
    definition: {
      name: "calculate_hvac_load",
      description:
        "Rough HVAC cooling load estimate (tons) from conditioned area (sq ft). This is a rule-of-thumb only — a Manual J calc is required for design.",
      input_schema: {
        type: "object",
        properties: {
          areaSqFt: { type: "number" },
          sqFtPerTon: { type: "number", description: "Rule of thumb (default 450)" },
        },
        required: ["areaSqFt"],
      },
    },
    run: async (_u, i) => {
      const area = num(i.areaSqFt);
      const sqFtPerTon = num(i.sqFtPerTon, 450);
      const tons = area / sqFtPerTon;
      return {
        output: JSON.stringify({
          tons: +tons.toFixed(2),
          btuh: Math.round(tons * 12000),
          note: "Rule-of-thumb only; do a Manual J for design.",
        }),
        summary: `~${tons.toFixed(1)} tons (${Math.round(tons * 12000).toLocaleString()} BTU/h) — rough estimate`,
      };
    },
  },
  {
    name: "save_memory",
    definition: {
      name: "save_memory",
      description:
        "Save a durable fact to long-term memory so it's recalled in future chats — e.g. a company standard, preferred sub/vendor/material, estimating method, or lesson learned. Use when the user says to remember something.",
      input_schema: {
        type: "object",
        properties: {
          content: { type: "string" },
          category: {
            type: "string",
            description:
              "One of: standard, preference, vendor, material, method, lesson, project, other",
          },
        },
        required: ["content"],
      },
    },
    run: async (userId, i) => {
      const content = str(i.content).trim();
      if (!content) return { output: "No content.", summary: "Nothing to remember", isError: true };
      const catRaw = str(i.category, "other");
      const category = (MEMORY_CATEGORIES.some((c) => c.id === catRaw)
        ? catRaw
        : "other") as MemoryCategory;
      await createMemory({ ownerId: userId, scope: "personal", category, content });
      return {
        output: JSON.stringify({ saved: true, category }),
        summary: `Remembered: ${content.slice(0, 60)}${content.length > 60 ? "…" : ""}`,
      };
    },
  },
];

export function getLocalTool(name: string): LocalTool | undefined {
  return LOCAL_TOOLS.find((t) => t.name === name);
}

export function localToolDefinitions() {
  return LOCAL_TOOLS.map((t) => t.definition);
}

export async function runLocalTool(
  userId: string,
  name: string,
  input: Input,
): Promise<LocalToolResult> {
  const tool = getLocalTool(name);
  if (!tool) return { output: `Unknown tool: ${name}`, summary: "Unknown tool", isError: true };
  try {
    return await tool.run(userId, input);
  } catch (err) {
    return {
      output: `Error running ${name}: ${err instanceof Error ? err.message : "unknown"}`,
      summary: `${name} failed`,
      isError: true,
    };
  }
}
