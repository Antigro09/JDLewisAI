export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">
            C
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            {process.env.NEXT_PUBLIC_APP_NAME || "ContractorAI"}
          </h1>
          <p className="text-sm text-neutral-500">
            Private AI for the construction team
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
