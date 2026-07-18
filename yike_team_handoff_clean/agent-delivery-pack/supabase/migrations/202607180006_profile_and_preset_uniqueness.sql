create unique index if not exists entertainment_cards_preset_unique_title_idx
on public.entertainment_cards (lower(btrim(title)))
where source_type = 'preset';

create or replace view public.preset_card_duplicate_audit
with (security_invoker = true)
as
select
  lower(btrim(title)) as normalized_title,
  count(*) as duplicate_count,
  array_agg(card_id order by created_at) as card_ids,
  array_agg(title order by created_at) as titles
from public.entertainment_cards
where source_type = 'preset'
group by lower(btrim(title))
having count(*) > 1;

grant select on public.preset_card_duplicate_audit to authenticated;
