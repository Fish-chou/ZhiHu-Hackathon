export interface Segment {
  text: string;
  start: number;
  end: number;
}

/** Splits text into sentences/lines while keeping exact offsets into the original string. */
export function splitSentences(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /[^\n。！？!?；;]+[。！？!?；;]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out.push({ text: trimmed, start: m.index + lead, end: m.index + lead + trimmed.length });
  }
  return out;
}

function normalize(s: string): string {
  return s.replace(/[\s"“”'‘’「」『』]/g, "").toLowerCase();
}

/** Finds where a model-quoted location sits in the original text. */
export function locate(
  text: string,
  location: string,
): { match: "exact" | "approx" | "none"; start: number; end: number; text: string } {
  const loc = location.trim();
  if (loc) {
    const i = text.indexOf(loc);
    if (i >= 0) return { match: "exact", start: i, end: i + loc.length, text: loc };
  }
  const target = normalize(loc);
  if (!target) return { match: "none", start: -1, end: -1, text: loc };
  let best: { seg: Segment; score: number } | null = null;
  for (const seg of splitSentences(text)) {
    const s = normalize(seg.text);
    if (s.includes(target) || target.includes(s)) {
      const score = Math.min(s.length, target.length) / Math.max(s.length, target.length);
      if (!best || score > best.score) best = { seg, score };
    }
  }
  if (best && best.score >= 0.3) return { match: "approx", start: best.seg.start, end: best.seg.end, text: best.seg.text };
  return { match: "none", start: -1, end: -1, text: loc };
}
