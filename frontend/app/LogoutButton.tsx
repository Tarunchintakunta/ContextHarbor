"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./lib/api";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn small ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api("/v1/auth/logout", "POST");
        router.push("/login?signedOut=1");
        router.refresh();
      }}
    >
      {busy ? "Logging out…" : "Log out"}
    </button>
  );
}
