create table if not exists public.card_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  input_type text not null check (input_type in ('text', 'image', 'mixed')),
  source_asset jsonb not null default '{}',
  draft jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'saved', 'discarded')),
  saved_card_id uuid null references public.entertainment_cards(card_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists card_drafts_user_created_idx on public.card_drafts(user_id, created_at desc);
create index if not exists card_drafts_status_idx on public.card_drafts(status);

alter table public.card_drafts enable row level security;

create policy "users can read own card drafts"
on public.card_drafts
for select
using (user_id = auth.uid());

create policy "users can insert own card drafts"
on public.card_drafts
for insert
with check (user_id = auth.uid());

create policy "users can update own card drafts"
on public.card_drafts
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());
