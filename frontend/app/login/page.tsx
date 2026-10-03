import { redirect } from "next/navigation";
import SiteHeader from "../SiteHeader";
import AuthForm from "../AuthForm";
import { getMe } from "../lib/session";

export const metadata = { title: "Log in · ContextHarbor" };

export default async function Login({ searchParams }: { searchParams: Promise<{ signedOut?: string }> }) {
  const me = await getMe();
  if (me) redirect(me.role === "admin" ? "/admin" : "/dashboard");
  const { signedOut } = await searchParams;
  return (
    <div className="wrap">
      <SiteHeader />
      <main className="auth">
        <h1>Log in</h1>
        {signedOut && <p className="notice" role="status">You&apos;re logged out.</p>}
        <p className="lede">Use the email your admin invited. Accounts are created by invitation only.</p>
        <AuthForm mode="login" />
      </main>
    </div>
  );
}
