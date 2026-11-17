import { describe, expect, it, vi } from "vitest";
import snapshotJson from "@/data/evidence-snapshot.json";
import { DEMO_CASES, type CachedDemoEntry } from "@/lib/audit/demo-cache";
import { handleAuditPost } from "@/lib/audit/handler";
import { callModel, parseModelJson, type ModelCallResult } from "@/lib/audit/model";
import { createRateLimiter } from "@/lib/audit/rate-limit";
import type { AuditDeps } from "@/lib/audit/run-audit";
import type { AuditErrorResponse, AuditResponse } from "@/lib/audit/types";
import { searchEvidence } from "@/lib/evidence-search";
import type { EvidenceRecord } from "@/lib/types";

const records = (snapshotJson as unknown as { records: EvidenceRecord[] }).records;
const verifiedIds = new Set(records.map((r) => r.id));
const DB_ENV = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };

const SKINCARE = DEMO_CASES.find((d) => d.id === "skincare-ad")!;
const MAP = DEMO_CASES.find((d) => d.id === "map-store-locator")!;

// Test-only fixture: a candidate row returned by a misbehaving API. Must never be cited or shown.
const candidateRow: EvidenceRecord = {
  ...records.find((r) => r.id === "risk_008")!,
  id: "test_candidate_001",
  status: "candidate",
  title: "TEST candidate 美白 医生 best 最高级",
};

const dbFetch = (rows: EvidenceRecord[]) =>
  vi.fn(async () => new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } }));

const modelReturning = (output: unknown): AuditDeps["callModel"] =>
  vi.fn(async (): Promise<ModelCallResult> => ({ ok: true, content: JSON.stringify(output), model: "fake-model" }));

function makeDeps(over: Partial<AuditDeps> = {}): AuditDeps {
  return {
    evidenceMode: "verified_only",
    search: (p) => searchEvidence(p, { env: DB_ENV, fetchImpl: dbFetch(records) as unknown as typeof fetch, noCache: true }),
    callModel: modelReturning({ overall_level: "low", summary: "无", findings: [], missing_evidence: [] }),
    parseModelJson,
    findDemoCache: () => null,
    allowedEvidenceIds: () => verifiedIds,
    now: () => Date.parse("2026-11-14T12:00:00Z"),
    ...over,
  };
}

async function post(body: unknown, deps: AuditDeps, allow: (k: string) => boolean = () => true) {
  const req = new Request("http://localhost/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const { response, toLog } = await handleAuditPost(req, deps, allow);
  return { status: response.status, json: (await response.json()) as AuditResponse | AuditErrorResponse, toLog };
}

const skincareOutput = {
  overall_level: "medium",
  summary: "广告中出现绝对化用语和医生背书，存在潜在风险。",
  findings: [
    {
      id: "finding_001",
      location: "我们卖得最好的美白精华",
      risk_category: "language",
      severity: "medium",
      reason: "该规则文本规定，无合法证明文件时不得使用最高级用语。",
      evidence_ids: ["risk_008"],
      recommendation: "改为可以用证明文件支撑的具体参数。",
      requires_human_review: false,
    },
    {
      id: "finding_002",
      location: "敏感肌也能放心用",
      risk_category: "product",
      severity: "medium",
      reason: "该规则文本规定化妆品广告不得使用医务人员的名义。",
      evidence_ids: ["rule_003"],
      recommendation: "删除医生背书。",
      requires_human_review: false,
    },
  ],
  missing_evidence: ["字号比例需要看设计稿"],
  disclaimer: "结果仅作发布前风险提示，不构成法律意见",
};

describe("POST /api/audit", () => {
  it("正常输入：返回实时结果，引用的证据都是 verified 且附带来源卡片", async () => {
    const { status, json, toLog } = await post(
      { market: "Vietnam", contentType: SKINCARE.contentType, text: SKINCARE.text },
      makeDeps({ callModel: modelReturning(skincareOutput) }),
    );
    expect(status).toBe(200);
    const res = json as AuditResponse;
    expect(res.mode).toBe("live");
    expect(res.meta.evidenceSource).toBe("supabase");
    expect(res.meta.model).toBe("fake-model");
    expect(res.result.overall_level).toBe("medium");
    expect(res.result.findings.map((f) => f.location_match)).toEqual(["exact", "exact"]);
    expect(res.evidence.map((c) => c.id).sort()).toEqual(["risk_008", "rule_003"]);
    expect(res.evidence.every((c) => c.tier === "verified" && c.tierLabel === "已核验来源")).toBe(true);
    // official/risk rules are legal sources, so human review is forced on
    expect(res.result.findings.every((f) => f.requires_human_review)).toBe(true);
    expect(res.result.disclaimer).toBe("结果仅作发布前风险提示，不构成法律意见");
    expect(toLog).not.toBeNull();
  });

  it("空输入：返回 400", async () => {
    const callModelSpy = vi.fn();
    const { status, json } = await post({ market: "Vietnam", contentType: "advertisement", text: "   \n " }, makeDeps({ callModel: callModelSpy }));
    expect(status).toBe(400);
    expect((json as AuditErrorResponse).error.code).toBe("empty");
    expect(callModelSpy).not.toHaveBeenCalled();
  });

  it("超长输入：超过 3000 字返回 400", async () => {
    const { status, json } = await post({ market: "Vietnam", contentType: "advertisement", text: "美".repeat(3001) }, makeDeps());
    expect(status).toBe(400);
    expect((json as AuditErrorResponse).error.code).toBe("too_long");
  });

  it("非法参数：市场、内容类型或请求体无效时返回 400", async () => {
    expect((await post({ market: "Indonesia", contentType: "advertisement", text: "x" }, makeDeps())).status).toBe(400);
    expect((await post({ market: "Vietnam", contentType: "poster", text: "x" }, makeDeps())).status).toBe(400);
    expect((await post("{not json", makeDeps())).status).toBe(400);
  });

  it("无匹配证据：不调用模型，明确提示未找到可核验依据", async () => {
    const callModelSpy = vi.fn();
    const { status, json } = await post(
      { market: "Vietnam", contentType: "product_page", text: "这款保温杯采用不锈钢内胆，容量 500ml。" },
      makeDeps({ callModel: callModelSpy }),
    );
    expect(status).toBe(200);
    const res = json as AuditResponse;
    expect(res.mode).toBe("no_evidence");
    expect(res.result.summary).toBe("未找到可核验依据，建议进行人工确认。");
    expect(res.result.findings).toEqual([]);
    expect(res.evidence).toEqual([]);
    expect(callModelSpy).not.toHaveBeenCalled();
  });

  it("非法 evidence_id：被移除，只剩无效引用的判断整条删除", async () => {
    const output = {
      ...skincareOutput,
      findings: [
        { ...skincareOutput.findings[0], evidence_ids: ["incident_999", "risk_008"] },
        { ...skincareOutput.findings[1], evidence_ids: ["made_up_1"] },
      ],
    };
    const res = (await post({ market: "Vietnam", contentType: SKINCARE.contentType, text: SKINCARE.text }, makeDeps({ callModel: modelReturning(output) })))
      .json as AuditResponse;
    expect(res.result.findings).toHaveLength(1);
    expect(res.result.findings[0].evidence_ids).toEqual(["risk_008"]);
    expect(res.meta.removed.invalidEvidenceIds.sort()).toEqual(["incident_999", "made_up_1"]);
    expect(res.meta.removed.droppedFindings).toBe(1);
    expect(res.meta.notices.join()).toContain("已自动移除");
  });

  it("模型返回非法 JSON：自定义输入降级为规则匹配结果并标注", async () => {
    const res = (await post(
      { market: "Vietnam", contentType: SKINCARE.contentType, text: SKINCARE.text },
      makeDeps({ callModel: vi.fn(async () => ({ ok: true as const, content: "抱歉，我无法输出 JSON", model: "fake" })) }),
    )).json as AuditResponse;
    expect(res.mode).toBe("rules_only");
    expect(res.result.overall_level).toBe("needs_review");
    expect(res.result.findings.length).toBeGreaterThan(0);
    expect(res.result.findings.every((f) => f.source === "rules" && f.requires_human_review)).toBe(true);
    expect(res.evidence.every((c) => verifiedIds.has(c.id))).toBe(true);
    expect(res.meta.notices.join()).toContain("不是有效 JSON");
  });

  it("模型返回结构错误：同样降级，不展示模型内容", async () => {
    const res = (await post(
      { market: "Vietnam", contentType: SKINCARE.contentType, text: SKINCARE.text },
      makeDeps({ callModel: modelReturning({ verdict: "违法" }) }),
    )).json as AuditResponse;
    expect(res.mode).toBe("rules_only");
    expect(JSON.stringify(res.result)).not.toContain("违法");
  });

  it("模型超时：降级为规则匹配结果并标注", async () => {
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const env = { LLM_BASE_URL: "https://llm.example.com/v1", LLM_API_KEY: "test", LLM_MODEL: "m" };
    const deps = makeDeps({ callModel: (m) => callModel(m, { env, fetchImpl: hanging as unknown as typeof fetch, timeoutMs: 50 }) });
    const res = (await post({ market: "Vietnam", contentType: MAP.contentType, text: MAP.text }, deps)).json as AuditResponse;
    expect(res.mode).toBe("rules_only");
    expect(res.meta.notices.join()).toContain("模型响应超时");
  });

  it("规则匹配结果按句子合并，只提到地图的句子不单独报风险", async () => {
    const notConfigured = vi.fn(async (): Promise<ModelCallResult> => ({ ok: false, kind: "not_configured" }));
    const res = (await post({ market: "Vietnam", contentType: MAP.contentType, text: MAP.text }, makeDeps({ callModel: notConfigured })))
      .json as AuditResponse;
    expect(res.mode).toBe("rules_only");
    const keys = res.result.findings.map((f) => `${f.location}|${f.risk_category}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(res.result.findings.some((f) => f.location.startsWith("全新上线"))).toBe(false);
    expect(res.result.findings.some((f) => f.location.includes("Xisha"))).toBe(true);
    expect(res.meta.notices.join()).toContain("未配置大模型");
  });

  it("售后话术：证据库没有售后类依据时，如实返回未找到可核验依据", async () => {
    const cs = DEMO_CASES.find((d) => d.id === "cs-shipping-reply")!;
    const callModelSpy = vi.fn();
    const res = (await post({ market: "Vietnam", contentType: cs.contentType, text: cs.text }, makeDeps({ callModel: callModelSpy })))
      .json as AuditResponse;
    expect(res.mode).toBe("no_evidence");
    expect(res.result.overall_level).toBe("low");
    expect(res.result.missing_evidence.join()).toContain("售后与退换承诺");
    expect(callModelSpy).not.toHaveBeenCalled();
  });

  it("模型失败且输入是演示案例：返回带标注的演示缓存结果", async () => {
    const live = (await post(
      { market: "Vietnam", contentType: SKINCARE.contentType, text: SKINCARE.text },
      makeDeps({ callModel: modelReturning(skincareOutput) }),
    )).json as AuditResponse;
    const entry: CachedDemoEntry = {
      demoId: SKINCARE.id,
      generatedAt: "2026-11-14T10:00:00.000Z",
      contentType: SKINCARE.contentType,
      text: SKINCARE.text,
      evidenceIds: ["risk_008", "rule_003"],
      evidenceSource: "supabase",
      model: "fake-model",
      response: live,
    };
    const callModelSpy = vi.fn(async (): Promise<ModelCallResult> => ({ ok: false, kind: "network" }));
    const res = (await post(
      { market: "Vietnam", contentType: SKINCARE.contentType, text: SKINCARE.text },
      makeDeps({ callModel: callModelSpy, findDemoCache: () => entry, allowedEvidenceIds: () => new Set(["risk_008"]) }),
    )).json as AuditResponse;
    expect(res.mode).toBe("cached_demo");
    expect(res.meta.notices[0]).toContain("演示缓存结果");
    // rule_003 is no longer in the verified set, so its finding and card are removed
    expect(res.evidence.map((c) => c.id)).toEqual(["risk_008"]);
    expect(res.result.findings).toHaveLength(1);

    const fast = (await post(
      { market: "Vietnam", contentType: SKINCARE.contentType, text: SKINCARE.text, demoMode: true },
      makeDeps({ callModel: callModelSpy, findDemoCache: () => entry }),
    )).json as AuditResponse;
    expect(fast.mode).toBe("cached_demo");
    expect(callModelSpy).toHaveBeenCalledTimes(1);
  });

  it("Supabase 不可用：改用离线证据快照并在结果中标注", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const deps = makeDeps({
      search: (p) => searchEvidence(p, { env: DB_ENV, fetchImpl: down as unknown as typeof fetch, noCache: true, fallbackToSnapshot: true }),
      callModel: modelReturning(skincareOutput),
    });
    const res = (await post({ market: "Vietnam", contentType: SKINCARE.contentType, text: SKINCARE.text }, deps)).json as AuditResponse;
    expect(res.mode).toBe("live");
    expect(res.meta.evidenceSource).toBe("offline_snapshot");
    expect(res.meta.fallbackReason).toBe("db_unavailable");
    expect(res.meta.notices.join()).toContain("证据库暂时不可用");
  });

  it("证据库完全不可用且不是演示案例：返回 503，不返回任何伪造结果", async () => {
    const deps = makeDeps({
      search: async () => ({ ok: false, error: { code: "db_unavailable", message: "证据库暂时无法连接" } }),
    });
    const { status, json } = await post({ market: "Vietnam", contentType: "advertisement", text: "全网销量第一" }, deps);
    expect(status).toBe(503);
    expect((json as AuditErrorResponse).error.code).toBe("evidence_unavailable");
  });

  it("candidate 数据不能被引用：接口返回的 candidate 行被过滤，模型引用后也会被移除", async () => {
    const output = { ...skincareOutput, findings: [{ ...skincareOutput.findings[0], evidence_ids: ["test_candidate_001"] }] };
    const deps = makeDeps({
      search: (p) =>
        searchEvidence(p, { env: DB_ENV, fetchImpl: dbFetch([...records, candidateRow]) as unknown as typeof fetch, noCache: true }),
      callModel: modelReturning(output),
    });
    const res = (await post({ market: "Vietnam", contentType: SKINCARE.contentType, text: SKINCARE.text }, deps)).json as AuditResponse;
    expect(res.meta.removed.invalidEvidenceIds).toEqual(["test_candidate_001"]);
    expect(res.result.findings).toEqual([]);
    expect(JSON.stringify(res.evidence)).not.toContain("test_candidate_001");
    expect(res.result.summary).toContain("当前证据不足以判定风险");
  });

  it("禁用表述会被替换，地缘政治类判断强制人工复核", async () => {
    const output = {
      overall_level: "high",
      summary: "该内容一定违规，越南消费者普遍认为不可接受。",
      findings: [
        {
          location: "海域及岛屿名称沿用服务商默认标注（Xisha、Nansha）",
          risk_category: "geopolitical",
          severity: "high",
          reason: "这属于违法内容，一定会下架。",
          evidence_ids: ["incident_013"],
          recommendation: "删除。",
          requires_human_review: false,
        },
      ],
      missing_evidence: [],
    };
    const res = (await post({ market: "Vietnam", contentType: MAP.contentType, text: MAP.text }, makeDeps({ callModel: modelReturning(output) })))
      .json as AuditResponse;
    const text = JSON.stringify(res.result);
    for (const banned of ["违法", "一定违规", "越南消费者普遍认为", "一定会下架"]) expect(text).not.toContain(banned);
    expect(res.meta.removed.sanitizedPhrases).toBeGreaterThanOrEqual(4);
    expect(res.result.findings[0].requires_human_review).toBe(true);
    expect(res.result.findings[0].location_match).toBe("exact");
  });

  it("频率限制：超出后返回 429", async () => {
    const allow = createRateLimiter(1, 60_000);
    const body = { market: "Vietnam", contentType: "product_page", text: "保温杯" };
    expect((await post(body, makeDeps(), allow)).status).toBe(200);
    expect((await post(body, makeDeps(), allow)).status).toBe(429);
  });
});

describe("callModel", () => {
  it("returns not_configured without env", async () => {
    expect(await callModel([{ role: "user", content: "x" }], { env: {} })).toEqual({ ok: false, kind: "not_configured" });
  });

  it("retries once without response_format when the provider rejects it", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return bodies.length === 1
        ? new Response("bad", { status: 400 })
        : new Response(JSON.stringify({ model: "m1", choices: [{ message: { content: "{}" } }] }), { status: 200 });
    });
    const env = { LLM_BASE_URL: "https://llm.example.com/v1/", LLM_API_KEY: "k", LLM_MODEL: "m1" };
    const res = await callModel([{ role: "user", content: "x" }], { env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ ok: true, content: "{}", model: "m1" });
    expect(bodies[0]).toContain("response_format");
    expect(bodies[1]).not.toContain("response_format");
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe("https://llm.example.com/v1/chat/completions");
  });

  it("parses JSON wrapped in code fences", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson("结果如下：{\"a\":2} 以上")).toEqual({ a: 2 });
    expect(parseModelJson("no json")).toBeNull();
  });
});
