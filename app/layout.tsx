import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { DesktopTitlebar } from "@/components/desktop-titlebar";
import { sourceSerif, hankenGrotesk } from "./fonts";

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME || "ContractorAI",
  description: "Private, construction-specialized AI assistant for the team.",
  appleWebApp: {
    capable: true,
    title: "ContractorAI",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sourceSerif.variable} ${hankenGrotesk.variable}`}
    >
      <body className="bg-ember-bg font-sans text-ember-text">
        <ThemeProvider>
          {/* Hidden in browsers; shown via html.desktop-shell (Electron). */}
          <DesktopTitlebar />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
