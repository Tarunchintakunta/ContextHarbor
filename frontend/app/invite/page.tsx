import SiteHeader from "../SiteHeader";
import AuthForm from "../AuthForm";

export const metadata = { title: "Accept invitation · ContextHarbor" };
const API = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";

export default async function Invite({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const info = token
    ? await fetch(`${API}/v1/auth/invitations/${encodeURIComponent(token)}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ email: string; workspace: string | null }>) : null)).catch(() => null)
    : null;
  return (
    <div className="wrap">
      <SiteHeader />
      <main className="auth">
        <h1>{info?.workspace ? `Join ${info.workspace}` : "Accept invitation"}</h1>
        {info ? (
          <>
            <p className="lede">Choose a password for your account. You&apos;ll only see this workspace&apos;s notes.</p>
            <AuthForm mode="invite" token={token} email={info.email} />
          </>
        ) : (
          <p className="error">This link has expired or was already used. Ask your admin for a new one.</p>
        )}
      </main>
    </div>
  );
}
