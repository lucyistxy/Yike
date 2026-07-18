# Supabase 技术路径

## 阶段 1：真实推荐内核验证

目标：先用本地 fixtures 验证规则正确性，再让线上函数只读 Supabase 表。

做法：

- 本地测试使用 `fixtures/` 验证硬过滤、打分、Top 5。
- 线上 Edge Function 不接受前端传入临时候选卡。
- Product Mode 从 `entertainment_cards`、`user_memory`、`feedback_events` 读取真实数据。

## 阶段 2：接 Supabase 数据表

建议表：

### entertainment_cards

用途：存个人卡和预置卡。

关键字段：

```text
card_id uuid primary key
user_id uuid nullable
source_type text
title text
content_category text
duration_min int
duration_max int
energy_level text
indoor_outdoor text
prep_cost text
people text
budget_level text
constraint_tags text[]
mood_tags text[]
status text
eligible_for_draw boolean
missing_fields text[]
cooling_until timestamptz nullable
last_recommended_at timestamptz nullable
feedback_summary jsonb
created_at timestamptz
updated_at timestamptz
```

### user_memory

用途：存显式偏好和轻量长期记忆。

关键字段：

```text
user_id uuid primary key
preference_memory jsonb
explicit_profile jsonb
updated_at timestamptz
```

`explicit_profile` 承接首登固定个性化信息，例如城市、时区、默认可用时间、默认预算、是否愿意出门、常见同伴、内容偏好、饮食/行动限制等。

`preference_memory` 承接推荐内核直接使用的轻量偏好，例如：

```text
category_weights
duration_preference
indoor_outdoor_preference
```

### feedback_events

用途：存用户反馈行为。

关键字段：

```text
event_id uuid primary key
user_id uuid
card_id uuid
action text
optional_reason text nullable
created_at timestamptz
```

### recommendation_logs

用途：调试和复现推荐。

关键字段：

```text
request_id text primary key
user_id uuid
context_snapshot jsonb
selected_card_id uuid nullable
top5 jsonb
excluded_summary jsonb
rule_version text
score_version text
created_at timestamptz
```

当前已提供迁移：

```text
supabase/migrations/202607180001_yike_agent_core.sql
```

当前已提供本地种子数据：

```text
supabase/seed.sql
```

## 阶段 3：Product Mode 推荐接口

当前已实现 Supabase 数据读取：

```text
supabase/functions/_shared/repository.ts
supabase/functions/recommendations/index.ts
```

Product Mode 行为：

- 不传 `cards` 时，从 `entertainment_cards` 读取个人卡和预置卡。
- 从 `user_memory` 和 `feedback_events` 读取记忆。
- 调用确定性 `recommend()`。
- 写入 `recommendation_logs`。

## 阶段 4：反馈写回

当前已实现：

```text
supabase/functions/feedback/index.ts
```

行为：

- 写入 `feedback_events`。
- 根据 action 更新卡片冷却和 `feedback_summary`。
- 对 `user_memory.preference_memory.category_weights` 做轻量更新。
- 公共预置卡不会被用户反馈污染。
- `save_preset` 会复制一张个人卡。

## 阶段 5：首登资料接口

当前已实现：

```text
supabase/functions/profile/index.ts
```

行为：

- 登录账号本身交给 Supabase Auth。
- 用户登录后，前端调用 `POST /profile` 写入首登固定个性化信息。
- 后端保存到 `user_memory.explicit_profile`。
- 后端从显式偏好中提取轻量推荐信号，写入 `user_memory.preference_memory`。
- 后续 `recommendations` 会读取同一份 `user_memory` 参与软评分。

已支持的首登字段参考：

```text
nickname
city
timezone
default_available_time
default_energy_level
default_go_out
default_people
default_budget_level
preferred_categories
disliked_categories
mode_preferences
indoor_outdoor_preference
travel_preference
dietary_constraints
active_constraints
accessibility_constraints
content_blacklist_keywords
usual_free_time_windows
```

## 阶段 6：接 OpenAI Agent

Agent 只做三件事：

1. 把自然语言转成 `context_input`。
2. 必要时补问一次。
3. 基于 Top 5 和分数生成更自然的解释。

仍然不能做：

- 直接推荐未过滤卡。
- 直接修改长期记忆。
- 编造天气或卡片属性。

## 推荐上线 API

```text
POST /functions/v1/recommendations
POST /functions/v1/feedback
GET|POST|PATCH /functions/v1/profile
GET /rest/v1/entertainment_cards
GET /rest/v1/user_memory
```

首版前端只需要接：

- 推荐结果 `selected_card`
- 理由 `reason`
- 反馈按钮 action

`top5` 和 `score_breakdown` 可以先给调试后台，不必暴露给普通用户。

## 本地 Supabase 命令

如果本机已安装 Supabase CLI：

```bash
supabase start
supabase db reset
supabase functions serve recommendations --env-file .env.local
supabase functions serve feedback --env-file .env.local
supabase functions serve profile --env-file .env.local
```

`.env.local` 至少需要：

```text
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

生产部署：

```bash
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy recommendations
supabase functions deploy feedback
supabase functions deploy profile
```
