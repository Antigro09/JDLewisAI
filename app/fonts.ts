import { Source_Serif_4, Hanken_Grotesk } from "next/font/google";

// Shared Ember typography, loaded once and reused by the root layout and the
// marketing home. Source Serif 4 = display/headings; Hanken Grotesk = UI/body
// (wired to --font-sans so the whole app picks it up).
export const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

export const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});
