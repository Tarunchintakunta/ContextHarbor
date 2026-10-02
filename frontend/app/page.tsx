"use client";
import { useEffect, useState } from "react";

// Public API origin (not a secret). Set at build time on Vercel.
const API = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";

type Health = { state: "checking" } | { state: "ok"; commit: string } | { state: "down"; reason: string };

export default function Home() {
  const [health, setHealth] = useState<Health>({ state: "checking" });

  useEffect(() => {
    if (!API) return setHealth({ state: "down", reason: "API origin not configured" });
    fetch(`${API}/health`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setHealth({ state: "ok", commit: j.commit }))
      .catch((e: Error) => setHealth({ state: "down", reason: e.message }));
  }, []);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 16px" }}>
      <h1 style={{ marginTop: 0 }}>ContextHarbor</h1>
      <p>Project context, ready when the question comes.</p>
      <p style={{ color: "#ff9f6b" }}>
        Deployment skeleton. Accounts, documents and meeting answers are not built yet.
      </p>
      <p role="status">
        API:{" "}
        {health.state === "checking" && "checking…"}
        {health.state === "ok" && <strong style={{ color: "#7bd88f" }}>reachable (build {health.commit})</strong>}
        {health.state === "down" && <strong style={{ color: "#ff6b6b" }}>unreachable — {health.reason}</strong>}
      </p>
    </main>
  );
}
