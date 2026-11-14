"use client";

import type { CSSProperties } from "react";
import type { AuditFinding } from "@/lib/audit/types";
import { LEVEL_RANK, LEVEL_UI } from "./levels";

interface Range {
  start: number;
  end: number;
  index: number;
}

function findRanges(text: string, findings: AuditFinding[]): Range[] {
  const ranges: Range[] = [];
  findings.forEach((f, index) => {
    if (f.location_match === "none" || !f.location) return;
    const start = text.indexOf(f.location);
    if (start >= 0) ranges.push({ start, end: start + f.location.length, index });
  });
  return ranges;
}

/** Renders the user's text verbatim, with review marks under the passages each finding points to. */
export function MarkedText({
  text,
  findings,
  selected,
  onSelect,
}: {
  text: string;
  findings: AuditFinding[];
  selected: string | null;
  onSelect: (findingId: string) => void;
}) {
  const ranges = findRanges(text, findings);
  const cuts = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);

  const parts: React.ReactNode[] = [];
  let markIndex = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    const segment = text.slice(a, b);
    const covering = ranges.filter((r) => r.start <= a && r.end >= b);
    if (covering.length === 0) {
      parts.push(segment);
    } else {
      const top = covering.reduce((x, y) => (LEVEL_RANK[findings[y.index].severity] > LEVEL_RANK[findings[x.index].severity] ? y : x));
      const level = LEVEL_UI[findings[top.index].severity];
      const isSelected = covering.some((r) => findings[r.index].id === selected);
      parts.push(
        <mark
          key={`m${a}`}
          data-finding={findings[top.index].id}
          onClick={() => onSelect(findings[top.index].id)}
          className={`review-mark cursor-pointer rounded-sm text-ink ${level.soft} ${isSelected ? "outline-2 outline-offset-1" : ""}`}
          style={{ "--mark-color": level.color, "--mark-index": markIndex++, outlineColor: level.color } as CSSProperties}
        >
          {segment}
        </mark>,
      );
    }
    for (const r of ranges.filter((r) => r.end === b)) {
      const f = findings[r.index];
      parts.push(
        <button
          key={`n${b}-${r.index}`}
          type="button"
          onClick={() => onSelect(f.id)}
          aria-label={`查看第 ${r.index + 1} 处发现`}
          className={`mx-0.5 inline-flex h-5 min-w-5 -translate-y-1.5 items-center justify-center rounded-full px-1 align-baseline font-sans text-[11px] font-semibold text-white`}
          style={{ backgroundColor: LEVEL_UI[f.severity].color }}
        >
          {r.index + 1}
        </button>,
      );
    }
  }

  return <div className="font-serif text-[17px] leading-[2] whitespace-pre-wrap break-words sm:text-lg">{parts}</div>;
}
