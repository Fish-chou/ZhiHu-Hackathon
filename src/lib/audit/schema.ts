import { z } from "zod";
import { CONTENT_TYPES, FINDING_CATEGORIES, LEVELS, MAX_TEXT_LENGTH, type AuditErrorResponse, type ContentType } from "./types";

export const AuditRequestSchema = z.object({
  market: z.literal("Vietnam"),
  contentType: z.enum(CONTENT_TYPES),
  text: z.string(),
  assetName: z.string().max(200).optional(),
  demoMode: z.boolean().optional(),
  demoId: z.string().max(64).optional(),
});

export interface AuditRequest {
  market: "Vietnam";
  contentType: ContentType;
  text: string;
  assetName?: string;
  demoMode?: boolean;
  demoId?: string;
}

export function parseAuditRequest(body: unknown): { ok: true; value: AuditRequest } | AuditErrorResponse {
  const parsed = AuditRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_input", message: "请求参数无效：market 只能为 Vietnam，contentType 只能为广告、商品页或客服" } };
  }
  const text = parsed.data.text.replace(/\r\n?/g, "\n");
  if (text.trim().length === 0) {
    return { ok: false, error: { code: "empty", message: "请输入要审查的内容" } };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: { code: "too_long", message: `内容超过 ${MAX_TEXT_LENGTH} 字，请分段提交` } };
  }
  return { ok: true, value: { ...parsed.data, text } };
}

export const ModelFindingSchema = z.object({
  id: z.string().optional(),
  location: z.string().min(1),
  risk_category: z.enum(FINDING_CATEGORIES),
  severity: z.enum(LEVELS),
  reason: z.string().min(1),
  evidence_ids: z.array(z.string()),
  recommendation: z.string().min(1),
  requires_human_review: z.boolean(),
});

/** Top level is checked strictly; findings are validated one by one so one bad item does not void the rest. */
export const ModelOutputSchema = z.object({
  overall_level: z.enum(LEVELS),
  summary: z.string(),
  findings: z.array(z.unknown()),
  missing_evidence: z.array(z.string()).default([]),
  disclaimer: z.string().optional(),
});
