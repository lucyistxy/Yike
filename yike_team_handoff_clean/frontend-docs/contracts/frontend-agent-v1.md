# 宜刻前端 ↔ Agent 契约 v1

版本：`1.0.0`。TypeScript 单一事实来源位于 `web/lib/contracts/v1.ts`，本目录 JSON 样例必须与该类型同步。

## 调用边界

前端页面只调用 `AgentGateway`，不得直接依赖 HTTP、云函数或筛选算法。真实服务确定后，仅替换网关实现。

| 方法 | 输入 | 成功输出 | 失败约定 |
|---|---|---|---|
| `getProfile` | 当前登录用户 | 首登资料、推荐记忆、是否完成首登 | 未登录时返回鉴权错误 |
| `saveProfile` | 首登固定个性化信息 | 已保存资料、由显式偏好提取出的推荐记忆 | 字段错误必须放入 `field_errors` |
| `parseCard` | 浏览器 `File`、上传资源 ID、文字或手动标题 | 草稿卡、字段置信度、缺失字段、重复候选 | `GatewayErrorShape`；前端进入手动标题兜底 |
| `saveCard` | 用户确认后的完整/不完整卡片 | 保存后的卡、可抽取标记、缺失字段 | 字段错误必须放入 `field_errors` |
| `drawCard` | `DrawContext` 与最近展示卡 ID | `draw_result` 或 `no_candidate` | 零候选是正常业务结果，不作为异常抛出 |
| `submitFeedback` | 卡 ID、动作、可选原因/真实耗时 | 新状态、冷却、权重变化和解释文案 | 写入失败不阻塞继续使用 |
| `copyPreset` | 预置卡 ID 与可选编辑 | 新的个人卡副本 | 必须保留 `origin_preset_id` |

## 关键枚举

- `source_type`: `personal | preset`
- `source_scope`: `personal | preset | both`
- `status`: `active | cooling | archived | completed`
- `energy_level` / `prep_cost`: `low | medium | high`
- `indoor_outdoor`: `indoor | outdoor | either`
- `mood_preference`: `random | relax | active | quiet`
- `feedback action`: `accept | complete | not_suitable | later | dislike`

`mood_preference=relax` 表示“彻底放松”的概率偏好，不是卡片类型或产品模式。接口中禁止出现 `growth`、`light_growth`、`mixed_mode` 等 V3 旧口径。

## 数据规则

- 卡片只有在时长、精力、室内外、准备成本完整时，才允许 `eligible_for_draw=true`。
- `drawCard` 必须先执行硬约束过滤；随机过程不能绕过时长、出门、人数、预算、临时限制和状态。
- `no_candidate` 必须提供 `excluded_counts` 与明确的 `relax_suggestions`。
- `not_suitable` 仅表示本次不合适，不能映射为长期厌恶。
- 经期、妆容、不久站等 `session_constraints` 只用于本次请求，不由服务端建立长期画像。
- 预置卡只能通过 `copyPreset` 进入个人卡池，原预置卡不能直接改为个人来源。

## Supabase 后端映射

真实后端保留更丰富字段，前端 v1 只消费页面需要的核心字段。HTTP 网关负责映射：

- 前端 `indoor_outdoor=either` -> 后端 `flexible`
- 后端 `indoor_outdoor=flexible` -> 前端 `either`
- 后端 `restaurant/cafe` -> 前端 `food`
- 后端 `music/event/social/home_activity/shopping` -> 前端 `other`
- 后端 `card` 和 `saved_card` 都统一映射为前端 `saved_card`

真实接口基础地址：

```text
https://hwhflgxdaqfwfdfvnwwt.supabase.co/functions/v1
```

已上线接口：

- `GET|POST|PATCH /profile`
- `POST /card-drafts`
- `GET|POST|PATCH /cards`
- `POST /recommendations`
- `POST /feedback`
- `GET /preset-pool`
- `POST /weather-context`

## 错误结构

```json
{
  "code": "PARSE_FAILED",
  "message": "这次只看懂了标题，你仍可以手动补充后保存",
  "retryable": true,
  "field_errors": {},
  "request_id": "req-20260718-001"
}
```

接口或枚举变更必须同步更新 TypeScript 类型、本文档和全部 JSON 样例；破坏性变更提升主版本。
