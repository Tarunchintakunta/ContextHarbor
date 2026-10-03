"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { ago } from "../lib/format";

interface Device { id: string; label: string; created_at: string; last_used_at: string | null }

export default function DesktopApps({ ready }: { ready: number }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ devices: Device[] }>("/v1/desktop/devices");
    setDevices(r.ok ? r.data.devices : []);
  }, []);
  useEffect(() => void load(), [load]);

  async function disconnect(d: Device) {
    if (!confirm("Disconnect this desktop app? It stops receiving documents right away and must sign in again.")) return;
    await api(`/v1/desktop/devices/${d.id}`, "DELETE");
    void load();
  }

  return (
    <section className="side-card" aria-labelledby="desk-h">
      <h2 id="desk-h">Desktop app</h2>
      {devices === null ? (
        <p className="muted">Checking…</p>
      ) : devices.length > 0 ? (
        <>
          <p className="muted">{ready} ready document{ready === 1 ? "" : "s"} copy to {devices.length === 1 ? "this app" : "these apps"} on each sync.</p>
          <ul className="devices">
            {devices.map((d) => (
              <li key={d.id}>
                <span className={`pulse${d.last_used_at && Date.now() - new Date(d.last_used_at).getTime() < 86400000 ? " live" : ""}`} aria-hidden="true" />
                <div>
                  <strong>{d.label}</strong>
                  <small>
                    {ago(d.last_used_at)}, connected {new Date(d.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </small>
                </div>
                <button type="button" className="btn small ghost" onClick={() => disconnect(d)}>Disconnect</button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="muted">Not connected. Connect it so your meeting answers use these documents.</p>
          <ol className="steps">
            <li>Open ContextHarbor on your computer.</li>
            <li>In Settings, choose <strong>Connect web account</strong>.</li>
            <li>Approve the request in the browser window that opens.</li>
          </ol>
        </>
      )}
    </section>
  );
}
