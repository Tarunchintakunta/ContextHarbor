import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp, createSetupLink } from "./app.js";
import { connect, migrate, type Db } from "./db.js";
import { DirBlobs } from "./blobs.js";

const ORIGIN = "https://dash.example";
const FIX = path.join(process.cwd(), "fixtures");
const H = { "x-ch-csrf": "1", "content-type": "application/json" };
let db: Db;
let blobDir: string;

before(async () => {
  db = connect(process.env.TEST_DATABASE_URL ?? "postgresql:///ch_test_docs");
  await db.query("drop table if exists audit_events, upload_tickets, documents, invitations, sessions, users, workspaces cascade");
  await migrate(db);
  blobDir = mkdtempSync(path.join(tmpdir(), "blobs-"));
});
after(async () => {
  await db.end();
  rmSync(blobDir, { recursive: true, force: true });
});

test("upload, extract, preview, accept, dedupe, isolate, delete", async () => {
  const app = buildApp({ db, blobs: new DirBlobs(blobDir), appOrigin: ORIGIN });
  const cookieOf = (r: { headers: Record<string, unknown> }) => String(r.headers["set-cookie"]).split(";")[0];
  const setup = await app.inject({ method: "POST", url: "/v1/auth/setup", headers: H, payload: { token: new URL(await createSetupLink(db, ORIGIN)).searchParams.get("token"), email: "admin@x.io", password: "admin password long" } });
  const admin = cookieOf(setup);
  const member = async (email: string, workspace: string) => {
    const m = (await app.inject({ method: "POST", url: "/v1/admin/members", headers: { ...H, cookie: admin }, payload: { email, workspace } })).json();
    return cookieOf(await app.inject({ method: "POST", url: "/v1/auth/invitations/accept", headers: H, payload: { token: new URL(m.inviteUrl).searchParams.get("token"), password: "member password long" } }));
  };
  const alice = await member("alice@x.io", "Outstar");
  const bob = await member("bob@x.io", "Chintakunta");

  const upload = async (cookie: string, file: string, name = file) => {
    const { ticket } = (await app.inject({ method: "POST", url: "/v1/documents/upload-ticket", headers: { ...H, cookie }, payload: {} })).json();
    return app.inject({ method: "PUT", url: "/v1/uploads", headers: { origin: ORIGIN, "content-type": "application/octet-stream", "x-ch-ticket": ticket, "x-ch-filename": encodeURIComponent(name) }, payload: readFileSync(path.join(FIX, file)) });
  };

  const md = await upload(alice, "notes.md");
  assert.equal(md.statusCode, 200);
  assert.equal(md.headers["access-control-allow-origin"], ORIGIN);
  assert.equal(md.json().document.state, "ready");

  const pdf = (await upload(alice, "perf.pdf")).json().document;
  assert.equal(pdf.state, "needs_review"); // page 2 has no text
  assert.equal(pdf.pages, 2);
  assert.match(pdf.warnings[0], /page 2/);
  const prev = (await app.inject({ url: `/v1/documents/${pdf.id}`, headers: { cookie: alice } })).json();
  assert.match(prev.preview, /\[page 1\]\nCheckout p95 latency 182 ms/);
  assert.equal((await app.inject({ method: "POST", url: `/v1/documents/${pdf.id}/accept`, headers: { ...H, cookie: alice }, payload: {} })).statusCode, 200);

  const docx = (await upload(alice, "plan.docx")).json().document;
  const docxPrev = (await app.inject({ url: `/v1/documents/${docx.id}`, headers: { cookie: alice } })).json().preview;
  assert.match(docxPrev, /# Payments plan/);
  assert.match(docxPrev, /Ireland \| 1/);

  assert.equal((await upload(alice, "scanned.pdf")).json().document.state, "failed");
  const fake = await upload(alice, "fake.pdf");
  assert.equal(fake.statusCode, 415);
  assert.match(fake.json().message, /isn't a PDF/);
  assert.equal((await upload(alice, "notes.md", "notes.exe")).statusCode, 415);
  const macro = await upload(alice, "macro.docx");
  assert.equal(macro.statusCode, 415);
  assert.match(macro.json().message, /Macro-enabled/);

  // oversize files are rejected before anything is stored
  const t2 = (await app.inject({ method: "POST", url: "/v1/documents/upload-ticket", headers: { ...H, cookie: alice }, payload: {} })).json().ticket;
  const big = await app.inject({ method: "PUT", url: "/v1/uploads", headers: { origin: ORIGIN, "content-type": "application/octet-stream", "x-ch-ticket": t2, "x-ch-filename": "big.md" }, payload: Buffer.alloc(25 * 1024 * 1024 + 1, 97) });
  assert.equal(big.statusCode, 413);

  // retry of the same bytes creates one version
  const again = (await upload(alice, "notes.md", "notes-copy.md")).json();
  assert.equal(again.duplicate, true);

  // ticket is single-use and required
  const { ticket } = (await app.inject({ method: "POST", url: "/v1/documents/upload-ticket", headers: { ...H, cookie: alice }, payload: {} })).json();
  const put = () => app.inject({ method: "PUT", url: "/v1/uploads", headers: { origin: ORIGIN, "content-type": "application/octet-stream", "x-ch-ticket": ticket, "x-ch-filename": "a.md" }, payload: Buffer.from("# hi there") });
  assert.equal((await put()).statusCode, 200);
  assert.equal((await put()).statusCode, 401);
  assert.equal((await app.inject({ method: "PUT", url: "/v1/uploads", headers: { origin: "https://evil.example", "content-type": "application/octet-stream", "x-ch-ticket": "x", "x-ch-filename": "a.md" }, payload: Buffer.from("x") })).statusCode, 403);

  // isolation: bob sees none of alice's documents and can't read, accept or delete them
  const list = (c: string) => app.inject({ url: "/v1/documents", headers: { cookie: c } }).then((r) => r.json());
  assert.equal((await list(bob)).documents.length, 0);
  assert.equal((await list(alice)).documents.length, 5);
  assert.equal((await app.inject({ url: `/v1/documents/${pdf.id}`, headers: { cookie: bob } })).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: `/v1/documents/${pdf.id}`, headers: { ...H, cookie: bob } })).statusCode, 404);
  assert.equal((await app.inject({ url: "/v1/documents", headers: { cookie: admin } })).statusCode, 403); // admin has no workspace content view
  assert.equal((await app.inject({ url: "/v1/documents" })).statusCode, 401);

  // delete revokes access and removes the stored original
  const stored = () => readdirSync(blobDir, { recursive: true }).filter((f) => String(f).split(path.sep).length === 3).length;
  const before = stored();
  assert.equal((await app.inject({ method: "DELETE", url: `/v1/documents/${pdf.id}`, headers: { ...H, cookie: alice } })).statusCode, 200);
  assert.equal(stored(), before - 1);
  assert.equal((await app.inject({ url: `/v1/documents/${pdf.id}`, headers: { cookie: alice } })).statusCode, 404);
  const row = await db.query("select text, state from documents where id = $1", [pdf.id]);
  assert.deepEqual(row.rows[0], { text: null, state: "deleted" });
  await app.close();
});
