"use client";
import { useEffect, useState } from "react";

// Public API origin (not a secret), set at build time on Vercel.
const API = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";

export default function ApiStatus() {
  const [s, setS] = useState<{ state: "checking" | "ok" | "down"; detail: string }>({ state: "checking", detail: "checking…" });
  useEffect(() => {
    if (!API) return setS({ state: "down", detail: "API origin not configured" });
    fetch(`${API}/health`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { commit: string }) => setS({ state: "ok", detail: `API reachable · build ${j.commit}` }))
      .catch((e: Error) => setS({ state: "down", detail: `API unreachable · ${e.message}` }));
  }, []);
  return (
    <span className="status" role="status">
      <span className={`dot ${s.state === "ok" ? "ok" : s.state === "down" ? "bad" : ""}`} aria-hidden="true" />
      {s.detail}
    </span>
  );
}
