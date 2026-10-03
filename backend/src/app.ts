import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import type { Db } from "./db.js";
import { hashPassword, Limiter, newToken, normalizeEmail, sha256, validPassword, verifyPassword } from "./auth.js";
import type { BlobStore } from "./blobs.js";
import { registerDocuments } from "./documents.js";

const COOKIE = "ch_session";
const SESSION_MS = 7 * 86_400_000;
const INVITE_MS = 7 * 86_400_000;

export interface Options {
  db?: Db; // absent: health-only mode
  blobs?: BlobStore;
  appOrigin?: string;
  secureCookies?: boolean;
}

interface Me {
  id: string;
  email: string;
  role: "admin" | "member";
  workspace_id: string | null;
  workspace_name: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    me?: Me;
  }
}

export function buildApp(opts: Options = {}) {
  const { db, blobs, appOrigin = process.env.APP_ORIGIN ?? "", secureCookies = process.env.NODE_ENV === "production" } = opts;
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 16 * 1024, trustProxy: true });
  void app.register(cookie);
  // Treat an empty JSON body as {} (DELETE/logout calls often send the header with no body).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error("invalid JSON"), { statusCode: 400 }), undefined);
    }
  });
  const limiter = new Limiter();

  app.addHook("onSend", async (req, reply) => {
    // Exact-match CORS for the dashboard origin only; no wildcard, no credentials cross-site.
    if (appOrigin && req.headers.origin === appOrigin) {
      reply.header("access-control-allow-origin", appOrigin);
      reply.header("vary", "Origin");
    }
    reply.header("cache-control", "no-store");
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "contextharbor-api",
    stage: db ? "auth" : "skeleton",
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  }));

  if (!db) return app;

  // CSRF: every state-changing request must carry a custom header, which a cross-site form or
  // simple request cannot add without a CORS preflight (and preflights are never approved here).
  app.addHook("onRequest", async (req, reply) => {
    const ticketed = req.url.startsWith("/v1/uploads"); // authenticated by a single-use ticket, not the cookie
    if (req.method !== "GET" && req.method !== "HEAD" && !ticketed && req.headers["x-ch-csrf"] !== "1") {
      return reply.code(403).send({ error: "csrf" });
    }
  });

  async function loadSession(req: FastifyRequest) {
    const t = req.cookies[COOKIE];
    if (!t) return;
    const r = await db!.query<Me>(
      `select u.id, u.email, u.role, u.workspace_id, w.name as workspace_name
         from sessions s join users u on u.id = s.user_id left join workspaces w on w.id = u.workspace_id
        where s.token_hash = $1 and s.expires_at > now() and s.session_version = u.session_version and u.status = 'active'`,
      [sha256(t)],
    );
    req.me = r.rows[0];
  }
  app.addHook("preHandler", loadSession);

  const requireUser = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.me) return reply.code(401).send({ error: "unauthenticated" });
  };
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.me) return reply.code(401).send({ error: "unauthenticated" });
    if (req.me.role !== "admin") return reply.code(403).send({ error: "forbidden" });
  };
  const audit = (actor: string | null, action: string, target: string | null) =>
    db.query("insert into audit_events (actor, action, target) values ($1, $2, $3)", [actor, action, target]);

  async function startSession(reply: FastifyReply, userId: string) {
    const token = newToken();
    await db!.query(
      "insert into sessions (token_hash, user_id, session_version, expires_at) select $1, id, session_version, now() + $3 * interval '1 millisecond' from users where id = $2",
      [sha256(token), userId, SESSION_MS],
    );
    reply.setCookie(COOKIE, token, { httpOnly: true, secure: secureCookies, sameSite: "lax", path: "/", maxAge: SESSION_MS / 1000 });
  }

  // ---- auth ----
  app.post("/v1/auth/login", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(b.email);
    const key = `${req.ip}|${email ?? ""}`;
    if (limiter.blocked(key)) return reply.code(429).send({ error: "too_many_attempts" });
    const r = email ? await db.query<{ id: string; password_hash: string | null; status: string }>("select id, password_hash, status from users where email = $1", [email]) : { rows: [] };
    const u = r.rows[0];
    const ok = typeof b.password === "string" && (await verifyPassword(b.password, u?.password_hash ?? null));
    if (!u || !ok || u.status !== "active") {
      limiter.fail(key);
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    limiter.reset(key);
    await startSession(reply, u.id);
    await audit(u.id, "login", null);
    return { ok: true };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const t = req.cookies[COOKIE];
    if (t) await db.query("delete from sessions where token_hash = $1", [sha256(t)]);
    if (req.me) await audit(req.me.id, "logout", null);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/v1/me", { preHandler: requireUser }, async (req) => {
    const m = req.me!;
    return { email: m.email, role: m.role, workspace: m.workspace_id ? { id: m.workspace_id, name: m.workspace_name } : null };
  });

  /** One-time first-admin setup using a token created by `node dist/cli.js setup-link`. */
  app.post("/v1/auth/setup", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(b.email);
    if (typeof b.token !== "string" || !email || !validPassword(b.password)) return reply.code(400).send({ error: "invalid_input" });
    const c = await db.connect();
    try {
      await c.query("begin");
      const inv = await c.query("update invitations set consumed_at = now() where token_hash = $1 and kind = 'setup' and consumed_at is null and expires_at > now() returning 1", [sha256(b.token)]);
      const admins = await c.query("select 1 from users where role = 'admin'");
      if (!inv.rowCount || admins.rowCount) {
        await c.query("rollback");
        return reply.code(400).send({ error: "invalid_or_used_link" });
      }
      const u = await c.query<{ id: string }>("insert into users (email, password_hash, role) values ($1, $2, 'admin') returning id", [email, await hashPassword(b.password)]);
      await c.query("insert into audit_events (actor, action) values ($1, 'admin_setup')", [u.rows[0].id]);
      await c.query("commit");
      await startSession(reply, u.rows[0].id);
      return { ok: true };
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  });

  app.get("/v1/auth/invitations/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const r = await db.query<{ email: string; workspace: string | null }>(
      `select u.email, w.name as workspace from invitations i join users u on u.id = i.user_id left join workspaces w on w.id = u.workspace_id
        where i.token_hash = $1 and i.kind = 'member' and i.consumed_at is null and i.expires_at > now()`,
      [sha256(token)],
    );
    if (!r.rows[0]) return reply.code(404).send({ error: "invalid_or_used_link" });
    return r.rows[0];
  });

  app.post("/v1/auth/invitations/accept", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.token !== "string" || !validPassword(b.password)) return reply.code(400).send({ error: "invalid_input" });
    const hash = await hashPassword(b.password);
    const r = await db.query<{ user_id: string }>(
      "update invitations set consumed_at = now() where token_hash = $1 and kind = 'member' and consumed_at is null and expires_at > now() returning user_id",
      [sha256(b.token)],
    );
    const id = r.rows[0]?.user_id;
    if (!id) return reply.code(400).send({ error: "invalid_or_used_link" });
    await db.query("update users set password_hash = $2, session_version = session_version + 1 where id = $1", [id, hash]);
    await audit(id, "password_set", null);
    await startSession(reply, id);
    return { ok: true };
  });

  // ---- member ----
  app.get("/v1/workspace", { preHandler: requireUser }, async (req, reply) => {
    if (!req.me!.workspace_id) return reply.code(404).send({ error: "no_workspace" });
    return { id: req.me!.workspace_id, name: req.me!.workspace_name };
  });

  // ---- admin ----
  app.get("/v1/admin/users", { preHandler: requireAdmin }, async () => {
    const r = await db.query(
      `select u.id, u.email, u.role, u.status, u.password_hash is not null as activated, w.name as workspace, u.created_at
         from users u left join workspaces w on w.id = u.workspace_id order by u.role, u.created_at`,
    );
    return { users: r.rows };
  });

  async function inviteLink(userId: string) {
    const token = newToken();
    await db!.query("update invitations set consumed_at = now() where user_id = $1 and consumed_at is null", [userId]); // old links stop working
    await db!.query("insert into invitations (token_hash, kind, user_id, expires_at) values ($1, 'member', $2, now() + $3 * interval '1 millisecond')", [sha256(token), userId, INVITE_MS]);
    return `${appOrigin}/invite?token=${token}`;
  }

  app.post("/v1/admin/members", { preHandler: requireAdmin }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(b.email);
    const name = typeof b.workspace === "string" ? b.workspace.trim() : "";
    if (!email || !name || name.length > 80) return reply.code(400).send({ error: "invalid_input" });
    const c = await db.connect();
    let userId: string;
    try {
      await c.query("begin");
      const w = await c.query<{ id: string }>("insert into workspaces (name) values ($1) returning id", [name]);
      const u = await c.query<{ id: string }>("insert into users (email, role, workspace_id) values ($1, 'member', $2) returning id", [email, w.rows[0].id]);
      userId = u.rows[0].id;
      await c.query("commit");
    } catch (e) {
      await c.query("rollback").catch(() => {});
      if ((e as { code?: string }).code === "23505") return reply.code(409).send({ error: "email_taken" });
      throw e;
    } finally {
      c.release();
    }
    await audit(req.me!.id, "member_created", userId);
    return { id: userId, inviteUrl: await inviteLink(userId) };
  });

  app.patch("/v1/admin/users/:id/status", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const status = (req.body as Record<string, unknown> | undefined)?.status;
    if (status !== "active" && status !== "disabled") return reply.code(400).send({ error: "invalid_input" });
    const r = await db.query("update users set status = $2, session_version = session_version + 1 where id = $1 and role = 'member' returning id", [id, status]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" }); // the admin account can't be disabled
    await audit(req.me!.id, `member_${status}`, id);
    return { ok: true };
  });

  app.post("/v1/admin/users/:id/reset", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.query("update users set password_hash = null, session_version = session_version + 1 where id = $1 and role = 'member' returning id", [id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    await audit(req.me!.id, "member_reset", id);
    return { inviteUrl: await inviteLink(id) };
  });

  if (blobs) registerDocuments(app, db, blobs, appOrigin, requireUser);

  return app;
}

/** Creates a one-time first-admin setup link (only while no admin exists). */
export async function createSetupLink(db: Db, appOrigin: string) {
  const admins = await db.query("select 1 from users where role = 'admin'");
  if (admins.rowCount) throw new Error("An admin already exists; setup is disabled.");
  const token = newToken();
  await db.query("insert into invitations (token_hash, kind, expires_at) values ($1, 'setup', now() + interval '24 hours')", [sha256(token)]);
  return `${appOrigin}/setup?token=${token}`;
}
