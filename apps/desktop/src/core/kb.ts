// One global knowledge base per user: SQLite (node:sqlite) with FTS5 keyword index and stored
// embeddings. Every read is filtered by user_id and re-checked before anything leaves this module.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { type Embedder, cosine, tokens } from "./embed";
import { parseKbPath, weekOf } from "./weeks";

export interface Passage {
  id: number;
  userId: string;
  sourcePath: string;
  week: string | null;
  date: string | null;
  title: string;
  docType: string;
  text: string;
  score: number;
}

export class IsolationError extends Error {}

export interface SearchOptions {
  weeks?: string[] | null; // time-hint weeks to boost
  docTypes?: string[]; // e.g. ["meeting"] for past-meeting segments
  k?: number; // max passages (3..6 typical)
  minScore?: number; // relevance threshold
  now?: Date;
}

const TEXT_EXT = new Set([".md", ".txt", ".markdown"]);

export class KnowledgeBase {
  private db: DatabaseSync;

  constructor(file: string, private embedder: Embedder) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS docs (user_id TEXT NOT NULL, source_path TEXT NOT NULL, hash TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'file', PRIMARY KEY (user_id, source_path));
      CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL CHECK (user_id <> ''),
        source_path TEXT NOT NULL, week TEXT, date TEXT, title TEXT NOT NULL, doc_type TEXT NOT NULL,
        text TEXT NOT NULL, emb BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS chunks_user ON chunks (user_id, week);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5 (text, title, tokenize = 'porter unicode61');
    `);
    const pinned = this.db.prepare("SELECT v FROM meta WHERE k = 'embedder'").get() as { v: string } | undefined;
    if (pinned && pinned.v !== embedder.id) {
      throw new Error(`Index was built with ${pinned.v}; embedder is ${embedder.id}. Re-index deliberately with reindexAll().`);
    }
    if (!pinned) this.db.prepare("INSERT INTO meta (k, v) VALUES ('embedder', ?)").run(embedder.id);
  }

  close() {
    this.db.close();
  }

  /** Adds or replaces one document. Returns false when content is unchanged. */
  /** `origin: "app"` marks recordings/summaries the app created; folder sync never deletes those. */
  async upsertDocument(userId: string, sourcePath: string, text: string, meta: { title?: string; date?: string; docType?: string; origin?: "file" | "app" | "web" } = {}) {
    requireUser(userId);
    const hash = createHash("sha256").update(text).digest("hex");
    const prev = this.db.prepare("SELECT hash FROM docs WHERE user_id = ? AND source_path = ?").get(userId, sourcePath) as { hash: string } | undefined;
    if (prev?.hash === hash) return false;

    const pm = parseKbPath(sourcePath);
    const date = meta.date ?? pm.date;
    const week = date && pm.docType !== "reference" ? weekOf(date).key : pm.week;
    const title = meta.title ?? path.basename(sourcePath);
    const docType = meta.docType ?? pm.docType;
    const pieces = chunk(text);
    const embs = pieces.length ? await this.embedder.embed(pieces.map((p) => `${title}\n${p}`)) : [];

    this.db.exec("BEGIN");
    try {
      this.deleteRows(userId, sourcePath);
      const ins = this.db.prepare(
        "INSERT INTO chunks (user_id, source_path, week, date, title, doc_type, text, emb) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const fts = this.db.prepare("INSERT INTO chunks_fts (rowid, text, title) VALUES (?, ?, ?)");
      pieces.forEach((p, i) => {
        const r = ins.run(userId, sourcePath, week, date, title, docType, p, Buffer.from(embs[i].buffer));
        fts.run(r.lastInsertRowid, p, title);
      });
      this.db.prepare("INSERT OR REPLACE INTO docs (user_id, source_path, hash, origin) VALUES (?, ?, ?, ?)").run(userId, sourcePath, hash, meta.origin ?? "file");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return true;
  }

  removeDocument(userId: string, sourcePath: string) {
    requireUser(userId);
    this.deleteRows(userId, sourcePath);
    this.db.prepare("DELETE FROM docs WHERE user_id = ? AND source_path = ?").run(userId, sourcePath);
  }

  /** Incremental sync of a knowledge-base folder: new/changed files indexed, deleted files removed. */
  async syncFolder(userId: string, root: string) {
    requireUser(userId);
    const seen = new Set<string>();
    let changed = 0;
    for (const abs of walk(root)) {
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      seen.add(rel);
      if (await this.upsertDocument(userId, rel, readFileSync(abs, "utf8"))) changed++;
    }
    const known = this.db.prepare("SELECT source_path FROM docs WHERE user_id = ? AND origin = 'file'").all(userId) as { source_path: string }[];
    for (const { source_path } of known) {
      if (!seen.has(source_path)) {
        this.removeDocument(userId, source_path);
        changed++;
      }
    }
    return changed;
  }

  /** Source paths of this user's documents from one origin (e.g. "web" for dashboard uploads). */
  sources(userId: string, origin: "file" | "app" | "web") {
    requireUser(userId);
    return (this.db.prepare("SELECT source_path FROM docs WHERE user_id = ? AND origin = ?").all(userId, origin) as { source_path: string }[]).map((r) => r.source_path);
  }

  count(userId: string) {
    requireUser(userId);
    return (this.db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE user_id = ?").get(userId) as { n: number }).n;
  }

  wipeUser(userId: string) {
    requireUser(userId);
    const ids = this.db.prepare("SELECT id FROM chunks WHERE user_id = ?").all(userId) as { id: number }[];
    const del = this.db.prepare("DELETE FROM chunks_fts WHERE rowid = ?");
    for (const { id } of ids) del.run(id);
    this.db.prepare("DELETE FROM chunks WHERE user_id = ?").run(userId);
    this.db.prepare("DELETE FROM docs WHERE user_id = ?").run(userId);
  }

  /** Hybrid search (vector + FTS5, fused), re-ranked, thresholded and ownership-checked. */
  async search(userId: string, query: string, opts: SearchOptions = {}): Promise<Passage[]> {
    requireUser(userId);
    const { weeks = null, docTypes, k = 6, minScore = 0.3, now = new Date() } = opts;
    const qTokens = [...new Set(tokens(query))];
    if (!qTokens.length) return [];
    const [qv] = await this.embedder.embed([query]);
    const typeSql = docTypes?.length ? ` AND doc_type IN (${docTypes.map(() => "?").join(",")})` : "";
    const typeArgs = docTypes ?? [];

    // ponytail: brute-force cosine over the user's rows; fine to ~100k chunks, add ANN (sqlite-vec) beyond that.
    const rows = this.db
      .prepare(`SELECT id, emb FROM chunks WHERE user_id = ?${typeSql}`)
      .all(userId, ...typeArgs) as { id: number; emb: Uint8Array }[];
    const vecRank = rows
      .map((r) => ({ id: r.id, sim: cosine(qv, new Float32Array(r.emb.buffer, r.emb.byteOffset, r.emb.byteLength / 4)) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 50);

    const match = qTokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
    const ftsRank = this.db
      .prepare(
        `SELECT chunks_fts.rowid AS id FROM chunks_fts JOIN chunks ON chunks.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ? AND chunks.user_id = ?${typeSql} ORDER BY bm25(chunks_fts) LIMIT 50`,
      )
      .all(match, userId, ...typeArgs) as { id: number }[];

    const fused = new Map<number, number>();
    vecRank.forEach((r, i) => fused.set(r.id, (fused.get(r.id) ?? 0) + 1 / (60 + i)));
    ftsRank.forEach((r, i) => fused.set(r.id, (fused.get(r.id) ?? 0) + 1 / (60 + i)));
    const sims = new Map(vecRank.map((r) => [r.id, r.sim]));
    const candidates = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => id);
    if (!candidates.length) return [];

    const get = this.db.prepare(
      "SELECT id, user_id, source_path, week, date, title, doc_type, text FROM chunks WHERE id = ? AND user_id = ?",
    );
    const nowMs = now.getTime();
    const out: Passage[] = [];
    for (const id of candidates) {
      const r = get.get(id, userId) as Record<string, string | number | null> | undefined;
      if (!r) continue;
      if (r.user_id !== userId) throw new IsolationError("ownership check failed"); // defense in depth
      // Re-rank: lexical coverage of the query is the strongest signal for short meeting questions.
      const textTokens = new Set(tokens(`${r.title} ${r.text}`));
      const coverage = qTokens.filter((t) => textTokens.has(t)).length / qTokens.length;
      const sim = sims.get(id) ?? 0;
      const timeBoost = weeks?.length ? (r.week && weeks.includes(r.week as string) ? 0.25 : r.doc_type === "reference" ? 0 : -0.1) : 0;
      const ageDays = r.date ? Math.max(0, (nowMs - Date.parse(`${r.date}T00:00:00Z`)) / 86_400_000) : 365;
      const recency = 0.05 * Math.exp(-ageDays / 60);
      const score = 0.6 * coverage + 0.4 * Math.max(0, sim) + timeBoost + recency;
      if (score < minScore) continue;
      out.push({
        id: r.id as number,
        userId: r.user_id as string,
        sourcePath: r.source_path as string,
        week: r.week as string | null,
        date: r.date as string | null,
        title: r.title as string,
        docType: r.doc_type as string,
        text: r.text as string,
        score,
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }

  private deleteRows(userId: string, sourcePath: string) {
    const ids = this.db.prepare("SELECT id FROM chunks WHERE user_id = ? AND source_path = ?").all(userId, sourcePath) as { id: number }[];
    const del = this.db.prepare("DELETE FROM chunks_fts WHERE rowid = ?");
    for (const { id } of ids) del.run(id);
    this.db.prepare("DELETE FROM chunks WHERE user_id = ? AND source_path = ?").run(userId, sourcePath);
  }
}

/** Filters any passage list to the current user; throws if something foreign slipped through. */
export function assertOwned<T extends { userId: string }>(userId: string, passages: T[]): T[] {
  requireUser(userId);
  for (const p of passages) if (p.userId !== userId) throw new IsolationError("foreign passage blocked");
  return passages;
}

export function requireUser(userId: string) {
  if (!userId || typeof userId !== "string") throw new IsolationError("missing user id");
}

// Paragraph-aware chunks of ~600 chars, keeping headings with their body.
export function chunk(text: string, max = 600): string[] {
  const paras = text.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > max && !/^#+ /.test(cur.split("\n").pop() ?? "")) {
      out.push(cur);
      cur = "";
    }
    if (p.length > max) {
      for (const s of p.match(new RegExp(`[\\s\\S]{1,${max}}(?=\\s|$)`, "g")) ?? [p]) out.push(s.trim());
      continue;
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.has(path.extname(e.name).toLowerCase()) && statSync(p).size < 5_000_000) yield p;
  }
}
