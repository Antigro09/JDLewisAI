// Design tokens for the marketing home page, ported verbatim from the
// ContractorAI-Home design prototype. Single warm clay/terracotta accent,
// two themes. All colors are CSS oklch(). Kept as a plain map (not Tailwind
// utilities) because the design switches ~40 tokens per theme and drives many
// of them through inline styles / animated transforms.

export const EASE_OUT = "cubic-bezier(0.23,1,0.32,1)";

export type Tokens = {
  bg: string;
  navBg: string;
  navBorder: string;
  navShadow: string;
  surface: string;
  subtleBg: string;
  chipBg: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accentSolid: string;
  accent: string;
  accentTint: string;
  accentTintText: string;
  accentShadow: string;
  cardShadow: string;
  cardShadowHover: string;
  pillBg: string;
  orbWarm: string;
  orbDeep: string;
  glowCursor: string;
  shotBorder: string;
  shotShadow: string;
  ctaBg: string;
  ctaText: string;
  ctaButtonBg: string;
  ctaButtonText: string;
  ctaOrb: string;
  ctaGlowCursor: string;
};

const dark: Tokens = {
  bg: "oklch(0.16 0.013 55)",
  navBg: "oklch(0.22 0.016 50 / 0.7)",
  navBorder: "oklch(0.34 0.02 50 / 0.8)",
  navShadow: "0 8px 30px rgba(0,0,0,0.35)",
  surface: "oklch(0.235 0.016 50)",
  subtleBg: "oklch(0.215 0.015 50)",
  chipBg: "oklch(0.27 0.017 50)",
  border: "oklch(0.32 0.02 50)",
  text: "oklch(0.95 0.01 60)",
  textMuted: "oklch(0.78 0.02 55)",
  textFaint: "oklch(0.6 0.02 50)",
  accentSolid: "oklch(0.62 0.15 40)",
  accent: "oklch(0.72 0.14 40)",
  accentTint: "oklch(0.32 0.05 40)",
  accentTintText: "oklch(0.82 0.09 45)",
  accentShadow: "oklch(0.3 0.1 35 / 0.45)",
  cardShadow: "0 2px 14px rgba(0,0,0,0.28)",
  cardShadowHover: "0 18px 38px rgba(0,0,0,0.45)",
  pillBg: "oklch(0.3 0.02 50)",
  orbWarm: "oklch(0.45 0.13 55 / 0.45)",
  orbDeep: "oklch(0.33 0.13 15 / 0.5)",
  glowCursor: "oklch(0.75 0.13 45 / 0.35)",
  shotBorder: "oklch(0.34 0.02 50)",
  shotShadow: "0 40px 100px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
  ctaBg: "oklch(0.62 0.15 40)",
  ctaText: "#fff8f2",
  ctaButtonBg: "oklch(0.16 0.013 55)",
  ctaButtonText: "#fff",
  ctaOrb: "oklch(0.8 0.1 60 / 0.3)",
  ctaGlowCursor: "oklch(0.95 0.05 60 / 0.28)",
};

const light: Tokens = {
  bg: "oklch(0.975 0.006 60)",
  navBg: "oklch(0.995 0.004 60 / 0.68)",
  navBorder: "oklch(0.9 0.012 55 / 0.9)",
  navShadow: "0 8px 30px rgba(90,55,20,0.1)",
  surface: "oklch(0.995 0.004 60)",
  subtleBg: "oklch(0.94 0.014 55)",
  chipBg: "oklch(0.93 0.016 55)",
  border: "oklch(0.885 0.015 50)",
  text: "oklch(0.24 0.02 45)",
  textMuted: "oklch(0.46 0.025 45)",
  textFaint: "oklch(0.6 0.02 50)",
  accentSolid: "oklch(0.6 0.15 40)",
  accent: "oklch(0.55 0.16 38)",
  accentTint: "oklch(0.93 0.04 50)",
  accentTintText: "oklch(0.45 0.14 35)",
  accentShadow: "oklch(0.6 0.15 40 / 0.28)",
  cardShadow: "0 2px 14px rgba(90,55,20,0.07)",
  cardShadowHover: "0 18px 38px rgba(90,55,20,0.18)",
  pillBg: "oklch(0.93 0.012 55)",
  orbWarm: "oklch(0.85 0.09 60 / 0.55)",
  orbDeep: "oklch(0.72 0.13 22 / 0.4)",
  glowCursor: "oklch(0.9 0.08 55 / 0.5)",
  shotBorder: "oklch(0.88 0.014 55)",
  shotShadow: "0 40px 100px rgba(90,55,20,0.22), 0 0 0 1px rgba(255,255,255,0.6)",
  ctaBg: "oklch(0.6 0.15 40)",
  ctaText: "#fff8f2",
  ctaButtonBg: "#fff",
  ctaButtonText: "oklch(0.4 0.14 38)",
  ctaOrb: "oklch(0.9 0.06 60 / 0.4)",
  ctaGlowCursor: "oklch(0.98 0.04 60 / 0.4)",
};

export function getTokens(isDark: boolean): Tokens {
  return isDark ? dark : light;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
