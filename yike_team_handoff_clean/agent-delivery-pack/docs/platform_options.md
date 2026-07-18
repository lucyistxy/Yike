# 平台选择与适用场景

## 推荐主路径：Supabase

适合当前阶段，因为它同时覆盖：

- 数据存储：Postgres 表存卡片、记忆和反馈。
- 轻后端：Edge Functions 承载推荐接口。
- 权限：Row Level Security 后续可控制用户只能访问自己的卡。
- 部署：前端和 Agent 内核都稳定后，可以直接上线 API。

技术路径：

```text
前端
  -> Supabase Edge Function /recommendations
  -> Recommendation Core
  -> Supabase Postgres: cards, memory, feedback
  -> 返回 selected_card + reason + top5 + excluded_summary
```

优点：

- 不等完整后端团队也能落地。
- 对 Demo 和早期产品都够用。
- 以后可以平滑接真实模型和天气 API。

限制：

- Edge Functions 不适合做特别长耗时的多轮复杂 Agent。
- 复杂工作流或人工审核流，后续更适合 LangGraph。

## OpenAI Agents SDK

适合后续接真正的 LLM Agent 编排。

建议用途：

- 最多补问一次。
- 把用户自然语言状态转成结构化 `context_input`。
- 根据 Top 5 和 `score_breakdown` 生成更自然的理由。
- 做工具调用编排。

不建议用途：

- 不让模型直接浏览全量卡池后自由推荐。
- 不让模型绕过硬约束。
- 不让模型长期记忆敏感状态。

## LangGraph

适合 P1 之后：

- 多节点工作流。
- 状态可恢复。
- 人工确认。
- 更复杂的记忆治理和任务追踪。

当前 P0 不必上 LangGraph，否则工程复杂度会偏重。

## Vercel AI SDK

适合你的前端如果最终是 Next.js，并希望把 Agent 工具调用放在前端工程 API route 内。

适用：

- 快速做流式理由。
- 前端团队熟悉 Next.js。
- 推荐接口和页面强绑定。

不适用：

- 当前前端还经常变化时，不建议把推荐核心写死在页面工程里。

## Dify / Coze / 低代码 Agent 平台

适合快速做演示对话，但不适合作为宜刻推荐核心的第一承载。

原因：

- 硬过滤和可解释打分需要代码级控制。
- 字段、版本、反馈日志需要可迁移。
- 低代码平台容易让规则散在节点里，后续维护困难。

## 结论

当前最优：

```text
Supabase Edge Functions + Postgres + 确定性 Recommendation Core
```

后续增强：

```text
OpenAI Agents SDK 负责编排和语言理解
Supabase 继续负责数据与确定性规则
```

