// Generates src/data/demo/demo-results.json by calling a running instance of the app.
// Usage: node scripts/generate-demo-cache.mjs [baseUrl]    (default http://localhost:3000)
// The app must run with EVIDENCE_MODE=verified_only, so the cache cites only individually verified sources
// and can be shown safely in either mode. Every cached result comes from the same /api/audit pipeline the
// site uses; nothing is written by hand.
import { readFile, writeFile } from "node:fs/promises";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const root = new URL("../", import.meta.url);
const demos = JSON.parse(await readFile(new URL("src/data/demo/demo-cases.json", root), "utf8"));
const snapshot = JSON.parse(await readFile(new URL("src/data/evidence-snapshot.json", root), "utf8"));
const bulk = new Set(JSON.parse(await readFile(new URL("src/data/bulk-verified.json", root), "utf8")).ids);
const verified = new Set(
  snapshot.records.filter((r) => r.status === "verified" && r.market === "Vietnam" && !bulk.has(r.id)).map((r) => r.id),
);

const out = {};
let failed = false;
for (const d of demos) {
  const res = await fetch(`${base}/api/audit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ market: "Vietnam", contentType: d.contentType, text: d.text, demoId: d.id }),
  });
  const body = await res.json();
  if (!res.ok || body.ok !== true) {
    console.error(`✗ ${d.id}: HTTP ${res.status} ${JSON.stringify(body.error ?? body)}`);
    failed = true;
    continue;
  }
  if (body.meta.evidenceMode !== "verified_only") {
    console.error(`✗ ${d.id}: evidenceMode=${body.meta.evidenceMode} — run the app with EVIDENCE_MODE=verified_only`);
    failed = true;
    continue;
  }
  // A cached result must be a real model run, or an honest "no evidence" answer. Fallback modes are not cached.
  if (!["live", "no_evidence"].includes(body.mode)) {
    console.error(`✗ ${d.id}: mode=${body.mode} (${body.meta.notices.join(" ")}) — not cached`);
    failed = true;
    continue;
  }
  const evidenceIds = [...new Set(body.result.findings.flatMap((f) => f.evidence_ids))];
  const bad = [...evidenceIds.filter((id) => !verified.has(id)), ...body.evidence.filter((c) => c.tier !== "verified").map((c) => c.id)];
  if (bad.length) {
    console.error(`✗ ${d.id}: cites ids that are not individually verified: ${[...new Set(bad)].join(", ")}`);
    failed = true;
    continue;
  }
  out[d.id] = {
    demoId: d.id,
    generatedAt: body.meta.generatedAt,
    contentType: d.contentType,
    text: d.text,
    evidenceIds,
    evidenceSource: body.meta.evidenceSource,
    model: body.meta.model,
    response: body,
  };
  console.log(`✓ ${d.id}: mode=${body.mode} level=${body.result.overall_level} findings=${body.result.findings.length} evidence=${evidenceIds.join(",") || "-"}`);
}

if (failed) {
  console.error("Cache not written: fix the errors above and run again.");
  process.exit(1);
}
await writeFile(new URL("src/data/demo/demo-results.json", root), JSON.stringify(out, null, 1) + "\n");
console.log(`Wrote ${Object.keys(out).length} cached demo results.`);
