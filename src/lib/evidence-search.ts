import "server-only";
import snapshotJson from "@/data/evidence-snapshot.json";
import { isBulkMarked, isUsableEvidence } from "./evidence-card";
import { getSupabaseConfig, SupabaseQueryError, supabaseSelect, type SupabaseConfig } from "./supabase-server";
import { foldText } from "./text-fold";
import { MARKET, type EvidenceRecord, type EvidenceSource } from "./types";

interface Snapshot {
  exported_at: string;
  records: EvidenceRecord[];
}
const snapshot = snapshotJson as unknown as Snapshot;

export const SNAPSHOT_EXPORTED_AT = snapshot.exported_at;
export const MAX_EVIDENCE = 20;
const CACHE_TTL_MS = 60_000;

export type EvidenceErrorCode = "db_unavailable" | "db_error" | "config_invalid" | "unsupported_market";

export interface EvidenceError {
  code: EvidenceErrorCode;
  message: string;
}

export interface EvidencePool {
  source: EvidenceSource;
  /** Export time of the offline snapshot; null when rows came live from Supabase. */
  snapshotDate: string | null;
  /** Set when Supabase was configured but failed and the snapshot was used instead. */
  fallbackReason: EvidenceErrorCode | null;
  records: EvidenceRecord[];
}

export type PoolResult = ({ ok: true } & EvidencePool) | { ok: false; error: EvidenceError };

export interface LoadOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Use the offline verified snapshot (clearly labelled) when Supabase fails. Off by default. */
  fallbackToSnapshot?: boolean;
  noCache?: boolean;
}

const ERROR_MESSAGES: Record<EvidenceErrorCode, string> = {
  db_unavailable: "证据库暂时无法连接",
  db_error: "证据库查询失败",
  config_invalid: "证据库配置无效",
  unsupported_market: "当前只支持越南市场",
};

function evidenceError(code: EvidenceErrorCode): { ok: false; error: EvidenceError } {
  return { ok: false, error: { code, message: ERROR_MESSAGES[code] } };
}

function onlyVerifiedVietnam(rows: EvidenceRecord[]): EvidenceRecord[] {
  return rows.filter((r) => r.status === "verified" && r.market === MARKET);
}

function offlinePool(fallbackReason: EvidenceErrorCode | null): EvidencePool {
  return {
    source: "offline_snapshot",
    snapshotDate: snapshot.exported_at,
    fallbackReason,
    records: onlyVerifiedVietnam(snapshot.records),
  };
}

let cache: { at: number; url: string; records: EvidenceRecord[] } | null = null;

export function clearEvidenceCache() {
  cache = null;
}

/** Loads every verified Vietnam record. Status/market are filtered in the query and again in code. */
export async function loadVerifiedPool(opts: LoadOptions = {}): Promise<PoolResult> {
  let config: SupabaseConfig | null;
  try {
    config = getSupabaseConfig(opts.env);
  } catch {
    return opts.fallbackToSnapshot ? { ok: true, ...offlinePool("config_invalid") } : evidenceError("config_invalid");
  }
  if (!config) return { ok: true, ...offlinePool(null) };

  if (!opts.noCache && cache && cache.url === config.url && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ok: true, source: "supabase", snapshotDate: null, fallbackReason: null, records: cache.records };
  }

  const params = new URLSearchParams({
    select: "*",
    market: `eq.${MARKET}`,
    status: "eq.verified",
    order: "id",
    limit: "1000",
  });
  try {
    const rows = await supabaseSelect<EvidenceRecord>(config, "evidence_records", params, {
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
    const records = onlyVerifiedVietnam(rows);
    if (!opts.noCache) cache = { at: Date.now(), url: config.url, records };
    return { ok: true, source: "supabase", snapshotDate: null, fallbackReason: null, records };
  } catch (err) {
    const code: EvidenceErrorCode =
      err instanceof SupabaseQueryError && (err.kind === "timeout" || err.kind === "network")
        ? "db_unavailable"
        : "db_error";
    console.error(`[evidence] Supabase query failed: ${code}`, err instanceof Error ? err.message : err);
    return opts.fallbackToSnapshot ? { ok: true, ...offlinePool(code) } : evidenceError(code);
  }
}

// ---------- keyword ranking ----------

export { foldText };

const FIELDS: { field: keyof EvidenceRecord; weight: number; primary: boolean }[] = [
  { field: "title", weight: 3, primary: true },
  { field: "pattern", weight: 3, primary: true },
  { field: "claim", weight: 2, primary: true },
  { field: "quote_original", weight: 2, primary: true },
  { field: "translation_zh", weight: 1, primary: true },
  { field: "risk_signal", weight: 1, primary: false },
  { field: "recommended_action", weight: 1, primary: false },
  { field: "category", weight: 1, primary: false },
];

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
/** A single incidental hit (e.g. one word in a translation) is noise, not evidence. */
const MIN_SCORE = 3;

const foldedCache = new WeakMap<EvidenceRecord, Partial<Record<keyof EvidenceRecord, string>>>();
function folded(r: EvidenceRecord, field: keyof EvidenceRecord): string {
  let entry = foldedCache.get(r);
  if (!entry) foldedCache.set(r, (entry = {}));
  if (entry[field] === undefined) entry[field] = foldText(String(r[field] ?? ""));
  return entry[field]!;
}

function makeMatcher(keyword: string): (text: string) => boolean {
  const k = foldText(keyword.trim());
  // Short Latin keywords ("app", "only") need word boundaries, otherwise "app" matches "apply".
  if (/^[a-z0-9 ]{1,4}$/.test(k)) {
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/ /g, "\\s+")}($|[^a-z0-9])`);
    return (text) => re.test(text);
  }
  return (text) => text.includes(k);
}

export interface SearchEvidenceParams {
  market?: string;
  keywords: string[];
  /** Hard filter on evidence risk_category. */
  riskCategory?: string | string[];
  /** Hard filter on record_type. */
  recordTypes?: string[];
  /** Soft boost for these risk categories. */
  boostCategories?: string[];
  limit?: number;
}

export interface ScoredEvidence {
  record: EvidenceRecord;
  score: number;
  matchedKeywords: string[];
}

/**
 * Scores usable verified records against keywords and returns at most 20.
 * A record needs at least one hit in a source field (title, pattern, claim, quote, translation);
 * hits only in analysis fields do not qualify it.
 */
export function rankEvidence(records: EvidenceRecord[], params: SearchEvidenceParams): ScoredEvidence[] {
  const keywords = [...new Set(params.keywords.map((k) => k.trim()).filter((k) => k.length > 0))].slice(0, 80);
  if (keywords.length === 0) return [];
  const matchers = keywords.map((k) => ({ raw: k, test: makeMatcher(k) }));
  const categories = params.riskCategory ? [params.riskCategory].flat() : [];
  const boost = new Set(params.boostCategories ?? []);

  const scored: ScoredEvidence[] = [];
  for (const r of records) {
    if (!isUsableEvidence(r)) continue;
    if (categories.length && !categories.includes(r.risk_category ?? "")) continue;
    if (params.recordTypes?.length && !params.recordTypes.includes(r.record_type)) continue;

    let score = 0;
    let primaryHit = false;
    const matched = new Set<string>();
    for (const m of matchers) {
      for (const f of FIELDS) {
        if (m.test(folded(r, f.field))) {
          score += f.weight;
          matched.add(m.raw);
          if (f.primary) primaryHit = true;
        }
      }
    }
    if (!primaryHit) continue;
    if (boost.has(r.risk_category ?? "")) score += 2;
    if (score < MIN_SCORE) continue;
    scored.push({ record: r, score, matchedKeywords: [...matched] });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (CONFIDENCE_RANK[a.record.confidence ?? ""] ?? 3) - (CONFIDENCE_RANK[b.record.confidence ?? ""] ?? 3) ||
      a.record.id.localeCompare(b.record.id),
  );

  // Same URL with a different quote is a different provision of the same law, so it stays;
  // same URL + same quote is the same evidence and only the best-scoring row is kept.
  const seenIds = new Set<string>();
  const seenSource = new Set<string>();
  const out: ScoredEvidence[] = [];
  for (const s of scored) {
    const sourceKey = `${s.record.source_url?.trim()}\u0000${s.record.quote_original?.trim()}`;
    if (seenIds.has(s.record.id) || seenSource.has(sourceKey)) continue;
    seenIds.add(s.record.id);
    seenSource.add(sourceKey);
    out.push(s);
    if (out.length >= Math.min(params.limit ?? MAX_EVIDENCE, MAX_EVIDENCE)) break;
  }
  return out;
}

export type SearchEvidenceResult =
  | ({ ok: true; results: ScoredEvidence[]; poolSize: number } & Omit<EvidencePool, "records">)
  | { ok: false; error: EvidenceError };

export async function searchEvidence(params: SearchEvidenceParams, opts: LoadOptions = {}): Promise<SearchEvidenceResult> {
  if ((params.market ?? MARKET) !== MARKET) return evidenceError("unsupported_market");
  const pool = await loadVerifiedPool(opts);
  if (!pool.ok) return pool;
  return {
    ok: true,
    source: pool.source,
    snapshotDate: pool.snapshotDate,
    fallbackReason: pool.fallbackReason,
    results: rankEvidence(pool.records, params),
    poolSize: pool.records.length,
  };
}

export interface EvidenceStats {
  source: EvidenceSource;
  snapshotDate: string | null;
  fallbackReason: EvidenceErrorCode | null;
  total: number;
  usable: number;
  /** Usable records that were switched to verified in bulk without a per-record source check. */
  bulkMarked: number;
  byRecordType: Record<string, number>;
  byRiskCategory: Record<string, number>;
}

export async function getVerifiedEvidenceStats(opts: LoadOptions = {}): Promise<
  ({ ok: true } & EvidenceStats) | { ok: false; error: EvidenceError }
> {
  const pool = await loadVerifiedPool({ fallbackToSnapshot: true, ...opts });
  if (!pool.ok) return pool;
  const usable = pool.records.filter(isUsableEvidence);
  const count = (key: (r: EvidenceRecord) => string) =>
    usable.reduce<Record<string, number>>((acc, r) => {
      acc[key(r)] = (acc[key(r)] ?? 0) + 1;
      return acc;
    }, {});
  return {
    ok: true,
    source: pool.source,
    snapshotDate: pool.snapshotDate,
    fallbackReason: pool.fallbackReason,
    total: pool.records.length,
    usable: usable.length,
    bulkMarked: usable.filter((r) => isBulkMarked(r.id)).length,
    byRecordType: count((r) => r.record_type),
    byRiskCategory: count((r) => r.risk_category ?? "other"),
  };
}
