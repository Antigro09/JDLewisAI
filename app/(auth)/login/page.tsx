import { AuthForm } from "../auth-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; google?: string }>;
}) {
  const { next, google } = await searchParams;
  return <AuthForm mode="signin" next={next} googleStatus={google} />;
}
