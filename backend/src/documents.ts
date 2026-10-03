// Document upload, listing, preview, limitation acceptance and deletion. Every query is scoped to the
// caller's own workspace; there is no route that takes a workspace id from the client.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import type { BlobStore } from "./blobs.js";
import { newToken, sha256 } from "./auth.js";
import { extract, LIMITS, sniff } from "./extract.js";

const TYPES = { md: "text/markdown", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as const;
const COLS = "id, name, format, size_bytes, state, warnings, reason, pages, created_at, limitations_accepted_at";

export function registerDocuments(app: FastifyInstance, db: Db, blobs: BlobStore, appOrigin: string, requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  const member = async (req: FastifyRequest, reply: FastifyReply) => {
    await requireUser(req, reply);
    if (!reply.sent && !req.me?.workspace_id) return reply.code(403).send({ error: "no_workspace" });
  };

  app.get("/v1/documents", { preHandler: member }, async (req) => {
    const ws = req.me!.workspace_id!;
    const [docs, usage] = await Promise.all([
      db.query(`select ${COLS} from documents where workspace_id = $1 and state <> 'deleted' order by created_at desc`, [ws]),
      db.query<{ n: string; bytes: string }>("select count(*) n, coalesce(sum(size_bytes), 0) bytes from documents where workspace_id = $1 and state <> 'deleted'", [ws]),
    ]);
    return { documents: docs.rows, usage: { files: +usage.rows[0].n, bytes: +usage.rows[0].bytes }, limits: LIMITS };
  });

  app.get("/v1/documents/:id", { preHandler: member }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply.code(404).send({ error: "not_found" });
    const r = await db.query(`select ${COLS}, left(text, 6000) as preview, length(text) as text_length from documents where id = $1 and workspace_id = $2 and state <> 'deleted'`, [id, req.me!.workspace_id]);
    return r.rows[0] ?? reply.code(404).send({ error: "not_found" });
  });

  app.post("/v1/documents/:id/accept", { preHandler: member }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.query("update documents set state = 'ready', limitations_accepted_at = now() where id = $1 and workspace_id = $2 and state = 'needs_review' returning id", [id, req.me!.workspace_id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.delete("/v1/documents/:id", { preHandler: member }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply.code(404).send({ error: "not_found" });
    // Revoke access first (text cleared, row tombstoned), then remove the stored original.
    const r = await db.query<{ blob_key: string | null }>(
      "update documents set state = 'deleted', deleted_at = now(), text = null where id = $1 and workspace_id = $2 and state <> 'deleted' returning blob_key",
      [id, req.me!.workspace_id],
    );
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    if (r.rows[0].blob_key) await blobs.remove(r.rows[0].blob_key).catch((e) => req.log.error({ err: String(e) }, "blob delete failed"));
    await db.query("insert into audit_events (actor, action, target) values ($1, 'document_deleted', $2)", [req.me!.id, id]);
    return { ok: true };
  });

  /** Single-use, 5-minute ticket so the file can go straight to this API instead of through the web proxy. */
  app.post("/v1/documents/upload-ticket", { preHandler: member }, async (req) => {
    const token = newToken();
    await db.query("insert into upload_tickets (token_hash, user_id, workspace_id, expires_at) values ($1, $2, $3, now() + interval '5 minutes')", [sha256(token), req.me!.id, req.me!.workspace_id]);
    return { ticket: token };
  });

  // Direct upload endpoint (cross-origin from the dashboard; authenticated by the ticket, not a cookie).
  const cors = (reply: FastifyReply) => {
    reply.header("access-control-allow-origin", appOrigin);
    reply.header("access-control-allow-methods", "PUT");
    reply.header("access-control-allow-headers", "content-type, x-ch-ticket, x-ch-filename");
    reply.header("access-control-max-age", "600");
    reply.header("vary", "Origin");
  };
  app.options("/v1/uploads", async (req, reply) => {
    if (req.headers.origin !== appOrigin) return reply.code(403).send();
    cors(reply);
    return reply.code(204).send();
  });

  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: LIMITS.fileBytes }, (_req, body, done) => done(null, body));

  app.put("/v1/uploads", { bodyLimit: LIMITS.fileBytes }, async (req, reply) => {
    if (req.headers.origin && req.headers.origin !== appOrigin) return reply.code(403).send({ error: "forbidden" });
    cors(reply);
    const ticket = String(req.headers["x-ch-ticket"] ?? "");
    let name = "";
    try {
      name = decodeURIComponent(String(req.headers["x-ch-filename"] ?? "")).replace(/[\\/\u0000-\u001f]/g, "").trim().slice(0, 200);
    } catch {
      /* invalid encoding -> empty name */
    }
    const buf = req.body as Buffer;
    if (!ticket || !name || !Buffer.isBuffer(buf) || !buf.length) return reply.code(400).send({ error: "invalid_input" });

    const t = await db.query<{ user_id: string; workspace_id: string }>(
      `update upload_tickets set consumed_at = now() where token_hash = $1 and consumed_at is null and expires_at > now()
        and user_id in (select id from users where status = 'active') returning user_id, workspace_id`,
      [sha256(ticket)],
    );
    const owner = t.rows[0];
    if (!owner) return reply.code(401).send({ error: "upload_expired" });

    const kind = sniff(name, buf);
    if ("error" in kind) return reply.code(415).send({ error: "unsupported_file", message: kind.error });
    const digest = createHash("sha256").update(buf).digest("hex");

    const existing = await db.query(`select ${COLS} from documents where workspace_id = $1 and sha256 = $2 and state <> 'deleted'`, [owner.workspace_id, digest]);
    if (existing.rows[0]) return { document: existing.rows[0], duplicate: true }; // retries and re-uploads create one version

    const usage = await db.query<{ n: string; bytes: string }>("select count(*) n, coalesce(sum(size_bytes), 0) bytes from documents where workspace_id = $1 and state <> 'deleted'", [owner.workspace_id]);
    if (+usage.rows[0].n >= LIMITS.filesPerWorkspace) return reply.code(409).send({ error: "too_many_files", message: `A workspace can hold ${LIMITS.filesPerWorkspace} documents. Delete one to add another.` });
    if (+usage.rows[0].bytes + buf.length > LIMITS.workspaceBytes) return reply.code(409).send({ error: "storage_full", message: "This workspace's 500 MB storage is full. Delete documents to make room." });

    const x = await extract(kind.format, buf);
    let blobKey: string | null = null;
    if (x.state !== "failed") {
      blobKey = `ws/${owner.workspace_id}/${digest}`;
      await blobs.put(blobKey, buf, TYPES[kind.format]);
    }
    try {
      const r = await db.query(
        `insert into documents (workspace_id, uploaded_by, name, format, size_bytes, sha256, state, warnings, reason, pages, text, blob_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning ${COLS}`,
        [owner.workspace_id, owner.user_id, name, kind.format, buf.length, digest, x.state, JSON.stringify(x.warnings), x.reason ?? null, x.pages, x.state === "failed" ? null : x.text, blobKey],
      );
      await db.query("insert into audit_events (actor, action, target) values ($1, 'document_uploaded', $2)", [owner.user_id, r.rows[0].id]);
      return { document: r.rows[0], duplicate: false };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        const again = await db.query(`select ${COLS} from documents where workspace_id = $1 and sha256 = $2 and state <> 'deleted'`, [owner.workspace_id, digest]);
        return { document: again.rows[0], duplicate: true };
      }
      if (blobKey) await blobs.remove(blobKey).catch(() => {});
      throw e;
    }
  });
}
