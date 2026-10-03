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
        <h1>Members</h1>
        <p className="lede">Each member gets one workspace for one client or project. As admin ({me.email}) you manage access; you don&apos;t see their passwords.</p>
        <AdminPanel />
      </main>
    </div>
  );
}
