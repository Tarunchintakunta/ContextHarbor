import Link from "next/link";
import { getMe } from "./lib/session";
import LogoutButton from "./LogoutButton";

export default async function SiteHeader() {
  const me = await getMe();
  return (
    <header className="top">
      <Link className="mark" href="/">ContextHarbor</Link>
      <nav className="nav" aria-label="Account">
        {me ? (
          <>
            <Link href={me.role === "admin" ? "/admin" : "/dashboard"}>{me.role === "admin" ? "Admin" : me.workspace?.name ?? "Dashboard"}</Link>
            <span className="who">{me.email}</span>
            <LogoutButton />
          </>
        ) : (
          <Link className="btn small" href="/login">Log in</Link>
        )}
      </nav>
    </header>
  );
}
