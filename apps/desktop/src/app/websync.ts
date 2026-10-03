// Connects the desktop app to the user's web account and keeps dashboard uploads in the local knowledge base.
// Sign-in: system browser + PKCE + one-time code to a 127.0.0.1 loopback port. Only extracted text is synced.
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { KnowledgeBase } from "../core/kb";

export interface WebStatus {
  connected: boolean;
  email?: string;
  workspace?: string;
  documents?: number;
  lastSync?: number;
  error?: string;
}

type Fetch = typeof fetch;

/** Browser sign-in. `open` launches the system browser; resolves with a device token. */
export async function connectAccount(webOrigin: string, apiOrigin: string, open: (url: string) => void, f: Fetch = fetch, timeoutMs = 5 * 60_000): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  let finish!: (code: string) => void;
  let fail!: (e: Error) => void;
  const gotCode = new Promise<string>((res, rej) => ((finish = res), (fail = rej)));
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname !== "/callback") return void res.writeHead(404).end();
    const ok = u.searchParams.get("state") === state && !!u.searchParams.get("code");
    res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>ContextHarbor</title><body style="font:18px system-ui;padding:40px">${ok ? "Desktop app connected. You can close this tab." : "Sign-in failed. Start again from the desktop app."}</body>`);
    if (ok) finish(u.searchParams.get("code")!);
    else fail(new Error("state mismatch"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
  const timer = setTimeout(() => fail(new Error("Sign-in timed out")), timeoutMs);
  try {
    open(`${webOrigin}/desktop-login?challenge=${challenge}&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`);
    const code = await gotCode;
    const r = await f(`${apiOrigin}/v1/desktop/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, verifier, redirect_uri: redirect }) });
    if (!r.ok) throw new Error("Sign-in was rejected. Try again.");
    return ((await r.json()) as { token: string }).token;
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

export class DeviceRevoked extends Error {}

/**
 * Pulls ready dashboard documents into the local KB under `web/<id>/<name>` and removes ones deleted on the web.
 * Documents are stored for the current local user only; another local user's KB is never touched.
 */
export async function syncDocuments(userId: string, kb: KnowledgeBase, apiOrigin: string, token: string, f: Fetch = fetch): Promise<WebStatus> {
  const get = async <T>(path: string): Promise<T> => {
    const r = await f(`${apiOrigin}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 401) throw new DeviceRevoked("This device was signed out. Connect again.");
    if (!r.ok) throw new Error(`Sync failed (HTTP ${r.status}).`);
    return (await r.json()) as T;
  };
  const me = await get<{ email: string; workspace: { name: string } }>("/v1/sync/me");
  const list = await get<{ documents: { id: string; name: string; sha256: string; created_at: string }[] }>("/v1/sync/documents");
  const safe = (n: string) => n.replace(/[\\/]/g, "_");
  const wanted = new Map(list.documents.map((d) => [`web/${d.id}/${safe(d.name)}`, d]));
  for (const path of kb.sources(userId, "web")) if (!wanted.has(path)) kb.removeDocument(userId, path);
  const have = new Set(kb.sources(userId, "web"));
  for (const [path, d] of wanted) {
    if (have.has(path)) continue; // documents are immutable versions: same id means same content
    const doc = await get<{ text: string; created_at: string }>(`/v1/sync/documents/${d.id}`);
    await kb.upsertDocument(userId, path, doc.text, { title: d.name, docType: "reference", origin: "web" });
  }
  return { connected: true, email: me.email, workspace: me.workspace.name, documents: wanted.size, lastSync: Date.now() };
}
