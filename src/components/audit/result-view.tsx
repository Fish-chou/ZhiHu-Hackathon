"use client";

import { findDemoCase } from "@/lib/audit/demo-cache";
import { CONTENT_TYPE_LABELS, type AuditResponse } from "@/lib/audit/types";
import type { EvidenceCard } from "@/lib/types";
import { CopyButton } from "./copy-button";
import { CATEGORY_LABELS, LEVEL_UI, NO_EVIDENCE_NOTICE } from "./levels";
import { MarkedText } from "./marked-text";

function ModeNotice({ data }: { data: AuditResponse }) {
  const title =
    data.mode === "cached_demo"
      ? "演示缓存结果"
      : data.mode === "rules_only"
        ? "规则匹配结果（未经模型分析）"
        : data.meta.evidenceSource === "offline_snapshot"
          ? "离线证据快照"
          : null;
  if (!title && data.meta.notices.length === 0) return null;
  const strong = data.mode === "cached_demo" || data.mode === "rules_only";
  return (
    <div role="status" className={`rounded-md border px-4 py-3 text-sm leading-6 ${strong ? "border-review bg-review-soft" : "border-rule bg-sheet"}`}>
      {title && <p className="font-semibold text-review">{title}</p>}
      {data.meta.notices.map((n) => (
        <p key={n} className="text-ink">
          {n}
        </p>
      ))}
    </div>
  );
}

export function ResultView({
  data,
  selected,
  onSelect,
  onOpenEvidence,
  onRestart,
  onHome,
}: {
  data: AuditResponse;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenEvidence: (card: EvidenceCard) => void;
  onRestart: () => void;
  onHome: () => void;
}) {
  const { result } = data;
  const level = LEVEL_UI[result.overall_level];
  const cards = new Map(data.evidence.map((c) => [c.id, c]));
  const humanReview = result.findings.some((f) => f.requires_human_review);
  const signals = [...new Set(data.signals.map((s) => s.label))];
  const demo = findDemoCase(data.input.contentType, data.input.text);

  const select = (id: string) => {
    onSelect(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  };

  return (
    <section aria-labelledby="result-heading" className="flex flex-col gap-6">
      <ModeNotice data={data} />

      <div className="flex flex-col gap-4 border-b border-rule pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex max-w-2xl flex-col gap-2">
          <h2 id="result-heading" className="text-sm text-muted">
            审查结果
          </h2>
          <p className={`text-3xl font-semibold ${level.text}`}>{level.label}</p>
          <p className="text-sm leading-6 text-muted">{level.explain}</p>
          {humanReview && (
            <p className="text-sm font-medium text-cinnabar">本次结果包含需要人工复核的内容，请在发布前交由熟悉越南市场的同事或法律顾问确认。</p>
          )}
          <p className="mt-1 text-base leading-7">{result.summary}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onRestart} className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/85">
            重新审查
          </button>
          <button type="button" onClick={onHome} className="rounded-md border border-rule bg-sheet px-4 py-2 text-sm hover:border-ink">
            返回首页
          </button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="self-start rounded-lg border border-rule bg-sheet lg:sticky lg:top-6">
          <div className="flex items-baseline justify-between border-b border-rule px-5 py-3 text-sm">
            <span className="font-medium">原文</span>
            <span className="text-muted">{CONTENT_TYPE_LABELS[data.input.contentType]}，越南市场</span>
          </div>
          {demo && <p className="border-b border-rule bg-paper px-5 py-2 text-xs text-muted">{demo.label}</p>}
          <div className="border-l-2 border-cinnabar-soft px-5 py-5 sm:px-7">
            <MarkedText text={data.input.text} findings={result.findings} selected={selected} onSelect={select} />
          </div>
          <p className="border-t border-rule px-5 py-2.5 text-xs text-muted">原文按提交内容原样显示，系统没有做任何改动。</p>
        </div>

        <div className="flex flex-col gap-6">
          {result.findings.length === 0 ? (
            <div className="rounded-lg border border-sage bg-sage-soft px-5 py-4">
              <p className="font-semibold text-sage">{NO_EVIDENCE_NOTICE}</p>
              <p className="mt-1 text-sm leading-6 text-ink">系统不会在没有证据的情况下判定风险。这不等于内容一定没有问题。</p>
            </div>
          ) : (
            <ol className="flex flex-col gap-4">
              {result.findings.map((f, i) => {
                const lv = LEVEL_UI[f.severity];
                return (
                  <li
                    key={f.id}
                    id={f.id}
                    className={`scroll-mt-6 border-l-4 bg-sheet px-4 py-4 ${lv.rule} ${selected === f.id ? "ring-2 ring-rule" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <button
                        type="button"
                        onClick={() => select(f.id)}
                        className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white"
                        style={{ backgroundColor: lv.color }}
                        aria-label={`在原文中定位第 ${i + 1} 处`}
                      >
                        {i + 1}
                      </button>
                      <span className={`font-semibold ${lv.text}`}>{lv.label}</span>
                      <span className="text-muted">{CATEGORY_LABELS[f.risk_category]}</span>
                      {f.requires_human_review && <span className="rounded bg-cinnabar-soft px-1.5 py-0.5 text-xs text-cinnabar">需人工复核</span>}
                    </div>

                    <blockquote className="mt-3 border-l-2 border-rule pl-3 font-serif text-[15px] leading-7">
                      {f.location_match === "none" && <span className="mr-1 font-sans text-xs text-muted">未能在原文中定位：</span>}
                      {f.location}
                    </blockquote>

                    <p className="mt-3 text-[15px] leading-7">
                      <span className="mr-1.5 rounded bg-paper px-1.5 py-0.5 text-xs text-muted">{f.source === "rules" ? "规则匹配" : "系统分析"}</span>
                      {f.reason}
                    </p>

                    <div className="mt-3 rounded-md bg-paper px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">修改建议（系统建议）</p>
                        <CopyButton text={f.recommendation} />
                      </div>
                      <p className="mt-1 text-[15px] leading-7">{f.recommendation}</p>
                    </div>

                    <div className="mt-3">
                      <p className="text-sm text-muted">依据（点击查看证据详情）</p>
                      <ul className="mt-1.5 flex flex-col gap-1.5">
                        {f.evidence_ids.map((id) => {
                          const c = cards.get(id);
                          if (!c) return null;
                          return (
                            <li key={id}>
                              <button
                                type="button"
                                onClick={() => onOpenEvidence(c)}
                                className="flex w-full items-start gap-2 rounded px-1 py-1 text-left text-sm hover:bg-paper"
                              >
                                <span className="mt-0.5 shrink-0 rounded border border-rule px-1.5 text-xs text-muted">{c.recordTypeLabel}</span>
                                <span className="text-cite underline decoration-cite/30 underline-offset-4">{c.title}</span>
                                {c.verification === "bulk_marked" && <span className="shrink-0 text-xs text-ochre">未逐条核对</span>}
                                {c.lowConfidence && <span className="shrink-0 text-xs text-ochre">置信度低</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {result.missing_evidence.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">当前证据无法确认的问题</h3>
              <ul className="mt-2 list-disc pl-5 text-sm leading-6 text-muted">
                {result.missing_evidence.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-rule pt-4 text-xs leading-6 text-muted">
            <p>
              检索到 {data.meta.retrievedCount} 条已核验证据，引用 {data.evidence.length} 条；证据来源：
              {data.meta.evidenceSource === "supabase" ? "Supabase 证据库（实时）" : `离线证据快照（导出于 ${data.meta.snapshotDate?.slice(0, 10)}）`}。
            </p>
            {signals.length > 0 && <p>命中的风险信号：{signals.join("、")}。</p>}
            <p>
              {data.meta.model ? `模型：${data.meta.model}` : "本次没有调用模型"}；生成时间：
              {(data.meta.cachedAt ?? data.meta.generatedAt).slice(0, 16).replace("T", " ")}（UTC）。
            </p>
            <p>{result.disclaimer}。</p>
          </div>
        </div>
      </div>
    </section>
  );
}
