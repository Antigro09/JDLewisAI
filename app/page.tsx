import { redirect } from "next/navigation";
import { getSessionClaims } from "@/lib/auth/server";
import { HomeLanding } from "@/components/marketing/home-landing";

// Fonts (--font-serif / --font-hanken) are loaded globally in the root layout.
export default async function Home() {
  // Signed-in users go straight to the product; visitors see the landing page.
  const claims = await getSessionClaims();
  if (claims) redirect("/chat");

  return <HomeLanding />;
}
