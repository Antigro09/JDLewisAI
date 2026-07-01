import { requireUser } from "@/lib/auth/server";
import { PageShell } from "@/components/page-shell";
import { CalcCard } from "./calc-card";

export const dynamic = "force-dynamic";

export default async function CalculatorsPage() {
  await requireUser();
  return (
    <PageShell
      title="Calculators"
      description="Quick construction math. The AI can also call these from chat (e.g. “how much concrete for a 40×30 slab at 6 inches?”)."
    >
      <div className="grid gap-5 md:grid-cols-2">
        <CalcCard
          tool="calculate_concrete"
          title="Concrete volume"
          blurb="Cubic yards for a slab/footing, plus order qty with waste."
          fields={[
            { name: "lengthFt", label: "Length (ft)", type: "number" },
            { name: "widthFt", label: "Width (ft)", type: "number" },
            { name: "thicknessIn", label: "Thickness (in)", type: "number" },
            { name: "wastePct", label: "Waste % (opt)", type: "number", placeholder: "10" },
          ]}
        />
        <CalcCard
          tool="calculate_rebar"
          title="Rebar weight"
          blurb="Total weight (lbs / tons) for a bar size and linear feet."
          fields={[
            { name: "barSize", label: "Bar size", placeholder: "#5" },
            { name: "totalLengthFt", label: "Total length (ft)", type: "number" },
          ]}
        />
        <CalcCard
          tool="calculate_pipe_volume"
          title="Pipe volume"
          blurb="Internal volume in gallons for a pipe run."
          fields={[
            { name: "diameterIn", label: "Inside dia. (in)", type: "number" },
            { name: "lengthFt", label: "Length (ft)", type: "number" },
          ]}
        />
        <CalcCard
          tool="calculate_voltage_drop"
          title="Voltage drop"
          blurb="Estimated conductor voltage drop and %."
          fields={[
            { name: "amps", label: "Load (A)", type: "number" },
            { name: "lengthFt", label: "One-way length (ft)", type: "number" },
            { name: "conductorAwg", label: "Conductor (AWG)", placeholder: "10, 2, 4/0" },
            { name: "voltage", label: "System voltage", type: "number", placeholder: "120" },
            { name: "phase", label: "Phase (1 or 3)", type: "number", placeholder: "1" },
            { name: "material", label: "Material", placeholder: "copper" },
          ]}
        />
        <CalcCard
          tool="calculate_hvac_load"
          title="HVAC load (rough)"
          blurb="Rule-of-thumb cooling tons from area. Not a Manual J."
          fields={[
            { name: "areaSqFt", label: "Area (sq ft)", type: "number" },
            { name: "sqFtPerTon", label: "Sq ft / ton (opt)", type: "number", placeholder: "450" },
          ]}
        />
      </div>
    </PageShell>
  );
}
