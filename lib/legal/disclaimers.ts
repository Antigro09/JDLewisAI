/**
 * All user-facing legal/disclaimer copy, in one dependency-free module so the
 * wording stays consistent across every surface (chat, printed documents,
 * exports, consent notices, emails) and is unit-testable. No React, no env —
 * safe to import from server code, client components, and tests alike.
 *
 * Wording here is a DRAFT FOR ATTORNEY REVIEW (see content/legal/*).
 */

/** Always-on caption under the chat composer. */
export const AI_CHAT_CAPTION =
  "ContractorAI can make mistakes. Verify important information before relying on it.";

/** Fixed small-print footer on every printed/PDF generated document
 * (scopes of work, RFIs, change orders, daily reports, meeting minutes). */
export const DOC_FOOTER_DISCLAIMER =
  "Draft prepared with AI assistance. Review and verify all contents before sending or relying on this document. This document is not professional engineering, architectural, accounting, or legal advice.";

/** Caption on material-takeoff results in the app. */
export const TAKEOFF_UI_CAPTION =
  "Machine-assisted takeoff. Quantities require estimator review before use in bids, orders, or contracts. No accuracy guarantee is made.";

/** Caveat appended to meeting-minutes exports (markdown/HTML/email/CSV). */
export const MINUTES_CAVEAT =
  "Generated with AI assistance from an automated transcription and may contain errors. Verify decisions, action items, and attributions before relying on them.";

/** Footer appended to emails sent by unattended automations. */
export const AUTOMATION_EMAIL_FOOTER =
  "\n\n--\nThis message was prepared by an automated AI assistant on behalf of the sender. Please verify important details before acting on it.";

/** Notice under the sign-in button. */
export const SIGNIN_AGREEMENT_NOTICE =
  "By signing in you agree to the ContractorAI Terms of Service and Privacy Policy.";

/** Default meeting-recording consent notice (companies can override via
 * companies.recordingConsentText). Mentions third-party transcription —
 * required for informed consent. */
export const DEFAULT_RECORDING_CONSENT_TEXT =
  "This meeting will be recorded and transcribed by ContractorAI using third-party transcription services. By continuing, you confirm that all participants have been informed of, and consent to, the recording and transcription of this meeting.";

/** Written biometric notice shown before voiceprint enrollment (BIPA-grade).
 * Server returns this with a 403 when enrollment is attempted without
 * consent, so any client can render the notice verbatim. */
export const VOICEPRINT_CONSENT_NOTICE =
  "Voiceprint notice: ContractorAI will create a mathematical voiceprint (a biometric identifier) from this audio sample and store it in encrypted form for one purpose only — identifying this speaker in your company's meeting transcripts. The voiceprint will be retained according to the ContractorAI Privacy Policy retention and destruction schedule and will be permanently deleted on request, when the speaker leaves your company, or when it is no longer needed, whichever comes first. By continuing, you confirm that the person being enrolled has received this notice and has given written consent to the collection and storage of their voiceprint, as required by applicable biometric privacy laws (including the Illinois Biometric Information Privacy Act).";
