import { generate, type GenerateResult } from "@/lib/claude/chat";
import { EAP_TEMPLATE } from "@/templates/eap";

const SYSTEM = `You are a construction safety professional. Produce a complete, ready-to-use
Emergency Action Plan (EAP) by filling out the company template below with the provided
project details. Keep every numbered section and heading from the template. Where specific
information is not provided, insert a clearly bracketed placeholder like "[TO BE CONFIRMED:
nearest hospital]" rather than inventing facts (especially phone numbers and addresses).
Output clean, professional Markdown suitable for export to a document.

COMPANY EAP TEMPLATE:
${EAP_TEMPLATE}`;

export async function generateEAP(opts: {
  projectName: string;
  address?: string;
  details?: string;
  model?: string;
  effort?: string;
}): Promise<{ markdown: string; usage: GenerateResult }> {
  const ctx: string[] = [`Project name: ${opts.projectName}`];
  if (opts.address) ctx.push(`Project address: ${opts.address}`);
  if (opts.details) ctx.push(`Additional details:\n${opts.details}`);

  const usage = await generate({
    model: opts.model,
    effort: opts.effort ?? "high",
    system: SYSTEM,
    maxTokens: 6000,
    turns: [
      {
        role: "user",
        text: `Create the Emergency Action Plan using these details:\n\n${ctx.join("\n")}`,
      },
    ],
  });

  return { markdown: usage.text, usage };
}
