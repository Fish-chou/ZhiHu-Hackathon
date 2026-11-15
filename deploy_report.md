# 部署与交付检查报告（deploy_report）

检查时间：2026-11-14 22:00（北京时间）
状态：**已部署**。公网地址 https://chuhai-redteam.netlify.app/ ，代码仓库 https://github.com/Fish-chou/ZhiHu-Hackathon （公开）。本报告只写环境变量名称，不写任何密钥值。

## 部署信息

| 项目 | 内容 |
|---|---|
| 平台 | Netlify（Free 套餐），从 GitHub 仓库 `main` 分支自动构建，推送即重新部署 |
| 构建 | `npm run build`，Next.js 运行时插件 `@netlify/plugin-nextjs` 5.16.6，Node 22 |
| 服务端函数 | 区域 us-east-2，同步执行上限 60 秒；应用的模型超时 40 秒 |
| 大模型 | DeepSeek（`LLM_MODEL=deepseek-chat`，接口实际返回模型名 `deepseek-flash`） |
| 证据库 | Supabase `evidence_records`，已开启行级安全（RLS） |

## 检查结果

| # | 要求 | 状态 | 说明 |
|---|---|---|---|
| 1 | 生成公网可访问 URL | 通过 | 从中国大陆网络实测：首页 1.3–3.3 秒，`/about` 约 2 秒，均返回 200 |
| 2 | 无需登录即可体验三个预置 Demo | 通过 | 公网实测三个演示均由真实模型实时出结果，见下方“公网测试” |
| 3 | Supabase URL 使用环境变量 | 通过 | `SUPABASE_URL`，只在服务端读取 |
| 4 | anon key 使用环境变量 | 通过 | `SUPABASE_PUBLISHABLE_KEY`，只在服务端读取 |
| 5 | service_role key 不进入前端 | 通过 | 项目不使用 service_role key；误配置时程序会拒绝使用 |
| 6 | 模型 API key 不进入前端 | 通过 | 下载公网首页和 `/about` 引用的全部 8 个 JS 文件及页面 HTML，检索不到 Supabase 地址、Supabase key、模型 key |
| 7 | 密码、Token 和密钥不进入 Git | 通过 | GitHub 仓库不含 `.env.local`；推送前对全部文件检索 `.env.local` 中的每个值、GitHub token 和常见密钥格式，无命中 |
| 8 | 检查 .gitignore | 通过 | 忽略 `.env*`（保留 `.env.example`）、`node_modules`、`.next`、`.vercel`、`.netlify` |
| 9 | 检查 git diff 和 git history | 通过 | 每次推送前检查暂存文件和提交历史，无密钥 |
| 10 | 后端只读取 verified evidence | 通过 | 代码层：查询条件和代码各过滤一次。数据库层：已运行 `supabase/policies.sql`，公开 key 只能读到 204 条 `market=Vietnam AND status=verified` 记录，读不到 rejected 记录、`analysis_runs`、`findings`、`assets` |
| 11 | 网络或模型失败时自动切换缓存结果 | 通过 | 三个演示的缓存已用真实模型生成（2026-11-14 21:08，证据来自 Supabase） |
| 12 | 页面显示缓存模式，不伪装成实时结果 | 通过 | 部署初期未配置环境变量时，线上演示如实显示“演示缓存结果……未配置大模型”，`/about` 显示“离线证据快照” |
| 13 | 生成 `.env.example` | 通过 | 所有值为空 |
| 14 | 生成 README | 通过 | 顶部已填写公网地址 |
| 15 | 生成数据库导入说明 | 通过 | README“导入 evidence_records”；RLS 配置见 `supabase/policies.sql` |
| 16 | 生成本地启动说明 | 通过 | README“本地启动” |
| 17 | 生成部署说明 | 通过 | README“部署”（Netlify 实际步骤） |
| 18 | 生成数据来源和局限性说明 | 通过 | README“数据来源”“已知限制”，网站 `/about` 页面 |

## 公网测试（2026-11-14 21:56–22:00，中国大陆网络）

| 测试 | 结果 |
|---|---|
| `/about` 证据来源 | “实时读取自 Supabase 证据库”，可用于审查的 verified 证据 80 条（其余 verified 记录因缺少原文、来源或摘要不参与审查） |
| 演示：越南敏感地理素材 | 实时模型，潜在高风险，3 条发现 |
| 演示：越南语言/文化表达 | 实时模型，中风险，7 条发现 |
| 演示：普通安全文案 | 未找到可核验依据，低风险，未调用模型（符合预期） |
| 自定义广告文案（“越南独家首发……全网销量第一……皮肤科医生推荐，7 天见效”） | 12.3 秒返回，实时模型，中风险，6 条发现，引用 4 条证据，全部在 verified 快照中 |
| 审查记录写入 | 开启 RLS 后，上述每次审查都写入了 `analysis_runs` / `findings`（只存原文 SHA-256 和字数） |

本次是接口级测试，没有在公网上运行浏览器端到端脚本 `e2e/run-e2e.mjs`；页面交互以本地生产构建的 E2E 结果为准（见 `functional_test_report.md`）。

## 环境变量清单（只列名称）

| 变量 | 本地 `.env.local` | Netlify |
|---|---|---|
| `SUPABASE_URL` | 已填 | 已填 |
| `SUPABASE_PUBLISHABLE_KEY` | 已填 | 已填 |
| `LLM_BASE_URL` | 已填（DeepSeek） | 已填 |
| `LLM_API_KEY` | 已填 | 已填 |
| `LLM_MODEL` | 已填（deepseek-chat） | 已填 |
| `LLM_TIMEOUT_MS`、`AUDIT_RATE_LIMIT`、`AUDIT_LOG_DISABLED` | 未填，使用默认值 | 未填，使用默认值 |

Netlify 中的变量均未标记为 “Contains secret values”：`LLM_BASE_URL`、`LLM_MODEL` 的值出现在 README 中，标记为机密会触发 Netlify 密钥扫描导致构建失败。

## 仍需注意

| 事项 | 说明 |
|---|---|
| DeepSeek 余额 | 余额用完后，自定义输入会降级为规则匹配结果，演示案例显示缓存结果 |
| 频率限制 | 每个 IP 每分钟 10 次实时审查，只在单个服务实例内生效 |
| README“数据来源”统计 | 仍是早期快照数字（207 条、verified 51 条）；当前数据库为 verified 204 条、rejected 3 条，其中 153 条为批量改为 verified。网站 `/about` 显示的是实时统计 |
| 公网浏览器 E2E | 未运行，见上方说明 |
