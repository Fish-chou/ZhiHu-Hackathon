"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestAudit, type ClientOutcome } from "@/lib/audit/client";
import { DEMO_CASES, type DemoCase } from "@/lib/audit/demo-cache";
import { CONTENT_TYPE_LABELS, MAX_TEXT_LENGTH, type AuditResponse, type ContentType } from "@/lib/audit/types";
import type { EvidenceCard } from "@/lib/types";
import { EvidenceDrawer } from "./evidence-drawer";
import { FeatureMenu, type FeatureMenuGroup } from "./feature-menu";
import { LEVEL_UI } from "./levels";
import { ResultView } from "./result-view";

const STAGES = ["正在读取输入", "正在匹配越南市场证据", "正在生成风险判断", "正在校验来源"];

/** 功能菜单配置。市场一栏当前只有越南，保留结构以便后续扩展。 */
const MENU_GROUPS: FeatureMenuGroup[] = [
  {
    id: "market",
    title: "目标市场",
    hint: "其他市场尚未接入证据",
    items: [
      { id: "Vietnam", label: "越南 Vietnam", description: "证据库目前只覆盖越南市场" },
      { id: "Thailand", label: "泰国 Thailand", description: "暂未接入证据", disabled: true, badge: "即将支持" },
      { id: "Indonesia", label: "印尼 Indonesia", description: "暂未接入证据", disabled: true, badge: "即将支持" },
    ],
  },
  {
    id: "contentType",
    title: "内容类型",
    items: [
      { id: "advertisement", label: "广告文案", description: "投放素材、推广标语、活动文案" },
      { id: "product_page", label: "商品详情页", description: "标题、卖点、规格与图文说明" },
      {
        id: "customer_service",
        label: "客服话术",
        description: "售前答疑、售后与退换回复",
        note: "售后与物流类已核验证据较少，可能提示未找到依据",
      },
    ],
  },
];

type Phase =
  | { name: "idle" }
  | { name: "loading"; stage: number }
  | { name: "result"; data: AuditResponse }
  | { name: "error"; code: string; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs one audit and walks the visible stages. Stage changes happen in timers, never synchronously. */
async function execute(
  input: { contentType: ContentType; text: string; demoId?: string },
  setPhase: (p: Phase) => void,
  isCurrent: () => boolean,
) {
  const timers = [
    setTimeout(() => isCurrent() && setPhase({ name: "loading", stage: 1 }), 500),
    setTimeout(() => isCurrent() && setPhase({ name: "loading", stage: 2 }), 1300),
  ];
  const outcome: ClientOutcome = await requestAudit(input);
  timers.forEach(clearTimeout);
  if (!isCurrent()) return;
  setPhase({ name: "loading", stage: 3 });
  await sleep(350);
  if (!isCurrent()) return;
  setPhase(outcome.kind === "result" ? { name: "result", data: outcome.data } : { name: "error", code: outcome.code, message: outcome.message });
}

function LoadingStages({ stage }: { stage: number }) {
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-rule bg-sheet px-6 py-6">
      <p className="text-sm text-muted">正在审查，通常需要 10 到 30 秒。</p>
      <ol className="mt-4 flex flex-col gap-3">
        {STAGES.map((s, i) => (
          <li key={s} className={`flex items-center gap-3 text-[15px] ${i > stage ? "text-muted" : "text-ink"}`}>
            <span
              aria-hidden
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                i < stage ? "border-sage bg-sage text-white" : i === stage ? "border-cinnabar text-cinnabar motion-safe:animate-pulse" : "border-rule"
              }`}
            >
              {i < stage ? "✓" : i + 1}
            </span>
            {s}
            {i === stage && <span className="sr-only">（进行中）</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AuditWorkspace() {
  const params = useSearchParams();
  const initialDemo = DEMO_CASES.find((d) => d.id === params.get("demo")) ?? null;

  const [contentType, setContentType] = useState<ContentType>(initialDemo?.contentType ?? "advertisement");
  const [text, setText] = useState(initialDemo?.text ?? "");
  const [demoId, setDemoId] = useState<string | undefined>(initialDemo?.id);
  const [phase, setPhase] = useState<Phase>(initialDemo ? { name: "loading", stage: 0 } : { name: "idle" });
  const [selected, setSelected] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<EvidenceCard | null>(null);
  const runId = useRef(0);
  const topRef = useRef<HTMLDivElement>(null);

  const start = useCallback((input: { contentType: ContentType; text: string; demoId?: string }) => {
    const id = ++runId.current;
    setSelected(null);
    setPhase({ name: "loading", stage: 0 });
    topRef.current?.scrollIntoView({ block: "start" });
    void execute(input, setPhase, () => runId.current === id);
  }, []);

  useEffect(() => {
    if (!initialDemo) return;
    const id = ++runId.current;
    void execute({ contentType: initialDemo.contentType, text: initialDemo.text, demoId: initialDemo.id }, setPhase, () => runId.current === id);
    // Only the demo from the URL at first render is auto-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runDemo = (d: DemoCase) => {
    setContentType(d.contentType);
    setText(d.text);
    setDemoId(d.id);
    window.history.replaceState(null, "", `/?demo=${d.id}`);
    start({ contentType: d.contentType, text: d.text, demoId: d.id });
  };

  const submit = () => {
    const isDemoText = DEMO_CASES.some((d) => d.id === demoId && d.text === text && d.contentType === contentType);
    if (!isDemoText) {
      setDemoId(undefined);
      window.history.replaceState(null, "", "/");
    }
    start({ contentType, text, demoId: isDemoText ? demoId : undefined });
  };

  const goHome = () => {
    runId.current++;
    setText("");
    setDemoId(undefined);
    setContentType("advertisement");
    setPhase({ name: "idle" });
    window.history.replaceState(null, "", "/");
    window.scrollTo({ top: 0 });
  };

  const trimmed = text.trim();
  const tooLong = text.length > MAX_TEXT_LENGTH;
  const blockReason = !trimmed ? "请输入要审查的内容" : tooLong ? `内容超过 ${MAX_TEXT_LENGTH} 字，请分段提交` : null;

  return (
    <div ref={topRef} className="scroll-mt-4">
      {phase.name === "loading" && <LoadingStages stage={phase.stage} />}

      {phase.name === "result" && (
        <ResultView
          data={phase.data}
          selected={selected}
          onSelect={setSelected}
          onOpenEvidence={setDrawer}
          onRestart={() => setPhase({ name: "idle" })}
          onHome={goHome}
        />
      )}

      {(phase.name === "idle" || phase.name === "error") && (
        <section aria-label="提交审查内容" className="flex flex-col gap-5">
          {phase.name === "error" && (
            <div role="alert" className="rounded-md border border-cinnabar bg-cinnabar-soft px-4 py-3 text-sm leading-6">
              <p className="font-semibold text-cinnabar">没有完成审查</p>
              <p className="text-ink">{phase.message}</p>
            </div>
          )}

          <FeatureMenu
            groups={MENU_GROUPS}
            value={{ market: "Vietnam", contentType }}
            onChange={(groupId, itemId) => {
              if (groupId === "contentType") setContentType(itemId as ContentType);
            }}
            summary={`越南 Vietnam · ${CONTENT_TYPE_LABELS[contentType]}`}
          />

          <div className="rounded-lg border border-rule bg-sheet focus-within:border-ink">
            <label htmlFor="audit-text" className="sr-only">
              待审查内容
            </label>
            <textarea
              id="audit-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="粘贴准备在越南发布的广告文案、商品详情页或客服话术"
              className="block min-h-40 w-full resize-y rounded-t-lg border-l-2 border-cinnabar-soft bg-transparent px-5 py-4 font-serif text-[17px] leading-[1.9] outline-none placeholder:text-muted/70 sm:min-h-64 sm:px-7"
            />
            <div className="flex items-center justify-between border-t border-rule px-5 py-2 text-xs text-muted">
              <span>{blockReason ?? "可以直接编辑演示素材后再审查"}</span>
              <span className={tooLong ? "font-semibold text-cinnabar" : ""}>
                {text.length} / {MAX_TEXT_LENGTH}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={!!blockReason}
              className="rounded-md bg-cinnabar px-6 py-2.5 text-[15px] font-semibold text-white hover:bg-cinnabar/90 disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted"
            >
              开始审查
            </button>
            {blockReason && trimmed && <span className="text-sm text-cinnabar">{blockReason}</span>}
          </div>

          <div className="mt-2 flex flex-col gap-3">
            <h2 className="text-sm font-semibold">用演示素材试一试</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {DEMO_CASES.map((d) => {
                const lv = LEVEL_UI[d.expectedLevel];
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => runDemo(d)}
                    className={`flex flex-col gap-1 border-l-4 bg-sheet px-4 py-3 text-left hover:bg-paper ${lv.rule}`}
                  >
                    <span className="font-semibold">{d.title}</span>
                    <span className="text-sm leading-6 text-muted">{d.summary}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted">当前为公开证据驱动的原型，演示素材不代表客户数据。</p>
          </div>
        </section>
      )}

      <EvidenceDrawer card={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
