// Everything scoped to one local user. Disposing it is the "full context reset on user switch".
import { existsSync, mkdirSync, readFileSync, writeFileSync, watch, type FSWatcher } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { KnowledgeBase } from "../core/kb";
import { HashEmbedder, OllamaEmbedder, type Embedder } from "../core/embed";
import { EncryptedFiles, EncryptedSummaryStore, UserVault, wipeUserDir } from "../core/store";
import { MeetingMemory, ModelSummarizer } from "../core/memory";
import { AnswerPipeline } from "../core/pipeline";
import { createLLM, type LLM } from "../core/llm";
import type { Settings } from "./settings";

export interface KeyWrap {
  encrypt(b: Buffer): Buffer;
  decrypt(b: Buffer): Buffer;
}

export class UserContext {
  readonly dir: string;
  vault!: UserVault;
  kb!: KnowledgeBase;
  memory!: MeetingMemory;
  pipeline!: AnswerPipeline;
  models!: LLM[];
  embedderId = "";
  private files!: EncryptedFiles;
  private watcher: FSWatcher | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  disposed = false;

  constructor(readonly userId: string, root: string, private settings: Settings, private wrap: KeyWrap, private log: (e: Record<string, unknown>) => void, private apiKey: (ref?: string) => string) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(userId)) throw new Error("invalid user id");
    this.dir = path.join(root, "users", userId);
  }

  async init() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.files = new EncryptedFiles(path.join(this.dir, "vault"), this.key());
    this.vault = new UserVault(this.files);
    const embedder = await pickEmbedder(this.settings);
    this.embedderId = embedder.id;
    // One index file per pinned embedder: switching embedders on purpose builds a fresh index.
    this.kb = new KnowledgeBase(path.join(this.dir, `kb-${embedder.id.replace(/[^a-z0-9]+/gi, "_")}.sqlite`), embedder);
    this.models = this.settings.models.map((m) => createLLM(m, this.apiKey(m.apiKeyRef)));
    const cheap = this.models[0];
    this.memory = new MeetingMemory(this.userId, this.kb, new EncryptedSummaryStore(this.files), new ModelSummarizer(async (system, user, max) =>
      (await cheap.generate({ system, messages: [{ role: "user", content: user }], maxTokens: max, timeoutMs: 30_000 })).text));
    this.pipeline = new AnswerPipeline(this.userId, this.kb, this.models, undefined, this.log);
    mkdirSync(this.settings.knowledgeBaseDir, { recursive: true });
    for (const d of ["_reference"]) mkdirSync(path.join(this.settings.knowledgeBaseDir, d), { recursive: true });
    await this.syncKb();
    try {
      this.watcher = watch(this.settings.knowledgeBaseDir, { recursive: true }, () => this.scheduleSync());
    } catch {
      this.log({ ev: "kb_watch_unavailable" }); // Linux without recursive watch: periodic sync covers it
    }
    for (const m of this.vault.purge(this.settings.retention)) this.kb.removeDocument(this.userId, `${m.folder}/transcript.md`);
  }

  scheduleSync() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.syncKb(), 1500);
  }

  async syncKb() {
    if (this.disposed) return;
    const t0 = Date.now();
    const changed = await this.kb.syncFolder(this.userId, this.settings.knowledgeBaseDir);
    this.log({ ev: "kb_sync", changed, ms: Date.now() - t0, chunks: this.kb.count(this.userId) });
  }

  dispose() {
    this.disposed = true;
    this.watcher?.close();
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.kb?.close();
  }

  wipe() {
    this.dispose();
    wipeUserDir(this.dir);
  }

  private key() {
    const f = path.join(this.dir, "key.bin");
    if (existsSync(f)) return this.wrap.decrypt(readFileSync(f));
    const k = randomBytes(32);
    writeFileSync(f, this.wrap.encrypt(k), { mode: 0o600 });
    return k;
  }
}

async function pickEmbedder(s: Settings): Promise<Embedder> {
  if (s.embedding.provider === "ollama") {
    try {
      const r = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1500) });
      const tags = (await r.json()) as { models: { name: string; digest: string }[] };
      const m = tags.models.find((x) => x.name.split(":")[0] === s.embedding.model && x.digest.startsWith(s.embedding.digest));
      if (m) return new OllamaEmbedder(s.embedding.model, m.digest);
    } catch {
      /* Ollama not running: fall back below */
    }
  }
  return new HashEmbedder();
}
