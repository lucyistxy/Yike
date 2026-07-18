create extension if not exists "pgcrypto";

create table if not exists public.entertainment_cards (
  card_id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  source_type text not null check (source_type in ('personal', 'preset')),
  origin_preset_id uuid null,
  source_asset jsonb null,
  title text not null,
  subtitle text null,
  description text null,
  content_category text not null,
  mood_tags text[] not null default '{}',
  duration_min integer not null check (duration_min >= 0),
  duration_max integer not null check (duration_max >= 0),
  energy_level text not null default 'unknown' check (energy_level in ('low', 'medium', 'high', 'unknown')),
  indoor_outdoor text not null default 'unknown' check (indoor_outdoor in ('indoor', 'outdoor', 'flexible', 'unknown')),
  prep_cost text not null default 'unknown' check (prep_cost in ('low', 'medium', 'high', 'unknown')),
  people text not null default 'unknown' check (people in ('solo', 'pair', 'group', 'flexible', 'unknown')),
  budget_level text not null default 'unknown' check (budget_level in ('free', 'low', 'medium', 'high', 'unknown')),
  location_type text not null default 'unknown',
  distance_level text not null default 'unknown',
  reservation_required boolean null,
  ticket_required boolean null,
  weather_dependency text not null default 'unknown',
  constraint_tags text[] not null default '{}',
  available_time_windows text[] not null default '{}',
  avoid_time_windows text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'pending', 'cooling', 'archived', 'completed')),
  eligible_for_draw boolean not null default false,
  missing_fields text[] not null default '{}',
  cooling_until timestamptz null,
  last_recommended_at timestamptz null,
  recommend_count integer not null default 0 check (recommend_count >= 0),
  feedback_summary jsonb not null default '{}',
  confidence jsonb null,
  quality_score numeric null check (quality_score is null or (quality_score >= 0 and quality_score <= 100)),
  rule_version text null,
  score_version text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duration_order check (duration_max >= duration_min)
);

create index if not exists entertainment_cards_user_idx on public.entertainment_cards(user_id);
create index if not exists entertainment_cards_source_status_idx on public.entertainment_cards(source_type, status);
create index if not exists entertainment_cards_draw_idx on public.entertainment_cards(eligible_for_draw, status);

create table if not exists public.user_memory (
  user_id uuid primary key,
  preference_memory jsonb not null default '{}',
  explicit_profile jsonb not null default '{"user_editable": true}',
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback_events (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  card_id uuid not null references public.entertainment_cards(card_id) on delete cascade,
  action text not null check (action in ('accept', 'complete', 'reroll', 'later', 'dislike', 'save_preset')),
  optional_reason text null,
  created_at timestamptz not null default now()
);

create index if not exists feedback_events_user_created_idx on public.feedback_events(user_id, created_at desc);
create index if not exists feedback_events_card_created_idx on public.feedback_events(card_id, created_at desc);

create table if not exists public.recommendation_logs (
  request_id text primary key,
  user_id uuid not null,
  session_id text not null,
  context_snapshot jsonb not null,
  selected_card_id uuid null,
  top5 jsonb not null default '[]',
  excluded_summary jsonb not null default '{}',
  rule_version text not null,
  score_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists recommendation_logs_user_created_idx on public.recommendation_logs(user_id, created_at desc);

alter table public.entertainment_cards enable row level security;
alter table public.user_memory enable row level security;
alter table public.feedback_events enable row level security;
alter table public.recommendation_logs enable row level security;

-- RLS policy placeholders:
-- Replace auth.uid() checks after the product auth model is finalized.
-- For preset cards, user_id is null and may be readable by every signed-in user.

create policy "users can read own and preset cards"
on public.entertainment_cards
for select
using (user_id = auth.uid() or user_id is null);

create policy "users can manage own cards"
on public.entertainment_cards
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can read own memory"
on public.user_memory
for select
using (user_id = auth.uid());

create policy "users can manage own memory"
on public.user_memory
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can read own feedback"
on public.feedback_events
for select
using (user_id = auth.uid());

create policy "users can insert own feedback"
on public.feedback_events
for insert
with check (user_id = auth.uid());

create policy "users can read own recommendation logs"
on public.recommendation_logs
for select
using (user_id = auth.uid());

create policy "users can insert own recommendation logs"
on public.recommendation_logs
for insert
with check (user_id = auth.uid());
