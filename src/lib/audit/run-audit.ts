import { toEvidenceCard } from "@/lib/evidence-card";
import type { EvidenceMode } from "@/lib/evidence-mode";
import type { ScoredEvidence, SearchEvidenceParams, SearchEvidenceResult } from "@/lib/evidence-search";
import { MARKET } from "@/lib/types";
import { toCachedResponse, type CachedDemoEntry } from "./demo-cache";
import { extractSignals } from "./lexicon";
import type { ChatMessage, ModelCallResult } from "./model";
import { buildRulesOnlyResult, missingEvidenceFor, postprocessModelOutput } from "./postprocess";
import { buildMessages } from "./prompt";
import type { AuditRequest } from "./schema";
import {
  DISCLAIMER,
  NO_EVIDENCE_SUMMARY,
  PROMPT_VERSION,
  type AuditErrorResponse,
  type AuditMode,
  type AuditResponse,
  type AuditResult,
} from "./types";

export interface AuditDeps {
  evidenceMode: EvidenceMode;
  search: (params: SearchEvidenceParams) => Promise<SearchEvidenceResult>;
  callModel: (messages: ChatMessage[]) => Promise<ModelCallResult>;
  parseModelJson: (content: string) => unknown | null;
  findDemoCache: (contentType: AuditRequest["contentType"], text: string, demoId?: string) => CachedDemoEntry | null;
  /** Ids the current mode allows; cached demo citations outside this set are removed before display. */
  allowedEvidenceIds: () => Set<string>;
  now: () => number;
}

const MODEL_FAILURE_NOTICE: Record<string, string> = {
  not_configured: "未配置大模型",
  timeout: "模型响应超时",
  http: "模型服务返回错误",
  network: "模型服务无法连接",
  empty: "模型没有返回内容",
  invalid_json: "模型返回的内容不是有效 JSON，已丢弃",
  invalid_schema: "模型返回的结果格式不符合要求，已丢弃",
};

export async function runAudit(req: AuditRequest, deps: AuditDeps): Promise<AuditResponse | AuditErrorResponse> {
  const started = deps.now();
  const mode = deps.evidenceMode;
  const cached = () => deps.findDemoCache(req.contentType, req.text, req.demoId);
  const fromCache = (entry: CachedDemoEntry, reason: string) => toCachedResponse(entry, reason, deps.allowedEvidenceIds(), mode);

  if (req.demoMode) {
    const entry = cached();
    if (entry) return fromCache(entry, "已按演示模式直接读取缓存。");
  }

  const ext = extractSignals(req.text, req.contentType);
  const search = await deps.search({ market: MARKET, mode, keywords: ext.keywords, boostCategories: ext.boostCategories });
  if (!search.ok) {
    const entry = cached();
    if (entry) return fromCache(entry, `${search.error.message}。`);
    return { ok: false, error: { code: "evidence_unavailable", message: `${search.error.message}，暂时无法审查，请稍后重试` } };
  }

  const notices: string[] = [];
  if (search.source === "offline_snapshot") {
    const date = search.snapshotDate?.slice(0, 10);
    notices.push(
      search.fallbackReason
        ? `证据库暂时不可用，已改用离线证据快照（导出于 ${date}）。`
        : `当前为离线演示模式：证据来自离线证据快照（导出于 ${date}）。`,
    );
    if (mode === "demo") notices.push("离线快照不含数据库中状态为 candidate 的候选资料。");
  }

  const retrieved: ScoredEvidence[] = search.results.filter((s) => s.tier === "verified" || mode === "demo");
  const retrievedByTier = {
    verified: retrieved.filter((s) => s.tier === "verified").length,
    candidate: retrieved.filter((s) => s.tier === "candidate").length,
  };
  const respond = (
    auditMode: AuditMode,
    result: AuditResult,
    citedIds: string[],
    extra: Partial<AuditResponse["meta"]> = {},
  ): AuditResponse => {
    const byId = new Map(retrieved.map((s) => [s.record.id, s.record]));
    const evidence = citedIds.map((id) => toEvidenceCard(byId.get(id)!, mode));
    if (evidence.some((c) => c.tier === "candidate")) {
      notices.push("演示模式：标注为“候选资料/待核验”的依据尚未核验来源，只能作为线索参考，不能单独支撑风险判断。");
    }
    return {
      ok: true,
      mode: auditMode,
      input: { market: MARKET, contentType: req.contentType, text: req.text, assetName: req.assetName },
      result,
      evidence,
      signals: ext.signals,
      meta: {
        evidenceMode: mode,
        evidenceSource: search.source,
        snapshotDate: search.snapshotDate,
        fallbackReason: search.fallbackReason,
        retrievedCount: retrieved.length,
        retrievedByTier,
        model: null,
        promptVersion: PROMPT_VERSION,
        generatedAt: new Date(deps.now()).toISOString(),
        durationMs: deps.now() - started,
        notices,
        removed: { invalidEvidenceIds: [], droppedFindings: 0, sanitizedPhrases: 0, downgradedFindings: 0 },
        ...extra,
      },
    };
  };

  if (retrieved.length === 0) {
    return respond(
      "no_evidence",
      {
        overall_level: "low",
        summary: NO_EVIDENCE_SUMMARY,
        findings: [],
        missing_evidence: [
          ...missingEvidenceFor(ext, retrieved),
          mode === "demo"
            ? "当前证据库中没有与该内容直接相关的记录（已核验来源和候选资料均未命中）。"
            : "当前证据库中没有与该内容直接相关的已核验记录。",
        ],
        disclaimer: DISCLAIMER,
      },
      [],
    );
  }

  const fallback = (kind: string): AuditResponse => {
    const reason = `${MODEL_FAILURE_NOTICE[kind] ?? "模型暂不可用"}。`;
    const entry = cached();
    if (entry) return fromCache(entry, reason);
    const rules = buildRulesOnlyResult(ext, retrieved);
    notices.push(`${reason}以下为规则匹配结果，没有经过模型分析。`);
    return respond("rules_only", rules.result, rules.citedIds);
  };

  const model = await deps.callModel(
    buildMessages({ contentType: req.contentType, text: req.text, signals: ext.signals, evidence: retrieved.map((s) => s.record) }),
  );
  if (!model.ok) return fallback(model.kind);

  const raw = deps.parseModelJson(model.content);
  if (raw === null) return fallback("invalid_json");

  const pp = postprocessModelOutput(raw, {
    text: req.text,
    evidence: new Map(retrieved.map((s) => [s.record.id, s.record])),
    mode,
  });
  if (!pp.ok) return fallback(pp.reason);

  if (pp.removed.invalidEvidenceIds.length || pp.removed.droppedFindings) {
    notices.push(
      `已自动移除 ${pp.removed.invalidEvidenceIds.length} 个无法核验的证据引用和 ${pp.removed.droppedFindings} 条缺少可核验证据的判断。`,
    );
  }
  const candidateOnly = pp.result.findings.filter((f) => f.evidence_basis === "candidate_only").length;
  if (candidateOnly) {
    notices.push(`有 ${candidateOnly} 条判断只引用了候选资料（待核验），已统一降为“待人工复核”。`);
  }
  return respond("live", pp.result, pp.citedIds, { model: model.model, removed: pp.removed });
}
