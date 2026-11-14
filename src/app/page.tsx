import { Suspense } from "react";
import { AuditWorkspace } from "@/components/audit/audit-workspace";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8 sm:py-12">
      <div className="flex max-w-3xl flex-col gap-3">
        <h1 className="text-[26px] font-semibold leading-snug tracking-tight text-balance sm:text-[32px]">
          在发布前，提前发现内容进入越南市场时可能产生的风险。
        </h1>
        <p className="text-base leading-7 text-muted">
          粘贴准备发布的广告文案、商品详情页或客服话术。系统只依据已核验的公开证据指出可能的问题，每一处都附来源和修改建议。
        </p>
      </div>
      <Suspense fallback={<div className="h-80 rounded-lg border border-rule bg-sheet" aria-hidden />}>
        <AuditWorkspace />
      </Suspense>
    </main>
  );
}
