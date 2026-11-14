import type { ScoredEvidence } from "@/lib/evidence-search";
import { MARKET, type EvidenceRecord } from "@/lib/types";
import type { SignalExtraction } from "./lexicon";
import { ModelFindingSchema, ModelOutputSchema } from "./schema";
import { locate } from "./text";
import {
  DISCLAIMER,
  NO_EVIDENCE_SUMMARY,
  type AuditFinding,
  type AuditResult,
  type FindingCategory,
  type Level,
} from "./types";

const BANNED: [RegExp, string][] = [
  [/一定违规|必然违规|肯定违规|绝对违规/g, "可能存在违规风险"],
  [/当地人都认为|越南人都认为|越南消费者普遍认为|越南消费者都认为/g, "部分来源提到"],
  [/必然导致抵制|一定会被抵制|必然引发抵制|一定会引发抵制/g, "可能引发负面反应"],
  [/一定会下架|必然下架|肯定会下架|一定会被下架/g, "存在被下架的可能"],
  [/违法/g, "可能涉及合规风险"],
];

export function sanitize(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [re, replacement] of BANNED) {
    out = out.replace(re, () => {
      count++;
      return replacement;
    });
  }
  return { text: out, count };
}

const HUMAN_REVIEW_CATEGORIES: FindingCategory[] = ["geopolitical", "cultural"];
const HUMAN_REVIEW_RECORD_TYPES = ["official_rule", "platform_rule", "risk_rule"];
const HUMAN_REVIEW_TEXT = /地图|领土|主权|边界|国界|地名|岛|国旗|国徽|国歌|领导人|宗教|信仰|民族|种族|政治|法律|法规|法令|议定|法条/;

const LEVEL_RANK: Record<Level, number> = { low: 0, needs_review: 1, medium: 2, high: 3 };

export function overallLevel(findings: AuditFinding[]): Level {
  return findings.reduce<Level>((acc, f) => (LEVEL_RANK[f.severity] > LEVEL_RANK[acc] ? f.severity : acc), "low");
}

const NO_RISK_WITH_EVIDENCE = "已检索到相关证据，但没有发现能由证据支持的风险。当前证据不足以判定风险，建议进行人工确认。";
const MAX_FINDINGS = 12;

export interface PostprocessContext {
  text: string;
  /** Evidence actually sent to the model. Only these ids may be cited. */
  evidence: Map<string, EvidenceRecord>;
}

export type PostprocessOutcome =
  | {
      ok: true;
      result: AuditResult;
      citedIds: string[];
      removed: { invalidEvidenceIds: string[]; droppedFindings: number; sanitizedPhrases: number };
    }
  | { ok: false; reason: "invalid_schema" };

export function postprocessModelOutput(raw: unknown, ctx: PostprocessContext): PostprocessOutcome {
  const top = ModelOutputSchema.safeParse(raw);
  if (!top.success) return { ok: false, reason: "invalid_schema" };

  const invalidIds = new Set<string>();
  let dropped = 0;
  let sanitized = 0;
  const clean = (s: string) => {
    const r = sanitize(s.trim());
    sanitized += r.count;
    return r.text;
  };

  const findings: AuditFinding[] = [];
  for (const item of top.data.findings) {
    const parsed = ModelFindingSchema.safeParse(item);
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const f = parsed.data;
    const ids = [...new Set(f.evidence_ids)].filter((id) => {
      const r = ctx.evidence.get(id);
      const ok = !!r && r.status === "verified" && r.market === MARKET;
      if (!ok) invalidIds.add(id);
      return ok;
    });
    if (ids.length === 0) {
      dropped++;
      continue;
    }
    const loc = locate(ctx.text, f.location);
    const cited = ids.map((id) => ctx.evidence.get(id)!);
    const mustReview =
      HUMAN_REVIEW_CATEGORIES.includes(f.risk_category) ||
      cited.some((r) => HUMAN_REVIEW_RECORD_TYPES.includes(r.record_type)) ||
      HUMAN_REVIEW_TEXT.test(`${f.reason}${f.recommendation}${loc.text}`);
    findings.push({
      id: "",
      location: loc.text,
      location_match: loc.match,
      risk_category: f.risk_category,
      severity: f.severity,
      reason: clean(f.reason),
      evidence_ids: ids,
      recommendation: clean(f.recommendation),
      requires_human_review: f.requires_human_review || mustReview,
      source: "model",
    });
    if (findings.length >= MAX_FINDINGS) break;
  }
  findings.forEach((f, i) => (f.id = `finding_${String(i + 1).padStart(3, "0")}`));

  const modelSummary = clean(top.data.summary);
  const summary =
    findings.length === 0
      ? ctx.evidence.size > 0
        ? NO_RISK_WITH_EVIDENCE
        : NO_EVIDENCE_SUMMARY
      : modelSummary || `发现 ${findings.length} 处潜在风险，详见下方。`;

  return {
    ok: true,
    result: {
      overall_level: overallLevel(findings),
      summary,
      findings,
      missing_evidence: top.data.missing_evidence.slice(0, 8).map((m) => clean(m).slice(0, 300)).filter(Boolean),
      disclaimer: DISCLAIMER,
    },
    citedIds: [...new Set(findings.flatMap((f) => f.evidence_ids))],
    removed: { invalidEvidenceIds: [...invalidIds], droppedFindings: dropped, sanitizedPhrases: sanitized },
  };
}

/** Lists matched signal groups that found no evidence, so the user sees what could not be checked. */
export function missingEvidenceFor(ext: SignalExtraction, retrieved: ScoredEvidence[]): string[] {
  return ext.groups
    .filter((g) => !retrieved.some((s) => s.matchedKeywords.some((k) => g.keywords.includes(k))))
    .map((g) => `「${g.label}」相关表述：证据库中没有找到可核验依据，无法判断。`);
}

/**
 * Deterministic result used when the model is unavailable: signal hits plus the evidence they matched.
 * Hits are merged per sentence and category; context-only groups never produce a finding on their own.
 */
export function buildRulesOnlyResult(ext: SignalExtraction, retrieved: ScoredEvidence[]): { result: AuditResult; citedIds: string[] } {
  const merged = new Map<string, { sentence: string; category: FindingCategory; labels: Set<string>; terms: Set<string>; ids: string[]; hints: Set<string> }>();
  const strongSentences = new Set(
    ext.signals.filter((s) => !ext.groups.find((g) => g.id === s.id)?.contextOnly).map((s) => s.sentence),
  );

  for (const g of ext.groups) {
    const ids = retrieved
      .filter((s) => s.matchedKeywords.some((k) => g.keywords.includes(k)))
      .slice(0, 3)
      .map((s) => s.record.id);
    if (ids.length === 0) continue;
    for (const s of ext.signals.filter((x) => x.id === g.id)) {
      if (g.contextOnly && !strongSentences.has(s.sentence)) continue;
      const key = `${s.sentence}\u0000${g.category}`;
      const m = merged.get(key) ?? { sentence: s.sentence, category: g.category, labels: new Set(), terms: new Set(), ids: [], hints: new Set() };
      if (!g.contextOnly) {
        m.labels.add(g.label);
        m.hints.add(g.reviewHint);
      }
      m.terms.add(s.term);
      for (const id of ids) if (!m.ids.includes(id)) m.ids.push(id);
      merged.set(key, m);
    }
  }

  const findings: AuditFinding[] = [...merged.values()]
    .filter((m) => m.labels.size > 0)
    .map((m, i) => {
      const ids = m.ids.slice(0, 4);
      return {
        id: `finding_${String(i + 1).padStart(3, "0")}`,
        location: m.sentence,
        location_match: "exact" as const,
        risk_category: m.category,
        severity: "needs_review" as const,
        reason: `命中风险信号${[...m.labels].map((l) => `「${l}」`).join("")}（触发词：${[...m.terms].join("、")}）。证据库中有 ${ids.length} 条相关的已核验证据，但模型暂不可用，系统没有生成进一步解释，请对照证据人工判断。`,
        evidence_ids: ids,
        recommendation: [...m.hints].join(" "),
        requires_human_review: true,
        source: "rules" as const,
      };
    });
  return {
    result: {
      overall_level: findings.length ? "needs_review" : "low",
      summary: findings.length
        ? `模型暂不可用，以下为规则匹配结果：共 ${findings.length} 处表述命中风险信号，均需人工复核。`
        : NO_EVIDENCE_SUMMARY,
      findings,
      missing_evidence: missingEvidenceFor(ext, retrieved),
      disclaimer: DISCLAIMER,
    },
    citedIds: [...new Set(findings.flatMap((f) => f.evidence_ids))],
  };
}
