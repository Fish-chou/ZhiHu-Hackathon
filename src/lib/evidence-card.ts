import bulkVerified from "@/data/bulk-verified.json";
import type { EvidenceMode } from "./evidence-mode";
import {
  EVIDENCE_TIER_LABELS,
  MARKET,
  RECORD_TYPE_LABELS,
  RISK_CATEGORY_LABELS,
  type EvidenceCard,
  type EvidenceRecord,
  type EvidenceTier,
} from "./types";

const BULK_MARKED = new Set<string>(bulkVerified.ids);

export function isBulkMarked(id: string): boolean {
  return BULK_MARKED.has(id);
}

/**
 * The tier is derived from the stored status and never written back.
 * Bulk-marked rows are stored as verified but were never checked record by record, so they rank as candidates.
 */
export function evidenceTier(r: EvidenceRecord): EvidenceTier | null {
  if (r.market !== MARKET) return null;
  if (r.status === "verified") return isBulkMarked(r.id) ? "candidate" : "verified";
  if (r.status === "candidate") return "candidate";
  return null;
}

export function allowedTiers(mode: EvidenceMode): EvidenceTier[] {
  return mode === "demo" ? ["verified", "candidate"] : ["verified"];
}

export function isTierAllowed(r: EvidenceRecord, mode: EvidenceMode): boolean {
  const tier = evidenceTier(r);
  return tier !== null && allowedTiers(mode).includes(tier);
}

const ANALYST_PREFIX = /^\s*analyst_inference\s*[:：]\s*/i;
// Spreadsheet-converted candidates use these as "no value" / "same as the row above".
const PLACEHOLDER = /^(?:[\s—–\-_/·.。、]*|同上|无|暂无|n\/?a|null|none|待补充|未知)$/i;

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && !PLACEHOLDER.test(v) ? v : null;
}

function httpUrl(value: string | null | undefined): string | null {
  const v = clean(value);
  return v && /^https?:\/\//i.test(v) ? v : null;
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

/** The quote shown on the card. Candidates without a usable quote fall back to their raw data row. */
export function evidenceExcerpt(r: EvidenceRecord): { text: string; label: string } | null {
  const quote = clean(r.quote_original);
  if (quote) return { text: quote, label: "原文短引" };
  if (evidenceTier(r) !== "candidate") return null;
  const raw = clean(r.original_text);
  return raw ? { text: raw.length > 400 ? `${raw.slice(0, 400)}…` : raw, label: "原始资料行" } : null;
}

/**
 * Whether a record may be retrieved, sent to the model and shown, under the given mode.
 * Verified sources need a title, quote, claim and source link. Candidates need a title, claim and excerpt;
 * a link is optional because the data side often has none for them.
 */
export function isUsableEvidence(r: EvidenceRecord, mode: EvidenceMode): boolean {
  if (!isTierAllowed(r, mode)) return false;
  if (!clean(r.title) || !clean(r.claim) || !evidenceExcerpt(r)) return false;
  return evidenceTier(r) === "candidate" || !!httpUrl(r.source_url);
}

/** Builds the source card. Throws if the mode does not allow the record, so it can never reach the UI by accident. */
export function toEvidenceCard(r: EvidenceRecord, mode: EvidenceMode): EvidenceCard {
  if (!isUsableEvidence(r, mode)) {
    throw new Error(`evidence ${r.id} is not usable in ${mode} mode`);
  }
  const tier = evidenceTier(r)!;
  const excerpt = evidenceExcerpt(r)!;
  const confidence = clean(r.confidence);
  return {
    id: r.id,
    recordType: r.record_type,
    recordTypeLabel: RECORD_TYPE_LABELS[r.record_type] ?? r.record_type,
    title: clean(r.title)!,
    sourceTitle: clean(r.source_title),
    sourceType: clean(r.source_type),
    sourceUrl: httpUrl(r.source_url),
    publishedAt: clean(r.source_published_at),
    accessedAt: clean(r.accessed_at),
    quoteOriginal: excerpt.text,
    quoteLabel: excerpt.label,
    translationZh: clean(r.translation_zh),
    claimLabel: tier === "candidate" ? "候选资料记载（待核验）" : (CLAIM_LABELS[r.record_type] ?? "来源记载"),
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
    tier,
    tierLabel: EVIDENCE_TIER_LABELS[tier],
    dbStatus: r.status === "verified" ? "verified" : "candidate",
    bulkMarked: isBulkMarked(r.id),
  };
}
