-- ══════════════════════════════════════════════════════════════════════════════
-- PsychAI Tutor — Supabase Schema PATCH v2
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- This patches the existing schema — safe to run on an existing database.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Patch osce_attempts: add columns missing from original schema ─────────────
alter table public.osce_attempts
  add column if not exists training_level   text,
  add column if not exists patient_language text default 'en',
  add column if not exists global_rating    text,
  add column if not exists checklist_score  integer;

-- ── Verify osce_attempts RLS allows inserts ───────────────────────────────────
-- (Already present in original schema but repeating for safety)
drop policy if exists "Users can insert own osce attempts" on public.osce_attempts;
create policy "Users can insert own osce attempts"
  on public.osce_attempts for insert
  with check (auth.uid() = user_id);

-- ── Verify mcq_attempts RLS allows inserts ────────────────────────────────────
drop policy if exists "Users can insert own mcq attempts" on public.mcq_attempts;
create policy "Users can insert own mcq attempts"
  on public.mcq_attempts for insert
  with check (auth.uid() = user_id);

-- ── Verify mse_practice RLS allows inserts ───────────────────────────────────
drop policy if exists "Users can insert own mse practice" on public.mse_practice;
create policy "Users can insert own mse practice"
  on public.mse_practice for insert
  with check (auth.uid() = user_id);

-- ── Add helpful indexes ───────────────────────────────────────────────────────
create index if not exists osce_attempts_user_idx on public.osce_attempts (user_id, attempted_at desc);
create index if not exists mcq_attempts_user_idx  on public.mcq_attempts  (user_id, attempted_at desc);
create index if not exists mse_practice_user_idx  on public.mse_practice  (user_id, practiced_at desc);

-- ══════════════════════════════════════════════════════════════════════════════
-- Done. Run supabase_schema.sql first if this is a fresh database.
-- ══════════════════════════════════════════════════════════════════════════════
