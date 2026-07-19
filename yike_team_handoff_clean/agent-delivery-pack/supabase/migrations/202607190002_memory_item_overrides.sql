create table if not exists public.memory_item_overrides (
  override_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  item_key text not null,
  action text not null check (action in ('keep', 'clear')),
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, item_key)
);

create index if not exists memory_item_overrides_user_idx
on public.memory_item_overrides(user_id, updated_at desc);

alter table public.memory_item_overrides enable row level security;

create policy "users can read own memory item overrides"
on public.memory_item_overrides
for select
using (user_id = auth.uid());

create policy "users can manage own memory item overrides"
on public.memory_item_overrides
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());
