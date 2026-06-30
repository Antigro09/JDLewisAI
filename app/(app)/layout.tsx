import { requireUser } from "@/lib/auth/server";
import { Sidebar } from "@/components/sidebar";
import { ThemeSync } from "@/components/theme-sync";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <div className="flex h-screen overflow-hidden">
      <ThemeSync initialTheme={user.personalization?.darkMode} />
      <Sidebar
        user={{ name: user.name, email: user.email, role: user.role }}
      />
      <main className="flex-1 overflow-hidden bg-neutral-50 dark:bg-neutral-950">
        {children}
      </main>
    </div>
  );
}
