import demoCasesJson from "@/data/demo/demo-cases.json";
import demoResultsJson from "@/data/demo/demo-results.json";
import type { AuditResponse, ContentType, Level } from "./types";

export interface DemoCase {
  id: string;
  title: string;
  expectedLevel: Level;
  contentType: ContentType;
  summary: string;
  label: string;
  text: string;
}

/** A pre-generated live result for a demo case, written by scripts/generate-demo-cache.mjs. */
export interface CachedDemoEntry {
  demoId: string;
  generatedAt: string;
  contentType: ContentType;
  text: string;
  evidenceIds: string[];
  evidenceSource: string;
  model: string | null;
  response: AuditResponse;
}

export const DEMO_CASES = demoCasesJson as DemoCase[];
const DEMO_RESULTS = demoResultsJson as Record<string, CachedDemoEntry>;

const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();

export function findDemoCase(contentType: ContentType, text: string, demoId?: string): DemoCase | null {
  const t = norm(text);
  const candidates = demoId ? DEMO_CASES.filter((d) => d.id === demoId) : DEMO_CASES;
  return candidates.find((d) => d.contentType === contentType && norm(d.text) === t) ?? null;
}

export function findDemoCache(contentType: ContentType, text: string, demoId?: string): CachedDemoEntry | null {
  const demo = findDemoCase(contentType, text, demoId);
  if (!demo) return null;
  const entry = DEMO_RESULTS[demo.id];
  return entry && norm(entry.text) === norm(demo.text) ? entry : null;
}

/**
 * Serves a cached result, clearly labelled. When a set of currently verified ids is given,
 * citations that are no longer verified are removed, and findings left without evidence are dropped.
 */
export function toCachedResponse(entry: CachedDemoEntry, reason: string, verifiedIds?: Set<string>): AuditResponse {
  const r = structuredClone(entry.response);
  if (verifiedIds) {
    r.result.findings = r.result.findings
      .map((f) => ({ ...f, evidence_ids: f.evidence_ids.filter((id) => verifiedIds.has(id)) }))
      .filter((f) => f.evidence_ids.length > 0);
    const cited = new Set(r.result.findings.flatMap((f) => f.evidence_ids));
    r.evidence = r.evidence.filter((c) => cited.has(c.id));
  }
  r.mode = "cached_demo";
  r.meta.cachedAt = entry.generatedAt;
  r.meta.demoId = entry.demoId;
  r.meta.notices = [`演示缓存结果：生成于 ${entry.generatedAt.slice(0, 16).replace("T", " ")}，不是本次实时生成。${reason}`];
  return r;
}
