import { requireUser } from "@/lib/auth/server";
import { getOrgTemplate } from "@/lib/templates/render";
import { EapClient } from "./eap-client";

export const dynamic = "force-dynamic";

export default async function EapPage() {
  await requireUser();
  const template = await getOrgTemplate();
  return <EapClient template={template} />;
}
