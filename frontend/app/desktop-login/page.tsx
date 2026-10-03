import { redirect } from "next/navigation";
import SiteHeader from "../SiteHeader";
import { getMe } from "../lib/session";
import Approve from "./Approve";

export const metadata = { title: "Connect desktop app · ContextHarbor" };
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{2,5}\/callback$/;

export default async function DesktopLogin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const valid = !!q.challenge && /^[A-Za-z0-9_-]{43}$/.test(q.challenge) && !!q.redirect_uri && LOOPBACK.test(q.redirect_uri) && !!q.state;
  const me = await getMe();
  if (!me && valid) redirect(`/login?next=${encodeURIComponent(`/desktop-login?${new URLSearchParams(q as Record<string, string>)}`)}`);
  return (
    <div className="wrap">
      <SiteHeader />
      <main className="auth">
        <h1>Connect the desktop app</h1>
        {!valid ? (
          <p className="error">This link didn&apos;t come from the ContextHarbor desktop app. Start again from the app&apos;s Settings.</p>
        ) : me?.role !== "member" || !me.workspace ? (
          <p className="error">Only member accounts with a workspace can connect a desktop app.</p>
        ) : (
          <>
            <p className="lede">
              The desktop app on this computer will get the text of your <strong>{me.workspace.name}</strong> documents, so it can answer from them in meetings.
              It can&apos;t change your account or see other workspaces.
            </p>
            <Approve challenge={q.challenge!} redirectUri={q.redirect_uri!} state={q.state!} workspace={me.workspace.name} />
          </>
        )}
      </main>
    </div>
  );
}
