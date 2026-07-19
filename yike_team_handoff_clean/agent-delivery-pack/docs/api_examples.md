# API 调用示例

## recommendations

线上函数只读 Supabase 表，不接受前端传入临时候选卡。

```bash
curl -X POST "$SUPABASE_URL/functions/v1/recommendations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "session_id": "session_001",
    "context_input": {
      "available_time": 110,
      "energy_level": "low",
      "go_out": false,
      "people": "solo",
      "budget_level": "low",
      "active_constraints": [],
      "mode_preference": ["relax", "quiet"]
    },
    "source_scope": "both",
    "seed": 7
  }'
```

## card-drafts: 图片/文字识别成草稿

需要先在 Supabase Secrets 配置：

```text
OPENAI_API_KEY
OPENAI_CARD_DRAFT_MODEL
```

图片 URL：

```bash
curl -X POST "$SUPABASE_URL/functions/v1/card-drafts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "input_type": "image",
    "image_url": "https://example.com/screenshot.png"
  }'
```

文字：

```bash
curl -X POST "$SUPABASE_URL/functions/v1/card-drafts" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "input_type": "text",
    "text": "周末想去看一个展，最好 2 小时以内"
  }'
```

## cards: 确认草稿并保存

```bash
curl -X POST "$SUPABASE_URL/functions/v1/cards" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "draft_id": "<draft_id>",
    "overrides": {
      "duration_min": 90,
      "duration_max": 120,
      "energy_level": "low",
      "indoor_outdoor": "indoor",
      "prep_cost": "low"
    }
  }'
```

## cards: 卡池列表

```bash
curl "$SUPABASE_URL/functions/v1/cards?user_id=00000000-0000-0000-0000-000000000001&source_scope=both&eligible_only=false&limit=50" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN"
```

`source_scope` 可选：

```text
personal, preset, both
```

## cards: 编辑、归档、恢复、冷却个人卡

```bash
curl -X PATCH "$SUPABASE_URL/functions/v1/cards" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "card_id": "<personal_card_id>",
    "updates": {
      "title": "今晚看一集轻松剧",
      "duration_min": 40,
      "duration_max": 50,
      "indoor_outdoor": "indoor"
    }
  }'
```

动作：

```text
archive, restore, cool, complete
```

## cards: 删除已归档个人卡

删除只允许操作当前登录用户自己的个人卡。预置卡不能被用户删除。

```bash
curl -X DELETE "$SUPABASE_URL/functions/v1/cards" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "card_id": "<personal_card_id>"
  }'
```

返回：

```json
{
  "card_id": "<personal_card_id>",
  "deleted": true
}
```

## cards: 复制预置卡为个人卡

```bash
curl -X POST "$SUPABASE_URL/functions/v1/cards" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "preset_card_id": "<preset_card_id>",
    "edits": {
      "title": "我的版本：周末看一部温柔电影"
    }
  }'
```

## preset-pool: 预置推荐池

```bash
curl "$SUPABASE_URL/functions/v1/preset-pool?user_id=00000000-0000-0000-0000-000000000001&limit=60" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN"
```

## profile: 首登固定个性化信息

读取当前用户的首登资料和推荐记忆：

```bash
curl "$SUPABASE_URL/functions/v1/profile?user_id=00000000-0000-0000-0000-000000000001" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN"
```

首次填写或后续更新：

```bash
curl -X POST "$SUPABASE_URL/functions/v1/profile" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "onboarding_completed": true,
    "explicit_profile": {
      "nickname": "小宜",
      "city": "Shanghai",
      "timezone": "Asia/Shanghai",
      "default_available_time": 90,
      "default_energy_level": "low",
      "default_go_out": false,
      "default_people": "solo",
      "default_budget_level": "low",
      "preferred_categories": ["movie", "cafe", "craft"],
      "disliked_categories": ["event"],
      "mode_preferences": ["relax", "quiet"],
      "indoor_outdoor_preference": "indoor",
      "travel_preference": "nearby",
      "dietary_constraints": [],
      "active_constraints": ["no_transport"],
      "usual_free_time_windows": ["weekday_evening"]
    }
  }'
```

`profile` 写入的是 `user_memory.explicit_profile`；其中 `preferred_categories`、`disliked_categories`、`default_available_time`、`indoor_outdoor_preference` 会同步生成推荐可用的轻量 `preference_memory`。

## memory

读取新记忆页需要的三块数据：贝壳日历、长期偏好、记忆清单。

```bash
curl "$SUPABASE_URL/functions/v1/memory?user_id=00000000-0000-0000-0000-000000000001" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN"
```

记忆清单条目操作：

```bash
curl -X POST "$SUPABASE_URL/functions/v1/memory" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "item_key": "pref_indoor",
    "action": "keep"
  }'
```

`action` 支持：

```text
keep, view, clear
```

输出给前端的核心字段：

- `feedback_calendar`：当月有反馈的日期、珍珠数量、完成次数。
- `long_term_preference`：如 `室内 · 低准备 · 45 分钟`，以及可展示的小标签。
- `memory_items`：最多三条可解释记忆，每条支持保留、查看、清除。
- `non_persistent`：右侧固定说明，提示不会长期记住的敏感/临时状态。

## weather-context

```bash
curl -X POST "$SUPABASE_URL/functions/v1/weather-context" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "city": "Shanghai",
    "timezone": "Asia/Shanghai",
    "latitude": 31.2304,
    "longitude": 121.4737
  }'
```

## feedback

```bash
curl -X POST "$SUPABASE_URL/functions/v1/feedback" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -d '{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "card_id": "10000000-0000-0000-0000-000000000001",
    "action": "not_suitable"
  }'
```

反馈动作：

```text
accept, complete, reroll, not_suitable, later, dislike, save_preset
```

注意：

- Product Mode 需要真实登录用户 JWT，且 `user_id` 应等于 `auth.uid()`。
- `card-drafts` 没有模拟兜底；没有 OpenAI secret 会直接失败。
- `profile` 只负责登录后首登资料保存；注册/登录账号本身继续使用 Supabase Auth。
