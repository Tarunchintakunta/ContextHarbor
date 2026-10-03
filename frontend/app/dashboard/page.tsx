import SiteHeader from "../SiteHeader";
import { requireMe } from "../lib/session";

export const metadata = { title: "Dashboard · ContextHarbor" };

export default async function Dashboard() {
  const me = await requireMe("member");
  return (
    <div className="wrap">
      <SiteHeader />
      <main className="panel-page">
        <h1>{me.workspace?.name}</h1>
        <p className="lede">Signed in as {me.email}. This account only sees the {me.workspace?.name} workspace.</p>
        <dl className="facts">
          <div><dt>Workspace</dt><dd>{me.workspace?.name}</dd></div>
          <div><dt>Account</dt><dd>{me.email}</dd></div>
          <div><dt>Notes and meetings</dt><dd>Kept in the desktop app on your computer. Document upload on the web is not available yet.</dd></div>
        </dl>
      </main>
    </div>
  );
}
