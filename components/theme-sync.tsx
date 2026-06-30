"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/** Apply the user's saved appearance preference once, unless they've already
 * picked a theme client-side this browser (next-themes' own localStorage wins). */
export function ThemeSync({
  initialTheme,
}: {
  initialTheme?: "light" | "dark" | "system";
}) {
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!initialTheme) return;
    const stored = window.localStorage.getItem("theme");
    if (!stored) setTheme(initialTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
