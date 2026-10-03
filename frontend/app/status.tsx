"use client";
import { useEffect, useState } from "react";

// Public API origin (not a secret), set at build time on Vercel.
const API = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";

export default function ApiStatus() {
  const [s, setS] = useState<{ state: "checking" | "ok" | "down"; text: string }>({ state: "checking", text: "Checking service" });
  useEffect(() => {
    if (!API) return setS({ state: "down", text: "Service not configured" });
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(() => setS({ state: "ok", text: "Service online" }))
      .catch(() => setS({ state: "down", text: "Service unreachable" }));
  }, []);
  return (
    <span className="api" role="status">
      <i className={s.state === "ok" ? "ok" : s.state === "down" ? "bad" : ""} aria-hidden="true" />
      {s.text}
    </span>
  );
}
