import "server-only";
import snapshotJson from "@/data/evidence-snapshot.json";
import { evidenceTier, isTierAllowed, isUsableEvidence } from "./evidence-card";
import { getEvidenceMode, type EvidenceMode } from "./evidence-mode";
import { getSupabaseConfig, SupabaseQueryError, supabaseSelect, type SupabaseConfig } from "./supabase-server";
import { foldText } from "./text-fold";
import { MARKET, type EvidenceRecord, type EvidenceSource, type EvidenceTier } from "./types";

interface Snapshot {
  exported_at: string;
  records: EvidenceRecord[];
}
const snapshot = snapshotJson as unknown as Snapshot;

export const SNAPSHOT_EXPORTED_AT = snapshot.exported_at;
export const MAX_EVIDENCE = 20;
/** Candidates are leads, not proof; cap them so verified sources keep most of the model context. */
export const MAX_CANDIDATE_EVIDENCE = 8;
const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

export type EvidenceErrorCode = "db_unavailable" | "db_error" | "config_invalid" | "unsupported_market";

export interface EvidenceError {
  code: EvidenceErrorCode;
  message: string;
}

export interface EvidencePool {
  mode: EvidenceMode;
  source: EvidenceSource;
  /** Export time of the offline snapshot; null when rows came live from Supabase. */
  snapshotDate: string | null;
  /** Set when Supabase was configured but failed and the snapshot was used instead. */
  fallbackReason: EvidenceErrorCode | null;
  /** Only records whose tier the mode allows. */
  records: EvidenceRecord[];
  /** Rows stored as verified that were left out because they were bulk-marked (verified_only mode). */
  excludedBulkMarked: number;
}

export type PoolResult = ({ ok: true } & EvidencePool) | { ok: false; error: EvidenceError };

export interface LoadOptions {
  env?: Record<string, string | undefined>;
  /** Defaults to EVIDENCE_MODE from env. */
  mode?: EvidenceMode;
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

/** Statuses requested from the database. rejected is never requested in any mode. */
export function queriedStatuses(mode: EvidenceMode): string[] {
  return mode === "demo" ? ["verified", "candidate"] : ["verified"];
}

function selectForMode(rows: EvidenceRecord[], mode: EvidenceMode): Pick<EvidencePool, "records" | "excludedBulkMarked"> {
  const statuses = queriedStatuses(mode);
  const inScope = rows.filter((r) => r.market === MARKET && statuses.includes(r.status));
  const records = inScope.filter((r) => isTierAllowed(r, mode));
  return { records, excludedBulkMarked: inScope.filter((r) => r.status === "verified" && !isTierAllowed(r, mode)).length };
}

function offlinePool(mode: EvidenceMode, fallbackReason: EvidenceErrorCode | null): EvidencePool {
  return { mode, source: "offline_snapshot", snapshotDate: snapshot.exported_at, fallbackReason, ...selectForMode(snapshot.records, mode) };
}

let cache: { at: number; key: string; pool: EvidencePool } | null = null;

export function clearEvidenceCache() {
  cache = null;
}

async function fetchAllRows(config: SupabaseConfig, mode: EvidenceMode, opts: LoadOptions): Promise<EvidenceRecord[]> {
  const statuses = queriedStatuses(mode);
  const rows: EvidenceRecord[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      select: "*",
      market: `eq.${MARKET}`,
      status: statuses.length === 1 ? `eq.${statuses[0]}` : `in.(${statuses.join(",")})`,
      order: "id",
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    const batch = await supabaseSelect<EvidenceRecord>(config, "evidence_records", params, {
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Loads the evidence the mode allows. verified_only asks the database for status=verified only;
 * demo asks for verified and candidate. Status, market and tier are checked again in code.
 */
export async function loadEvidencePool(opts: LoadOptions = {}): Promise<PoolResult> {
  const mode = opts.mode ?? getEvidenceMode(opts.env ?? process.env);
  let config: SupabaseConfig | null;
  try {
    config = getSupabaseConfig(opts.env);
  } catch {
    return opts.fallbackToSnapshot ? { ok: true, ...offlinePool(mode, "config_invalid") } : evidenceError("config_invalid");
  }
  if (!config) return { ok: true, ...offlinePool(mode, null) };

  const key = `${config.url}|${mode}`;
  if (!opts.noCache && cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ok: true, ...cache.pool };
  }

  try {
    const rows = await fetchAllRows(config, mode, opts);
    const pool: EvidencePool = { mode, source: "supabase", snapshotDate: null, fallbackReason: null, ...selectForMode(rows, mode) };
    if (!opts.noCache) cache = { at: Date.now(), key, pool };
    return { ok: true, ...pool };
  } catch (err) {
    const code: EvidenceErrorCode =
      err instanceof SupabaseQueryError && (err.kind === "timeout" || err.kind === "network")
        ? "db_unavailable"
        : "db_error";
    console.error(`[evidence] Supabase query failed: ${code}`, err instanceof Error ? err.message : err);
    return opts.fallbackToSnapshot ? { ok: true, ...offlinePool(mode, code) } : evidenceError(code);
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
  /** Defaults to the LoadOptions / env mode for searchEvidence, and to verified_only for rankEvidence. */
  mode?: EvidenceMode;
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
  tier: EvidenceTier;
  score: number;
  matchedKeywords: string[];
}

/**
 * Scores the records the mode allows against keywords and returns at most 20: verified sources first,
 * then at most 8 candidates. A record needs at least one hit in a source field (title, pattern, claim,
 * quote, translation); hits only in analysis fields do not qualify it.
 */
export function rankEvidence(records: EvidenceRecord[], params: SearchEvidenceParams): ScoredEvidence[] {
  const mode = params.mode ?? "verified_only";
  const keywords = [...new Set(params.keywords.map((k) => k.trim()).filter((k) => k.length > 0))].slice(0, 80);
  if (keywords.length === 0) return [];
  const matchers = keywords.map((k) => ({ raw: k, test: makeMatcher(k) }));
  const categories = params.riskCategory ? [params.riskCategory].flat() : [];
  const boost = new Set(params.boostCategories ?? []);

  const scored: ScoredEvidence[] = [];
  for (const r of records) {
    if (!isUsableEvidence(r, mode)) continue;
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
    scored.push({ record: r, tier: evidenceTier(r)!, score, matchedKeywords: [...matched] });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (CONFIDENCE_RANK[a.record.confidence ?? ""] ?? 3) - (CONFIDENCE_RANK[b.record.confidence ?? ""] ?? 3) ||
      a.record.id.localeCompare(b.record.id),
  );

  // Same URL with a different quote is a different provision of the same law, so it stays;
  // same URL + same quote is the same evidence and only the best-scoring row is kept.
  // Candidates often have no URL, so their title stands in for it.
  const seenIds = new Set<string>();
  const seenSource = new Set<string>();
  const unique: ScoredEvidence[] = [];
  for (const s of scored) {
    const where = s.record.source_url?.trim() || `title:${s.record.title?.trim()}`;
    const sourceKey = `${where}\u0000${s.record.quote_original?.trim()}`;
    if (seenIds.has(s.record.id) || seenSource.has(sourceKey)) continue;
    seenIds.add(s.record.id);
    seenSource.add(sourceKey);
    unique.push(s);
  }

  const limit = Math.min(params.limit ?? MAX_EVIDENCE, MAX_EVIDENCE);
  const candidates = unique.filter((s) => s.tier === "candidate");
  const candidateSlots = Math.min(candidates.length, MAX_CANDIDATE_EVIDENCE, limit);
  const verified = unique.filter((s) => s.tier === "verified").slice(0, limit - candidateSlots);
  return [...verified, ...candidates.slice(0, candidateSlots)];
}

export type SearchEvidenceResult =
  | ({ ok: true; results: ScoredEvidence[]; poolSize: number } & Omit<EvidencePool, "records">)
  | { ok: false; error: EvidenceError };

export async function searchEvidence(params: SearchEvidenceParams, opts: LoadOptions = {}): Promise<SearchEvidenceResult> {
  if ((params.market ?? MARKET) !== MARKET) return evidenceError("unsupported_market");
  const pool = await loadEvidencePool({ ...opts, mode: params.mode ?? opts.mode });
  if (!pool.ok) return pool;
  const { records, ...meta } = pool;
  return { ...meta, results: rankEvidence(records, { ...params, mode: pool.mode }), poolSize: records.length };
}

export interface EvidenceStats {
  mode: EvidenceMode;
  source: EvidenceSource;
  snapshotDate: string | null;
  fallbackReason: EvidenceErrorCode | null;
  /** Records the mode loads, before the completeness check. */
  total: number;
  usable: { verified: number; candidate: number };
  /** Usable candidates that are bulk-marked verified rows. */
  bulkMarkedUsable: number;
  /** Stored-as-verified rows left out because they were bulk-marked (verified_only mode). */
  excludedBulkMarked: number;
  byRecordType: Record<string, { verified: number; candidate: number }>;
}

export async function getEvidenceStats(opts: LoadOptions = {}): Promise<({ ok: true } & EvidenceStats) | { ok: false; error: EvidenceError }> {
  const pool = await loadEvidencePool({ fallbackToSnapshot: true, ...opts });
  if (!pool.ok) return pool;
  const usable = pool.records.filter((r) => isUsableEvidence(r, pool.mode));
  const byRecordType: EvidenceStats["byRecordType"] = {};
  for (const r of usable) {
    const row = (byRecordType[r.record_type] ??= { verified: 0, candidate: 0 });
    row[evidenceTier(r)!]++;
  }
  return {
    ok: true,
    mode: pool.mode,
    source: pool.source,
    snapshotDate: pool.snapshotDate,
    fallbackReason: pool.fallbackReason,
    total: pool.records.length,
    usable: {
      verified: usable.filter((r) => evidenceTier(r) === "verified").length,
      candidate: usable.filter((r) => evidenceTier(r) === "candidate").length,
    },
    bulkMarkedUsable: usable.filter((r) => r.status === "verified" && evidenceTier(r) === "candidate").length,
    excludedBulkMarked: pool.excludedBulkMarked,
    byRecordType,
  };
}
