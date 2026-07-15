import { requireUser } from "@/lib/auth/server";
import { requireTermsAccepted } from "@/lib/legal/gate";
import { Sidebar } from "@/components/sidebar";
import { ThemeSync } from "@/components/theme-sync";
import { PageTransition } from "@/components/page-transition";
import { MeetingAutoStart } from "@/components/meetings/meeting-auto-start";
import { DesktopBridge } from "@/components/desktop-bridge";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Clickwrap: no app access until the current Terms of Service are accepted.
  await requireTermsAccepted(user);
  return (
    <div className="flex h-dvh flex-col overflow-hidden lg:flex-row">
      <ThemeSync initialTheme={user.personalization?.darkMode} />
      <MeetingAutoStart />
      <DesktopBridge />
      <Sidebar
        user={{ name: user.name, email: user.email, role: user.role }}
      />
      <main className="flex-1 overflow-hidden bg-ember-bg">
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
