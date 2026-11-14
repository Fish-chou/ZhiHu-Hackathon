import "server-only";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

type Env = Record<string, string | undefined>;

export function getModelConfig(env: Env = process.env): ModelConfig | null {
  const baseUrl = env.LLM_BASE_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  const t = Number(env.LLM_TIMEOUT_MS);
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model, timeoutMs: Number.isFinite(t) && t > 0 ? t : 40_000 };
}

export type ModelFailureKind = "not_configured" | "timeout" | "http" | "network" | "empty";
export type ModelCallResult =
  | { ok: true; content: string; model: string }
  | { ok: false; kind: ModelFailureKind; status?: number };

export interface CallModelOptions {
  env?: Env;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function callModel(messages: ChatMessage[], opts: CallModelOptions = {}): Promise<ModelCallResult> {
  const cfg = getModelConfig(opts.env);
  if (!cfg) return { ok: false, kind: "not_configured" };
  const doFetch = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + (opts.timeoutMs ?? cfg.timeoutMs);

  const attempt = async (jsonMode: boolean): Promise<ModelCallResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    try {
      const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature: 0.1,
          max_tokens: 3000,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return { ok: false, kind: "http", status: res.status };
      const data = (await res.json()) as { model?: unknown; choices?: { message?: { content?: unknown } }[] };
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) return { ok: false, kind: "empty" };
      return { ok: true, content, model: typeof data.model === "string" ? data.model : cfg.model };
    } catch {
      return { ok: false, kind: controller.signal.aborted ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await attempt(true);
  // Some OpenAI-compatible providers reject response_format; retry once without it.
  if (!first.ok && first.kind === "http" && first.status === 400) return attempt(false);
  return first;
}

/** Parses the model's JSON, tolerating code fences or stray text around the object. */
export function parseModelJson(content: string): unknown | null {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const i = stripped.indexOf("{");
    const j = stripped.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(stripped.slice(i, j + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
