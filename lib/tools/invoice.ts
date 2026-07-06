import { generateStructured, type GenerateResult } from "@/lib/claude/chat";
import { MECHANICAL_MODEL } from "@/lib/claude/models";

export type InvoiceLineItem = {
  description: string;
  quantity?: number | string;
  unitPrice?: number | string;
  amount?: number | string;
};

export type InvoiceExtraction = {
  vendor?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  poNumber?: string;
  project?: string;
  lineItems: InvoiceLineItem[];
  subtotal?: number | string;
  tax?: number | string;
  total?: number | string;
  currency?: string;
  recommendation?: "APPROVE" | "REVIEW" | "DENY";
  recommendationReason?: string;
  flags?: string[];
};

const SYSTEM = `You are an accounts-payable assistant for a general contractor. You read an
invoice (image or PDF) and extract structured data, then recommend an approval action.
Output STRICT JSON only matching this shape:
{
  "vendor": string, "invoiceNumber": string, "invoiceDate": string, "dueDate": string,
  "poNumber": string, "project": string,
  "lineItems": [{"description": string, "quantity": string, "unitPrice": string, "amount": string}],
  "subtotal": string, "tax": string, "total": string, "currency": string,
  "recommendation": "APPROVE" | "REVIEW" | "DENY",
  "recommendationReason": string,
  "flags": string[]
}
Recommend REVIEW (not APPROVE) whenever math doesn't add up, the total is unusually large,
required fields are missing, or anything looks irregular. Recommend DENY only for clear
problems (duplicate, wrong payee, disallowed charges). Put concrete concerns in "flags".
Leave a field as an empty string if it is not present on the invoice. Do not invent values.`;

/** Enforced via structured outputs — mirrors the shape in SYSTEM exactly
 * (missing fields come back as empty strings, per the prompt). */
const INVOICE_SCHEMA = {
  type: "object",
  properties: {
    vendor: { type: "string" },
    invoiceNumber: { type: "string" },
    invoiceDate: { type: "string" },
    dueDate: { type: "string" },
    poNumber: { type: "string" },
    project: { type: "string" },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: { type: "string" },
          unitPrice: { type: "string" },
          amount: { type: "string" },
        },
        required: ["description", "quantity", "unitPrice", "amount"],
        additionalProperties: false,
      },
    },
    subtotal: { type: "string" },
    tax: { type: "string" },
    total: { type: "string" },
    currency: { type: "string" },
    recommendation: { type: "string", enum: ["APPROVE", "REVIEW", "DENY"] },
    recommendationReason: { type: "string" },
    flags: { type: "array", items: { type: "string" } },
  },
  required: [
    "vendor",
    "invoiceNumber",
    "invoiceDate",
    "dueDate",
    "poNumber",
    "project",
    "lineItems",
    "subtotal",
    "tax",
    "total",
    "currency",
    "recommendation",
    "recommendationReason",
    "flags",
  ],
  additionalProperties: false,
};

export async function extractInvoice(opts: {
  fileBase64: string;
  mime: string;
  fileName: string;
  model?: string;
}): Promise<{ data: InvoiceExtraction; usage: GenerateResult }> {
  const { data: parsed, ...meta } = await generateStructured<InvoiceExtraction>({
    // Mechanical field extraction defaults to the cheap model.
    model: opts.model ?? MECHANICAL_MODEL,
    effort: "high",
    system: SYSTEM,
    maxTokens: 4000,
    schema: INVOICE_SCHEMA,
    schemaName: "invoice_extraction",
    turns: [
      {
        role: "user",
        text: "Extract this invoice and recommend an action. Return JSON only.",
        attachments: [
          { mime: opts.mime, name: opts.fileName, dataBase64: opts.fileBase64 },
        ],
      },
    ],
  });
  // Structured path returns parsed data, not raw text — keep the GenerateResult
  // shape callers meter against.
  const usage: GenerateResult = { text: "", ...meta };

  const data: InvoiceExtraction = {
    lineItems: [],
    ...(parsed ?? {}),
  };
  if (!Array.isArray(data.lineItems)) data.lineItems = [];
  return { data, usage };
}
