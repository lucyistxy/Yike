# 宜刻 Yike 前端 + Agent/Supabase 交付说明

交付日期：2026-07-19

这个压缩包用于同步给组员，包含：

- `web/`：当前可运行的前端页面工程。
- `agent-delivery-pack/`：Agent 推荐内核、Supabase 表结构迁移、Edge Functions、接口文档。
- `README_交付说明.md`：本说明。

## 一、组员如何运行前端页面

进入前端目录：

```bash
cd web
npm install
npm run dev
```

启动后浏览器打开：

```text
http://localhost:3000/
```

如果 macOS 弹出无法验证 `lightningcss`、`fsevents`、`workerd` 等提示，通常是依赖被系统隔离。重新执行一次 `npm install` 一般可以恢复；如果仍出现，需要对对应依赖文件移除 quarantine 标记。

## 二、前端当前能看到什么

当前页面已经可以跑起来，主要包括：

- “此刻”抽卡页面。
- “添加/收进小岛”页面。
- 上传截图或输入文字生成卡片草稿的前端流程。
- 保存到个人卡池的前端流程。
- 卡池展示。
- 抽卡结果页。
- 反馈动作入口，例如就它、换一张、改条件等。
- 与后端的 `HttpAgentGateway` 适配层。

前端默认有 Mock 模式。未配置真实后端地址时，页面会用本地演示数据。

## 三、真实 Supabase Agent 模式怎么打开

在 `web/` 下创建 `.env.local`：

```text
NEXT_PUBLIC_YIKE_AGENT_BASE_URL=https://<project-ref>.supabase.co/functions/v1
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase anon/public key>
NEXT_PUBLIC_YIKE_USER_ID=
```

然后重新启动：

```bash
npm run dev
```

真实模式需要用户先通过页面顶部的“真实 Agent 登录”调试面板登录 Supabase Auth 测试账号。登录成功后，浏览器会自动保存：

- `yike-user-id`
- `yike-user-access-token`

注意：`yike-user-access-token` 是 Supabase Auth 登录用户的 JWT，不是 OpenAI key，不是 Supabase Personal Access Token，也不是 service_role。

## 四、后端/Agent 已实现功能

后端交付包位置：

```text
agent-delivery-pack/
```

已实现：

- Supabase 表结构：
  - `entertainment_cards`：个人卡 + 预设卡。
  - `card_drafts`：图片/文字识别后的草稿。
  - `user_memory`：显式首登资料 + 推荐记忆。
  - `feedback_events`：用户反馈记录。
  - `recommendation_logs`：Top5、分数拆解、硬过滤统计日志。
- 推荐内核：
  - 硬约束过滤。
  - 软评分。
  - Top 5。
  - 加权随机选卡。
  - 零候选兜底。
  - 推荐理由生成。
- Supabase Edge Functions：
  - `card-drafts`：真实大模型图片/文字识别成卡片 JSON。
  - `cards`：保存草稿、查卡池、编辑/归档/恢复/冷却个人卡、复制预设卡。
  - `recommendations`：读取 Supabase 真实卡池和用户记忆后抽卡。
  - `feedback`：记录反馈，并做冷却/权重更新。
  - `preset-pool`：读取预设推荐池。
  - `weather-context`：天气上下文接口。
  - `profile`：首登固定个性化信息读取/保存。
- 图片资产：
  - 上传图片会存入 Supabase Storage 私有 bucket。
  - 返回卡片时会生成短期 signed URL。
  - 后续展示同一张卡时可以显示原图。
- 预设卡去重：
  - 数据库唯一索引防止同标题预设卡重复。
  - `preset-pool` 接口返回前也会按标题去重。
- 调试：
  - `recommendation_log_top5_audit` 可查看 Top5 每张卡的分数拆解。
  - `preset_card_duplicate_audit` 可检查预设卡重复情况。

## 五、首登个性化信息当前怎么处理

登录账号本身交给 Supabase Auth。

用户登录后，前端应调用：

```text
POST /functions/v1/profile
```

保存固定资料，例如：

- 昵称。
- 城市和时区。
- 默认可用时间。
- 默认精力。
- 默认是否愿意出门。
- 默认同伴状态。
- 默认预算。
- 喜欢/不喜欢的内容类别。
- 放松/安静/活跃等模式偏好。
- 饮食限制、行动限制、常见空闲时间。

后端会把这些资料写入 `user_memory.explicit_profile`，并提取部分字段进入 `preference_memory` 参与推荐软评分。

## 六、当前还未完全实现的功能

未完成或仍需联调：

- 前端还没有正式的 Supabase Auth 登录/注册页面。
- 前端还没有正式的首登信息填写页面。
- 真实图片识别链路已经接入，但仍需用真实用户 JWT、真实 OpenAI key、真实 Supabase secrets 做端到端测试。
- 当前 Supabase 后端已经部署到项目 `hwhflgxdaqfwfdfvnwwt`，组员测试时只需要配置公开环境变量和 Supabase Auth 测试账号。
- 前端字段和产品最终 PRD 还需要冻结一次，当前后端支持的是较丰富字段版本。
- 管理后台还没有做成页面，目前分数路径主要通过 Supabase 表/视图查看。
- 用户个人上传卡默认不做重复检测，这是当前产品规则。
- 推荐理由目前是模板化解释，不是大模型自然语言润色。

## 七、后端本地验证命令

进入后端交付包：

```bash
cd agent-delivery-pack
npm install
npm test
npm run check
```

## 八、Supabase 部署命令

进入后端交付包：

```bash
cd agent-delivery-pack
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase functions deploy profile --project-ref <project-ref>
npx supabase functions deploy preset-pool --project-ref <project-ref>
```

如果要全量部署函数：

```bash
npx supabase functions deploy card-drafts --project-ref <project-ref>
npx supabase functions deploy cards --project-ref <project-ref>
npx supabase functions deploy recommendations --project-ref <project-ref>
npx supabase functions deploy feedback --project-ref <project-ref>
npx supabase functions deploy preset-pool --project-ref <project-ref>
npx supabase functions deploy weather-context --project-ref <project-ref>
npx supabase functions deploy profile --project-ref <project-ref>
```

Supabase secrets 需要在项目里配置：

```text
OPENAI_API_KEY
OPENAI_CARD_DRAFT_MODEL
```

不要把 `service_role`、OpenAI key、Supabase Personal Access Token 写进前端或交付包。

## 九、建议组员分工

- 前端同学：先接 Supabase Auth 登录页，再接首登表单，最后接真实 `HttpAgentGateway`。
- Agent/后端同学：部署最新迁移和函数，验证 `profile`、`card-drafts`、`recommendations` 三条主链路。
- 产品同学：冻结首登字段、卡片字段、反馈动作解释和零候选兜底文案。
- 测试同学：按“首登 -> 预设抽卡 -> 图片建卡 -> 保存个人卡 -> 再抽卡 -> 反馈 -> 看日志”的路径验收。
