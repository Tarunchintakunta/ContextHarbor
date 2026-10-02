// Pluggable, pinned embedding models. Changing `id` on purpose triggers a re-index.

export interface Embedder {
  readonly id: string; // pinned identity, e.g. "ollama:nomic-embed-text@<digest>" or "hash-384-v1"
  embed(texts: string[]): Promise<Float32Array[]>;
}

const DIM = 384;

// Deterministic local fallback: feature-hashed word, bigram and character-trigram vectors.
// ponytail: lexical-ish similarity only; use OllamaEmbedder (or any real model) for semantics.
export class HashEmbedder implements Embedder {
  readonly id = "hash-384-v1";
  async embed(texts: string[]) {
    return texts.map((t) => {
      const v = new Float32Array(DIM);
      const words = tokens(t);
      const add = (f: string, w: number) => {
        const h = fnv(f);
        v[h % DIM] += h & 0x80000000 ? -w : w;
      };
      words.forEach((w, i) => {
        add(`w:${w}`, 1);
        if (i) add(`b:${words[i - 1]}_${w}`, 0.7);
        const p = `#${w}#`;
        for (let j = 0; j + 3 <= p.length; j++) add(`c:${p.slice(j, j + 3)}`, 0.25);
      });
      return normalize(v);
    });
  }
}

// Any Ollama embedding model. `digest` pins the exact model build.
export class OllamaEmbedder implements Embedder {
  readonly id: string;
  constructor(private model: string, digest: string, private base = "http://127.0.0.1:11434") {
    this.id = `ollama:${model}@${digest.slice(0, 12)}`;
  }
  async embed(texts: string[]) {
    const r = await fetch(`${this.base}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`embed HTTP ${r.status}`);
    const j = (await r.json()) as { embeddings: number[][] };
    return j.embeddings.map((e) => normalize(Float32Array.from(e)));
  }
}

const STOP = new Set(
  "a an the and or but if of to in on at for with from by is are was were be been it this that these those what which who whom how why when where do does did can could should would will shall may might you your we our i me my us they them their he she his her its as about into than then so not no".split(" "),
);

export function tokens(t: string): string[] {
  return (t.toLowerCase().match(/[a-z0-9][a-z0-9\-_.]*[a-z0-9]|[a-z0-9]/g) ?? []).filter((w) => !STOP.has(w));
}

export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: Float32Array) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
