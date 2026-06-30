import { generate, extractJson, type GenerateResult } from "@/lib/claude/chat";

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

export async function extractInvoice(opts: {
  fileBase64: string;
  mime: string;
  fileName: string;
  model?: string;
}): Promise<{ data: InvoiceExtraction; usage: GenerateResult }> {
  const usage = await generate({
    model: opts.model,
    effort: "high",
    system: SYSTEM,
    maxTokens: 4000,
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

  const parsed = extractJson<InvoiceExtraction>(usage.text);
  const data: InvoiceExtraction = {
    lineItems: [],
    ...(parsed ?? {}),
  };
  if (!Array.isArray(data.lineItems)) data.lineItems = [];
  return { data, usage };
}
