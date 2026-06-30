import { requireUser } from "@/lib/auth/server";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        user={{ name: user.name, email: user.email, role: user.role }}
      />
      <main className="flex-1 overflow-hidden bg-neutral-50">{children}</main>
    </div>
  );
}
