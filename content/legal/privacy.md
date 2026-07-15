---
title: Privacy Policy
version: "2026-07-11.1"
lastUpdated: "2026-07-11"
---

> **DRAFT FOR ATTORNEY REVIEW** — this document was prepared as a working draft and has **not** been reviewed by legal counsel. It is not legal advice and is not final. Have a licensed attorney review and approve it before relying on it.

## 1. Who We Are

This Privacy Policy describes how **[LEGAL ENTITY NAME]** ("ContractorAI", "we", "us") collects, uses, stores, and shares information when you use the ContractorAI application and related services (the "Service"). The Service is provided to business customers; your employer or the business that provisioned your account (the "Customer") controls much of the data processed on its behalf.

## 2. Information We Collect

- **Account data** — name, work email, password (stored only as a salted hash), role, and preferences (display role, tone, theme, notification settings).
- **Chat content** — messages you send, AI responses, and file attachments (images and documents) you share in chat.
- **Assistant memory** — durable facts and preferences the assistant saves to personalize future responses.
- **Meeting data** — live meeting audio (processed for transcription), transcripts with speaker labels, participant names, AI-generated summaries, minutes, action items, decisions, and risks, and semantic index vectors derived from transcripts.
- **Biometric voiceprints** — if your company enrolls speakers for automatic identification, a mathematical voiceprint (a biometric identifier) derived from a voice sample, stored in encrypted form. See Section 6.
- **Files and business records** — project files you upload (stored in our database), construction documents the Service generates, invoices you submit for processing (including extracted vendor and amount data), bids, and takeoff drawings and results.
- **Connected-account data** — if you link Google, encrypted OAuth tokens and the content the Service accesses or creates at your direction (see Section 5).
- **Usage and device data** — feature usage, AI token counts and costs (for billing), an audit log of actions taken in your account, the desktop app version and last-check-in time, and IP-derived rate-limit counters.

We do not intentionally collect data from anyone under 18, and the Service is not directed to children.

## 3. How We Use Information

We use the information above to: provide and operate the Service (including generating AI responses, transcripts, documents, and takeoffs); personalize the assistant; deliver software updates appropriate to your company's license; secure the Service (authentication, audit logging, rate limiting, abuse prevention); meter usage for billing; provide support; and comply with law. **We do not sell personal information and we do not use your content to train our own or third parties' foundation models.**

## 4. Service Providers (Subprocessors)

To provide the Service, we transmit specific data to the following categories of processors, bound by their service terms:

| Provider | What is sent | Purpose |
|---|---|---|
| Anthropic (Claude API) | Chat messages, attachments, assistant memory/context, document and meeting text being analyzed | AI responses and analysis |
| AssemblyAI | Live meeting audio streams | Real-time transcription with speaker labels |
| OpenAI and/or ElevenLabs | Text of assistant replies | Text-to-speech (voice replies), if enabled |
| Embeddings provider (OpenAI-compatible API) | Transcript and file text excerpts | Semantic search index, if enabled |
| Voiceprint service (self-hosted or configured endpoint) | Enrollment voice samples | Creating speaker voiceprints, if enabled |
| Google (Google APIs) | Content accessed/created at your direction | Drive/Docs/Sheets/Gmail integration (Section 5) |
| GitHub | Desktop app version metadata | Software update delivery |
| Database and hosting providers | All stored data (encrypted in transit; sensitive tokens and voiceprints encrypted at rest) | Running the Service |

The self-hosted material-takeoff engine processes uploaded drawings within our infrastructure.

## 5. Google User Data (Google API Services)

If you connect a Google account, the Service requests the following OAuth scopes: Google Drive, Google Docs, Google Sheets, Gmail read-only, and Gmail send. The Service uses these only at your direction to: read and create Drive files, Docs, and Sheets you ask the assistant to work with; read Gmail messages you ask it to summarize or act on; and send email you compose or approve (including scheduled automations you configure, which are limited by your allow-list and daily send cap). Google OAuth tokens are stored encrypted at rest and can be disconnected at any time in Settings, which revokes our access.

**ContractorAI's use and transfer of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.** In particular, Google user data is used only to provide the user-facing features described above, is not used for advertising, is not sold, and is not used to train generalized AI/ML models.

## 6. Biometric Information (Voiceprints)

If — and only if — your company uses automatic speaker identification, the Service creates a **voiceprint**: a mathematical representation (embedding) of a speaker's voice, which is a biometric identifier under laws such as the Illinois Biometric Information Privacy Act (BIPA), the Texas Capture or Use of Biometric Identifier Act, and Washington's biometric privacy law.

- **Notice and consent first.** A voiceprint is created only after the written notice presented at enrollment and the affirmative consent it requires. Enrollment is blocked without recorded consent.
- **Purpose limitation.** Voiceprints are used for exactly one purpose: identifying enrolled speakers in your company's meeting transcripts. They are never used for advertising, profiling, or any other purpose.
- **No sale or disclosure.** We do not sell, lease, trade, or otherwise profit from biometric identifiers, and we do not disclose them except as required by law or with consent.
- **Storage.** Voiceprint embeddings are stored encrypted at rest and scoped to your company.
- **Retention and destruction schedule.** A voiceprint is permanently destroyed upon the earliest of: (a) a deletion request by the enrolled individual or the Customer; (b) the individual leaving the Customer's organization; (c) the Customer's account termination; or (d) three (3) years after the individual's last interaction with the Customer's meetings in the Service **[ATTORNEY TO CONFIRM RETENTION HORIZON]**.

## 7. Meeting Recording

Recording and transcription only occur in meetings your company chooses to capture. By default the Service requires an on-screen consent acknowledgement before capture begins; company administrators who disable that requirement assume responsibility for providing all notices and obtaining all consents required by applicable recording laws. Transcripts are retained according to your company's configured retention window (administrators can set automatic purging; the default is retention until deletion).

## 8. Data Retention

- **Meeting transcripts and their search index**: purged automatically per your company's retention setting, or retained until deletion if none is set.
- **Voiceprints**: per the schedule in Section 6.
- **All other categories** (chat, files, documents, invoices, telemetry, audit logs): retained while the account or company remains active, and deleted or de-identified following account/company deletion (deleting a user or company cascades deletion of their data) or upon a verified deletion request, except where retention is required by law.

## 9. Security

We use industry-standard measures including: TLS encryption in transit; encryption at rest for OAuth tokens, connected-service credentials, and voiceprint embeddings; salted password hashing; session revocation ("sign out all devices"); role-based access control; a desktop-only access gate in production; and an append-only audit log of significant actions. No system is perfectly secure; report suspected issues to **[CONTACT EMAIL]**.

## 10. Your Rights and Choices

Depending on your state, you may have rights to access, correct, delete, or receive a copy of your personal information, and to not be discriminated against for exercising those rights. Because most data is processed on behalf of your employer (the Customer), we may direct requests to, or coordinate with, your company's administrator. To make a request, contact **[CONTACT EMAIL]**. We will respond within the time required by applicable law.

## 11. Changes to This Policy

We may update this Policy; the version and date at the top control. Material changes will be presented in the application. Continued use after the effective date constitutes acceptance to the extent permitted by law.

## 12. Contact

**[LEGAL ENTITY NAME]** · [MAILING ADDRESS] · **[CONTACT EMAIL]**
