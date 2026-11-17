import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import bulkVerified from "@/data/bulk-verified.json";
import demoResultsJson from "@/data/demo/demo-results.json";
import snapshotJson from "@/data/evidence-snapshot.json";
import { isValidAuditResponse } from "@/lib/audit/client";
import { DEMO_CASES } from "@/lib/audit/demo-cache";
import { handleAuditPost } from "@/lib/audit/handler";
import { parseModelJson, type ChatMessage, type ModelCallResult } from "@/lib/audit/model";
import type { AuditDeps } from "@/lib/audit/run-audit";
import type { AuditResponse } from "@/lib/audit/types";
import { isUsableEvidence, toEvidenceCard } from "@/lib/evidence-card";
import { getEvidenceMode, type EvidenceMode } from "@/lib/evidence-mode";
import { loadEvidencePool, rankEvidence, searchEvidence } from "@/lib/evidence-search";
import type { EvidenceRecord } from "@/lib/types";

const snapshot = (snapshotJson as unknown as { records: EvidenceRecord[] }).records;
const BULK = new Set((bulkVerified as { ids: string[] }).ids);
/** Rows checked record by record. Bulk-marked rows are left out so the candidate slots go to the fixtures below. */
const individuallyVerified = snapshot.filter((r) => !BULK.has(r.id));
const ENV = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const SKINCARE = DEMO_CASES.find((d) => d.id === "skincare-ad")!;

// Test-only fixtures shaped like the spreadsheet-converted candidates in the database. Not product data.
const candidateSkin: EvidenceRecord = {
  ...snapshot.find((r) => r.id === "risk_008")!,
  id: "test_candidate_skin",
  status: "candidate",
  title: "TEST 候选：绝对化用语 best / 最好",
  source_title: "同上",
  source_url: null,
  quote_original: "—",
  original_text: "序号=1 | 中文禁用表述=最好 / best | 风险等级=高 | 法律或平台依据=同上",
  claim: "原始表格将“最好 / best”标为高风险。",
  confidence: "low",
};
const rejectedRow: EvidenceRecord = { ...candidateSkin, id: "test_rejected_skin", status: "rejected" };

const pageOf = (rows: EvidenceRecord[]) =>
  vi.fn(async () => new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } }));
const urlOf = (fn: ReturnType<typeof vi.fn>, i = 0) => decodeURIComponent(String((fn.mock.calls[i] as unknown[])[0]));

function deps(mode: EvidenceMode, rows: EvidenceRecord[], output: unknown, seen: ChatMessage[][] = []): AuditDeps {
  return {
    evidenceMode: mode,
    search: (p) => searchEvidence(p, { env: ENV, fetchImpl: pageOf(rows) as unknown as typeof fetch, noCache: true }),
    callModel: vi.fn(async (messages: ChatMessage[]): Promise<ModelCallResult> => {
      seen.push(messages);
      return { ok: true, content: JSON.stringify(output), model: "fake-model" };
    }),
    parseModelJson,
    findDemoCache: () => null,
    allowedEvidenceIds: () => new Set(),
    now: () => Date.parse("2026-11-17T12:00:00Z"),
  };
}

async function audit(d: AuditDeps): Promise<AuditResponse> {
  const req = new Request("http://localhost/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ market: "Vietnam", contentType: SKINCARE.contentType, text: SKINCARE.text }),
  });
  const { response } = await handleAuditPost(req, d, () => true);
  return (await response.json()) as AuditResponse;
}

const finding = (evidenceIds: string[], severity: string, reason = "该规则文本规定不得使用最高级用语。") => ({
  location: "我们卖得最好的美白精华",
  risk_category: "language",
  severity,
  reason,
  evidence_ids: evidenceIds,
  recommendation: "改为可以用证明文件支撑的具体参数。",
  requires_human_review: false,
});
const output = (...findings: unknown[]) => ({ overall_level: "high", summary: "存在潜在风险。", findings, missing_evidence: [] });

describe("EVIDENCE_MODE", () => {
  it("只认 demo；未设置或拼错时用更严格的 verified_only", () => {
    expect(getEvidenceMode({ EVIDENCE_MODE: "demo" })).toBe("demo");
    expect(getEvidenceMode({ EVIDENCE_MODE: " Demo " })).toBe("demo");
    expect(getEvidenceMode({ EVIDENCE_MODE: "verified_only" })).toBe("verified_only");
    expect(getEvidenceMode({})).toBe("verified_only");
    expect(getEvidenceMode({ EVIDENCE_MODE: "demmo" })).toBe("verified_only");
  });
});

describe("demo 模式能读取 candidate", () => {
  it("查询 verified 和 candidate，不查询 rejected；接口多返回的 rejected 也会被丢掉", async () => {
    const fetchImpl = pageOf([...individuallyVerified.slice(0, 3), candidateSkin, rejectedRow]);
    const pool = await loadEvidencePool({ env: { ...ENV, EVIDENCE_MODE: "demo" }, fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true });
    expect(urlOf(fetchImpl)).toContain("status=in.(verified,candidate)");
    expect(urlOf(fetchImpl)).not.toContain("rejected");
    expect(pool.ok && pool.mode).toBe("demo");
    const ids = pool.ok ? pool.records.map((r) => r.id) : [];
    expect(ids).toContain("test_candidate_skin");
    expect(ids).not.toContain("test_rejected_skin");
  });

  it("超过 1000 条时分页读取", async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...candidateSkin, id: `test_candidate_${i}` }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(many)))
      .mockResolvedValueOnce(new Response(JSON.stringify([candidateSkin])));
    const pool = await loadEvidencePool({ env: ENV, mode: "demo", fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchImpl, 1)).toContain("offset=1000");
    expect(pool.ok && pool.records.length).toBe(1001);
  });

  it("候选资料显示为“候选资料/待核验”，没有链接时如实为空，原文为占位符时改用原始资料行", () => {
    const card = toEvidenceCard(candidateSkin, "demo");
    expect(card).toMatchObject({ tier: "candidate", tierLabel: "候选资料/待核验", dbStatus: "candidate", sourceUrl: null, sourceTitle: null });
    expect(card.quoteLabel).toBe("原始资料行");
    expect(card.claimLabel).toBe("候选资料记载（待核验）");
  });

  it("模型上下文中候选资料带“候选资料/待核验”等级", async () => {
    const seen: ChatMessage[][] = [];
    await audit(deps("demo", [...individuallyVerified, candidateSkin], output(finding(["risk_008"], "medium")), seen));
    const user = seen[0].find((m) => m.role === "user")!.content;
    expect(user).toContain("test_candidate_skin");
    expect(user).toContain('"证据等级": "候选资料/待核验"');
    expect(user).toContain('"证据等级": "已核验来源"');
  });
});

describe("verified_only 模式不能读取 candidate", () => {
  it("只查询 status=verified；接口返回的 candidate、rejected 和批量标记记录都被丢掉", async () => {
    const bulkRow = snapshot.find((r) => BULK.has(r.id))!;
    const fetchImpl = pageOf([...individuallyVerified.slice(0, 3), bulkRow, candidateSkin, rejectedRow]);
    const pool = await loadEvidencePool({ env: ENV, mode: "verified_only", fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true });
    expect(urlOf(fetchImpl)).toContain("status=eq.verified");
    expect(urlOf(fetchImpl)).not.toContain("candidate");
    const ids = pool.ok ? pool.records.map((r) => r.id) : [];
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(bulkRow.id);
    expect(pool.ok && pool.excludedBulkMarked).toBe(1);
  });

  it("检索和证据卡片都拒绝候选资料", () => {
    const ranked = rankEvidence([...individuallyVerified, candidateSkin], { mode: "verified_only", keywords: ["best", "最好"] });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((s) => s.tier === "verified")).toBe(true);
    expect(isUsableEvidence(candidateSkin, "verified_only")).toBe(false);
    expect(() => toEvidenceCard(candidateSkin, "verified_only")).toThrow();
  });

  it("candidate 不进入模型上下文，模型引用 candidate 也会被移除，不出现在证据卡片中", async () => {
    const seen: ChatMessage[][] = [];
    const res = await audit(
      deps("verified_only", [...individuallyVerified, candidateSkin, rejectedRow], output(finding(["test_candidate_skin"], "high")), seen),
    );
    const context = JSON.stringify(seen);
    expect(context).not.toContain("test_candidate_skin");
    expect(context).not.toContain("test_rejected_skin");
    const user = seen[0].find((m) => m.role === "user")!.content;
    expect(user).toContain('"证据等级": "已核验来源"');
    expect(user).not.toContain('"证据等级": "候选资料/待核验"');
    expect(res.meta.evidenceMode).toBe("verified_only");
    expect(res.meta.removed.invalidEvidenceIds).toEqual(["test_candidate_skin"]);
    expect(res.result.findings).toEqual([]);
    expect(res.evidence.every((c) => c.tier === "verified")).toBe(true);
  });

  it("前端校验：非 demo 结果里出现候选资料卡片时拒绝渲染", async () => {
    const res = await audit(deps("demo", [...individuallyVerified, candidateSkin], output(finding(["test_candidate_skin"], "high"))));
    expect(res.evidence.some((c) => c.tier === "candidate")).toBe(true);
    expect(isValidAuditResponse(res)).toBe(true);
    expect(isValidAuditResponse({ ...res, meta: { ...res.meta, evidenceMode: "verified_only" } })).toBe(false);
  });
});

describe("只有 candidate 的风险判断降级为 needs_review", () => {
  it("severity 强制为 needs_review，必须人工复核，确定性结论被改写", async () => {
    const reason = "这属于违法内容，一定违规，越南消费者普遍认为不可接受，消费者普遍认为这是虚假宣传，已构成违规，一定会被处罚。";
    const res = await audit(deps("demo", [...individuallyVerified, candidateSkin], output(finding(["test_candidate_skin"], "high", reason))));
    expect(res.mode).toBe("live");
    const f = res.result.findings[0];
    expect(f.severity).toBe("needs_review");
    expect(f.requires_human_review).toBe(true);
    expect(f.evidence_basis).toBe("candidate_only");
    expect(res.result.overall_level).toBe("needs_review");
    for (const banned of ["违法", "一定违规", "消费者普遍认为", "构成违规", "一定会"]) expect(f.reason).not.toContain(banned);
    expect(res.meta.removed.downgradedFindings).toBe(1);
    expect(res.meta.notices.join()).toContain("已统一降为“待人工复核”");
    expect(res.evidence.map((c) => [c.id, c.tierLabel])).toEqual([["test_candidate_skin", "候选资料/待核验"]]);
  });

  it("同时引用已核验来源的判断保留原等级，但候选资料仍不能支撑确定性结论", async () => {
    const res = await audit(
      deps("demo", [...individuallyVerified, candidateSkin], output(finding(["risk_008", "test_candidate_skin"], "medium", "消费者普遍认为这是夸大宣传。"))),
    );
    const f = res.result.findings[0];
    expect(f.severity).toBe("medium");
    expect(f.evidence_basis).toBe("mixed");
    expect(f.reason).not.toContain("消费者普遍认为");
  });
});

describe("verified 证据仍能正常显示", () => {
  for (const mode of ["demo", "verified_only"] as const) {
    it(`${mode}：已核验来源保持原等级，卡片标注“已核验来源”并带原文链接`, async () => {
      const res = await audit(deps(mode, [...individuallyVerified, candidateSkin], output(finding(["risk_008"], "medium"))));
      const f = res.result.findings[0];
      expect(f.severity).toBe("medium");
      expect(f.evidence_basis).toBe("verified");
      const card = res.evidence.find((c) => c.id === "risk_008")!;
      expect(card).toMatchObject({ tier: "verified", tierLabel: "已核验来源", dbStatus: "verified", bulkMarked: false, quoteLabel: "原文短引" });
      expect(card.sourceUrl).toMatch(/^https:\/\//);
      expect(isValidAuditResponse(res)).toBe(true);
    });
  }
});

describe("不通过修改 status 伪造核验", () => {
  it("应用代码只向 analysis_runs 和 findings 写入，从不写 evidence_records", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk(fileURLToPath(new URL("../src", import.meta.url)));
    const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const written = [...source.matchAll(/supabaseInsert\(\s*\w+,\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(written)).toEqual(new Set(["analysis_runs", "findings"]));
    expect(source).not.toMatch(/method:\s*"(PATCH|PUT|DELETE)"/);
  });

  it("演示缓存只引用逐条核验的证据，因此在两种模式下都可以安全展示", () => {
    const entries = Object.values(demoResultsJson as unknown as Record<string, { response: AuditResponse }>);
    expect(entries.length).toBe(3);
    for (const { response } of entries) {
      expect(response.meta.evidenceMode ?? "verified_only").toBe("verified_only");
      const cited = response.result.findings.flatMap((f) => f.evidence_ids);
      expect(cited.every((id) => !BULK.has(id) && individuallyVerified.some((r) => r.id === id))).toBe(true);
    }
  });
});