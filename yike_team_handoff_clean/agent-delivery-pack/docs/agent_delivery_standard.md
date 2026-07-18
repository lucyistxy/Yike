# Agent 交付标准

本项目的 Agent 交付不是“能聊”，而是“能稳定完成一次可解释推荐”。

## 必须交付

### 1. Schema

必须有：

- Card schema
- Recommendation request schema
- Recommendation result schema
- Feedback event schema
- User memory schema

当前文件：

```text
schemas/yike_recommendation_core_schema.json
```

### 2. 确定性推荐内核

必须有：

- `hard_filter_cards`
- `score_cards`
- `select_top5`
- `controlled_select`
- `generate_reason`
- `feedback_effect`

当前文件：

```text
supabase/functions/_shared/recommendationCore.ts
src/core/recommendationCore.mjs
```

### 3. Agent 编排契约

必须明确：

- 工具顺序。
- 工具输入输出。
- Agent 权限边界。
- LLM 不可绕过规则。

当前文件：

```text
src/orchestrator/agentToolsContract.md
```

### 4. 可运行测试样例

必须验证：

- 不出门时，户外卡不进入 Top 5。
- pending 卡不进入候选。
- Top 5 返回分项得分。
- `reroll` 不等于 `dislike`。

当前文件：

```text
fixtures/
tests/run_core_fixture.mjs
```

运行：

```bash
npm test
```

## 验收口径

### 硬约束

硬约束正确率必须是 100%。  
例如：用户选择 30 分钟且不出门，不允许推荐 90 分钟户外活动。

### 可解释性

每个 Top 5 item 必须有：

```json
{
  "card_id": "card_001",
  "score": 82,
  "score_breakdown": {}
}
```

### 降级能力

天气不可用、模型不可用时，推荐主链路仍然可运行。

### 记忆边界

以下内容不得长期保存：

- 经期不适
- 临时身体不适
- 当天不想化妆
- 情绪推断
- 健康推断

这些只能作为本次 `active_constraints`，会话结束后清理。

## 不算合格的交付

- 只有 prompt，没有确定性规则。
- 让 LLM 直接从全量卡池里凭感觉推荐。
- 没有排除原因。
- 没有分数拆解。
- 没有反馈动作边界。
- 把 `reroll` 当成长期不喜欢。

## 当前状态

当前交付包达到：

- Agent 内核规格：已具备。
- Supabase Edge Function 雏形：已具备。
- Supabase 表迁移 SQL：已具备。
- Supabase 数据读取仓储层：已具备。
- Supabase 反馈写回函数：已具备。
- 真实 OpenAI 图片/文字建卡函数：已具备。
- 草稿确认保存函数：已具备。
- 天气上下文函数：已具备。
- Supabase seed 数据：已具备。
- Demo fixtures：已具备。
- 本地无依赖测试：已具备。

尚未包含：

- OpenAI Agent SDK 编排代码。
- 端到端真实用户 token 调用验收。

这些建议在前端主流程和卡池数据结构稳定后进入。
