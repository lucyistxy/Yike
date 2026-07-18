insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'card-assets',
  'card-assets',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users can read own card assets" on storage.objects;
drop policy if exists "users can upload own card assets" on storage.objects;
drop policy if exists "users can update own card assets" on storage.objects;
drop policy if exists "users can delete own card assets" on storage.objects;

create policy "users can read own card assets"
on storage.objects
for select
using (
  bucket_id = 'card-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can upload own card assets"
on storage.objects
for insert
with check (
  bucket_id = 'card-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can update own card assets"
on storage.objects
for update
using (
  bucket_id = 'card-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'card-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can delete own card assets"
on storage.objects
for delete
using (
  bucket_id = 'card-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace view public.recommendation_log_top5_audit
with (security_invoker = true)
as
select
  logs.request_id,
  logs.user_id,
  logs.session_id,
  logs.created_at,
  logs.selected_card_id,
  (item.value ->> 'card_id')::uuid as card_id,
  cards.title,
  cards.source_type,
  cards.content_category,
  item.ordinality::integer as rank,
  (item.value ->> 'score')::numeric as total_score,
  ((item.value -> 'score_breakdown') ->> 'energy_score')::numeric as energy_score,
  ((item.value -> 'score_breakdown') ->> 'time_fit_score')::numeric as time_fit_score,
  ((item.value -> 'score_breakdown') ->> 'mood_preference_score')::numeric as mood_preference_score,
  ((item.value -> 'score_breakdown') ->> 'prep_cost_score')::numeric as prep_cost_score,
  ((item.value -> 'score_breakdown') ->> 'weather_time_score')::numeric as weather_time_score,
  ((item.value -> 'score_breakdown') ->> 'feedback_score')::numeric as feedback_score,
  ((item.value -> 'score_breakdown') ->> 'freshness_score')::numeric as freshness_score,
  ((item.value -> 'score_breakdown') ->> 'source_score')::numeric as source_score,
  logs.excluded_summary,
  logs.context_snapshot,
  logs.rule_version,
  logs.score_version
from public.recommendation_logs logs
cross join lateral jsonb_array_elements(logs.top5) with ordinality as item(value, ordinality)
left join public.entertainment_cards cards
  on cards.card_id = (item.value ->> 'card_id')::uuid;

grant select on public.recommendation_log_top5_audit to authenticated;
