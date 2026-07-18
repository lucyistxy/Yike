# Yike Agent Delivery Pack

这是宜刻 Yike 个性化娱乐推荐 Agent 的第一版交付包，按 Supabase 优先路径组织。

它的目标不是立刻做一个复杂聊天 Agent，而是先交付可验证的推荐决策能力：

```text
用户状态 -> 记忆 -> 候选卡 -> 硬过滤 -> 打分 -> Top 5 -> 受控选择 -> 理由 -> 反馈
```

## 为什么先这样做

当前前端还会调整，真实接口和真实模型也还没有进入稳定联调。因此本包把 Agent 拆成两层：

- 确定性推荐内核：硬过滤、打分、Top 5、理由模板、反馈映射。
- Agent 编排外壳：后续接 Supabase、OpenAI Agents SDK、LangGraph 或 Vercel AI SDK。

这样即使模型不可用，宜刻仍然能完成一次稳定、可解释、不违反硬约束的推荐。

## 包结构

```text
yike-agent-delivery-pack/
  README.md
  package.json
  schemas/
    yike_recommendation_core_schema.json
  fixtures/
    demo-request.json
    demo-cards.json
    demo-memory.json
  src/
    core/
      recommendationCore.mjs
    orchestrator/
      agentToolsContract.md
  supabase/
    config.toml
    seed.sql
    migrations/
      202607180001_yike_agent_core.sql
    functions/
      _shared/
        recommendationCore.ts
        repository.ts
        supabaseClient.ts
      feedback/
        index.ts
      recommendations/
        index.ts
  tests/
    run_core_fixture.mjs
  docs/
    api_examples.md
    deploy_checklist.md
    deployment_status.md
    platform_options.md
    supabase_technical_path.md
    agent_delivery_standard.md
```

## 本地验证

不需要安装依赖，直接运行：

```bash
npm test
```

预期结果：

- 能选出一张符合当前条件的娱乐卡。
- 不出门时，户外卡不会进入 Top 5。
- pending / 不可抽卡的卡不会进入候选。
- `reroll` 不会被当成长期不喜欢。

## Supabase 部署思路

本包已包含一个 Supabase Edge Function 雏形：

```text
supabase/functions/recommendations/index.ts
```

当前线上部署配置要求 JWT，并只读 Supabase 真实数据：

- 从 Supabase 表读取卡片、记忆和反馈。
- 不接受前端传入临时候选卡。
- 图片/文字建卡必须调用 OpenAI，未配置 OpenAI secret 会失败。

已实现的数据读取：

- `cards`：读取 `personal_cards` + `preset_cards`
- `memory`：读取 `user_memory` + `feedback_events`
- `feedback`：`supabase/functions/feedback/index.ts` 写回反馈、冷却和偏好记忆

建表起点：

```text
supabase/migrations/202607180001_yike_agent_core.sql
```

本地种子数据：

```text
supabase/seed.sql
```

## 推荐下一步

1. 先用本包验证推荐内核。
2. 再建 Supabase 表结构。
3. 再把 Edge Function 中的 demo cards/memory 替换为数据库读取。
4. 最后再接 OpenAI Agent，用于编排、澄清和自然语言解释。
