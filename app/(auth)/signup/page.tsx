import { AuthForm } from "../auth-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; google?: string }>;
}) {
  const { next, google } = await searchParams;
  return <AuthForm mode="signup" next={next} googleStatus={google} />;
}
