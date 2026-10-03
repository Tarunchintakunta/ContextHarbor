"use client";
import { useState } from "react";
import { api } from "../lib/api";

export default function Approve({ challenge, redirectUri, state, workspace }: { challenge: string; redirectUri: string; state: string; workspace: string }) {
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function approve() {
    setStatus("busy");
    const r = await api<{ code?: string }>("/v1/desktop/authorize", "POST", { challenge, redirect_uri: redirectUri });
    if (!r.ok || !r.data.code) return setStatus("error");
    setStatus("done");
    window.location.href = `${redirectUri}?code=${encodeURIComponent(r.data.code)}&state=${encodeURIComponent(state)}`;
  }
  if (status === "done") return <p className="notice" role="status">Connected. Return to the desktop app; you can close this tab.</p>;
  return (
    <div className="form">
      {status === "error" && <p className="error" role="alert">Couldn&apos;t connect. Start again from the desktop app.</p>}
      <button className="btn" type="button" onClick={approve} disabled={status === "busy"}>{status === "busy" ? "Connecting…" : `Connect to ${workspace}`}</button>
    </div>
  );
}
