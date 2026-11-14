// Mock OpenAI-compatible model server for end-to-end tests only. Never used in production.
// Usage: node e2e/mock-llm.mjs [port]
//   POST /ok/v1/chat/completions       -> valid JSON citing the first evidence id in the prompt
//   POST /timeout/v1/chat/completions  -> never responds
//   POST /badjson/v1/chat/completions  -> content that is not JSON
import http from "node:http";

const port = Number(process.argv[2] ?? 4010);

http
  .createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const mode = req.url.split("/")[1];
    if (mode === "timeout") return;
    const reply = (content, model) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model, choices: [{ message: { content } }] }));
    };
    if (mode === "badjson") return reply("抱歉，我无法按要求输出。", "mock-badjson");

    const user = JSON.parse(raw).messages.find((m) => m.role === "user").content;
    const text = user.split("<<<\n")[1]?.split("\n>>>")[0] ?? "";
    const ids = [...user.matchAll(/"evidence_id": "([^"]+)"/g)].map((m) => m[1]);
    const lines = text.split("\n").filter((l) => l.trim());
    const location = lines.find((l) => /Xisha|第一|医生|地图/.test(l)) ?? lines[0] ?? "";
    const output = {
      overall_level: ids.length ? "medium" : "low",
      summary: "（模拟模型）这是用于测试页面流程的结果，不是真实模型的判断。",
      findings: ids.length
        ? [
            {
              id: "finding_001",
              location,
              risk_category: "product",
              severity: "medium",
              reason: "（模拟模型）该句与所引用的证据相关，用于测试证据展示流程。",
              evidence_ids: [ids[0]],
              recommendation: "（模拟模型）请对照证据人工复核这句话。",
              requires_human_review: true,
            },
          ]
        : [],
      missing_evidence: [],
      disclaimer: "结果仅作发布前风险提示，不构成法律意见",
    };
    reply(JSON.stringify(output), "mock-llm");
  })
  .listen(port, () => console.log(`mock llm on ${port}`));
