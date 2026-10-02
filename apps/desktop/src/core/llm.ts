// Provider-agnostic LLM layer: one interface, hosted + local adapters, pinned config, fallback chain.

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  system: string;
  messages: Message[];
  stream?: (delta: string) => void; // called with text deltas when streaming
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  firstTokenMs?: number;
  totalMs: number;
}

export interface LLM {
  readonly id: string; // "provider:model@version" — always an exact pinned version
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export class LLMError extends Error {
  constructor(msg: string, readonly kind: "timeout" | "rate_limit" | "context_length" | "provider" | "format" | "deprecated") {
    super(msg);
  }
}

export interface ModelConfig {
  provider: "openai-compatible" | "anthropic";
  model: string; // exact dated version / snapshot / local tag+digest, never "latest"
  baseUrl: string; // e.g. http://127.0.0.1:11434/v1 for Ollama, http://127.0.0.1:8080/v1 for llama.cpp
  apiKeyRef?: string; // name of the OS-keychain entry, never the key itself
  contextWindow: number;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  costPerMTokIn?: number; // USD, for the cost-per-answer report
  costPerMTokOut?: number;
}

/** OpenAI-compatible chat completions: OpenAI, Ollama, llama.cpp server, vLLM, LM Studio, OpenRouter, ... */
export class OpenAICompatible implements LLM {
  readonly id: string;
  constructor(private cfg: ModelConfig, private apiKey = "") {
    this.id = `openai-compatible:${cfg.model}`;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const t0 = Date.now();
    const body = {
      model: this.cfg.model,
      messages: [{ role: "system", content: req.system }, ...req.messages],
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? this.cfg.temperature,
      stream: !!req.stream,
      ...(req.stream ? { stream_options: { include_usage: true } } : {}),
    };
    const r = await post(`${this.cfg.baseUrl}/chat/completions`, body, req.timeoutMs, this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {});
    if (!req.stream) {
      const j = (await r.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
      return { text: j.choices[0]?.message?.content ?? "", inputTokens: j.usage?.prompt_tokens, outputTokens: j.usage?.completion_tokens, totalMs: Date.now() - t0 };
    }
    let text = "";
    let firstTokenMs: number | undefined;
    let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
    for await (const data of sse(r)) {
      if (data === "[DONE]") break;
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: typeof usage };
      const d = j.choices?.[0]?.delta?.content ?? "";
      if (d) {
        firstTokenMs ??= Date.now() - t0;
        text += d;
        req.stream(d);
      }
      if (j.usage) usage = j.usage;
    }
    return { text, firstTokenMs, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalMs: Date.now() - t0 };
  }
}

/** Anthropic Messages API adapter. */
export class AnthropicMessages implements LLM {
  readonly id: string;
  constructor(private cfg: ModelConfig, private apiKey: string) {
    this.id = `anthropic:${cfg.model}`;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const t0 = Date.now();
    const r = await post(
      `${this.cfg.baseUrl}/v1/messages`,
      { model: this.cfg.model, system: req.system, messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature ?? this.cfg.temperature, stream: !!req.stream },
      req.timeoutMs,
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
    );
    if (!req.stream) {
      const j = (await r.json()) as { content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } };
      return { text: j.content.filter((c) => c.type === "text").map((c) => c.text).join(""), inputTokens: j.usage.input_tokens, outputTokens: j.usage.output_tokens, totalMs: Date.now() - t0 };
    }
    let text = "";
    let firstTokenMs: number | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for await (const data of sse(r)) {
      const j = JSON.parse(data) as { type: string; delta?: { type: string; text?: string }; message?: { usage: { input_tokens: number } }; usage?: { output_tokens: number } };
      if (j.type === "message_start") inputTokens = j.message?.usage.input_tokens;
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) {
        firstTokenMs ??= Date.now() - t0;
        text += j.delta.text;
        req.stream(j.delta.text);
      }
      if (j.type === "message_delta") outputTokens = j.usage?.output_tokens;
    }
    return { text, firstTokenMs, inputTokens, outputTokens, totalMs: Date.now() - t0 };
  }
}

export function createLLM(cfg: ModelConfig, apiKey = ""): LLM {
  if (/(^|[:\-/])latest$/i.test(cfg.model)) throw new Error(`Model "${cfg.model}" is a floating alias; pin an exact version.`);
  return cfg.provider === "anthropic" ? new AnthropicMessages(cfg, apiKey) : new OpenAICompatible(cfg, apiKey);
}

export interface ChainOutcome<T> {
  value: T | null; // null => show the private "Answer unavailable" message
  modelId: string | null;
  attempts: { modelId: string; error?: string; ms: number }[];
}

/**
 * Pinned cheap model first, then a larger pinned fallback, then null ("Answer unavailable").
 * One retry with short backoff per model on transient errors; format failures move straight to the next model.
 * A context-length error retries once via `shrink` (smaller budget) before falling back.
 */
export async function runChain<T>(
  models: LLM[],
  attempt: (llm: LLM, shrink: boolean) => Promise<T>,
  log: (e: { modelId: string; error: string }) => void = () => {},
): Promise<ChainOutcome<T>> {
  const attempts: ChainOutcome<T>["attempts"] = [];
  for (const llm of models) {
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now();
      try {
        const value = await attempt(llm, i === 1);
        attempts.push({ modelId: llm.id, ms: Date.now() - t0 });
        return { value, modelId: llm.id, attempts };
      } catch (e) {
        const err = e instanceof LLMError ? e : new LLMError(String((e as Error)?.message ?? e), "provider");
        attempts.push({ modelId: llm.id, error: `${err.kind}: ${err.message}`, ms: Date.now() - t0 });
        log({ modelId: llm.id, error: err.kind });
        const retryable = err.kind === "rate_limit" || err.kind === "provider" || err.kind === "context_length";
        if (!retryable || i === 1) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }
  return { value: null, modelId: null, attempts };
}

async function post(url: string, body: unknown, timeoutMs: number, headers: Record<string, string>) {
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new LLMError(name === "TimeoutError" || name === "AbortError" ? "timed out" : "network error", name === "TimeoutError" || name === "AbortError" ? "timeout" : "provider");
  }
  if (r.ok) {
    const dep = r.headers.get("deprecation") ?? r.headers.get("x-model-deprecation");
    if (dep) console.warn(`[llm] deprecation notice: ${dep}`); // surfaced privately by the app
    return r;
  }
  const detail = (await r.text().catch(() => "")).slice(0, 300);
  if (r.status === 429) throw new LLMError("rate limited", "rate_limit");
  if (/context|too long|maximum.*tokens|prompt is too long/i.test(detail)) throw new LLMError("context length exceeded", "context_length");
  if (r.status === 404 && /model/i.test(detail)) throw new LLMError("model not found or retired", "deprecated");
  throw new LLMError(`HTTP ${r.status}`, "provider");
}

async function* sse(r: Response): AsyncGenerator<string> {
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}
