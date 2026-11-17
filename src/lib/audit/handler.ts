import "server-only";
import snapshotJson from "@/data/evidence-snapshot.json";
import { isUsableEvidence } from "@/lib/evidence-card";
import { getEvidenceMode, type EvidenceMode } from "@/lib/evidence-mode";
import { searchEvidence } from "@/lib/evidence-search";
import type { EvidenceRecord } from "@/lib/types";
import { findDemoCache } from "./demo-cache";
import { callModel, parseModelJson } from "./model";
import { createRateLimiter } from "./rate-limit";
import { runAudit, type AuditDeps } from "./run-audit";
import { parseAuditRequest } from "./schema";
import type { AuditErrorCode, AuditErrorResponse, AuditResponse } from "./types";

const snapshotRecords = (snapshotJson as unknown as { records: EvidenceRecord[] }).records;
const allowedSnapshotIds = new Map<EvidenceMode, Set<string>>();

/** Snapshot ids usable under the mode; cached demo results may only cite these. */
export function allowedIdsFor(mode: EvidenceMode): Set<string> {
  let ids = allowedSnapshotIds.get(mode);
  if (!ids) {
    ids = new Set(snapshotRecords.filter((r) => isUsableEvidence(r, mode)).map((r) => r.id));
    allowedSnapshotIds.set(mode, ids);
  }
  return ids;
}

export function defaultAuditDeps(): AuditDeps {
  const evidenceMode = getEvidenceMode();
  return {
    evidenceMode,
    search: (params) => searchEvidence(params, { fallbackToSnapshot: true }),
    callModel: (messages) => callModel(messages),
    parseModelJson,
    findDemoCache,
    allowedEvidenceIds: () => allowedIdsFor(evidenceMode),
    now: Date.now,
  };
}

const STATUS: Record<AuditErrorCode, number> = {
  invalid_input: 400,
  empty: 400,
  too_long: 400,
  rate_limited: 429,
  evidence_unavailable: 503,
  internal: 500,
};

const rateLimit = Number(process.env.AUDIT_RATE_LIMIT);
const defaultLimiter = createRateLimiter(Number.isFinite(rateLimit) && rateLimit > 0 ? rateLimit : 10, 60_000);
const MAX_BODY_BYTES = 64_000;

function errorResponse(code: AuditErrorCode, message: string) {
  const body: AuditErrorResponse = { ok: false, error: { code, message } };
  return Response.json(body, { status: STATUS[code] });
}

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anonymous";
}

/** POST /api/audit. Returns the HTTP response plus the result to log (logging happens after the response). */
export async function handleAuditPost(
  req: Request,
  deps: AuditDeps = defaultAuditDeps(),
  allow: (key: string) => boolean = defaultLimiter,
): Promise<{ response: Response; toLog: AuditResponse | null }> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { response: errorResponse("too_long", "请求内容过大，请分段提交"), toLog: null };
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { response: errorResponse("invalid_input", "请求体不是有效的 JSON"), toLog: null };
  }
  const parsed = parseAuditRequest(body);
  if (!parsed.ok) return { response: errorResponse(parsed.error.code, parsed.error.message), toLog: null };

  if (!parsed.value.demoMode && !allow(clientKey(req))) {
    return { response: errorResponse("rate_limited", "请求过于频繁，请一分钟后再试"), toLog: null };
  }

  try {
    const result = await runAudit(parsed.value, deps);
    if (!result.ok) return { response: errorResponse(result.error.code, result.error.message), toLog: null };
    return { response: Response.json(result), toLog: result };
  } catch (err) {
    console.error("[audit] unexpected error:", err instanceof Error ? err.message : err);
    return { response: errorResponse("internal", "审查服务出现异常，请稍后重试"), toLog: null };
  }
}
