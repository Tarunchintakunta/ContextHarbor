import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeBase } from "../core/kb";
import { HashEmbedder } from "../core/embed";
import { connectAccount, syncDocuments, DeviceRevoked } from "./websync";

function fakeApi(docs: Record<string, { name: string; text: string }>, token = "tok") {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.pathname === "/v1/desktop/token") return json(200, { token });
    if (auth !== `Bearer ${token}`) return json(401, { error: "device_revoked" });
    if (u.pathname === "/v1/sync/me") return json(200, { email: "alice@x.io", workspace: { name: "Outstar" } });
    if (u.pathname === "/v1/sync/documents") return json(200, { documents: Object.entries(docs).map(([id, d]) => ({ id, name: d.name, sha256: id, created_at: "2026-10-01T00:00:00Z" })) });
    const id = u.pathname.split("/").pop()!;
    return docs[id] ? json(200, { ...docs[id], created_at: "2026-10-01T00:00:00Z" }) : json(404, {});
  }) as typeof fetch;
}

test("dashboard documents sync into the local KB for that user only, and deletions follow", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sync-"));
  const kb = new KnowledgeBase(path.join(dir, "kb.sqlite"), new HashEmbedder());
  const docs: Record<string, { name: string; text: string }> = {
    "11111111-1111-1111-1111-111111111111": { name: "payments-plan.md", text: "Payments migration launch date is October 14." },
    "22222222-2222-2222-2222-222222222222": { name: "perf/report.pdf", text: "[page 1]\nCheckout p95 latency 182 ms." },
  };
  const s = await syncDocuments("alice", kb, "https://api.test", "tok", fakeApi(docs));
  assert.deepEqual([s.workspace, s.documents], ["Outstar", 2]);
  const hit = await kb.search("alice", "payments migration launch date");
  assert.match(hit[0].text, /October 14/);
  assert.equal(hit[0].sourcePath, "web/11111111-1111-1111-1111-111111111111/payments-plan.md");
  assert.deepEqual(await kb.search("bob", "payments migration launch date"), [], "other local users see nothing");

  delete docs["11111111-1111-1111-1111-111111111111"];
  await syncDocuments("alice", kb, "https://api.test", "tok", fakeApi(docs));
  assert.deepEqual(await kb.search("alice", "payments migration launch date"), [], "deleted on the web, gone locally");
  assert.equal(kb.sources("alice", "web").length, 1);

  await assert.rejects(syncDocuments("alice", kb, "https://api.test", "revoked", fakeApi(docs, "tok")), DeviceRevoked);
  kb.close();
  rmSync(dir, { recursive: true });
});

test("browser sign-in: loopback callback with state check, PKCE exchange", async () => {
  const token = await connectAccount("https://web.test", "https://api.test", (url) => {
    const u = new URL(url);
    assert.equal(u.pathname, "/desktop-login");
    assert.match(u.searchParams.get("challenge")!, /^[A-Za-z0-9_-]{43}$/);
    const redirect = u.searchParams.get("redirect_uri")!;
    assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    void fetch(`${redirect}?code=abc&state=${u.searchParams.get("state")}`); // what the browser does after approval
  }, fakeApi({}, "device-token"));
  assert.equal(token, "device-token");

  await assert.rejects(connectAccount("https://web.test", "https://api.test", (url) => {
    const redirect = new URL(url).searchParams.get("redirect_uri")!;
    void fetch(`${redirect}?code=abc&state=forged`).catch(() => {});
  }, fakeApi({})), /state mismatch/);
});
