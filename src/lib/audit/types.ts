import type { EvidenceCard, EvidenceSource } from "@/lib/types";

export const CONTENT_TYPES = ["advertisement", "product_page", "customer_service"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  advertisement: "广告文案",
  product_page: "商品详情页",
  customer_service: "客服话术",
};

export const FINDING_CATEGORIES = ["geopolitical", "cultural", "language", "platform", "product", "aftersale"] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const LEVELS = ["high", "medium", "low", "needs_review"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  high: "潜在高风险",
  medium: "中风险",
  low: "低风险",
  needs_review: "待人工复核",
};

export const MAX_TEXT_LENGTH = 3000;
export const DISCLAIMER = "结果仅作发布前风险提示，不构成法律意见";
export const NO_EVIDENCE_SUMMARY = "未找到可核验依据，建议进行人工确认。";
export const PROMPT_VERSION = "audit-v2";

export interface AuditFinding {
  id: string;
  location: string;
  risk_category: FindingCategory;
  severity: Level;
  reason: string;
  evidence_ids: string[];
  recommendation: string;
  requires_human_review: boolean;
  /** exact: verbatim in the input; approx: mapped to the closest sentence; none: could not be located. */
  location_match: "exact" | "approx" | "none";
  source: "model" | "rules";
}

export interface AuditResult {
  overall_level: Level;
  summary: string;
  findings: AuditFinding[];
  missing_evidence: string[];
  disclaimer: string;
}

/**
 * live: model judged against live/snapshot evidence.
 * rules_only: model unavailable; deterministic signal matches only.
 * no_evidence: nothing in the evidence base matched, model not called.
 * cached_demo: pre-generated result for a demo case.
 */
export type AuditMode = "live" | "rules_only" | "no_evidence" | "cached_demo";

export interface MatchedSignal {
  id: string;
  label: string;
  category: FindingCategory;
  term: string;
  sentence: string;
}

export interface AuditResponse {
  ok: true;
  mode: AuditMode;
  input: { market: "Vietnam"; contentType: ContentType; text: string; assetName?: string };
  result: AuditResult;
  /** Cards for every evidence_id cited in result.findings. */
  evidence: EvidenceCard[];
  signals: MatchedSignal[];
  meta: {
    evidenceSource: EvidenceSource;
    snapshotDate: string | null;
    fallbackReason: string | null;
    retrievedCount: number;
    model: string | null;
    promptVersion: string;
    generatedAt: string;
    durationMs: number;
    cachedAt?: string;
    demoId?: string;
    notices: string[];
    removed: { invalidEvidenceIds: string[]; droppedFindings: number; sanitizedPhrases: number };
  };
}

export type AuditErrorCode = "invalid_input" | "empty" | "too_long" | "rate_limited" | "evidence_unavailable" | "internal";

export interface AuditErrorResponse {
  ok: false;
  error: { code: AuditErrorCode; message: string };
}
