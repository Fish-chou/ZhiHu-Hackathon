import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { EVIDENCE_MODE_HINTS, EVIDENCE_MODE_LABELS, getEvidenceMode } from "@/lib/evidence-mode";
import { getEvidenceStats } from "@/lib/evidence-search";
import { RECORD_TYPE_LABELS } from "@/lib/types";

export const metadata: Metadata = { title: "数据与限制 · 出海红队" };

async function EvidenceStats() {
  await connection();
  const stats = await getEvidenceStats();
  if (!stats.ok) {
    return <p className="text-sm text-cinnabar">证据库统计暂时无法读取（{stats.error.message}）。</p>;
  }
  const demo = stats.mode === "demo";
  const sourceText =
    stats.source === "supabase"
      ? "实时读取自 Supabase 证据库"
      : `离线证据快照（导出于 ${stats.snapshotDate?.slice(0, 10)}${stats.fallbackReason ? "，数据库暂不可用" : ""}）`;
  const usableTotal = stats.usable.verified + stats.usable.candidate;
  const types = Object.entries(stats.byRecordType).sort((a, b) => b[1].verified + b[1].candidate - (a[1].verified + a[1].candidate));
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted">
        当前为<strong className="text-ink">{EVIDENCE_MODE_LABELS[stats.mode]}</strong>（{sourceText}）。可用于审查的已核验来源{" "}
        <strong className="text-ink">{stats.usable.verified}</strong> 条
        {demo && (
          <>
            ，候选资料/待核验 <strong className="text-ink">{stats.usable.candidate}</strong> 条
            {stats.bulkMarkedUsable > 0 && `（其中 ${stats.bulkMarkedUsable} 条是 2026-11-14 被批量改为 verified 的记录，按候选资料处理）`}
          </>
        )}
        。
        {!demo &&
          stats.excludedBulkMarked > 0 &&
          ` 另有 ${stats.excludedBulkMarked} 条记录在数据库中标为 verified，但属于 2026-11-14 批量标记、没有逐条核对来源，本模式按候选资料处理，不使用。`}
        {stats.total > usableTotal && ` 另有 ${stats.total - usableTotal} 条已读取的记录因缺少标题、摘要、原文或来源链接而不参与审查。`}
      </p>
      <div>
        <h3 className="mb-2 font-medium">按证据类型（可用于审查的记录）</h3>
        <ul className="flex max-w-md flex-col gap-1 text-muted">
          {types.map(([k, n]) => (
            <li key={k} className="flex justify-between gap-6">
              <span>{RECORD_TYPE_LABELS[k] ?? k}</span>
              <span className="tabular-nums">{demo ? `已核验 ${n.verified} · 候选 ${n.candidate}` : n.verified}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const RECORD_TYPES = [
  ["incident", "真实案例", "公开报道或官方通报中已经发生的事件，只记录来源写明的经过和后果，不推断因果或销售影响。"],
  ["official_rule", "官方规则", "越南法律、政府议定等规则文本的原文摘录，不由系统推导处罚或适用结论。"],
  ["platform_rule", "平台规则", "电商平台的政策或运营要求。目前只有候选资料，没有已核验记录。"],
  ["risk_rule", "风险信号", "需要人工检查的信号，不是黑名单。命中只代表需要复核，不代表违规。"],
  ["zhihu", "知乎内容", "知乎作者公开发表的经验或观点，表述为“一位知乎作者提到”，不代表越南消费者的普遍看法。"],
  ["market_insight", "市场资料", "促销节点、平台对比等市场参考。目前只有候选资料。"],
];

const LIMITS = [
  "没有有效的客户访谈数据，没有声称完成客户验证。",
  "没有有效的越南电商商品详情页样本，演示一律使用合成素材。",
  "暂无已核验的电商平台规则；演示模式下的平台规则都是候选资料，系统不会据此输出“违反某平台规则”的判断。",
  "售后、物流类已核验证据为 0 条，客服话术审查多数情况下只能提示“未找到可核验依据”。",
  "候选资料多由表格转换而来，大部分没有来源链接，无法在页面上打开原文核对。",
  "部分法规来源为英译本数据库，不等同于越南语官方原文。",
  "系统没有越南语母语审校，不能替代本地团队的语感判断。",
];

export default function AboutPage() {
  const mode = getEvidenceMode();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16 leading-7">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">数据与限制</h1>
        <p className="text-muted">
          出海红队的每一条风险判断都必须引用证据库中的记录，并标明它是已核验来源还是候选资料。证据库由独立的数据采集流程建立，开发侧不新增、不改写任何证据，也不修改记录的核验状态。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">证据库现状</h2>
        <Suspense fallback={<p className="text-sm text-muted">正在读取证据库统计…</p>}>
          <EvidenceStats />
        </Suspense>
      </section>

      <section id="evidence-mode" className="flex scroll-mt-6 flex-col gap-3">
        <h2 className="text-lg font-semibold">证据使用模式</h2>
        <p className="text-muted">
          当前：<strong className="text-ink">{EVIDENCE_MODE_LABELS[mode]}</strong>，{EVIDENCE_MODE_HINTS[mode]}。模式由部署时的环境变量 EVIDENCE_MODE 决定，页面顶部始终显示当前模式。
        </p>
        <dl className="flex flex-col gap-3">
          <div>
            <dt className="font-medium">正式核验模式 <code className="text-xs text-muted">verified_only</code></dt>
            <dd className="text-muted">只查询状态为 verified 的记录，并排除批量标记的记录。候选资料和已排除记录不会进入模型，也不会出现在证据卡片中。</dd>
          </div>
          <div>
            <dt className="font-medium">演示模式 <code className="text-xs text-muted">demo</code></dt>
            <dd className="text-muted">
              同时查询 verified 和 candidate。已核验来源标注“已核验来源”，候选资料标注“候选资料/待核验”。只引用候选资料的判断，风险等级一律降为“待人工复核”；候选资料不能支撑“违法”“一定违规”“消费者普遍认为”这类确定性结论，出现时会被系统改写。
            </dd>
          </div>
        </dl>
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
          只有数据侧逐条打开原始来源、核对过标题、链接和引文的 verified 记录，才标为“已核验来源”。数据库中有一批记录原为候选，2026-11-14 由项目方批量改为 verified，没有逐条核对来源；本系统不把它们当作已核验，一律按“候选资料/待核验”处理，它们当初未通过核验的原因保留在核验备注里。数据库中的状态字段保持原样，系统不会通过修改状态来改变核验结论。
        </p>
        <p className="text-muted">已排除（rejected）的记录在任何模式下都不会被读取。</p>
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
