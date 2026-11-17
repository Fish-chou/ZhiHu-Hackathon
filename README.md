# 出海红队：越南市场发布前风险审查工具

帮助中国电商和品牌团队，在向越南市场发布广告、商品页或客服内容之前，发现可能存在的文化、语言、地缘政治、平台和产品表达风险，并给出有来源的修改建议。

- 在线体验：**https://chuhai-redteam.netlify.app/** （无需登录；中国大陆网络可直接访问）
- 部署检查：[deploy_report.md](deploy_report.md)
- 产品规格：[PRODUCT_SPEC.md](PRODUCT_SPEC.md)
- 证据审计：[audit_report.md](audit_report.md)
- 功能测试：[functional_test_report.md](functional_test_report.md)

> 审查结果仅作发布前风险提示，不构成法律意见，不替代当地律师或市场团队。

## 目标用户

跨境电商卖家和品牌出海团队的内容运营、出海代运营公司、广告和设计代理、直播和短视频团队、客服团队。以上是产品假设，尚未经过用户访谈验证。

## 核心流程

```text
用户输入广告文案、商品页文本或客服话术
→ 系统用风险信号词表提取关键表达
→ 按证据使用模式查询 Supabase evidence_records（见下一节）
→ 大模型只依据这些证据判断风险，每条证据都标明“已核验来源”或“候选资料/待核验”
→ 程序校验：结构、证据 ID、证据等级、禁用表述、强制人工复核
→ 返回风险等级、问题位置、证据、修改建议和待人工确认事项
```

## 证据使用模式（EVIDENCE_MODE）

| | 正式核验模式 `verified_only` | 演示模式 `demo` |
|---|---|---|
| 页面顶部标识 | 正式核验模式 | 演示模式 |
| 查询条件 | `status=verified` | `status in (verified, candidate)`，分页读取 |
| 可以进入模型和证据卡片的记录 | 只有逐条核验的 verified 记录 | 已核验来源 + 候选资料 |
| 证据卡片标注 | 已核验来源 | 已核验来源 / 候选资料/待核验 |
| 只引用候选资料的判断 | 不会出现 | 风险等级强制降为 `needs_review`（待人工复核），并强制人工复核 |
| 确定性结论 | 禁用“违法”“一定违规”“越南消费者普遍认为”等 | 同左；凡引用了候选资料的判断，再额外改写“消费者普遍认为”“构成违规”“一定会”“一律禁止”等 |
| rejected 记录 | 不读取 | 不读取 |

- 不设置或填错时默认 `verified_only`。修改后需要重新部署才生效（页面顶部标识在构建时确定）。
- 两种模式都**不修改** `evidence_records.status`。网站对证据表只有读取，写入只发生在 `analysis_runs` 和 `findings`，测试中有静态检查。
- 2026-11-14 从 candidate 批量改为 verified 的 153 条记录（名单见 `src/data/bulk-verified.json`）没有逐条核对来源。数据库中的状态保持原样，但网站一律按“候选资料/待核验”处理：正式核验模式不使用，演示模式标为候选资料。
- 候选资料多由表格转换而来，大多没有来源链接；卡片上会写“无来源链接”。原文字段只有“—”等占位符时，改为显示“原始资料行”。
- 演示模式下，每次检索最多放入 8 条候选资料，其余名额优先给已核验来源。
- 演示缓存（模型失败时的备用结果）只在 `verified_only` 下生成，只引用逐条核验的证据，两种模式都可以安全展示。

当前线上使用演示模式。提交正式版时，在 Netlify 把 `EVIDENCE_MODE` 改为 `verified_only` 并重新部署即可，代码不需要改动。

失败时的降级：

| 情况 | 结果 | 页面标注 |
|---|---|---|
| 证据库没有相关记录 | 不调用模型，直接说明“未找到可核验依据” | 未找到可核验依据，不建议据此作出发布决定 |
| Supabase 不可用 | 改用离线 verified 快照 | 离线证据快照（导出日期） |
| 模型未配置、超时、出错或返回非法 JSON | 演示案例显示缓存结果；自定义输入显示规则匹配结果 | 演示缓存结果 / 规则匹配结果（未经模型分析） |

## 技术栈

Next.js 16（App Router）、React 19、TypeScript、Tailwind CSS 4、Supabase（PostgreSQL，经 REST 接口只读访问）、Zod、Vitest、Playwright。大模型通过 OpenAI 兼容接口接入，DeepSeek、通义千问、Kimi、OpenAI 等都可以。

## 环境变量

复制 `.env.example` 为 `.env.local` 后填写。所有变量只在服务端读取，不要加 `NEXT_PUBLIC_` 前缀。

| 变量 | 必填 | 说明 |
|---|---|---|
| `SUPABASE_URL` | 否 | Supabase 项目地址。不填时进入离线演示模式 |
| `SUPABASE_PUBLISHABLE_KEY` | 否 | publishable（anon）key。也接受 `SUPABASE_ANON_KEY`。**不能用** service_role / secret key，程序会拒绝 |
| `LLM_BASE_URL` | 否 | 模型的 OpenAI 兼容地址，如 `https://api.deepseek.com` |
| `LLM_API_KEY` | 否 | 模型密钥 |
| `LLM_MODEL` | 否 | 模型名称，如 `deepseek-chat` |
| `EVIDENCE_MODE` | 否 | `demo`（演示模式）或 `verified_only`（正式核验模式，默认）。见“证据使用模式” |
| `LLM_TIMEOUT_MS` | 否 | 模型超时，默认 40000 |
| `AUDIT_RATE_LIMIT` | 否 | 每个 IP 每分钟最多实时审查次数，默认 10 |
| `AUDIT_LOG_DISABLED` | 否 | 设为 `1` 时不写审查记录 |

`.env*` 已在 `.gitignore` 中忽略（`.env.example` 除外），密钥不会进入 Git。

## 数据库

Supabase 中有四张表：

| 表 | 用途 |
|---|---|
| `evidence_records` | 证据库：真实案例、官方规则、风险信号、知乎内容等，用 `record_type` 区分，`status` 标注核验状态 |
| `analysis_runs` | 每次审查的概况：内容类型、模式、等级、模型名。**不保存用户原文**，只保存原文的 SHA-256 和字数 |
| `findings` | 每次审查的发现：类别、等级、解释、引用的证据 ID |
| `assets` | 预留，当前未使用 |

### verified、candidate、rejected 的区别

- **verified**：数据侧已打开原始来源，核对过标题、链接和引文，网站标为“已核验来源”。两种模式都使用。对知乎内容来说，verified 只表示内容存在且与链接一致，不表示作者的说法正确。批量标记的 153 条除外，见上一节。
- **candidate**：有一定价值但证据不足。只在演示模式下读取，标为“候选资料/待核验”。
- **rejected**：已排除，任何模式都不读取。

### 导入 evidence_records

1. 数据侧按 33 列的统一表头导出 UTF-8 CSV（表头见 `src/lib/types.ts` 中的 `EvidenceRecord`）。
2. Supabase 后台 → Table Editor → `evidence_records` → Insert → Import data from CSV，选择文件后确认列名映射并导入。
3. 在 SQL Editor 中检查：

```sql
select record_type, status, count(*) from evidence_records group by 1, 2 order by 1, 2;
select id from evidence_records where status = 'verified' and (source_url is null or source_url = '');
```

4. **上线前必须运行** `supabase/policies.sql`：开启行级安全，让公开 key 只能读取越南市场的 verified 和 candidate 记录（读不到 rejected），只能新增审查记录。
5. 更新离线快照（可选）：把 `market=Vietnam AND status=verified` 的记录原样导出为 `src/data/evidence-snapshot.json`（格式见文件开头的说明字段），不得手工增改。

## 本地启动

需要 Node.js 20.9 或更高版本。

```bash
npm install                      # 国内网络慢时：npm install --registry=https://registry.npmmirror.com
cp .env.example .env.local       # Windows：copy .env.example .env.local，然后填写
npm run dev                      # 打开 http://localhost:3000
```

其他命令：

```bash
npm run lint         # 代码检查
npm run typecheck    # 类型检查
npm test             # 单元和接口测试（51 项，不需要网络和密钥）
npm run build && npm start   # 生产模式
node scripts/generate-demo-cache.mjs http://localhost:3000   # 用真实模型重新生成演示缓存
```

端到端测试见 `functional_test_report.md`。

## 部署

任何能运行 Node.js 20.9+ 的平台都可以：`npm ci && npm run build && npm start`，并在平台上配置上面的环境变量。

**Netlify**（当前使用）：Netlify 中 Add new project → Import from GitHub，选择本仓库，构建设置由 `netlify.toml` 自动读取。在 Project configuration → Environment variables 中填写环境变量（可用 Import from a .env file 一次性导入），**不要**勾选 “Contains secret values”：`LLM_BASE_URL`、`LLM_MODEL` 的值在本 README 中出现，标记为机密会触发 Netlify 密钥扫描导致构建失败。改环境变量后需在 Deploys → Trigger deploy 重新部署才生效。推送到 `main` 分支会自动重新部署。Netlify 函数同步执行上限为 60 秒，应用的模型超时默认 40 秒。

**Vercel**：把代码推到 GitHub，在 Vercel 中 Import 该仓库，Framework 选 Next.js，在 Settings → Environment Variables 中填写环境变量后部署。注意：`*.vercel.app` 域名在中国大陆经常无法直接访问。如果评委在国内，需要绑定自己的域名，或改用国内能访问的平台。

部署完成后：

1. 确认已运行 `supabase/policies.sql`；
2. 打开 `/about`，确认证据来源显示“实时读取自 Supabase 证据库”；
3. 点击三个演示按钮确认能出结果；
4. 用 `node e2e/run-e2e.mjs --main <公网地址> --label "public deployment"` 跑浏览器端到端测试。

## Demo 使用方法

1. 打开首页，点击“用演示素材试一试”下的任一按钮，系统会立刻审查：
   - 越南敏感地理素材：官网门店页的地图与地名表述；
   - 越南语言/文化表达：护肤品广告的绝对化用语、竞品比较、医生背书；
   - 普通安全文案：客服发货通知，用来展示系统不会强行判定风险。
2. 结果页左侧是原文，有问题的句子画了标记线并带编号；右侧是逐条发现。点击“依据”下的证据查看详情，点“查看原文”打开来源。
3. 也可以直接粘贴自己的文案审查。演示案例也可以通过 `/?demo=map-store-locator`、`/?demo=skincare-ad`、`/?demo=cs-shipping-reply` 直接打开。

演示素材都是合成内容，品牌是虚构的，不是客户数据。

## 数据来源

证据库由独立的数据采集流程建立，开发侧不新增、不改写任何证据。截至 2026-11-14，共 207 条记录，其中 verified 51 条：

| 类型 | verified | 主要来源 |
|---|---:|---|
| 真实案例 incident | 20 | 越南官方媒体和通讯社（越通社、VnExpress、Tuổi Trẻ、Lao Động 等）、国际媒体报道 |
| 官方规则 official_rule | 7 | 越南政府法规库 vanban.chinhphu.vn |
| 风险信号 risk_rule | 14 | 越南法律英译本（WIPO Lex、LuatVietnam）、越南外交部官网 |
| 知乎内容 zhihu | 10 | 知乎公开文章和回答 |

网站“数据与限制”页面显示证据库的实时统计。

## 没有客户访谈和商品详情样本

本项目**没有有效的客户访谈数据**，也**没有有效的越南电商商品详情页样本**。因此产品不声称完成了客户验证，不声称了解越南消费者的普遍偏好，不声称能预测商品是否畅销，也没有任何准确率数字。演示一律使用合成素材。

## 已知限制

- 只支持越南市场和文本审查，暂不支持图片识别。
- 检索基于风险信号词表，词表没有覆盖的表达可能漏检。
- 证据库中没有平台规则、售后和物流类的已核验记录，相关内容多数只能提示“未找到可核验依据”。
- 部分法规来源是英译本，不等同于越南语官方原文。
- 没有越南语母语审校，不能替代本地团队的语感判断。
- 10 条已核验知乎记录在测试环境中被知乎反爬拦截，无法独立复核，见 `audit_report.md`。
- 频率限制只在单个服务实例内生效。
