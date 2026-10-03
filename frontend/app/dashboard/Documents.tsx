"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import DesktopApps from "./DesktopApps";

const API = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";
const MAX = 25 * 1024 * 1024;
const OK_EXT = /\.(md|markdown|pdf|docx)$/i;

interface Doc {
  id: string; name: string; format: "md" | "pdf" | "docx"; size_bytes: string; state: "ready" | "needs_review" | "failed";
  warnings: string[]; reason: string | null; pages: number | null; created_at: string; limitations_accepted_at: string | null;
}
interface Pending { key: string; name: string; status: "uploading" | "error"; message?: string }

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const STATE = { ready: ["ok", "Ready"], needs_review: ["warn", "Needs your review"], failed: ["bad", "Couldn't read"] } as const;

export default function Documents() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [usage, setUsage] = useState({ files: 0, bytes: 0 });
  const [pending, setPending] = useState<Pending[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ documents: Doc[]; usage: { files: number; bytes: number } }>("/v1/documents");
    if (r.ok) {
      setDocs(r.data.documents);
      setUsage(r.data.usage);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function uploadOne(file: File) {
    const key = `${file.name}-${file.size}-${Date.now()}`;
    const fail = (message: string) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "error", message } : x)));
    setPending((p) => [...p, { key, name: file.name, status: "uploading" }]);
    if (!OK_EXT.test(file.name)) return fail("Only .md, .pdf and .docx files are supported.");
    if (file.size > MAX) return fail(`${size(file.size)} is over the 25 MB limit.`);
    const t = await api<{ ticket: string }>("/v1/documents/upload-ticket", "POST");
    if (!t.ok) return fail("Your session ended. Log in again to upload.");
    const r = await fetch(`${API}/v1/uploads`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-ch-ticket": t.data.ticket, "x-ch-filename": encodeURIComponent(file.name) },
      body: file,
    }).catch(() => null);
    if (!r) return fail("Upload failed. Check your connection and try again.");
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!r.ok) return fail(r.status === 413 ? "This file is over the 25 MB limit." : j.message ?? "Upload failed. Try again.");
    setPending((p) => p.filter((x) => x.key !== key));
    void load();
  }

  const uploadAll = (files: FileList | null) => {
    if (files) for (const f of Array.from(files)) void uploadOne(f);
  };

  async function toggle(d: Doc) {
    if (open === d.id) return setOpen(null);
    setOpen(d.id);
    if (!preview[d.id] && d.state !== "failed") {
      const r = await api<{ preview: string; text_length: number }>(`/v1/documents/${d.id}`);
      if (r.ok) setPreview((p) => ({ ...p, [d.id]: r.data.preview + (r.data.text_length > r.data.preview.length ? "\n\n…" : "") }));
    }
  }

  async function accept(d: Doc) {
    await api(`/v1/documents/${d.id}/accept`, "POST");
    void load();
  }

  async function remove(d: Doc) {
    if (!confirm(`Delete "${d.name}"? It will stop being used for answers right away.`)) return;
    await api(`/v1/documents/${d.id}`, "DELETE");
    if (open === d.id) setOpen(null);
    void load();
  }

  const count = (st: Doc["state"]) => docs?.filter((d) => d.state === st).length ?? 0;
  const ready = count("ready");

  return (
    <div className="dash">
    <section className="docs" aria-labelledby="docs-h">
      <div className="docs-head">
        <h2 id="docs-h">Documents</h2>
      </div>

      <label
        className={`drop${drag ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); uploadAll(e.dataTransfer.files); }}
      >
        <input type="file" multiple accept=".md,.markdown,.pdf,.docx" onChange={(e) => { uploadAll(e.target.files); e.target.value = ""; }} />
        <strong>Drop files here or choose files</strong>
        <span>Markdown, PDF or Word (.docx), up to 25 MB each. Text is read on our server; scanned pages and images aren&apos;t.</span>
      </label>

      {pending.length > 0 && (
        <ul className="pending" aria-live="polite">
          {pending.map((p) => (
            <li key={p.key} className={p.status}>
              <span>{p.name}</span>
              {p.status === "uploading" ? <em>Uploading and reading…</em> : <><em>{p.message}</em><button type="button" className="btn small ghost" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>Dismiss</button></>}
            </li>
          ))}
        </ul>
      )}

      {docs === null ? (
        <p className="muted">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="empty">No documents yet. Add the notes, plans and reports for this workspace; answers in meetings come only from these.</p>
      ) : (
        <ul className="doclist">
          {docs.map((d) => (
            <li key={d.id} className={open === d.id ? "open" : ""}>
              <div className="docrow">
                <button type="button" className="docname" aria-expanded={open === d.id} onClick={() => toggle(d)}>
                  <span className="fmt">{d.format.toUpperCase()}</span>
                  <span>{d.name}</span>
                </button>
                <span className="meta">{size(+d.size_bytes)}{d.pages ? `, ${d.pages} page${d.pages > 1 ? "s" : ""}` : ""}</span>
                <span className={`state ${STATE[d.state][0]}`}>{STATE[d.state][1]}</span>
                <button type="button" className="btn small ghost" onClick={() => remove(d)}>Delete</button>
              </div>
              {open === d.id && (
                <div className="docbody">
                  {d.state === "failed" && <p className="error">{d.reason}</p>}
                  {d.warnings.length > 0 && (
                    <div className="review">
                      {d.warnings.map((w) => <p key={w}>{w}</p>)}
                      {d.state === "needs_review" ? (
                        <button type="button" className="btn small" onClick={() => accept(d)}>Use the readable text</button>
                      ) : (
                        <p className="muted">You accepted these limits on {new Date(d.limitations_accepted_at!).toLocaleDateString()}.</p>
                      )}
                    </div>
                  )}
                  {d.state !== "failed" && <pre className="preview">{preview[d.id] ?? "Loading preview…"}</pre>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>

    <aside className="dash-side">
      <section className="side-card" aria-labelledby="glance-h">
        <h2 id="glance-h">At a glance</h2>
        <dl className="tally">
          <div><dt>Ready</dt><dd>{ready}</dd></div>
          <div className={count("needs_review") ? "warn" : ""}><dt>To review</dt><dd>{count("needs_review")}</dd></div>
          <div className={count("failed") ? "bad" : ""}><dt>Unreadable</dt><dd>{count("failed")}</dd></div>
        </dl>
        <Meter label="Files" value={usage.files} max={20} text={`${usage.files} of 20`} />
        <Meter label="Storage" value={usage.bytes} max={500 * 1024 * 1024} text={`${size(usage.bytes)} of 500 MB`} />
      </section>
      <DesktopApps ready={ready} />
    </aside>
    </div>
  );
}

function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="meter">
      <div className="meter-row"><span>{label}</span><span>{text}</span></div>
      <div className="meter-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={text}>
        <i style={{ width: `${value > 0 ? Math.max(pct, 2) : 0}%` }} className={pct >= 90 ? "full" : ""} />
      </div>
    </div>
  );
}
