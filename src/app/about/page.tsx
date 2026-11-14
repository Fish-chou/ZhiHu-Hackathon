import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getVerifiedEvidenceStats } from "@/lib/evidence-search";
import { RECORD_TYPE_LABELS, RISK_CATEGORY_LABELS } from "@/lib/types";

export const metadata: Metadata = { title: "数据与限制 · 出海红队" };

async function EvidenceStats() {
  await connection();
  const stats = await getVerifiedEvidenceStats();
  if (!stats.ok) {
    return <p className="text-sm text-cinnabar">证据库统计暂时无法读取（{stats.error.message}）。</p>;
  }
  const sourceText =
    stats.source === "supabase"
      ? "实时读取自 Supabase 证据库"
      : `离线证据快照（导出于 ${stats.snapshotDate?.slice(0, 10)}${stats.fallbackReason ? "，数据库暂不可用" : ""}）`;
  const rows = (obj: Record<string, number>, labels: Record<string, string>) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => (
        <li key={k} className="flex justify-between gap-6">
          <span>{labels[k] ?? k}</span>
          <span className="tabular-nums">{n}</span>
        </li>
      ));
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted">
        当前可用于审查的 verified 证据 <strong className="text-ink">{stats.usable}</strong> 条（{sourceText}）。
        {stats.bulkMarked > 0 &&
          ` 其中 ${stats.usable - stats.bulkMarked} 条经逐条核对来源，${stats.bulkMarked} 条为 2026-11-14 由项目方从候选批量改为 verified、没有逐条核对来源，页面上标注为“批量标记，未逐条核对来源”。`}
        {stats.total > stats.usable && ` 另有 ${stats.total - stats.usable} 条 verified 记录因缺少原文、来源或摘要而不参与审查。`}
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 font-medium">按证据类型</h3>
          <ul className="flex flex-col gap-1 text-muted">{rows(stats.byRecordType, RECORD_TYPE_LABELS)}</ul>
        </div>
        <div>
          <h3 className="mb-2 font-medium">按风险类别</h3>
          <ul className="flex flex-col gap-1 text-muted">{rows(stats.byRiskCategory, RISK_CATEGORY_LABELS)}</ul>
        </div>
      </div>
    </div>
  );
}

const RECORD_TYPES = [
  ["incident", "真实案例", "公开报道或官方通报中已经发生的事件，只记录来源写明的经过和后果，不推断因果或销售影响。"],
  ["official_rule", "官方规则", "越南法律、政府议定等规则文本的原文摘录，不由系统推导处罚或适用结论。"],
  ["risk_rule", "风险信号", "需要人工检查的信号，不是黑名单。命中只代表需要复核，不代表违规。"],
  ["zhihu", "知乎内容", "知乎作者公开发表的经验或观点，表述为“一位知乎作者提到”，不代表越南消费者的普遍看法。"],
];

const LIMITS = [
  "没有有效的客户访谈数据，没有声称完成客户验证。",
  "没有有效的越南电商商品详情页样本，演示一律使用合成素材。",
  "暂无已核验的电商平台规则，系统不会输出“违反某平台规则”的判断。",
  "售后、物流类已核验证据为 0 条，客服话术审查多数情况下只能提示“未找到可核验依据”。",
  "部分法规来源为英译本数据库，不等同于越南语官方原文。",
  "系统没有越南语母语审校，不能替代本地团队的语感判断。",
];

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16 leading-7">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">数据与限制</h1>
        <p className="text-muted">
          出海红队的每一条风险判断，都必须引用证据库中已核验的记录。证据库由独立的数据采集流程建立，开发侧不新增、不改写任何证据。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">证据库现状</h2>
        <Suspense fallback={<p className="text-sm text-muted">正在读取证据库统计…</p>}>
          <EvidenceStats />
        </Suspense>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">证据类型</h2>
        <dl className="flex flex-col gap-3">
          {RECORD_TYPES.map(([key, name, desc]) => (
            <div key={key}>
              <dt className="font-medium">
                {name} <code className="text-xs text-muted">{key}</code>
              </dt>
              <dd className="text-muted">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">什么算“已核验”</h2>
        <p className="text-muted">
          只有状态为 verified 的记录会被检索和展示，候选（candidate）和已排除（rejected）的记录不参与审查。verified 记录分两类：一类由数据侧逐条打开原始来源，核对过标题、链接和引文，页面标注“已核验”；另一类原为候选，2026-11-14 由项目方批量改为 verified，没有逐条核对来源，页面标注“批量标记，未逐条核对来源”，它们当初未通过核验的原因保留在核验备注里。
        </p>
        <p className="text-muted">对知乎内容来说，verified 只表示内容存在且与链接一致，不表示作者的说法一定正确。</p>
        <p className="text-muted">
          证据中的“风险信号”和“建议做法”字段多为数据侧的分析，页面会标注“分析建议（非来源事实）”，与来源原文分开显示。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">已知限制</h2>
        <ul className="list-disc pl-5 text-muted">
          {LIMITS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">声明</h2>
        <p className="text-muted">
          审查结果仅作发布前风险提示，不构成法律意见，不替代当地律师或市场团队。涉及地图、领土、宗教、民族、政治和法律的内容，系统只提示潜在风险，必须经人工复核。
        </p>
      </section>
    </main>
  );
}
