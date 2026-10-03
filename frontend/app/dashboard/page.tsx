import SiteHeader from "../SiteHeader";
import Documents from "./Documents";
import { requireMe } from "../lib/session";

export const metadata = { title: "Dashboard · ContextHarbor" };

export default async function Dashboard() {
  const me = await requireMe("member");
  return (
    <div className="wrap">
      <SiteHeader />
      <main className="panel-page">
        <h1>{me.workspace?.name}</h1>
        <p className="lede">Signed in as {me.email}. Only this workspace&apos;s documents are used for your answers.</p>
        <Documents />
      </main>
    </div>
  );
}
