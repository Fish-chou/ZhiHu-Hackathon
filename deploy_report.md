# 部署与交付检查报告（deploy_report）

检查时间：2026-11-14
状态：**尚未部署**。按项目负责人决定，暂不部署到公网。以下是已经完成的部署前检查，以及部署时还需要完成的事项。本报告只写环境变量名称，不写任何密钥值。

## 检查结果

| # | 要求 | 状态 | 说明 |
|---|---|---|---|
| 1 | 生成公网可访问 URL | 未完成 | 暂不部署 |
| 2 | 无需登录即可体验三个预置 Demo | 本地已验证 | 本地生产构建 E2E 第 2 项通过；公网待验证 |
| 3 | Supabase URL 使用环境变量 | 通过 | `SUPABASE_URL`，只在服务端读取 |
| 4 | anon key 使用环境变量 | 通过 | `SUPABASE_PUBLISHABLE_KEY`（兼容 `SUPABASE_ANON_KEY`），只在服务端读取 |
| 5 | service_role key 不进入前端 | 通过 | 项目不使用 service_role key；如果误配置 secret / service_role key，程序会拒绝使用 |
| 6 | 模型 API key 不进入前端 | 通过 | `LLM_API_KEY` 只在服务端读取；构建产物 `.next/static` 中检索不到 Supabase 地址、key 或证据数据 |
| 7 | 密码、Token 和密钥不进入 Git | 通过（模拟检查） | 在临时目录对项目做了一次 `git add -A`：72 个待提交文件中不含 `.env.local`，也不含 Supabase key 字符串 |
| 8 | 检查 .gitignore | 通过 | 忽略 `.env*`（保留 `.env.example`）、`node_modules`、`.next`、`.vercel` |
| 9 | 检查 git diff 和 git history | 未执行 | 项目文件夹还不是 Git 仓库，没有提交历史；部署时初始化仓库后需要再检查一次 |
| 10 | 后端只读取 verified evidence | 通过 | 查询条件和代码各过滤一次；接口测试与 E2E 第 17 项通过 |
| 11 | 网络或模型失败时自动切换缓存结果 | 部分完成 | 降级逻辑已实现并测试通过；**演示缓存文件还是空的**（见下方阻塞项），目前模型失败时演示案例会显示规则匹配结果 |
| 12 | 页面显示缓存模式，不伪装成实时结果 | 通过 | 缓存、规则匹配、离线快照三种模式都有页面标注；E2E 第 10–12 项通过 |
| 13 | 生成 `.env.example` | 通过 | 已生成，所有值为空 |
| 14 | 生成 README | 通过 | `README.md` |
| 15 | 生成数据库导入说明 | 通过 | README“导入 evidence_records”一节；RLS 配置见 `supabase/policies.sql` |
| 16 | 生成本地启动说明 | 通过 | README“本地启动”一节 |
| 17 | 生成部署说明 | 通过 | README“部署”一节 |
| 18 | 生成数据来源和局限性说明 | 通过 | README“数据来源”“已知限制”，网站 `/about` 页面 |

## 环境变量清单（只列名称）

| 变量 | 本地 `.env.local` 是否已填 | 部署平台需要填写 |
|---|---|---|
| `SUPABASE_URL` | 已填 | 是 |
| `SUPABASE_PUBLISHABLE_KEY` | 已填 | 是 |
| `LLM_BASE_URL` | 已填（DeepSeek） | 是 |
| `LLM_API_KEY` | 已填 | 是 |
| `LLM_MODEL` | 已填（deepseek-chat） | 是 |
| `LLM_TIMEOUT_MS`、`AUDIT_RATE_LIMIT`、`AUDIT_LOG_DISABLED` | 未填，使用默认值 | 可选 |

## 阻塞项

| 阻塞项 | 影响 | 处理方式 |
|---|---|---|
| DeepSeek 账户余额不足：接口返回 HTTP 402 Insufficient Balance（密钥本身通过了认证） | 无法用真实模型生成演示缓存（第 5 步），线上实时审查会降级为规则匹配结果 | 在 DeepSeek 开放平台充值后，运行 `node scripts/generate-demo-cache.mjs <地址>` 生成缓存，再重跑 E2E |
| `evidence_records` 尚未开启 RLS：公开 key 仍能读到 156 条 candidate / rejected 记录 | 上线后任何人都能用公开 key 直接读取未核验数据，可能还能写入 | 上线前在 Supabase SQL Editor 运行 `supabase/policies.sql` |
| 未部署 | 第 7 步公网测试、第 9 步演示材料无法完成 | 确定部署平台后进行；国内评委需考虑 `*.vercel.app` 在大陆不稳定 |

## 部署时的检查清单

1. 运行 `supabase/policies.sql`，确认公开 key 只能读到 verified 记录。
2. 初始化 Git 仓库，提交前再运行一次 `git status`，确认没有 `.env.local`。
3. 在部署平台填写上表中的环境变量。
4. 部署后打开首页和 `/about`，确认证据统计显示“实时读取自 Supabase 证据库”。
5. 用真实模型生成演示缓存，重新部署。
6. 运行 `node e2e/run-e2e.mjs --main <公网地址> --label "public deployment"`，把结果补进 `functional_test_report.md`。
7. 在 README 顶部填写公网地址。
