# Attorney / Owner Legal Checklist

Working list of legal items that code alone cannot resolve. The in-app legal
documents (`content/legal/terms.md`, `privacy.md`, `eula.md`) are **drafts for
attorney review** — none of this constitutes legal advice.

## Before shipping to clients

1. **Retain a lawyer to review the three drafts.** Fill in `[LEGAL ENTITY NAME]`,
   `[GOVERNING LAW STATE]`, `[MAILING ADDRESS]`, `[CONTACT EMAIL]`, and the
   biometric retention horizon (`[ATTORNEY TO CONFIRM]` in privacy.md §6).
   After sign-off: remove the "DRAFT FOR ATTORNEY REVIEW" banners and bump the
   versions in `lib/legal/version.ts` + the matching frontmatter (users will be
   re-prompted to accept).
2. **Repo license conflict:** the repository `LICENSE` is GPL-3.0, but the exe
   ships under a proprietary EULA. Distributing a GPL build entitles recipients
   to the source. If you hold all copyright, relicense the repo (proprietary /
   "all rights reserved"); otherwise reconcile with counsel.
3. **PyMuPDF is AGPL-3.0** inside the network-served takeoff-engine. Options:
   switch the default PDF backend to the already-supported permissive fallback
   (`pip install .[pdf-fallback]` → pypdfium2/pdfplumber), purchase an Artifex
   commercial license, or open-source the engine.

## Before/at production launch

4. **Google restricted scopes** (full Drive, Docs, Sheets, gmail.readonly,
   gmail.send): production OAuth verification requires Google's restricted-scope
   review including a **CASA security assessment**, and a **publicly reachable
   privacy policy URL**. The desktop-only gate currently 404s browsers — add an
   ungated exception for `/legal/privacy` (or host a static mirror) before
   submitting for verification or to any app store.
5. **Biometric (BIPA) follow-ups:** attorney to confirm whether an operator's
   affirmation that the enrollee consented suffices, or a direct signature from
   the enrolled individual is required; confirm the published retention/
   destruction schedule and horizon; **handle any pre-existing voiceprints
   created before the consent gate** (obtain consent retroactively or delete
   them via `DELETE /api/meetings/speaker-profiles/:id`); build an admin UI for
   enrollment + deletion when voice enrollment gets a front end.
6. **Recording consent:** the app now defaults to requiring an on-screen
   acknowledgement. Client admins can disable it — the admin UI warns that doing
   so shifts recording-law compliance to them; attorney may want this in the
   order form/MSA too.

## Ongoing / business items

7. **Data retention:** only meeting transcripts auto-purge today. Consider
   retention policies (and janitors) for chat history, uploaded files, invoices,
   and voiceprints.
8. **Insurance:** consider E&O (tech errors & omissions) and cyber liability
   coverage — AI-assisted estimating for construction bids is exactly the
   exposure E&O exists for.
9. **State AI laws watch:** Colorado AI Act (eff. 2026-06-30) — current features
   appear human-in-the-loop (not "high-risk consequential decisions"), attorney
   to confirm; California SB 942 applies at >1M monthly users (N/A today); Utah
   AI Policy Act's disclosure duty is covered by the always-on chat caption and
   ToS §6.
10. **Bigger clients:** consider a signed MSA/order form on top of the in-app
    clickwrap for larger engagements (negotiated liability caps, DPAs, etc.).
