export const MARKET = "Vietnam" as const;
export type Market = typeof MARKET;

export const RECORD_TYPE_LABELS: Record<string, string> = {
  incident: "真实案例",
  official_rule: "官方规则",
  platform_rule: "平台规则",
  risk_rule: "风险信号",
  zhihu: "知乎内容",
  marketplace: "电商样本",
  user_feedback: "用户反馈",
  market_insight: "市场资料",
};

export const RISK_CATEGORY_LABELS: Record<string, string> = {
  geopolitical: "地缘政治",
  cultural: "文化",
  language: "语言",
  platform: "平台",
  product: "产品表达",
  aftersale: "售后",
  logistics: "物流",
  compliance: "合规",
  market: "市场",
  other: "其他",
};

/**
 * verified: status=verified and checked record by record.
 * candidate: status=candidate, or switched to verified in bulk without a per-record source check.
 */
export type EvidenceTier = "verified" | "candidate";

export const EVIDENCE_TIER_LABELS: Record<EvidenceTier, string> = {
  verified: "已核验来源",
  candidate: "候选资料/待核验",
};

/** One row of the Supabase `evidence_records` table. Every column is nullable text in the database. */
export interface EvidenceRecord {
  id: string;
  record_type: string;
  market: string;
  category: string | null;
  title: string | null;
  source_type: string | null;
  source_title: string | null;
  source_url: string | null;
  source_published_at: string | null;
  accessed_at: string | null;
  source_group: string | null;
  original_text: string | null;
  quote_original: string | null;
  translation_zh: string | null;
  claim: string | null;
  consequence: string | null;
  risk_category: string | null;
  risk_signal: string | null;
  recommended_action: string | null;
  brand_or_product: string | null;
  content_type: string | null;
  platform: string | null;
  author_name: string | null;
  question_url: string | null;
  answer_url: string | null;
  price: string | null;
  rating: string | null;
  review_text: string | null;
  pattern: string | null;
  pattern_type: string | null;
  confidence: string | null;
  status: string;
  notes: string | null;
  created_at?: string | null;
}

/** Where the evidence pool came from for a given request. */
export type EvidenceSource = "supabase" | "offline_snapshot";

/** Display-ready evidence for the source card. Built only from records the current evidence mode allows. */
export interface EvidenceCard {
  id: string;
  recordType: string;
  recordTypeLabel: string;
  title: string;
  sourceTitle: string | null;
  sourceType: string | null;
  /** Candidates may come without a source link. */
  sourceUrl: string | null;
  publishedAt: string | null;
  accessedAt: string | null;
  quoteOriginal: string;
  /** 原文短引, or 原始资料行 when a candidate has no usable quote and its raw data row is shown instead. */
  quoteLabel: string;
  translationZh: string | null;
  /** How the claim must be framed, e.g. 来源记载 / 该规则文本规定 / 知乎作者称. */
  claimLabel: string;
  claim: string;
  consequence: string | null;
  /** Data-side analysis fields. Always shown as 分析建议（非来源事实）. */
  analysis: { riskSignal: string | null; recommendedAction: string | null };
  notes: string | null;
  authorName: string | null;
  riskCategory: string | null;
  riskCategoryLabel: string | null;
  confidence: string | null;
  lowConfidence: boolean;
  tier: EvidenceTier;
  tierLabel: string;
  /** The status stored in the database, shown as-is. It is never changed by this app. */
  dbStatus: "verified" | "candidate";
  /** Stored as verified, but switched from candidate in bulk without a per-record source check; treated as a candidate. */
  bulkMarked: boolean;
}
