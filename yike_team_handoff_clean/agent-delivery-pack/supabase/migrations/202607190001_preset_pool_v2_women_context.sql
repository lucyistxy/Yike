update public.entertainment_cards
set
  content_category = case
    when content_category in ('music', 'home_activity', 'shopping', 'social', 'event') then 'other'
    when content_category in ('cafe', 'restaurant') then 'food'
    else content_category
  end,
  source_asset = coalesce(source_asset, '{}'::jsonb) || '{"source":"preset_v2","tone":"women_lifestyle","context_tags":["time","weather","safety"]}'::jsonb,
  updated_at = now()
where source_type = 'preset';

insert into public.entertainment_cards (
  card_id,
  user_id,
  source_type,
  source_asset,
  title,
  subtitle,
  description,
  content_category,
  mood_tags,
  duration_min,
  duration_max,
  energy_level,
  indoor_outdoor,
  prep_cost,
  people,
  budget_level,
  location_type,
  distance_level,
  reservation_required,
  ticket_required,
  weather_dependency,
  constraint_tags,
  status,
  eligible_for_draw,
  missing_fields,
  quality_score,
  rule_version,
  score_version,
  notes
) values
  ('00000000-0000-4000-8000-000000000125', null, 'preset', '{"source":"preset_v2","tone":"women_lifestyle","context_tags":["rain","indoor"]}', '做一次低成本居家美甲', '不用出门也能有一点新鲜感', '挑一个收藏过的甲油、贴片或款式图，只做一只手或一个简单色系。', 'craft', array['beauty','home','creative','quiet'], 60, 120, 'low', 'indoor', 'medium', 'solo', 'low', 'home', 'none', false, false, 'indoor_friendly', array['beauty','indoor'], 'active', true, array[]::text[], 88, 'filter_v1', 'score_v1', '女性向生活方式预置卡'),
  ('00000000-0000-4000-8000-000000000126', null, 'preset', '{"source":"preset_v2","tone":"women_lifestyle","context_tags":["late_night","safe_route"]}', '约一家明亮商场里的甜品店', '晚一点也尽量选安全路线', '选择商场或主路附近的甜品店，提前确认营业时间和回程路线。', 'food', array['food','sweet','safe_route','nearby'], 60, 90, 'medium', 'outdoor', 'medium', 'pair', 'medium', 'nearby', 'short', false, false, 'weather_sensitive', array['safe_route','transport_optional','late_night_risk'], 'active', true, array[]::text[], 86, 'filter_v1', 'score_v1', '女性向生活方式预置卡'),
  ('00000000-0000-4000-8000-000000000127', null, 'preset', '{"source":"preset_v2","tone":"women_lifestyle","context_tags":["rain","indoor"]}', '看一期妆造或穿搭视频', '把收藏变成一点点灵感', '选一个 20 到 40 分钟的妆造、穿搭或审美类视频，只收藏一个明天想试的小点。', 'other', array['beauty','visual','home','relax'], 20, 45, 'low', 'indoor', 'low', 'solo', 'free', 'home', 'none', false, false, 'indoor_friendly', array['screen_time'], 'active', true, array[]::text[], 82, 'filter_v1', 'score_v1', '女性向生活方式预置卡'),
  ('00000000-0000-4000-8000-000000000128', null, 'preset', '{"source":"preset_v2","tone":"women_lifestyle","context_tags":["afternoon","exhibition"]}', '去看一个香氛或生活方式展', '轻轻逛，不赶场', '选择交通方便、展期明确的小型展或品牌快闪，提前看好闭馆时间。', 'exhibition', array['beauty','culture','city','visual'], 75, 120, 'medium', 'outdoor', 'medium', 'solo', 'medium', 'city', 'medium', false, true, 'weather_sensitive', array['ticket_needed','transport_needed','safe_route'], 'active', true, array[]::text[], 84, 'filter_v1', 'score_v1', '女性向生活方式预置卡'),
  ('00000000-0000-4000-8000-000000000129', null, 'preset', '{"source":"preset_v2","tone":"women_lifestyle","context_tags":["indoor","book"]}', '读一篇女性叙事短篇', '不求读完一本', '选一本女性作者、散文或小说集，只读一篇，给今晚留一点安静。', 'book', array['quiet','women','home','literary'], 25, 50, 'low', 'indoor', 'low', 'solo', 'free', 'home', 'none', false, false, 'indoor_friendly', array[]::text[], 'active', true, array[]::text[], 82, 'filter_v1', 'score_v1', '女性向生活方式预置卡'),
  ('00000000-0000-4000-8000-000000000130', null, 'preset', '{"source":"preset_v2","tone":"women_lifestyle","context_tags":["night","indoor"]}', '玩一会儿治愈系经营游戏', '让脑子从待办里出来', '选择一款画风舒服、可暂停的经营、装扮或收纳类游戏，玩一个小目标。', 'game', array['cozy','home','playful','relax'], 35, 70, 'low', 'indoor', 'low', 'solo', 'free', 'home', 'none', false, false, 'indoor_friendly', array['screen_time'], 'active', true, array[]::text[], 84, 'filter_v1', 'score_v1', '女性向生活方式预置卡')
on conflict (card_id) do update set
  source_asset = excluded.source_asset,
  title = excluded.title,
  subtitle = excluded.subtitle,
  description = excluded.description,
  content_category = excluded.content_category,
  mood_tags = excluded.mood_tags,
  duration_min = excluded.duration_min,
  duration_max = excluded.duration_max,
  energy_level = excluded.energy_level,
  indoor_outdoor = excluded.indoor_outdoor,
  prep_cost = excluded.prep_cost,
  people = excluded.people,
  budget_level = excluded.budget_level,
  location_type = excluded.location_type,
  distance_level = excluded.distance_level,
  reservation_required = excluded.reservation_required,
  ticket_required = excluded.ticket_required,
  weather_dependency = excluded.weather_dependency,
  constraint_tags = excluded.constraint_tags,
  status = excluded.status,
  eligible_for_draw = excluded.eligible_for_draw,
  missing_fields = excluded.missing_fields,
  quality_score = excluded.quality_score,
  rule_version = excluded.rule_version,
  score_version = excluded.score_version,
  notes = excluded.notes,
  updated_at = now();

update public.entertainment_cards
set
  status = 'active',
  cooling_until = null,
  updated_at = now()
where source_type = 'personal'
  and status = 'cooling'
  and coalesce((feedback_summary ->> 'accept')::int, 0) > 0
  and coalesce((feedback_summary ->> 'reroll')::int, 0) = 0
  and coalesce((feedback_summary ->> 'not_suitable')::int, 0) = 0
  and coalesce((feedback_summary ->> 'later')::int, 0) = 0
  and coalesce((feedback_summary ->> 'dislike')::int, 0) = 0;
