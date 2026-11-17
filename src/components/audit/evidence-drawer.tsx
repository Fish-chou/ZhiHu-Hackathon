"use client";

import { useEffect, useRef } from "react";
import type { EvidenceCard } from "@/lib/types";

const CONFIDENCE_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Block({ title, children, muted = false }: { title: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <section className={muted ? "rounded-md bg-paper px-4 py-3" : ""}>
      <h3 className={`mb-1.5 text-sm font-semibold ${muted ? "text-muted" : "text-ink"}`}>{title}</h3>
      <div className="text-[15px] leading-7 text-ink">{children}</div>
    </section>
  );
}

export function EvidenceDrawer({ card, onClose }: { card: EvidenceCard | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!card) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [card, onClose]);

  if (!card) return null;
  const isZhihu = card.recordType === "zhihu";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end sm:items-stretch">
      <button type="button" aria-label="关闭证据详情" className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-xl bg-sheet shadow-2xl sm:max-h-none sm:w-[520px] sm:rounded-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-ink px-1.5 py-0.5 text-white">{card.recordTypeLabel}</span>
              <span
                data-evidence-tier={card.tier}
                className={`rounded border px-1.5 py-0.5 ${card.tier === "verified" ? "border-sage text-sage" : "border-ochre bg-ochre-soft text-ochre"}`}
              >
                {card.tierLabel}
              </span>
              {card.confidence && (
                <span className={`rounded border px-1.5 py-0.5 ${card.lowConfidence ? "border-ochre text-ochre" : "border-rule text-muted"}`}>
                  置信度{CONFIDENCE_LABEL[card.confidence] ?? card.confidence}
                </span>
              )}
              <span className="text-muted">{card.id}</span>
            </div>
            <h2 id="evidence-title" className="text-lg font-semibold leading-snug">
              {card.title}
            </h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="shrink-0 rounded px-2 py-1 text-sm text-muted hover:bg-paper hover:text-ink">
            关闭
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-1 text-sm text-muted">
            {card.sourceTitle && card.sourceTitle !== card.title && <p className="text-ink">{card.sourceTitle}</p>}
            {card.publishedAt && <p>来源日期：{card.publishedAt}</p>}
            {card.accessedAt && <p>数据侧访问日期：{card.accessedAt}</p>}
            {isZhihu && card.authorName && <p>作者（页面显示名）：{card.authorName}</p>}
            {card.sourceUrl ? (
              <p className="mt-1">
                <a
                  href={card.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded border border-cite px-3 py-1.5 text-sm font-medium text-cite hover:bg-cite hover:text-white"
                >
                  查看原文
                </a>
                <span className="ml-2 break-all text-xs">{hostOf(card.sourceUrl)}</span>
              </p>
            ) : (
              <p className="mt-1 text-ochre">无来源链接：数据侧没有提供这条资料的原始链接，无法打开原文核对。</p>
            )}
          </div>

          {card.tier === "candidate" && (
            <p className="rounded-md bg-ochre-soft px-3 py-2 text-sm leading-6 text-ochre">
              {card.bulkMarked
                ? "这条记录在数据库中的状态是 verified，但它原为候选（candidate），2026-11-14 由项目方批量改为 verified，没有逐条核对来源，因此本系统按候选资料处理。它当初没有通过核验的原因记录在下方的核验备注里。"
                : "这是候选资料，数据库状态为 candidate，尚未核验来源。"}
              只能作为线索参考，不能单独支撑风险判断；只引用候选资料的判断一律列为待人工复核。
            </p>
          )}
          {card.lowConfidence && (
            <p className="rounded-md bg-ochre-soft px-3 py-2 text-sm text-ochre">这条证据的置信度为低，只能作为参考，不能单独支撑判断。</p>
          )}

          <Block title={card.quoteLabel}>
            <blockquote className="border-l-2 border-rule pl-3 font-serif">{card.quoteOriginal}</blockquote>
          </Block>
          {card.translationZh && card.translationZh !== card.quoteOriginal && <Block title="中文译文">{card.translationZh}</Block>}
          <Block title={card.claimLabel}>
            {isZhihu && <span className="text-muted">这是作者个人的说法，不代表越南消费者的普遍看法。</span>}
            <p>{card.claim}</p>
          </Block>
          {card.consequence && <Block title="来源记载的后果">{card.consequence}</Block>}
          {(card.analysis.riskSignal || card.analysis.recommendedAction) && (
            <Block title="分析建议（非来源事实）" muted>
              {card.analysis.riskSignal && <p>{card.analysis.riskSignal}</p>}
              {card.analysis.recommendedAction && <p className="mt-2">{card.analysis.recommendedAction}</p>}
            </Block>
          )}
          {card.notes && (
            <details className="text-sm text-muted">
              <summary className="cursor-pointer text-ink">核验备注</summary>
              <p className="mt-2 leading-6 whitespace-pre-wrap">{card.notes}</p>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
