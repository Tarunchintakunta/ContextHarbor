"use client";
import { useCallback, useEffect, useState } from "react";
import { api, MESSAGES } from "../lib/api";

interface User { id: string; email: string; role: string; status: string; activated: boolean; workspace: string | null }

export default function AdminPanel() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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
    const r = await api<{ inviteUrl?: string; error?: string }>("/v1/admin/members", "POST", { email: f.get("email"), workspace: f.get("workspace") });
    if (!r.ok) return setError(MESSAGES[r.data.error ?? ""] ?? "Couldn't add the member.");
    setLink({ email: String(f.get("email")), url: r.data.inviteUrl! });
    setCopied(false);
    form.reset();
    void load();
  }

  async function setStatus(u: User, status: "active" | "disabled") {
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

  return (
    <>
      <form className="form inline" onSubmit={add}>
        <label className="field"><span>Member email</span><input name="email" type="email" required /></label>
        <label className="field"><span>Workspace (client or project)</span><input name="workspace" required maxLength={80} /></label>
        <button className="btn" type="submit">Add member</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {link && (
        <div className="invite" role="status">
          <p>Send this one-time link to {link.email}. It expires in 7 days.</p>
          <div className="copy">
            <input readOnly value={link.url} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
            <button className="btn small" type="button" onClick={async () => { await navigator.clipboard.writeText(link.url); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button>
          </div>
        </div>
      )}
      <div className="scroll">
        <table className="table">
          <thead><tr><th>Email</th><th>Workspace</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>
            {users === null && <tr><td colSpan={4}>Loading members…</td></tr>}
            {users?.length === 1 && <tr><td colSpan={4}>No members yet. Add one above to create their workspace.</td></tr>}
            {users?.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.role === "admin" ? "Admin" : u.workspace}</td>
                <td>{u.status === "disabled" ? <span className="state bad">Disabled</span> : u.activated ? <span className="state ok">Active</span> : <span className="state warn">Invited</span>}</td>
                <td>
                  {u.role === "member" && (
                    <div className="actions">
                      <button className="btn small ghost" type="button" onClick={() => reset(u)}>New login link</button>
                      {u.status === "active"
                        ? <button className="btn small ghost" type="button" onClick={() => setStatus(u, "disabled")}>Disable</button>
                        : <button className="btn small ghost" type="button" onClick={() => setStatus(u, "active")}>Enable</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
