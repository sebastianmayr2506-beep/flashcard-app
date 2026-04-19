-- Run this in the Supabase SQL Editor
-- Drops existing tables (no real data yet) and recreates them correctly.

-- Drop in reverse FK order
drop table if exists public.flag_attempts cascade;
drop table if exists public.card_links cascade;
drop table if exists public.cards cascade;
drop table if exists public.sets cascade;
drop table if exists public.user_settings cascade;
drop table if exists public.shared_sets cascade;

-- ─── 1. Sets ──────────────────────────────────────────────────────────────────
create table public.sets (
  id uuid primary key,
  user_id uuid references auth.users not null,
  name text not null,
  description text,
  subject text,
  examiner text,
  color text default '#6366f1',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.sets enable row level security;
create policy "own sets" on public.sets
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── 2. Cards ─────────────────────────────────────────────────────────────────
create table public.cards (
  id uuid primary key,
  user_id uuid references auth.users not null,
  front text not null default '',
  back text not null default '',
  front_image jsonb,
  back_image jsonb,
  subjects text[] default '{}',
  examiners text[] default '{}',
  difficulty text default 'mittel',
  custom_tags text[] default '{}',
  set_id uuid references public.sets(id) on delete set null,
  flagged boolean default false,
  times_asked integer default 0,
  asked_by_examiners text[] default '{}',
  asked_in_catalogs text[] default '{}',
  probability_percent integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  interval integer default 0,
  repetitions integer default 0,
  ease_factor float default 2.5,
  next_review_date timestamptz default now()
);
alter table public.cards enable row level security;
create policy "own cards" on public.cards
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── 3. Card Links ────────────────────────────────────────────────────────────
-- No FK on card_id/linked_card_id — avoids race condition when importing cards+links together
create table public.card_links (
  id uuid primary key,
  user_id uuid references auth.users not null,
  card_id uuid not null,
  linked_card_id uuid not null,
  link_type text default 'related',
  created_at timestamptz default now(),
  unique(user_id, card_id, linked_card_id)
);
alter table public.card_links enable row level security;
create policy "own card_links" on public.card_links
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── 4. User Settings ─────────────────────────────────────────────────────────
create table public.user_settings (
  user_id uuid primary key references auth.users not null,
  subjects text[] default '{}',
  examiners text[] default '{}',
  custom_tags text[] default '{}',
  study_streak integer default 0,
  last_studied_date text,
  exam_date text,
  daily_new_card_goal integer default 10,
  daily_plan_snapshot jsonb,
  auto_unflag_enabled boolean default true,
  auto_unflag_notification jsonb,
  updated_at timestamptz default now()
);
alter table public.user_settings enable row level security;
create policy "own user_settings" on public.user_settings
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── 5. Flag Attempts ─────────────────────────────────────────────────────────
create table public.flag_attempts (
  id uuid primary key,
  user_id uuid references auth.users not null,
  card_id uuid references public.cards(id) on delete cascade not null,
  answered_correctly boolean not null,
  attempted_at date default current_date not null,
  created_at timestamptz default now()
);
alter table public.flag_attempts enable row level security;
create policy "own flag_attempts" on public.flag_attempts
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── 6. Shared Sets ───────────────────────────────────────────────────────────
create table public.shared_sets (
  id uuid primary key default gen_random_uuid(),
  share_code text unique not null,
  created_by uuid references auth.users not null,
  set_data jsonb not null,
  created_at timestamptz default now()
);
alter table public.shared_sets enable row level security;
create policy "read shared sets"  on public.shared_sets for select using (true);
create policy "create shares"     on public.shared_sets for insert with check (auth.uid() = created_by);
create policy "delete own shares" on public.shared_sets for delete using (auth.uid() = created_by);
