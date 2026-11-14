"use client";

import { useState } from "react";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  }
}

export function CopyButton({ text, label = "复制修改建议" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        setState((await copyText(text)) ? "copied" : "failed");
        setTimeout(() => setState("idle"), 2000);
      }}
      className="rounded border border-rule bg-sheet px-2.5 py-1 text-xs text-ink hover:border-ink"
    >
      <span aria-live="polite">{state === "copied" ? "已复制" : state === "failed" ? "复制失败，请手动选择文字" : label}</span>
    </button>
  );
}
