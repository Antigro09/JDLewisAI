import type { Config } from "tailwindcss";

// Ember reskin: the accent (`brand`) and surface (`neutral`) ramps are remapped
// to the warm clay / warm-stone oklch palette so the whole app inherits the
// look. Colors use `oklch(L C H / <alpha-value>)` so Tailwind opacity utilities
// (e.g. bg-brand-600/30) keep working. `ember-*` tokens read CSS variables that
// flip per theme (see globals.css) for pieces that need a single value which
// changes with light/dark.
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Clay / terracotta accent ramp.
        brand: {
          50: "oklch(0.96 0.02 55 / <alpha-value>)",
          100: "oklch(0.93 0.04 50 / <alpha-value>)",
          200: "oklch(0.88 0.07 46 / <alpha-value>)",
          300: "oklch(0.8 0.11 43 / <alpha-value>)",
          400: "oklch(0.7 0.14 41 / <alpha-value>)",
          500: "oklch(0.64 0.155 40 / <alpha-value>)",
          600: "oklch(0.6 0.15 40 / <alpha-value>)",
          700: "oklch(0.53 0.15 38 / <alpha-value>)",
          800: "oklch(0.45 0.14 35 / <alpha-value>)",
          900: "oklch(0.38 0.12 34 / <alpha-value>)",
          950: "oklch(0.3 0.09 32 / <alpha-value>)",
        },
        // Warm-stone neutral ramp (replaces Tailwind's cool gray).
        neutral: {
          50: "oklch(0.97 0.008 60 / <alpha-value>)",
          100: "oklch(0.945 0.012 55 / <alpha-value>)",
          200: "oklch(0.885 0.015 50 / <alpha-value>)",
          300: "oklch(0.8 0.016 50 / <alpha-value>)",
          400: "oklch(0.62 0.02 50 / <alpha-value>)",
          500: "oklch(0.5 0.024 48 / <alpha-value>)",
          600: "oklch(0.42 0.024 46 / <alpha-value>)",
          700: "oklch(0.34 0.022 45 / <alpha-value>)",
          800: "oklch(0.31 0.02 50 / <alpha-value>)",
          900: "oklch(0.24 0.016 50 / <alpha-value>)",
          950: "oklch(0.19 0.014 55 / <alpha-value>)",
        },
        // Theme-flipping tokens (CSS vars set in globals.css).
        ember: {
          bg: "oklch(var(--ember-bg) / <alpha-value>)",
          surface: "oklch(var(--ember-surface) / <alpha-value>)",
          subtle: "oklch(var(--ember-subtle) / <alpha-value>)",
          border: "oklch(var(--ember-border) / <alpha-value>)",
          text: "oklch(var(--ember-text) / <alpha-value>)",
          muted: "oklch(var(--ember-text-muted) / <alpha-value>)",
          faint: "oklch(var(--ember-text-faint) / <alpha-value>)",
          accent: "oklch(var(--ember-accent) / <alpha-value>)",
          "accent-solid": "oklch(var(--ember-accent-solid) / <alpha-value>)",
          tint: "oklch(var(--ember-accent-tint) / <alpha-value>)",
          "tint-text": "oklch(var(--ember-accent-tint-text) / <alpha-value>)",
          pill: "oklch(var(--ember-pill) / <alpha-value>)",
          success: "oklch(var(--ember-success) / <alpha-value>)",
          "success-bg": "oklch(var(--ember-success-bg) / <alpha-value>)",
          warning: "oklch(var(--ember-warning) / <alpha-value>)",
          "warning-bg": "oklch(var(--ember-warning-bg) / <alpha-value>)",
          danger: "oklch(var(--ember-danger) / <alpha-value>)",
          "danger-bg": "oklch(var(--ember-danger-bg) / <alpha-value>)",
          pending: "oklch(var(--ember-pending) / <alpha-value>)",
          "pending-bg": "oklch(var(--ember-pending-bg) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
      },
      boxShadow: {
        "ember-card": "var(--ember-shadow-card)",
        "ember-card-hover": "var(--ember-shadow-card-hover)",
        "ember-composer": "var(--ember-shadow-composer)",
        "ember-palette": "var(--ember-shadow-palette)",
        "ember-bubble": "var(--ember-shadow-bubble)",
      },
      transitionTimingFunction: {
        "ember-out": "cubic-bezier(0.23, 1, 0.32, 1)",
        "ember-spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "ember-drawer": "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
