import { describe, expect, it, vi } from "vitest";
import bulkVerified from "@/data/bulk-verified.json";
import snapshotJson from "@/data/evidence-snapshot.json";
import { isUsableEvidence, toEvidenceCard } from "@/lib/evidence-card";
import { loadEvidencePool, rankEvidence, searchEvidence } from "@/lib/evidence-search";
import type { EvidenceRecord } from "@/lib/types";

const snapshot = snapshotJson as unknown as { records: EvidenceRecord[] };
const verified = snapshot.records;
const ENV = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };

// Test-only fixture: a candidate row that must never surface. Not product data.
const candidateFixture: EvidenceRecord = {
  ...verified.find((r) => r.id === "incident_013")!,
  id: "test_candidate_001",
  status: "candidate",
  title: "TEST candidate row mentioning Xisha 地图",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("loadEvidencePool (default verified_only)", () => {
  it("uses the offline verified snapshot when Supabase env vars are missing", async () => {
    const pool = await loadEvidencePool({ env: {}, noCache: true });
    expect(pool.ok).toBe(true);
    if (!pool.ok) return;
    expect(pool.source).toBe("offline_snapshot");
    expect(pool.snapshotDate).toBeTruthy();
    expect(pool.mode).toBe("verified_only");
    const bulk = new Set((bulkVerified as { ids: string[] }).ids);
    expect(pool.records.length).toBe(verified.filter((r) => !bulk.has(r.id)).length);
    expect(pool.records.every((r) => r.status === "verified" && r.market === "Vietnam" && !bulk.has(r.id))).toBe(true);
  });

  it("queries with market=Vietnam and status=verified and drops anything else the API returns", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([...verified.slice(0, 3), candidateFixture]));
    const pool = await loadEvidencePool({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true });
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("market=eq.Vietnam");
    expect(url).toContain("status=eq.verified");
    expect(pool.ok && pool.source).toBe("supabase");
    expect(pool.ok && pool.records.map((r) => r.id)).not.toContain("test_candidate_001");
  });

  it("returns a safe error (no data) when Supabase is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const pool = await loadEvidencePool({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true });
    expect(pool).toEqual({ ok: false, error: { code: "db_unavailable", message: "证据库暂时无法连接" } });
  });

  it("returns db_error on HTTP errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "boom" }, 500));
    const pool = await loadEvidencePool({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch, noCache: true });
    expect(pool.ok).toBe(false);
    expect(!pool.ok && pool.error.code).toBe("db_error");
  });

  it("falls back to the labelled snapshot only when asked to", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const pool = await loadEvidencePool({
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      noCache: true,
      fallbackToSnapshot: true,
    });
    expect(pool.ok && pool.source).toBe("offline_snapshot");
    expect(pool.ok && pool.fallbackReason).toBe("db_unavailable");
  });

  it("refuses secret keys", async () => {
    const pool = await loadEvidencePool({
      env: { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" },
      noCache: true,
    });
    expect(!pool.ok && pool.error.code).toBe("config_invalid");
  });
});

describe("rankEvidence", () => {
  it("finds the Yadea map incident for disputed island names, diacritic-insensitively", () => {
    const res = rankEvidence(verified, { keywords: ["Xisha", "Hoang Sa"] });
    expect(res.map((r) => r.record.id)).toContain("incident_013");
  });

  it("never returns more than 20 results", () => {
    const res = rankEvidence(verified, { keywords: ["越南", "广告", "地图", "法", "Vietnam", "the"], limit: 100 });
    expect(res.length).toBeLessThanOrEqual(20);
  });

  it("dedupes rows that share the same source URL and quote", () => {
    const ids = rankEvidence(verified, { keywords: ["国旗"] }).map((r) => r.record.id);
    expect(ids.filter((id) => id === "risk_001" || id === "risk_002")).toHaveLength(1);
  });

  it("excludes verified rows with an empty claim and never returns candidates", () => {
    const ids = rankEvidence([...verified, candidateFixture], { keywords: ["汉服", "Xisha"] }).map((r) => r.record.id);
    expect(ids).not.toContain("zhihu_087");
    expect(ids).not.toContain("test_candidate_001");
  });

  it("applies record type and risk category filters", () => {
    const res = rankEvidence(verified, { keywords: ["地图"], recordTypes: ["risk_rule"], riskCategory: "geopolitical" });
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((r) => r.record.record_type === "risk_rule" && r.record.risk_category === "geopolitical")).toBe(true);
  });

  it("returns nothing for unrelated text", () => {
    expect(rankEvidence(verified, { keywords: ["保温杯", "不锈钢内胆"] })).toEqual([]);
  });
});

describe("searchEvidence", () => {
  it("rejects markets other than Vietnam", async () => {
    const res = await searchEvidence({ market: "Indonesia", keywords: ["地图"] }, { env: {} });
    expect(!res.ok && res.error.code).toBe("unsupported_market");
  });
});

describe("toEvidenceCard", () => {
  it("labels zhihu claims as author statements and strips analyst prefixes", () => {
    const card = toEvidenceCard(verified.find((r) => r.id === "zhihu_047")!, "verified_only");
    expect(card.claimLabel).toBe("知乎作者称");
    const inc = toEvidenceCard(verified.find((r) => r.id === "incident_013")!, "verified_only");
    expect(inc.analysis.riskSignal?.startsWith("analyst_inference")).toBe(false);
  });

  it("refuses to build a card from a non-verified row", () => {
    expect(isUsableEvidence(candidateFixture, "verified_only")).toBe(false);
    expect(() => toEvidenceCard(candidateFixture, "verified_only")).toThrow();
  });

  it("treats records that were bulk-switched to verified as candidates", () => {
    const bulkId = (bulkVerified as { ids: string[] }).ids.find((id) => verified.some((r) => r.id === id && isUsableEvidence(r, "demo")))!;
    const bulkRow = verified.find((r) => r.id === bulkId)!;
    expect(bulkRow.status).toBe("verified");
    expect(isUsableEvidence(bulkRow, "verified_only")).toBe(false);
    const card = toEvidenceCard(bulkRow, "demo");
    expect(card).toMatchObject({ tier: "candidate", tierLabel: "候选资料/待核验", dbStatus: "verified", bulkMarked: true });
    expect(toEvidenceCard(verified.find((r) => r.id === "incident_013")!, "verified_only")).toMatchObject({ tier: "verified", bulkMarked: false });
  });
});
