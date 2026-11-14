import "server-only";

export interface SupabaseConfig {
  url: string;
  key: string;
}

export type SupabaseErrorKind = "config_invalid" | "timeout" | "network" | "http" | "invalid_response";

export class SupabaseQueryError extends Error {
  constructor(
    readonly kind: SupabaseErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SupabaseQueryError";
  }
}

type Env = Record<string, string | undefined>;

function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

/**
 * Reads Supabase settings from server-side env vars. Returns null when unset (offline snapshot mode).
 * Refuses secret / service_role keys: they bypass RLS and could expose non-verified rows.
 */
export function getSupabaseConfig(env: Env = process.env): SupabaseConfig | null {
  const url = env.SUPABASE_URL?.trim();
  const key = (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY)?.trim();
  if (!url || !key) return null;
  if (looksLikeSecretKey(key)) {
    throw new SupabaseQueryError("config_invalid", "SUPABASE key must be the publishable/anon key, not a secret key");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

function headers(config: SupabaseConfig): Record<string, string> {
  const h: Record<string, string> = { apikey: config.key, Accept: "application/json" };
  // Legacy anon keys are JWTs and also go in Authorization; new sb_publishable_ keys must not.
  if (config.key.split(".").length === 3) h.Authorization = `Bearer ${config.key}`;
  return h;
}

interface RequestOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function request(config: SupabaseConfig, path: string, init: RequestInit, opts: RequestOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${config.url}/rest/v1/${path}`, {
      ...init,
      headers: { ...headers(config), ...(init.headers as Record<string, string> | undefined) },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new SupabaseQueryError("http", `Supabase responded ${res.status}`, res.status);
    }
    return res;
  } catch (err) {
    if (err instanceof SupabaseQueryError) throw err;
    if (controller.signal.aborted) throw new SupabaseQueryError("timeout", "Supabase request timed out");
    throw new SupabaseQueryError("network", "Supabase request failed");
  } finally {
    clearTimeout(timer);
  }
}

export async function supabaseSelect<T>(
  config: SupabaseConfig,
  table: string,
  params: URLSearchParams,
  opts: RequestOptions = {},
): Promise<T[]> {
  const res = await request(config, `${table}?${params.toString()}`, { method: "GET" }, opts);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SupabaseQueryError("invalid_response", "Supabase returned non-JSON");
  }
  if (!Array.isArray(body)) throw new SupabaseQueryError("invalid_response", "Supabase returned a non-array body");
  return body as T[];
}

export async function supabaseInsert(
  config: SupabaseConfig,
  table: string,
  rows: Record<string, unknown>[],
  opts: RequestOptions = {},
): Promise<void> {
  await request(
    config,
    table,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    },
    opts,
  );
}
