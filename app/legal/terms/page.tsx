import type { Metadata } from "next";
import { LegalDocPage } from "../legal-doc";

export const metadata: Metadata = { title: "Terms of Service — ContractorAI" };

export default function TermsPage() {
  return <LegalDocPage slug="terms" />;
}
