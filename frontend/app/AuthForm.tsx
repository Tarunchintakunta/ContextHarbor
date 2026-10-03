"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, MESSAGES } from "./lib/api";

type Mode = "login" | "setup" | "invite";

// Only same-site relative paths, so a crafted link can't send people elsewhere after login.
const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") ? n : null);

export default function AuthForm({ mode, token, email: fixedEmail, next }: { mode: Mode; token?: string; email?: string; next?: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const label = mode === "login" ? "Log in" : mode === "setup" ? "Create admin account" : "Set password and log in";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password") ?? "");
    if (mode !== "login" && password !== String(f.get("confirm") ?? "")) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    const path = mode === "login" ? "/v1/auth/login" : mode === "setup" ? "/v1/auth/setup" : "/v1/auth/invitations/accept";
    const r = await api<{ error?: string }>(path, "POST", { email: f.get("email"), password, token });
    setBusy(false);
    if (!r.ok) return setError(MESSAGES[r.data.error ?? ""] ?? "Something went wrong. Try again.");
    router.push(safeNext(next) ?? (mode === "setup" ? "/admin" : "/dashboard"));
    router.refresh();
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="field">
        <span>Email</span>
        {fixedEmail ? <input value={fixedEmail} readOnly aria-readonly="true" /> : <input name="email" type="email" autoComplete="email" required autoFocus />}
      </label>
      <label className="field">
        <span>{mode === "login" ? "Password" : "New password"}</span>
        <input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? undefined : 12} required />
        {mode !== "login" && <small>At least 12 characters.</small>}
      </label>
      {mode !== "login" && (
        <label className="field">
          <span>Repeat password</span>
          <input name="confirm" type="password" autoComplete="new-password" required />
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Please wait…" : label}</button>
    </form>
  );
}
