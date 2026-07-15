import { Markdown } from "@/components/markdown";
import { getLegalDoc, type LegalSlug } from "@/lib/legal/content";

/** Shared renderer for the three legal document pages. */
export function LegalDocPage({ slug }: { slug: LegalSlug }) {
  const doc = getLegalDoc(slug);
  return (
    <article>
      <h1 className="font-serif text-2xl font-semibold text-ember-text">
        {doc.title}
      </h1>
      <p className="mt-1 text-xs text-ember-faint">
        Version {doc.version}
        {doc.lastUpdated ? ` · Last updated ${doc.lastUpdated}` : null}
      </p>
      <div className="mt-6">
        <Markdown content={doc.body} />
      </div>
    </article>
  );
}
