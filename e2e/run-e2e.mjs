// End-to-end test for the web demo. Drives a real browser and writes functional_test_report.md.
// Usage:
//   node e2e/run-e2e.mjs --main <url> [--db-down <url>] [--llm-timeout <url>] [--llm-badjson <url>]
//                        [--label <text>] [--model-note <text>] [--candidate-ids <json file>]
// Secrets to look for in pages can be passed as E2E_SECRET_STRINGS (comma separated); they are never printed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const MAIN = args.main?.replace(/\/+$/, "");
if (!MAIN) throw new Error("--main <url> is required");
const LABEL = args.label ?? "未命名环境";
const SLUG = LABEL.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "run";
const root = new URL("../", import.meta.url);
const SHOT_DIR = `e2e/screenshots/${SLUG}`;
await mkdir(new URL(SHOT_DIR, root), { recursive: true });

const snapshot = JSON.parse(await readFile(new URL("src/data/evidence-snapshot.json", root), "utf8"));
const bulkIds = new Set(JSON.parse(await readFile(new URL("src/data/bulk-verified.json", root), "utf8")).ids);
const verifiedIds = new Set(
  snapshot.records.filter((r) => r.status === "verified" && r.market === "Vietnam" && !bulkIds.has(r.id)).map((r) => r.id),
);
const candidateIds = new Set(args["candidate-ids"] ? JSON.parse(await readFile(args["candidate-ids"], "utf8")) : []);
const secrets = (process.env.E2E_SECRET_STRINGS ?? "").split(",").map((s) => s.trim()).filter((s) => s.length >= 8);

const NO_EVIDENCE = "未找到可核验依据，不建议据此作出发布决定。";
const browser = await chromium.launch();
const apiResponses = [];
const pageTexts = [];
const consoleErrors = [];
const results = [];

async function open(base, { mobile = false, clipboard = false } = {}) {
  const ctx = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } },
  );
  if (clipboard) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${base}: ${m.text()}`));
  page.on("pageerror", (e) => consoleErrors.push(`${base}: ${e.message}`));
  page.on("response", async (res) => {
    if (res.url().endsWith("/api/audit") && res.request().method() === "POST") {
      try {
        apiResponses.push({ base, status: res.status(), body: await res.json() });
      } catch {
        apiResponses.push({ base, status: res.status(), body: null });
      }
    }
  });
  return { ctx, page };
}

async function remember(page) {
  pageTexts.push({ url: page.url(), text: await page.locator("body").innerText(), html: await page.content() });
}

async function shot(page, r, name) {
  const path = `${SHOT_DIR}/${String(r.no).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: fileURLToPath(new URL(path, root)), fullPage: true });
  r.shots.push(path);
}

async function waitResult(page) {
  await page.locator("#result-heading").waitFor({ timeout: 70_000 });
  await page.waitForTimeout(700);
}

async function runDemo(page, title) {
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await waitResult(page);
}

async function submitText(page, type, text) {
  await page.getByText(type, { exact: true }).click();
  await page.locator("#audit-text").fill(text);
  await page.getByRole("button", { name: "开始审查" }).click();
  await waitResult(page);
}

const lastApi = () => apiResponses.at(-1)?.body;

async function test(no, name, severity, fix, fn) {
  const r = { no, name, severity, fix, steps: [], actual: "", pass: false, error: "", shots: [] };
  const started = Date.now();
  try {
    await fn(r);
  } catch (e) {
    r.pass = false;
    r.error = String(e?.message ?? e).split("\n")[0].slice(0, 300);
  }
  r.ms = Date.now() - started;
  results.push(r);
  console.log(`${r.pass ? "PASS" : "FAIL"} ${no}. ${name}${r.error ? ` — ${r.error}` : ""}`);
}

function skip(no, name, why) {
  results.push({ no, name, severity: "—", fix: why, steps: [], actual: `未执行：${why}`, pass: null, error: "", shots: [], ms: 0 });
  console.log(`SKIP ${no}. ${name}`);
}

// ---------- tests ----------

await test(1, "首页能够打开", "高", "检查部署是否成功、首页是否报错", async (r) => {
  const { ctx, page } = await open(MAIN);
  r.steps = ["打开首页", "检查标题、目标市场、内容类型、输入框、三个演示按钮和标注文字"];
  const res = await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  const text = await page.locator("body").innerText();
  const checks = {
    状态码200: res?.status() === 200,
    标题: text.includes("在发布前，提前发现内容进入越南市场时可能产生的风险。"),
    目标市场: text.includes("越南 Vietnam"),
    内容类型: ["广告文案", "商品详情页", "客服话术"].every((t) => text.includes(t)),
    输入框: await page.locator("#audit-text").isVisible(),
    演示按钮: (await page.getByRole("button", { name: /越南敏感地理素材|越南语言\/文化表达|普通安全文案/ }).count()) === 3,
    原型标注: text.includes("当前为公开证据驱动的原型，演示素材不代表客户数据。"),
  };
  await shot(page, r, "home");
  await remember(page);
  r.pass = Object.values(checks).every(Boolean);
  r.actual = Object.entries(checks).map(([k, v]) => `${k}${v ? "✓" : "✗"}`).join("，");
  await ctx.close();
});

await test(2, "不登录也能点击三个预置案例", "高", "检查演示按钮和 /api/audit", async (r) => {
  const { ctx, page } = await open(MAIN);
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  const done = [];
  for (const title of ["越南敏感地理素材", "越南语言/文化表达", "普通安全文案"]) {
    r.steps.push(`点击“${title}”，等待结果出现，再点“返回首页”`);
    await runDemo(page, title.replace("/", "\\/"));
    done.push(`${title}：${lastApi()?.mode}/${lastApi()?.result?.overall_level}`);
    await page.getByRole("button", { name: "返回首页" }).click();
  }
  r.pass = done.length === 3;
  r.actual = `三个案例都出现结果页，全程没有登录。${done.join("；")}`;
  await ctx.close();
});

await test(3, "高风险案例能够展示结果", "高", "检查证据检索和结果渲染", async (r) => {
  const { ctx, page } = await open(MAIN);
  r.steps = ["打开首页", "点击“越南敏感地理素材”", "检查风险等级、原文标记和逐条发现"];
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  await runDemo(page, "越南敏感地理素材");
  const api = lastApi();
  const marks = await page.locator("mark[data-finding]").count();
  const findings = await page.locator("li[id^=finding_]").count();
  const review = (await page.locator("body").innerText()).includes("需人工复核");
  await shot(page, r, "high-risk");
  await remember(page);
  r.pass = findings > 0 && marks > 0 && review;
  r.actual = `模式 ${api?.mode}，总体等级 ${api?.result?.overall_level}，原文标记 ${marks} 处，发现 ${findings} 条，${review ? "有" : "没有"}“需人工复核”提示；引用证据：${api?.evidence?.map((c) => c.id).join("、")}`;
  await ctx.close();
});

await test(4, "中风险案例能够展示证据", "高", "检查证据卡片和证据详情抽屉", async (r) => {
  const { ctx, page } = await open(MAIN);
  r.steps = ["点击“越南语言/文化表达”", "在第一条发现的“依据”中点击第一条证据", "检查证据详情"];
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  await runDemo(page, "越南语言\\/文化表达");
  await page.locator("li[id^=finding_]").first().locator("ul button").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const t = await dialog.innerText();
  const href = await dialog.getByRole("link", { name: "查看原文" }).getAttribute("href");
  await shot(page, r, "evidence-drawer");
  await remember(page);
  r.pass = t.includes("原文短引") && t.includes("已核验") && /^https?:\/\//.test(href ?? "");
  r.actual = `证据详情打开：${t.split("\n").slice(0, 3).join(" ")}；原文链接 ${href}`;
  await ctx.close();
});

await test(5, "低风险案例不会强行制造风险", "高", "检查无证据时的降级逻辑", async (r) => {
  const { ctx, page } = await open(MAIN);
  r.steps = ["点击“普通安全文案”", "检查是否显示无证据提示且没有任何风险发现"];
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  await runDemo(page, "普通安全文案");
  const text = await page.locator("body").innerText();
  const findings = await page.locator("li[id^=finding_]").count();
  await shot(page, r, "low-risk");
  await remember(page);
  r.pass = text.includes(NO_EVIDENCE) && findings === 0;
  r.actual = `模式 ${lastApi()?.mode}，等级 ${lastApi()?.result?.overall_level}，发现 ${findings} 条，${text.includes(NO_EVIDENCE) ? "显示" : "没有显示"}“${NO_EVIDENCE}”`;
  await ctx.close();
});

await test(6, "输入普通中文广告文案", "中", "检查自定义输入的完整流程", async (r) => {
  const { ctx, page } = await open(MAIN);
  const input = "夏季新款连衣裙，透气面料，多色可选，今天下单立减 50 元。";
  r.steps = ["选择“广告文案”", `输入：${input}`, "点击“开始审查”"];
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  await submitText(page, "广告文案", input);
  await shot(page, r, "custom-ad");
  await remember(page);
  const api = lastApi();
  r.pass = api?.ok === true;
  r.actual = `出现结果页：模式 ${api?.mode}，等级 ${api?.result?.overall_level}，发现 ${api?.result?.findings?.length} 条`;
  await ctx.close();
});

await test(7, "输入空内容", "中", "检查前端按钮禁用和接口 400", async (r) => {
  const { ctx, page } = await open(MAIN);
  r.steps = ["在输入框里只输入空格", "检查“开始审查”是否不可点、是否有提示", "直接调用接口提交空内容"];
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  await page.locator("#audit-text").fill("    ");
  const disabled = await page.getByRole("button", { name: "开始审查" }).isDisabled();
  const hint = (await page.locator("body").innerText()).includes("请输入要审查的内容");
  const api = await page.request.post(MAIN + "/api/audit", { data: { market: "Vietnam", contentType: "advertisement", text: "   " } });
  const body = await api.json();
  await shot(page, r, "empty");
  r.pass = disabled && hint && api.status() === 400 && body.error?.code === "empty";
  r.actual = `按钮${disabled ? "不可点" : "可点"}，${hint ? "有" : "没有"}提示；接口返回 ${api.status()} ${body.error?.code}`;
  await ctx.close();
});

await test(8, "输入超长内容", "中", "检查 3000 字上限", async (r) => {
  const { ctx, page } = await open(MAIN);
  const long = "这是一段很长的商品介绍。".repeat(300).slice(0, 3001);
  r.steps = ["输入 3001 个字", "检查按钮和提示", "直接调用接口提交 3001 个字"];
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  await page.locator("#audit-text").fill(long);
  const disabled = await page.getByRole("button", { name: "开始审查" }).isDisabled();
  const hint = (await page.locator("body").innerText()).includes("内容超过 3000 字，请分段提交");
  const api = await page.request.post(MAIN + "/api/audit", { data: { market: "Vietnam", contentType: "advertisement", text: long } });
  const body = await api.json();
  await shot(page, r, "too-long");
  r.pass = disabled && hint && api.status() === 400 && body.error?.code === "too_long";
  r.actual = `输入 ${long.length} 字：按钮${disabled ? "不可点" : "可点"}，${hint ? "有" : "没有"}提示；接口返回 ${api.status()} ${body.error?.code}`;
  await ctx.close();
});

await test(9, "输入数据库中没有相关证据的内容", "中", "检查无证据时不调用模型、不编造结论", async (r) => {
  const { ctx, page } = await open(MAIN);
  const input = "这款保温杯采用 304 不锈钢内胆，容量 500ml，保温 6 小时。";
  r.steps = ["选择“商品详情页”", `输入：${input}`, "点击“开始审查”"];
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  await submitText(page, "商品详情页", input);
  const text = await page.locator("body").innerText();
  await shot(page, r, "no-evidence");
  await remember(page);
  r.pass = text.includes(NO_EVIDENCE) && lastApi()?.mode === "no_evidence" && lastApi()?.meta?.model === null;
  r.actual = `模式 ${lastApi()?.mode}，模型 ${lastApi()?.meta?.model ?? "未调用"}，${text.includes(NO_EVIDENCE) ? "显示" : "没有显示"}无证据提示`;
  await ctx.close();
});

if (args["db-down"]) {
  await test(10, "数据库暂时不可用", "高", "检查离线快照降级和页面标注", async (r) => {
    const base = args["db-down"].replace(/\/+$/, "");
    const { ctx, page } = await open(base);
    r.steps = ["在 Supabase 地址不可达的实例上打开首页", "点击“越南语言/文化表达”", "检查结果是否标注离线快照"];
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await runDemo(page, "越南语言\\/文化表达");
    const text = await page.locator("body").innerText();
    await shot(page, r, "db-down");
    await remember(page);
    r.pass = text.includes("证据库暂时不可用，已改用离线证据快照") && lastApi()?.meta?.evidenceSource === "offline_snapshot";
    r.actual = `证据来源 ${lastApi()?.meta?.evidenceSource}，降级原因 ${lastApi()?.meta?.fallbackReason}；提示：${lastApi()?.meta?.notices?.join(" ")}`;
    await ctx.close();
  });
} else skip(10, "数据库暂时不可用", "需要一个 Supabase 地址不可达的测试实例（--db-down），公网部署上无法安全模拟");

const RISKY_CUSTOM = "全网销量第一的美白精华，皮肤科医生推荐。";
for (const [no, name, key, expect] of [
  [11, "模型返回超时", "llm-timeout", "模型响应超时"],
  [12, "模型返回非法 JSON", "llm-badjson", "不是有效 JSON"],
]) {
  if (!args[key]) {
    skip(no, name, `需要一个接入故障模型的测试实例（--${key}），公网部署上无法安全模拟`);
    continue;
  }
  await test(no, name, "高", "检查模型失败时的降级和页面标注", async (r) => {
    const base = args[key].replace(/\/+$/, "");
    const { ctx, page } = await open(base);
    r.steps = [`在模型${name.slice(4)}的实例上提交：${RISKY_CUSTOM}`, "检查结果是否降级为规则匹配并标注原因"];
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await submitText(page, "广告文案", RISKY_CUSTOM);
    const text = await page.locator("body").innerText();
    await shot(page, r, key);
    await remember(page);
    r.pass = lastApi()?.mode === "rules_only" && text.includes("规则匹配结果") && text.includes(expect);
    r.actual = `模式 ${lastApi()?.mode}；页面提示：${lastApi()?.meta?.notices?.join(" ")}`;
    await ctx.close();
  });
}

await test(13, "刷新页面", "中", "检查演示直达链接和刷新后的状态", async (r) => {
  const { ctx, page } = await open(MAIN);
  r.steps = ["打开 /?demo=map-store-locator", "等结果出现后刷新页面", "检查结果是否再次出现"];
  await page.goto(MAIN + "/?demo=map-store-locator", { waitUntil: "domcontentloaded" });
  await waitResult(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitResult(page);
  await shot(page, r, "after-reload");
  r.pass = (await page.locator("li[id^=finding_]").count()) > 0;
  r.actual = `刷新后结果再次出现，模式 ${lastApi()?.mode}`;
  await ctx.close();
});

await test(14, "点击证据来源链接", "中", "检查“查看原文”链接", async (r) => {
  const { ctx, page } = await open(MAIN);
  r.steps = ["点击“越南敏感地理素材”", "打开第一条证据", "点击“查看原文”"];
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  await runDemo(page, "越南敏感地理素材");
  await page.locator("li[id^=finding_]").first().locator("ul button").first().click();
  const link = page.getByRole("dialog").getByRole("link", { name: "查看原文" });
  const href = await link.getAttribute("href");
  const target = await link.getAttribute("target");
  const rel = await link.getAttribute("rel");
  const [popup] = await Promise.all([ctx.waitForEvent("page"), link.click()]);
  await popup.waitForLoadState("commit", { timeout: 15_000 }).catch(() => {});
  const opened = popup.url();
  r.pass = /^https?:\/\//.test(href ?? "") && target === "_blank" && (rel ?? "").includes("noopener") && opened.startsWith(href.split("?")[0].slice(0, 30));
  r.actual = `链接 ${href}，在新标签页打开（target=${target}，rel=${rel}）；新标签页地址 ${opened}`;
  await ctx.close();
});

await test(15, "点击复制建议", "低", "检查剪贴板写入", async (r) => {
  const { ctx, page } = await open(MAIN, { clipboard: true });
  r.steps = ["点击“越南语言/文化表达”", "点击第一条发现的“复制修改建议”", "读取剪贴板"];
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  await runDemo(page, "越南语言\\/文化表达");
  const first = page.locator("li[id^=finding_]").first();
  const expected = lastApi()?.result?.findings?.[0]?.recommendation;
  await first.getByRole("button", { name: "复制修改建议" }).click();
  const label = await first
    .getByText("已复制")
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  await shot(page, r, "copied");
  r.pass = label && clip === expected;
  r.actual = `按钮变为“${label ? "已复制" : "未变化"}”；剪贴板内容${clip === expected ? "与建议一致" : "与建议不一致"}：${clip.slice(0, 40)}`;
  await ctx.close();
});

await test(16, "移动端打开", "中", "检查窄屏布局", async (r) => {
  const { ctx, page } = await open(MAIN, { mobile: true });
  r.steps = ["以 390×844 手机尺寸打开首页", "检查是否有横向滚动", "运行“越南敏感地理素材”并打开证据详情"];
  await page.goto(MAIN + "/", { waitUntil: "networkidle" });
  await shot(page, r, "mobile-home");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await runDemo(page, "越南敏感地理素材");
  const overflowResult = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(page, r, "mobile-result");
  await page.locator("li[id^=finding_]").first().locator("ul button").first().click();
  await page.getByRole("dialog").waitFor();
  await shot(page, r, "mobile-drawer");
  await remember(page);
  r.pass = overflow <= 1 && overflowResult <= 1;
  r.actual = `首页横向溢出 ${overflow}px，结果页横向溢出 ${overflowResult}px；证据详情以底部抽屉打开`;
  await ctx.close();
});

await test(17, "候选资料只在演示模式出现，且如实标注", "高", "检查证据过滤", async (r) => {
  r.steps = [
    "汇总本次测试中所有 /api/audit 返回的证据卡片",
    "正式核验模式：每张卡片都是已核验来源，ID 在逐条核验的快照中，且不在 candidate 列表中",
    "演示模式：候选资料卡片必须标注“候选资料/待核验”，只引用候选资料的判断必须是待人工复核",
  ];
  const ok = apiResponses.filter((x) => x.body?.ok);
  const cards = ok.flatMap((x) => x.body.evidence);
  const cited = ok.flatMap((x) => x.body.result.findings.flatMap((f) => f.evidence_ids));
  const bad = ok.flatMap((x) => {
    const demo = x.body.meta?.evidenceMode === "demo";
    const ids = new Set(x.body.evidence.map((c) => c.id));
    return [
      ...x.body.evidence
        .filter((c) =>
          c.tier === "candidate"
            ? !demo || c.tierLabel !== "候选资料/待核验"
            : c.tier !== "verified" || !verifiedIds.has(c.id) || candidateIds.has(c.id),
        )
        .map((c) => c.id),
      ...x.body.result.findings.flatMap((f) => f.evidence_ids).filter((id) => !ids.has(id)),
      ...x.body.result.findings.filter((f) => f.evidence_basis === "candidate_only" && f.severity !== "needs_review").map((f) => f.id),
    ];
  });
  const modes = [...new Set(ok.map((x) => x.body.meta?.evidenceMode ?? "verified_only"))].join("、");
  r.pass = bad.length === 0 && cards.length > 0;
  r.actual = `模式：${modes}；检查了 ${apiResponses.length} 个审查响应、${cards.length} 张证据卡片（其中候选资料 ${cards.filter((c) => c.tier === "candidate").length} 张）、${cited.length} 处引用；candidate 列表 ${candidateIds.size} 条；违规 ${bad.length} 处${bad.length ? `：${[...new Set(bad)].join("、")}` : ""}`;
});

await test(18, "页面不出现 undefined、NaN、调试信息或密钥", "高", "检查页面文字和 HTML", async (r) => {
  r.steps = ["汇总测试中访问过的每个页面的可见文字和 HTML", "查找 undefined、NaN、[object Object]、报错堆栈和密钥字符串", "汇总浏览器控制台报错"];
  const { ctx, page } = await open(MAIN);
  await page.goto(MAIN + "/about", { waitUntil: "networkidle" });
  await shot(page, r, "about");
  await remember(page);
  await ctx.close();
  const problems = [];
  for (const p of pageTexts) {
    const m = p.text.match(/\bundefined\b|\bNaN\b|\[object Object\]|TypeError|ReferenceError|at \S+ \(.+:\d+:\d+\)/);
    if (m) problems.push(`${p.url} 可见文字含“${m[0]}”`);
    for (const s of secrets) if (p.html.includes(s)) problems.push(`${p.url} 的 HTML 含密钥字符串`);
  }
  for (const x of apiResponses) for (const s of secrets) if (JSON.stringify(x.body ?? "").includes(s)) problems.push(`${x.base} 接口响应含密钥字符串`);
  r.pass = problems.length === 0 && consoleErrors.length === 0;
  r.actual = `检查了 ${pageTexts.length} 个页面快照和 ${apiResponses.length} 个接口响应，检查的密钥字符串 ${secrets.length} 个；问题 ${problems.length} 处；控制台报错 ${consoleErrors.length} 条${
    problems.length || consoleErrors.length ? `：${[...problems, ...consoleErrors].slice(0, 5).join("；")}` : ""
  }`;
});

await browser.close();

// ---------- report ----------
const passed = results.filter((r) => r.pass === true).length;
const failed = results.filter((r) => r.pass === false).length;
const skipped = results.filter((r) => r.pass === null).length;
const status = (r) => (r.pass === null ? "未执行" : r.pass ? "通过" : "未通过");
const lines = [
  `## 测试环境：${LABEL}`,
  "",
  `- 地址：${MAIN}`,
  args["db-down"] ? `- 数据库故障实例：${args["db-down"]}` : null,
  args["llm-timeout"] ? `- 模型超时实例：${args["llm-timeout"]}` : null,
  args["llm-badjson"] ? `- 模型非法 JSON 实例：${args["llm-badjson"]}` : null,
  `- 运行时间：${new Date().toISOString()}`,
  `- 模型：${args["model-note"] ?? "见各项实际结果"}`,
  `- 结果：通过 ${passed} 项，未通过 ${failed} 项，未执行 ${skipped} 项`,
  "",
  "| # | 测试项 | 结果 | 严重程度 |",
  "|---|---|---|---|",
  ...results.map((r) => `| ${r.no} | ${r.name} | ${status(r)} | ${r.pass === false ? r.severity : "—"} |`),
  "",
  ...results.flatMap((r) => [
    `### ${r.no}. ${r.name}（${status(r)}）`,
    "",
    `- 测试步骤：${r.steps.length ? r.steps.join(" → ") : "—"}`,
    `- 实际结果：${r.actual || "—"}`,
    `- 是否通过：${status(r)}`,
    `- 错误信息：${r.error || "无"}`,
    `- 截图：${r.shots.length ? r.shots.map((s) => `\`${s}\``).join("、") : "无"}`,
    `- 严重程度：${r.pass === false ? r.severity : "无（未发现问题）"}`,
    `- 修复建议：${r.pass === false ? r.fix : r.pass === null ? r.fix : "无需修复"}`,
    "",
  ]),
].filter((l) => l !== null);

await writeFile(new URL(`e2e/results-${SLUG}.md`, root), lines.join("\n") + "\n");
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped → e2e/results-${SLUG}.md`);
process.exit(failed ? 1 : 0);
