-- ══════════════════════════════════════════════════════════════════════════════
-- PsychAI Tutor — Supabase Schema Patch v2
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run on existing databases (uses IF NOT EXISTS / DROP IF EXISTS).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. osce_attempts: add missing columns ────────────────────────────────────
alter table public.osce_attempts
  add column if not exists training_level   text,
  add column if not exists patient_language text default 'en',
  add column if not exists global_rating    text,
  add column if not exists checklist_score  integer;

-- ── 2. profiles: ensure insert policy exists ─────────────────────────────────
-- The trigger creates rows but the frontend also upserts as a safety net.
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can upsert own profile" on public.profiles;

-- ── 3. user_progress: fix upsert — needs BOTH insert AND update policies ─────
-- upsert = insert on first write, update on subsequent writes.
-- Both policies must exist or the upsert fails with RLS violation.
drop policy if exists "Users can upsert own progress" on public.user_progress;
drop policy if exists "Users can read own progress"   on public.user_progress;
drop policy if exists "Users can update own progress" on public.user_progress;

create policy "Users can read own progress"
  on public.user_progress for select
  using (auth.uid() = user_id);

create policy "Users can insert own progress"
  on public.user_progress for insert
  with check (auth.uid() = user_id);

create policy "Users can update own progress"
  on public.user_progress for update
  using (auth.uid() = user_id);

-- ── 4. osce_attempts: ensure insert policy ───────────────────────────────────
drop policy if exists "Users can insert own osce attempts" on public.osce_attempts;
create policy "Users can insert own osce attempts"
  on public.osce_attempts for insert
  with check (auth.uid() = user_id);

-- ── 5. mcq_attempts: ensure insert policy ────────────────────────────────────
drop policy if exists "Users can insert own mcq attempts" on public.mcq_attempts;
create policy "Users can insert own mcq attempts"
  on public.mcq_attempts for insert
  with check (auth.uid() = user_id);

-- ── 6. mse_practice: ensure insert policy ────────────────────────────────────
drop policy if exists "Users can insert own mse practice" on public.mse_practice;
create policy "Users can insert own mse practice"
  on public.mse_practice for insert
  with check (auth.uid() = user_id);

-- ── 7. Add indexes for query performance ─────────────────────────────────────
create index if not exists osce_attempts_user_idx on public.osce_attempts (user_id, attempted_at desc);
create index if not exists mcq_attempts_user_idx  on public.mcq_attempts  (user_id, attempted_at desc);
create index if not exists mse_practice_user_idx  on public.mse_practice  (user_id, practiced_at desc);

-- ── 8. Verify handle_new_user trigger exists ─────────────────────────────────
-- Re-create the trigger function in case it was lost
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, created_at, updated_at)
  values (new.id, new.email, now(), now())
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ══════════════════════════════════════════════════════════════════════════════
-- Verification queries (run these after the patch to confirm):
-- ══════════════════════════════════════════════════════════════════════════════
-- select schemaname, tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename, cmd;
-- select count(*) from public.profiles;
-- select count(*) from public.user_progress;
-- ══════════════════════════════════════════════════════════════════════════════
