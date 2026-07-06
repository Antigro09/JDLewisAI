"use client";

import { usePathname } from "next/navigation";

// Fades + rises each page in on navigation (keyed on pathname so the animation
// replays per route). Fills the scroll area so pages keep their own overflow.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="emb-page-in h-full">
      {children}
    </div>
  );
}
