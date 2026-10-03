// Desktop app sign-in (browser handoff with PKCE to a loopback redirect) and document sync.
// The desktop never sees the web password or the session cookie; it gets a revocable device token.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import { newToken, sha256 } from "./auth.js";

const LOOPBACK = /^http:\/\/127\.0\.0\.1:(\d{2,5})\/callback$/;

interface Device {
  user_id: string;
  email: string;
  workspace_id: string;
  workspace_name: string;
}

export function registerDesktop(app: FastifyInstance, db: Db, requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  /** Logged-in member approves the desktop app; returns a one-time code bound to the PKCE challenge and redirect. */
  app.post("/v1/desktop/authorize", { preHandler: requireUser }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!req.me?.workspace_id) return reply.code(403).send({ error: "no_workspace" });
    if (typeof b.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(b.challenge)) return reply.code(400).send({ error: "invalid_input" });
    if (typeof b.redirect_uri !== "string" || !LOOPBACK.test(b.redirect_uri)) return reply.code(400).send({ error: "invalid_redirect" });
    const code = newToken();
    await db.query("insert into desktop_codes (code_hash, user_id, challenge, redirect_uri, expires_at) values ($1, $2, $3, $4, now() + interval '2 minutes')", [sha256(code), req.me.id, b.challenge, b.redirect_uri]);
    return { code };
  });

  /** Desktop exchanges code + PKCE verifier for a device token. No cookie involved. */
  app.post("/v1/desktop/token", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.code !== "string" || typeof b.verifier !== "string" || typeof b.redirect_uri !== "string") return reply.code(400).send({ error: "invalid_input" });
    const challenge = createHash("sha256").update(b.verifier).digest("base64url");
    const r = await db.query<{ user_id: string }>(
      `update desktop_codes set consumed_at = now() where code_hash = $1 and consumed_at is null and expires_at > now()
        and challenge = $2 and redirect_uri = $3 returning user_id`,
      [sha256(b.code), challenge, b.redirect_uri],
    );
    const userId = r.rows[0]?.user_id;
    if (!userId) return reply.code(400).send({ error: "invalid_grant" });
    const token = newToken();
    await db.query("insert into device_tokens (token_hash, user_id, session_version) select $1, id, session_version from users where id = $2 and status = 'active'", [sha256(token), userId]);
    await db.query("insert into audit_events (actor, action) values ($1, 'desktop_connected')", [userId]);
    return { token };
  });

  async function device(req: FastifyRequest, reply: FastifyReply): Promise<Device | null> {
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? "");
    if (!m) {
      reply.code(401).send({ error: "unauthenticated" });
      return null;
    }
    const r = await db.query<Device>(
      `update device_tokens d set last_used_at = now() from users u join workspaces w on w.id = u.workspace_id
        where d.token_hash = $1 and d.revoked_at is null and u.id = d.user_id and u.status = 'active' and d.session_version = u.session_version
        returning u.id as user_id, u.email, w.id as workspace_id, w.name as workspace_name`,
      [sha256(m[1])],
    );
    if (!r.rows[0]) {
      reply.code(401).send({ error: "device_revoked" });
      return null;
    }
    return r.rows[0];
  }

  app.get("/v1/sync/me", async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return reply;
    return { email: d.email, workspace: { id: d.workspace_id, name: d.workspace_name } };
  });

  /** Ready documents only (accepted limitations count as ready). Text is fetched per document. */
  app.get("/v1/sync/documents", async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return reply;
    const r = await db.query(
      "select id, name, sha256, format, pages, created_at from documents where workspace_id = $1 and state = 'ready' order by created_at",
      [d.workspace_id],
    );
    return { workspace: { id: d.workspace_id, name: d.workspace_name }, documents: r.rows };
  });

  app.get("/v1/sync/documents/:id", async (req, reply) => {
    const d = await device(req, reply);
    if (!d) return reply;
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply.code(404).send({ error: "not_found" });
    const r = await db.query("select id, name, sha256, created_at, text from documents where id = $1 and workspace_id = $2 and state = 'ready'", [id, d.workspace_id]);
    return r.rows[0] ?? reply.code(404).send({ error: "not_found" });
  });

  /** Member's connected desktop apps, for the dashboard. */
  app.get("/v1/desktop/devices", { preHandler: requireUser }, async (req) => {
    const r = await db.query(
      `select d.id, d.label, d.created_at, d.last_used_at from device_tokens d join users u on u.id = d.user_id
        where d.user_id = $1 and d.revoked_at is null and d.session_version = u.session_version order by d.created_at desc`,
      [req.me!.id],
    );
    return { devices: r.rows };
  });

  app.delete("/v1/desktop/devices/:id", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply.code(404).send({ error: "not_found" });
    const r = await db.query("update device_tokens set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null", [id, req.me!.id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    await db.query("insert into audit_events (actor, action, target) values ($1, 'desktop_revoked', $2)", [req.me!.id, id]);
    return { ok: true };
  });

  app.post("/v1/desktop/disconnect", async (req, reply) => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? "");
    if (m) await db.query("update device_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null", [sha256(m[1])]);
    return reply.send({ ok: true });
  });
}
