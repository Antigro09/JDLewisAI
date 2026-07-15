import type { Metadata } from "next";
import { LegalDocPage } from "../legal-doc";

export const metadata: Metadata = {
  title: "End User License Agreement — ContractorAI",
};

export default function EulaPage() {
  return <LegalDocPage slug="eula" />;
}
