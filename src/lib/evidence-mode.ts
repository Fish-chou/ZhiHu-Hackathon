export const EVIDENCE_MODES = ["demo", "verified_only"] as const;
export type EvidenceMode = (typeof EVIDENCE_MODES)[number];

export const EVIDENCE_MODE_LABELS: Record<EvidenceMode, string> = {
  demo: "演示模式",
  verified_only: "正式核验模式",
};

export const EVIDENCE_MODE_HINTS: Record<EvidenceMode, string> = {
  demo: "同时使用已核验来源和候选资料（待核验），两者分开标注；只有候选资料支持的判断一律降为待人工复核",
  verified_only: "只使用已核验来源，候选资料和已排除记录不参与审查",
};

/** Unset or unknown values fall back to verified_only, the stricter mode. */
export function getEvidenceMode(env: Record<string, string | undefined> = process.env): EvidenceMode {
  return env.EVIDENCE_MODE?.trim().toLowerCase() === "demo" ? "demo" : "verified_only";
}
