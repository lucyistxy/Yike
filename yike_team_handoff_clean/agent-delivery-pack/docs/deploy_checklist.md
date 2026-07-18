# Supabase 部署检查清单

## 当前已完成

- 推荐 Edge Function：`recommendations`
- 反馈 Edge Function：`feedback`
- 首登资料 Edge Function：`profile`
- Supabase migration：`entertainment_cards`、`user_memory`、`feedback_events`、`recommendation_logs`
- Supabase seed：本地 Demo 卡片和记忆
- 本地推荐内核测试：通过
- JSON Schema 校验：通过

## 当前未在本机完成

本机当前缺少：

```text
deno
supabase
```

所以尚未执行：

- `supabase start`
- `supabase db reset`
- `supabase functions serve`
- `supabase functions deploy`

## 部署前准备

需要安装：

```bash
brew install supabase/tap/supabase
brew install deno
```

需要准备：

```text
SUPABASE_URL
SUPABASE_ANON_KEY
真实登录用户 JWT
```

## 本地启动

```bash
cd outputs/yike-agent-delivery-pack
supabase start
supabase db reset
supabase functions serve recommendations --env-file .env.local
supabase functions serve feedback --env-file .env.local
supabase functions serve profile --env-file .env.local
```

## 云端部署

```bash
cd outputs/yike-agent-delivery-pack
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy recommendations
supabase functions deploy feedback
supabase functions deploy profile
```

## 生产配置建议

当前 `recommendations` 和 `feedback` 都应使用：

```toml
[functions.recommendations]
verify_jwt = true

[functions.feedback]
verify_jwt = true

[functions.profile]
verify_jwt = true
```

同时要求：

- Product Mode 请求必须带用户 JWT。
- `user_id` 必须等于 `auth.uid()`。
- 前端不要传入 `cards`，由函数从数据库读取。

## 验收请求顺序

1. 调用 `recommendations` Product Mode，确认返回 `selected_card`。
2. 检查 `recommendation_logs` 是否写入。
3. 调用 `feedback`，action 用 `reroll`。
4. 检查 `feedback_events` 是否写入。
5. 检查个人卡是否进入 `cooling`。
6. 检查 `user_memory.preference_memory.category_weights` 是否轻量更新。
