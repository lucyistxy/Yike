# Web 前端联调与演示说明

## 分层约定

页面不直接调用 `fetch`、WebSocket 或具体 Agent SDK。统一由 `AgentGateway` 暴露这些方法：

- `getProfile`
- `saveProfile`
- `parseCard`
- `saveCard`
- `drawCard`
- `submitFeedback`
- `copyPreset`

开发阶段使用稳定 Mock；真实服务到位后新增 HTTP、流式 API 或 Agent SDK 适配器。上传、鉴权、重试、超时和错误结构转换都留在适配器内部。

## 推荐联调顺序

1. 产品、Agent、前端共同冻结 `frontend-agent-v1.md` 的枚举和字段。
2. Agent 先按 `docs/contracts/examples/` 返回固定 JSON，不接模型。
3. 前端按顺序接入 `saveProfile`、`parseCard`、`saveCard`、`drawCard`、`submitFeedback`、`copyPreset`。
4. 验证成功、识别失败、重复卡、待补充、个人池为空、零候选和反馈失败。
5. 最后替换真实模型逻辑；响应结构不变，破坏性改动升级契约版本。

## 90 秒演示路径

1. 在“添加”上传截图或输入“看一部收藏的电影”。
2. 等待 Agent 整理，确认草稿并保存。
3. 在“卡池”看到个人卡来源与状态。
4. 回到“此刻”，选择 45 分钟、不出门、低精力，从“两者”抽取。
5. 结果页说明来源、执行信息和匹配理由。
6. 点击“就它”，提交“当下不合适”或“已完成”。
7. 在“记忆”查看最后一次调用和隐私边界。

## Web 接口注意事项

- 图片输入以 `File` 或上传后的资源 ID 交给网关，不传小程序临时路径。
- `drawCard` 的 `no_candidate` 是正常业务结果，不应当抛成系统错误。
- “换一张”只更新当前会话的最近卡片 ID，不等同于“不喜欢”。
- 非敏感默认条件可写浏览器本地存储；`session_constraints` 只能放内存。
- 前端只展示排除统计和放宽建议，不自行绕过硬约束抽取。

## 当前实现边界

当前页面内置确定性演示逻辑，方便无后端展示。接入真实 Agent 前，应把页面中的演示调用迁移到 `web/lib/agent/` 网关层，并保持 v1 契约不变。

## 真实 Supabase Agent 接入

已新增 `HttpAgentGateway`：

- 未配置 `NEXT_PUBLIC_YIKE_AGENT_BASE_URL` 时，页面继续使用 Mock。
- 配置 `NEXT_PUBLIC_YIKE_AGENT_BASE_URL` 后，页面会请求 Supabase Edge Functions。
- 图片会由浏览器转为 base64 后发送给 `card-drafts`，P0 不依赖 Storage。
- `either` 会映射为后端的 `flexible`；后端扩展类别会折叠为前端 v1 可展示类别。
- 首登固定个性化信息通过 `profile` 写入 `user_memory`，推荐时自动参与软评分。

本地联调环境变量：

```text
NEXT_PUBLIC_YIKE_AGENT_BASE_URL=https://hwhflgxdaqfwfdfvnwwt.supabase.co/functions/v1
NEXT_PUBLIC_YIKE_USER_ID=<当前 Supabase 登录用户 id>
```

浏览器本地需要有当前用户 JWT：

```js
localStorage.setItem("yike-user-id", "<当前 Supabase 登录用户 id>");
localStorage.setItem("yike-user-access-token", "<当前 Supabase 用户 access_token>");
```

生产接入时不要让用户手动写 localStorage，应由 Supabase Auth 登录成功后把 `session.user.id` 和 `session.access_token` 交给 `HttpAgentGateway`。

真实联调顺序：

1. `GET /preset-pool`：确认 24 张预置卡能读到。
2. `saveProfile`：模拟首登填写默认时间、预算、内容偏好。
3. `drawCard`：用 `source_scope=preset` 验证新用户冷启动抽卡。
4. `parseCard`：先文字，再图片 base64，确认返回 `draft_card`。
5. `saveCard`：保存草稿后，`GET /cards?source_scope=personal` 可看到个人卡。
6. `submitFeedback`：分别验证 `not_suitable`、`later`、`dislike`。
7. `copyPreset`：确认预置卡复制为个人卡且保留 `origin_preset_id`。
