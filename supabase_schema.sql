-- ═══════════════════════════════════════════════════════════════
-- PsychAI Tutor — Supabase Database Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════

-- ── Enable UUID extension (usually already enabled) ──────────
create extension if not exists "uuid-ossp";


-- ── 1. profiles ──────────────────────────────────────────────
-- Auto-created when a user signs up via a trigger below.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text,            -- e.g. "Medical Student", "Resident"
  institution text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 2. user_progress ─────────────────────────────────────────
-- One row per user. Upserted on every progress change.
create table if not exists public.user_progress (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid unique references auth.users(id) on delete cascade,
  cases_completed  text[]      default '{}',   -- array of case IDs
  osce_completed   text[]      default '{}',   -- array of station IDs
  mse_explored     text[]      default '{}',   -- array of domain strings
  ddx_built        integer     default 0,
  mcq_correct      integer     default 0,
  mcq_total        integer     default 0,
  updated_at       timestamptz default now()
);

alter table public.user_progress enable row level security;

create policy "Users can read own progress"
  on public.user_progress for select
  using (auth.uid() = user_id);

create policy "Users can upsert own progress"
  on public.user_progress for insert
  with check (auth.uid() = user_id);

create policy "Users can update own progress"
  on public.user_progress for update
  using (auth.uid() = user_id);


-- ── 3. osce_attempts ─────────────────────────────────────────
create table if not exists public.osce_attempts (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade,
  station_id      text not null,
  station_name    text,
  overall_pass    boolean,
  communication_score integer,
  safety_score    integer,
  clinical_score  integer,
  checklist_score integer,
  transcript      jsonb,          -- full message history
  feedback        jsonb,          -- AI examiner feedback JSON
  attempted_at    timestamptz default now()
);

alter table public.osce_attempts enable row level security;

create policy "Users can read own osce attempts"
  on public.osce_attempts for select
  using (auth.uid() = user_id);

create policy "Users can insert own osce attempts"
  on public.osce_attempts for insert
  with check (auth.uid() = user_id);


-- ── 4. mcq_attempts ──────────────────────────────────────────
create table if not exists public.mcq_attempts (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade,
  question_id text,
  topic       text,
  correct     boolean not null,
  selected    text,
  answer      text,
  attempted_at timestamptz default now()
);

alter table public.mcq_attempts enable row level security;

create policy "Users can read own mcq attempts"
  on public.mcq_attempts for select
  using (auth.uid() = user_id);

create policy "Users can insert own mcq attempts"
  on public.mcq_attempts for insert
  with check (auth.uid() = user_id);


-- ── 5. mse_practice ──────────────────────────────────────────
create table if not exists public.mse_practice (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users(id) on delete cascade,
  practice_type text,            -- "practice" | "learn" | "sample"
  domain        text,            -- MSE domain explored
  eval_result   jsonb,           -- AI evaluation result
  practiced_at  timestamptz default now()
);

alter table public.mse_practice enable row level security;

create policy "Users can read own mse practice"
  on public.mse_practice for select
  using (auth.uid() = user_id);

create policy "Users can insert own mse practice"
  on public.mse_practice for insert
  with check (auth.uid() = user_id);


-- ── 6. app_feedback ──────────────────────────────────────────
create table if not exists public.app_feedback (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid references auth.users(id) on delete set null,  -- null = anonymous
  ease_of_use         integer check (ease_of_use between 1 and 5),
  educational_value   integer check (educational_value between 1 and 5),
  osce_usefulness     integer check (osce_usefulness between 1 and 5),
  case_realism        integer check (case_realism between 1 and 5),
  most_useful_section text,
  liked_most          text,
  suggestions         text,
  recommend           text,      -- "yes" | "probably" | "unsure" | "no"
  submitted_at        timestamptz default now()
);

alter table public.app_feedback enable row level security;

-- Anyone (including anonymous) can insert feedback
create policy "Anyone can submit feedback"
  on public.app_feedback for insert
  with check (true);

-- Only the submitting user can read their own feedback
create policy "Users can read own feedback"
  on public.app_feedback for select
  using (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════════
-- Done! All 6 tables created with RLS policies.
-- ═══════════════════════════════════════════════════════════════


-- ── 7. ai_usage ──────────────────────────────────────────────
-- Tracks daily AI feature usage per user for rate limiting.
-- One row per (user_id, feature, usage_date) combination.
create table if not exists public.ai_usage (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  feature     text not null,             -- "osce" | "ddx" | "mcq" | "mse"
  usage_date  date not null,             -- UTC date "YYYY-MM-DD"
  count       integer not null default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id, feature, usage_date)  -- enforces one row per user/feature/day
);

-- Index for fast lookups by the rate-limiter
create index if not exists ai_usage_lookup
  on public.ai_usage (user_id, feature, usage_date);

-- RLS: users can read their own rows; the server uses the service-role key to write
alter table public.ai_usage enable row level security;

create policy "Users can read own usage"
  on public.ai_usage for select
  using (auth.uid() = user_id);

-- Service-role key bypasses RLS, so no insert/update policy needed for server writes.
-- ═══════════════════════════════════════════════════════════════
