export function PageShell({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1040px] px-5 py-11 sm:px-9">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-[30px] font-semibold tracking-[-0.01em] text-ember-text">
              {title}
            </h1>
            {description && (
              <p className="mt-1 text-sm text-ember-muted">{description}</p>
            )}
          </div>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}
