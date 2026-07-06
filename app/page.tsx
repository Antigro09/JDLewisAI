import { redirect } from "next/navigation";
import { Source_Serif_4, Hanken_Grotesk } from "next/font/google";
import { getSessionClaims } from "@/lib/auth/server";
import { HomeLanding } from "@/components/marketing/home-landing";

// Display / body fonts for the marketing home, self-hosted at build time.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});
const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});

export default async function Home() {
  // Signed-in users go straight to the product; visitors see the landing page.
  const claims = await getSessionClaims();
  if (claims) redirect("/chat");

  return (
    <div className={`${sourceSerif.variable} ${hankenGrotesk.variable}`}>
      <HomeLanding />
    </div>
  );
}
