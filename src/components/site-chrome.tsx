import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-rule bg-sheet">
      <div className="mx-auto flex w-full max-w-6xl items-baseline justify-between gap-4 px-5 py-4 sm:px-8">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-wide text-cinnabar">出海红队</span>
          <span className="hidden text-sm text-muted sm:inline">越南市场发布前风险审查</span>
        </Link>
        <nav className="text-sm text-muted">
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
