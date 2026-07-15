import type { Metadata } from "next";
import { LegalDocPage } from "../legal-doc";

export const metadata: Metadata = { title: "Privacy Policy — ContractorAI" };

export default function PrivacyPage() {
  return <LegalDocPage slug="privacy" />;
}
