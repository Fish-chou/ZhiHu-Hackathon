"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * 功能菜单（点击展开，平滑下滑）
 * ================================
 * 设计约束：
 * - 与站点既有的公文/朱批语言一致，不引入新的视觉风格
 * - 用 grid-template-rows 0fr -> 1fr 实现高度自适应的平滑展开，
 *   内容变化时动画依然正确，不依赖写死的 max-height
 * - 面板本身限高并内部滚动，避免在小屏上把后面的选项组挤出视口
 * - 选中态用 inset ring 实现，避免 1px 边框切换造成的布局抖动
 * - 完整键盘与无障碍支持：Esc 关闭、点击外部关闭、aria-expanded / aria-controls
 * - 尊重 prefers-reduced-motion
 */

export interface FeatureMenuItem {
  id: string;
  label: string;
  description: string;
  /** 右侧补充说明，例如覆盖度提示 */
  note?: string;
  disabled?: boolean;
  /** 禁用项的状态标签，例如「即将支持」 */
  badge?: string;
}

export interface FeatureMenuGroup {
  id: string;
  title: string;
  items: FeatureMenuItem[];
  /** 该组当前只有一个可选项时的说明，显示在标题右侧 */
  hint?: string;
}

interface Props {
  groups: FeatureMenuGroup[];
  /** 当前选中项，按 group.id 索引 */
  value: Record<string, string>;
  onChange: (groupId: string, itemId: string) => void;
  /** 收起状态下按钮上显示的摘要 */
  summary: string;
  label?: string;
}

export function FeatureMenu({ groups, value, onChange, summary, label = "审查选项" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="flex flex-col">
      {/* 触发器：浅灰底 + 明确的按钮形态，与下方白底 textarea 区分开 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border bg-paper px-4 py-2.5 text-left transition-colors hover:border-ink focus-visible:border-ink sm:px-5 ${
          open ? "rounded-b-none border-ink" : "border-rule"
        }`}
      >
        <span className="flex min-w-0 items-baseline gap-2.5">
          <span className="shrink-0 text-xs text-muted">{label}</span>
          <span className="truncate text-sm font-semibold text-ink">{summary}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted">
          <span>{open ? "收起" : "展开"}</span>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={`h-4 w-4 transition-transform duration-300 ease-out motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
        </span>
      </button>

      <div
        id={panelId}
        data-state={open ? "open" : "closed"}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          {/* 限高 + 内部滚动：保证小屏上也能看到后面的选项组 */}
          <div className="flex max-h-[min(60vh,28rem)] flex-col gap-4 overflow-y-auto rounded-b-lg border border-t-0 border-ink bg-sheet px-4 py-4 sm:px-5">
            {groups.map((g) => (
              <fieldset key={g.id} className="flex flex-col">
                <legend className="mb-2 flex flex-wrap items-baseline gap-x-2 text-xs font-semibold tracking-wide text-muted">
                  <span>{g.title}</span>
                  {g.hint && <span className="font-normal text-muted/80">{g.hint}</span>}
                </legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {g.items.map((item) => {
                    const active = value[g.id] === item.id;
                    return (
                      <label
                        key={item.id}
                        className={`flex flex-col gap-0.5 rounded-md border border-rule px-3 py-2 transition-shadow has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cite ${
                          item.disabled
                            ? "cursor-not-allowed bg-paper"
                            : active
                              ? "cursor-pointer bg-sheet shadow-[inset_0_0_0_2px_var(--color-ink)]"
                              : "cursor-pointer bg-sheet hover:shadow-[inset_0_0_0_1px_var(--color-ink)]"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`${panelId}-${g.id}`}
                          value={item.id}
                          checked={active}
                          disabled={item.disabled}
                          aria-disabled={item.disabled}
                          onChange={() => onChange(g.id, item.id)}
                          className="sr-only"
                        />
                        <span className="flex items-center justify-between gap-2">
                          <span
                            className={`text-sm font-medium ${item.disabled ? "text-muted" : "text-ink"}`}
                          >
                            {item.label}
                          </span>
                          {active && (
                            <svg
                              aria-hidden
                              viewBox="0 0 20 20"
                              className="h-4 w-4 shrink-0 text-cinnabar"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M4 10.5 8 14.5 16 6" />
                            </svg>
                          )}
                          {item.badge && (
                            <span className="shrink-0 rounded-sm border border-rule bg-sheet px-1.5 py-px text-[11px] font-normal text-muted">
                              {item.badge}
                            </span>
                          )}
                        </span>
                        <span className={`text-xs leading-5 ${item.disabled ? "text-muted" : "text-muted"}`}>
                          {item.description}
                        </span>
                        {item.note && <span className="text-xs leading-5 text-ochre">{item.note}</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
