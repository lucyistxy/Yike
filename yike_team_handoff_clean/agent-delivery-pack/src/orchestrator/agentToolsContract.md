# Agent Tools Contract

Agent 的定位：流程经理，不是任意决策者。

它可以做：

- 读取上下文。
- 读取允许记忆。
- 调用候选卡读取工具。
- 调用硬过滤工具。
- 调用打分工具。
- 调用 Top 5 选择工具。
- 生成简短解释。
- 写回反馈。

它不可以做：

- 绕过硬过滤。
- 恢复被规则排除的卡。
- 编造天气、用户偏好或卡片字段。
- 把敏感临时状态写入长期记忆。
- 把成长任务变成 P0 娱乐推荐。

## 工具顺序

```text
get_current_context
  -> get_allowed_memory
  -> load_candidate_cards
  -> hard_filter_cards
  -> score_cards
  -> select_top5
  -> controlled_select
  -> generate_reason
  -> submit_feedback
```

## Tool 1: get_current_context

输入：

```json
{
  "session_id": "session_001",
  "location": {
    "city": "Shanghai",
    "timezone": "Asia/Shanghai"
  },
  "context_input": {
    "available_time": 110,
    "energy_level": "low",
    "go_out": false,
    "people": "solo",
    "budget_level": "low",
    "active_constraints": [],
    "mode_preference": ["relax", "quiet"]
  }
}
```

输出：

```json
{
  "now": "2026-07-18T12:00:00.000Z",
  "weekday": "Saturday",
  "time_period": "evening",
  "weather_tags": [],
  "context_input": {}
}
```

## Tool 2: get_allowed_memory

输入：

```json
{
  "user_id": "demo_user",
  "allowed_types": ["preference", "behavior", "explicit"]
}
```

输出：`user_memory`

规则：

- 只能读取白名单记忆。
- 敏感临时状态不进入长期记忆。
- 显式档案必须用户可查看、可修改、可删除。

## Tool 3: load_candidate_cards

输入：

```json
{
  "user_id": "demo_user",
  "source_scope": "both"
}
```

输出：`Card[]`

规则：

- 个人卡和预置卡可以合并进入候选。
- `pending`、`archived` 不应提前删除，交给 `hard_filter_cards` 输出排除原因。

## Tool 4: hard_filter_cards

输入：

```json
{
  "context": {},
  "cards": []
}
```

输出：

```json
{
  "eligible": [],
  "excluded": [
    {
      "card_id": "preset_walk_001",
      "reason": "outdoor"
    }
  ],
  "excluded_summary": {
    "outdoor": 1
  }
}
```

规则：

- 硬过滤必须在 LLM 选择之前执行。
- LLM 不能把 excluded 卡恢复为候选。

## Tool 5: score_cards

输入：

```json
{
  "eligible_cards": [],
  "context": {},
  "memory": {}
}
```

输出：

```json
{
  "ranked": [
    {
      "card_id": "personal_movie_001",
      "score": 84,
      "score_breakdown": {
        "energy_score": 25,
        "time_fit_score": 20,
        "mood_preference_score": 15,
        "prep_cost_score": 10,
        "weather_time_score": 4,
        "feedback_score": 6,
        "freshness_score": 1,
        "source_score": 3
      }
    }
  ]
}
```

## Tool 6: controlled_select

输入：

```json
{
  "top5": [],
  "strategy": "weighted_random",
  "seed": 7
}
```

输出：

```json
{
  "selected_card_id": "personal_movie_001",
  "strategy": "weighted_random"
}
```

## Tool 7: generate_reason

规则：

- 最多 2 条。
- 只引用真实字段。
- 不做情绪、健康、人格推断。

## Tool 8: submit_feedback

动作：

```text
accept, complete, reroll, later, dislike, save_preset
```

关键规则：

- `reroll` 只做短期降权。
- `dislike` 才进入强降权或归档。
- `complete` 不生成绩效感，不做完成率排名。

