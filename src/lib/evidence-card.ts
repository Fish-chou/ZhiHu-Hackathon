import bulkVerified from "@/data/bulk-verified.json";
import { MARKET, RECORD_TYPE_LABELS, RISK_CATEGORY_LABELS, type EvidenceCard, type EvidenceRecord } from "./types";

const BULK_MARKED = new Set<string>(bulkVerified.ids);

export function isBulkMarked(id: string): boolean {
  return BULK_MARKED.has(id);
}

const ANALYST_PREFIX = /^\s*analyst_inference\s*[:：]\s*/i;

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function analysisText(value: string | null): string | null {
  const v = clean(value);
  if (!v) return null;
  // risk_rule rows store the bare label "needs_review" here; it is a status, not analysis text.
  if (v === "needs_review") return null;
  return v.replace(ANALYST_PREFIX, "");
}

const CLAIM_LABELS: Record<string, string> = {
  incident: "来源记载",
  official_rule: "该规则文本规定",
  platform_rule: "该平台政策规定",
  risk_rule: "依据",
  zhihu: "知乎作者称",
};

export function isUsableEvidence(r: EvidenceRecord): boolean {
  return (
    r.status === "verified" &&
    r.market === MARKET &&
    !!clean(r.title) &&
    !!clean(r.quote_original) &&
    !!clean(r.claim) &&
    /^https?:\/\//i.test(clean(r.source_url) ?? "")
  );
}

/** Builds the source card. Throws if the record is not usable, so non-verified rows can never reach the UI. */
export function toEvidenceCard(r: EvidenceRecord): EvidenceCard {
  if (!isUsableEvidence(r)) {
    throw new Error(`evidence ${r.id} is not a usable verified ${MARKET} record`);
  }
  const confidence = clean(r.confidence);
  return {
    id: r.id,
    recordType: r.record_type,
    recordTypeLabel: RECORD_TYPE_LABELS[r.record_type] ?? r.record_type,
    title: clean(r.title)!,
    sourceTitle: clean(r.source_title),
    sourceType: clean(r.source_type),
    sourceUrl: clean(r.source_url)!,
    publishedAt: clean(r.source_published_at),
    accessedAt: clean(r.accessed_at),
    quoteOriginal: clean(r.quote_original)!,
    translationZh: clean(r.translation_zh),
    claimLabel: CLAIM_LABELS[r.record_type] ?? "来源记载",
    claim: clean(r.claim)!,
    consequence: clean(r.consequence),
    analysis: {
      riskSignal: analysisText(r.risk_signal),
      recommendedAction: analysisText(r.recommended_action),
    },
    notes: clean(r.notes),
    authorName: clean(r.author_name),
    riskCategory: clean(r.risk_category),
    riskCategoryLabel: RISK_CATEGORY_LABELS[clean(r.risk_category) ?? ""] ?? null,
    confidence,
    lowConfidence: confidence === "low",
    status: "verified",
    verification: isBulkMarked(r.id) ? "bulk_marked" : "individual",
  };
}
