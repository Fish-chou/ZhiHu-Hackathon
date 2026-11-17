import Link from "next/link";
import { EVIDENCE_MODE_HINTS, EVIDENCE_MODE_LABELS, getEvidenceMode } from "@/lib/evidence-mode";

export function EvidenceModeBadge() {
  const mode = getEvidenceMode();
  const tone = mode === "demo" ? "border-ochre bg-ochre-soft text-ochre" : "border-sage bg-sage-soft text-sage";
  return (
    <Link
      href="/about#evidence-mode"
      title={EVIDENCE_MODE_HINTS[mode]}
      data-evidence-mode={mode}
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {EVIDENCE_MODE_LABELS[mode]}
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-rule bg-sheet">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex items-baseline gap-3">
            <span className="text-lg font-semibold tracking-wide text-cinnabar">出海红队</span>
            <span className="hidden text-sm text-muted sm:inline">越南市场发布前风险审查</span>
          </Link>
          <EvidenceModeBadge />
        </div>
        <nav className="shrink-0 text-sm text-muted">
          <Link href="/about" className="hover:text-ink">
            数据与限制
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-rule text-xs leading-6 text-muted">
      <div className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-8">
        公开证据驱动的原型。演示素材为合成内容，不代表客户数据。审查结果仅作发布前风险提示，不构成法律意见。
      </div>
    </footer>
  );
}
