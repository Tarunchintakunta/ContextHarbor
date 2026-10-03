import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp, createSetupLink } from "./app.js";
import { connect, migrate, type Db } from "./db.js";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql:///ch_test";
let db: Db;
const ORIGIN = "https://dash.example";

before(async () => {
  db = connect(DB_URL);
  await db.query("drop table if exists audit_events, invitations, sessions, users, workspaces cascade");
  await migrate(db);
});
after(() => db.end());

const H = { "x-ch-csrf": "1", "content-type": "application/json" };
const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers["set-cookie"]).split(";")[0];

test("health returns ok and CORS only for the allowed origin", async () => {
  const app = buildApp({ appOrigin: ORIGIN });
  const ok = await app.inject({ url: "/health", headers: { origin: ORIGIN } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers["access-control-allow-origin"], ORIGIN);
  const other = await app.inject({ url: "/health", headers: { origin: "https://evil.example" } });
  assert.equal(other.headers["access-control-allow-origin"], undefined);
  await app.close();
});

test("setup, login, logout, invite, isolation and revocation", async () => {
  const app = buildApp({ db, appOrigin: ORIGIN });
  const link = await createSetupLink(db, ORIGIN);
  const token = new URL(link).searchParams.get("token")!;

  // CSRF header required for mutations
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "a@x.io", password: "x" } })).statusCode, 403);

  // first-admin setup is one-time
  const setup = await app.inject({ method: "POST", url: "/v1/auth/setup", headers: H, payload: { token, email: "Admin@Example.com", password: "correct horse battery" } });
  assert.equal(setup.statusCode, 200);
  const adminCookie = cookieOf(setup);
  assert.match(String(setup.headers["set-cookie"]), /HttpOnly/i);
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/setup", headers: H, payload: { token, email: "b@x.io", password: "correct horse battery" } })).statusCode, 400);
  await assert.rejects(createSetupLink(db, ORIGIN), /already exists/);

  // login / me / logout
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/login", headers: H, payload: { email: "admin@example.com", password: "wrong password!!" } })).statusCode, 401);
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", headers: H, payload: { email: "admin@example.com", password: "correct horse battery" } });
  assert.equal(login.statusCode, 200);
  const c2 = cookieOf(login);
  assert.equal((await app.inject({ url: "/v1/me", headers: { cookie: c2 } })).json().role, "admin");
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/logout", headers: { ...H, cookie: c2 }, payload: {} })).statusCode, 200);
  assert.equal((await app.inject({ url: "/v1/me", headers: { cookie: c2 } })).statusCode, 401, "logged-out session is dead");

  // admin creates two members, each with its own workspace
  const mk = async (email: string, workspace: string) =>
    (await app.inject({ method: "POST", url: "/v1/admin/members", headers: { ...H, cookie: adminCookie }, payload: { email, workspace } })).json();
  const a = await mk("alice@x.io", "Outstar");
  const b = await mk("bob@x.io", "Chintakunta");
  assert.equal((await app.inject({ method: "POST", url: "/v1/admin/members", headers: { ...H, cookie: adminCookie }, payload: { email: "alice@x.io", workspace: "Dup" } })).statusCode, 409);
  const accept = async (inviteUrl: string) =>
    app.inject({ method: "POST", url: "/v1/auth/invitations/accept", headers: H, payload: { token: new URL(inviteUrl).searchParams.get("token"), password: "alice's long password" } });
  const ra = await accept(a.inviteUrl);
  assert.equal(ra.statusCode, 200);
  assert.equal((await accept(a.inviteUrl)).statusCode, 400, "invite link is single-use");
  const aliceCookie = cookieOf(ra);
  const bobCookie = cookieOf(await accept(b.inviteUrl));
  assert.equal((await app.inject({ url: "/v1/workspace", headers: { cookie: aliceCookie } })).json().name, "Outstar");
  assert.equal((await app.inject({ url: "/v1/workspace", headers: { cookie: bobCookie } })).json().name, "Chintakunta");

  // members cannot use admin routes
  assert.equal((await app.inject({ url: "/v1/admin/users", headers: { cookie: aliceCookie } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/v1/admin/members", headers: { ...H, cookie: aliceCookie }, payload: { email: "e@x.io", workspace: "E" } })).statusCode, 403);

  // disabling revokes live sessions immediately; reset invalidates the old password
  await app.inject({ method: "PATCH", url: `/v1/admin/users/${a.id}/status`, headers: { ...H, cookie: adminCookie }, payload: { status: "disabled" } });
  assert.equal((await app.inject({ url: "/v1/me", headers: { cookie: aliceCookie } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/login", headers: H, payload: { email: "alice@x.io", password: "alice's long password" } })).statusCode, 401);
  const reset = (await app.inject({ method: "POST", url: `/v1/admin/users/${b.id}/reset`, headers: { ...H, cookie: adminCookie }, payload: {} })).json();
  assert.ok(reset.inviteUrl);
  assert.equal((await app.inject({ url: "/v1/me", headers: { cookie: bobCookie } })).statusCode, 401);

  // the single admin cannot be disabled, and a second admin is impossible at the DB level
  const users = (await app.inject({ url: "/v1/admin/users", headers: { cookie: adminCookie } })).json().users as { id: string; role: string }[];
  const admin = users.find((u) => u.role === "admin")!;
  assert.equal((await app.inject({ method: "PATCH", url: `/v1/admin/users/${admin.id}/status`, headers: { ...H, cookie: adminCookie }, payload: { status: "disabled" } })).statusCode, 404);
  await assert.rejects(db.query("insert into users (email, role) values ('second@x.io', 'admin')"));
  await app.close();
});

test("login is rate-limited", async () => {
  const app = buildApp({ db, appOrigin: ORIGIN });
  for (let i = 0; i < 5; i++) await app.inject({ method: "POST", url: "/v1/auth/login", headers: H, payload: { email: "nobody@x.io", password: "nope nope nope" } });
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/login", headers: H, payload: { email: "nobody@x.io", password: "nope nope nope" } })).statusCode, 429);
  await app.close();
});
