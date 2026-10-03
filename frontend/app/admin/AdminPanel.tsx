"use client";
import { useCallback, useEffect, useState } from "react";
import { api, MESSAGES } from "../lib/api";
import { ago, size } from "../lib/format";

interface User {
  id: string; email: string; role: string; status: string; activated: boolean; workspace: string | null;
  docs: number; bytes: string; devices: number; last_sync: string | null;
}

const statusOf = (u: User) => (u.status === "disabled" ? "disabled" : u.activated ? "active" : "invited");
const LABEL = { active: "Active", invited: "Invited", disabled: "Disabled" } as const;

export default function AdminPanel() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const r = await api<{ users: User[] }>("/v1/admin/users");
    if (r.ok) setUsers(r.data.users);
    else setError("Couldn't load members. Refresh the page.");
  }, []);
  useEffect(() => void load(), [load]);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError("");
    setBusy(true);
    const r = await api<{ inviteUrl?: string; error?: string }>("/v1/admin/members", "POST", { email: f.get("email"), workspace: f.get("workspace") });
    setBusy(false);
    if (!r.ok) return setError(MESSAGES[r.data.error ?? ""] ?? "Couldn't add the member.");
    setLink({ email: String(f.get("email")), url: r.data.inviteUrl! });
    setCopied(false);
    form.reset();
    void load();
  }

  async function setStatus(u: User, status: "active" | "disabled") {
    if (status === "disabled" && !confirm(`Disable ${u.email}? They're signed out everywhere, including the desktop app.`)) return;
    await api(`/v1/admin/users/${u.id}/status`, "PATCH", { status });
    void load();
  }

  async function reset(u: User) {
    const r = await api<{ inviteUrl: string }>(`/v1/admin/users/${u.id}/reset`, "POST");
    if (r.ok) {
      setLink({ email: u.email, url: r.data.inviteUrl });
      setCopied(false);
      void load();
    }
  }

  const members = users?.filter((u) => u.role === "member") ?? [];
  const shown = members.filter((u) => `${u.email} ${u.workspace}`.toLowerCase().includes(q.trim().toLowerCase()));
  const tally = (s: string) => members.filter((u) => statusOf(u) === s).length;
  const totalDocs = members.reduce((n, u) => n + u.docs, 0);
  const totalBytes = members.reduce((n, u) => n + Number(u.bytes), 0);

  return (
    <div className="dash">
      <section aria-labelledby="members-h">
        <div className="docs-head">
          <h2 id="members-h">Members</h2>
          {members.length > 3 && (
            <input className="search" type="search" placeholder="Find by email or workspace" aria-label="Find a member" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
        </div>
        {error && <p className="error" role="alert">{error}</p>}

        {users === null ? (
          <p className="muted">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="empty">No members yet. Add one to create their workspace and get a sign-in link to send them.</p>
        ) : shown.length === 0 ? (
          <p className="empty">No member matches &ldquo;{q}&rdquo;.</p>
        ) : (
          <ul className="members">
            {shown.map((u) => {
              const st = statusOf(u);
              return (
                <li key={u.id} className={st === "disabled" ? "off" : ""}>
                  <span className="avatar" aria-hidden="true">{(u.workspace ?? u.email).slice(0, 1).toUpperCase()}</span>
                  <div className="who-col">
                    <strong>{u.workspace}</strong>
                    <span>{u.email}</span>
                  </div>
                  <div className="stats">
                    <span>{u.docs} doc{u.docs === 1 ? "" : "s"}{u.docs > 0 && `, ${size(Number(u.bytes))}`}</span>
                    <span className={u.devices ? "desk on" : "desk"}>{u.devices ? `Desktop ${ago(u.last_sync)}` : "No desktop app"}</span>
                  </div>
                  <span className={`pill ${st}`}>{LABEL[st]}</span>
                  <div className="actions">
                    <button className="btn small ghost" type="button" onClick={() => reset(u)}>{u.activated ? "New login link" : "New invite link"}</button>
                    {u.status === "active"
                      ? <button className="btn small ghost" type="button" onClick={() => setStatus(u, "disabled")}>Disable</button>
                      : <button className="btn small ghost" type="button" onClick={() => setStatus(u, "active")}>Enable</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <aside className="dash-side">
        <section className="side-card" aria-labelledby="add-h">
          <h2 id="add-h">Add a member</h2>
          <p className="muted">Each member gets one workspace for one client or project.</p>
          <form className="form" onSubmit={add}>
            <label className="field"><span>Email</span><input name="email" type="email" required /></label>
            <label className="field"><span>Workspace name</span><input name="workspace" required maxLength={80} placeholder="Client or project" /></label>
            <button className="btn" type="submit" disabled={busy}>{busy ? "Adding…" : "Add member"}</button>
          </form>
          {link && (
            <div className="invite" role="status">
              <p>Send this one-time link to {link.email}. It expires in 7 days.</p>
              <div className="copy">
                <input readOnly value={link.url} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
                <button className="btn small" type="button" onClick={async () => { await navigator.clipboard.writeText(link.url); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
              </div>
            </div>
          )}
        </section>

        <section className="side-card" aria-labelledby="glance-h">
          <h2 id="glance-h">At a glance</h2>
          <dl className="tally">
            <div><dt>Active</dt><dd>{tally("active")}</dd></div>
            <div className={tally("invited") ? "warn" : ""}><dt>Invited</dt><dd>{tally("invited")}</dd></div>
            <div><dt>Disabled</dt><dd>{tally("disabled")}</dd></div>
          </dl>
          <p className="muted">{totalDocs} document{totalDocs === 1 ? "" : "s"} across all workspaces, {totalBytes ? size(totalBytes) : "nothing"} stored. You see counts, never document contents.</p>
        </section>
      </aside>
    </div>
  );
}
