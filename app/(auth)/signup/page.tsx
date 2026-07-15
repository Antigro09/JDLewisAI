import { notFound } from "next/navigation";
import { AuthForm } from "../auth-form";
import { desktopGateEnabled } from "@/lib/desktop/gate";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; google?: string }>;
}) {
  // Desktop-only production: accounts are created by the owner in /owner,
  // never self-service — even from inside the shell.
  if (desktopGateEnabled()) notFound();
  const { next, google } = await searchParams;
  return <AuthForm mode="signup" next={next} googleStatus={google} />;
}
