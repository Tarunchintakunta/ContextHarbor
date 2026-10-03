import SiteHeader from "../SiteHeader";
import AuthForm from "../AuthForm";

export const metadata = { title: "Set up admin · ContextHarbor" };

export default async function Setup({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="wrap">
      <SiteHeader />
      <main className="auth">
        <h1>Create the admin account</h1>
        <p className="lede">This one-time link sets up the only admin. It stops working once the account exists.</p>
        {token ? <AuthForm mode="setup" token={token} /> : <p className="error">This page needs the setup link from your server.</p>}
      </main>
    </div>
  );
}
