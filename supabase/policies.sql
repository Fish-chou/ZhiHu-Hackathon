-- 出海红队：Supabase 行级安全（RLS）配置
-- 用法：Supabase 后台 → SQL Editor → New query → 整段粘贴 → Run。可以重复运行。
-- 运行后，你在 Supabase 后台查看、导入数据不受影响；只有用公开 key 访问时受限。

-- 1) 证据表：公开 key 只能读取越南市场 verified 和 candidate 的记录，读不到 rejected，也不能新增、修改或删除。
--    candidate 只在 EVIDENCE_MODE=demo 时由网站读取并标注“候选资料/待核验”；verified_only 模式的查询条件只有 status=verified。
--    如果不需要演示模式，可以把 using 条件改回 status = 'verified' and market = 'Vietnam'。
alter table public.evidence_records enable row level security;
drop policy if exists "public read verified evidence" on public.evidence_records;
drop policy if exists "public read verified and candidate evidence" on public.evidence_records;
create policy "public read verified and candidate evidence" on public.evidence_records
  for select to anon, authenticated
  using (status in ('verified', 'candidate') and market = 'Vietnam');

-- 2) 审查记录：公开 key 只能新增，不能读取、修改或删除（网站用它记录每次审查的概况）
alter table public.analysis_runs enable row level security;
drop policy if exists "anon insert analysis runs" on public.analysis_runs;
create policy "anon insert analysis runs" on public.analysis_runs
  for insert to anon, authenticated
  with check (true);

alter table public.findings enable row level security;
drop policy if exists "anon insert findings" on public.findings;
create policy "anon insert findings" on public.findings
  for insert to anon, authenticated
  with check (true);

-- 3) 素材表：暂不对公开 key 开放任何权限
alter table public.assets enable row level security;
