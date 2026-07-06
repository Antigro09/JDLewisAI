import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 15.5 only ships eslintrc-style configs; FlatCompat
// (shipped with eslint 9) bridges them into flat config, per Next.js docs.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "public/**",
      "mobile/**",
      "electron/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Pinned so upstream config changes can't silently relax them.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Stylistic; downgraded so lint gates CI on real problems only.
      "prefer-const": "warn",
    },
  },
];
