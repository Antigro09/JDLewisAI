import { Markdown } from "@/components/markdown";
import { PrintButton } from "@/components/print-button";
import type { DocumentTemplate } from "@/lib/db/schema";

export function BrandedDocument({
  title,
  markdown,
  template,
}: {
  title: string;
  markdown: string;
  template: DocumentTemplate | null;
}) {
  const brand = template?.brandColor || "#ea580c";
  return (
    <div className="mx-auto max-w-3xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
        .branded-doc h1, .branded-doc h2, .branded-doc h3 { color: ${brand}; }
      `}</style>
      <div className="no-print mb-6 flex justify-end">
        <PrintButton />
      </div>
      <div className="branded-doc rounded-xl border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm print:border-0 print:p-0 print:shadow-none">
        {(template?.logo || template?.headerText) && (
          <div
            className="mb-6 flex items-center gap-4 border-b pb-4"
            style={{ borderColor: brand }}
          >
            {template?.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={template.logo} alt="" className="h-12 w-auto" />
            )}
            {template?.headerText && (
              <div className="whitespace-pre-wrap text-sm text-neutral-600">
                {template.headerText}
              </div>
            )}
          </div>
        )}
        <h1 className="mb-4 text-2xl font-bold" style={{ color: brand }}>
          {title}
        </h1>
        <Markdown content={markdown} />
        {template?.footerText && (
          <div
            className="mt-8 whitespace-pre-wrap border-t pt-4 text-xs text-neutral-400"
            style={{ borderColor: brand }}
          >
            {template.footerText}
          </div>
        )}
      </div>
    </div>
  );
}
