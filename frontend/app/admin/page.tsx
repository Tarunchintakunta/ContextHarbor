import SiteHeader from "../SiteHeader";
import AdminPanel from "./AdminPanel";
import { requireMe } from "../lib/session";

export const metadata = { title: "Admin · ContextHarbor" };

export default async function Admin() {
  const me = await requireMe("admin");
  return (
    <div className="wrap">
      <SiteHeader />
      <main className="panel-page">
        <h1>Admin</h1>
        <p className="lede">Signed in as {me.email}. Invite people, give each one a workspace, and turn their access on or off. You never see their passwords or document contents.</p>
        <AdminPanel />
      </main>
    </div>
  );
}
