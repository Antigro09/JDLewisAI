/**
 * Legal document versions — the single source of truth.
 *
 * Format: date-based ("YYYY-MM-DD.N"). Bumping TERMS_VERSION is by definition
 * a material change: every user is re-prompted with the clickwrap gate on
 * their next navigation (lib/legal/gate.ts compares users.termsAcceptedVersion
 * against this constant). Bump deliberately, and only after the updated text
 * has been reviewed.
 *
 * These must match the `version` frontmatter in content/legal/*.md — enforced
 * by lib/legal/content.test.ts.
 */
export const TERMS_VERSION = "2026-07-11.1";
export const PRIVACY_VERSION = "2026-07-11.1";
export const VOICEPRINT_CONSENT_VERSION = "2026-07-11.1";
export const EULA_VERSION = "2026-07-11.1";
