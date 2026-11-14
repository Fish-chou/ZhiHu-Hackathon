import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getSupabaseConfig, supabaseInsert } from "@/lib/supabase-server";
import type { AuditResponse } from "./types";

type Env = Record<string, string | undefined>;

/**
 * Best-effort record of one audit in analysis_runs / findings. The raw input is not stored:
 * only its SHA-256 and length, so pasted personal data never lands in the database.
 * Failures are logged and swallowed; they never affect the user's result.
 */
export async function logAnalysisRun(
  res: AuditResponse,
  opts: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const env = opts.env ?? process.env;
  if (env.AUDIT_LOG_DISABLED === "1" || res.mode === "cached_demo") return null;
  let config;
  try {
    config = getSupabaseConfig(env);
  } catch {
    return null;
  }
  if (!config) return null;

  const runId = `run_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const digest = createHash("sha256").update(res.input.text).digest("hex");
  try {
    await supabaseInsert(
      config,
      "analysis_runs",
      [
        {
          id: runId,
          asset_id: null,
          market: res.input.market,
          category: res.input.contentType,
          input_text: `sha256:${digest}; chars=${res.input.text.length}`,
          model_name: res.meta.model,
          prompt_version: res.meta.promptVersion,
          status: `${res.mode}:${res.result.overall_level}`,
        },
      ],
      { fetchImpl: opts.fetchImpl, timeoutMs: 5000 },
    );
    if (res.result.findings.length) {
      await supabaseInsert(
        config,
        "findings",
        res.result.findings.map((f, i) => ({
          id: `${runId}_f${i + 1}`,
          analysis_id: runId,
          risk_category: f.risk_category,
          severity: f.severity,
          finding_title: `${f.risk_category}/${f.severity}`,
          finding_explanation: f.reason,
          evidence_ids: f.evidence_ids.join(","),
          recommendation: f.recommendation,
          requires_human_review: f.requires_human_review,
        })),
        { fetchImpl: opts.fetchImpl, timeoutMs: 5000 },
      );
    }
    return runId;
  } catch (err) {
    console.warn("[audit-log] could not record analysis run:", err instanceof Error ? err.message : err);
    return null;
  }
}
