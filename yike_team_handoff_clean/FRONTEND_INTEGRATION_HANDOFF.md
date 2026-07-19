# 宜刻 Yike 前端与联调交接说明

> 更新日期：2026-07-19
> 前端根目录：`yike_team_handoff_clean/web`
> Vercel 项目：`yike-agent-demo`

## 1. 本次改造范围

本次改造覆盖「此刻、卡池、添加、记忆」四个主页的手绘手帐化视觉，不改变原有 Agent 抽卡、天气、上传解析、卡片编辑/归档/删除、反馈学习与登录逻辑。

- 「此刻」：透明底手帐主视觉；左页是真实 HTML 文字，会按本地时间、可用时长和精力变化；右页保留山谷、河流和海獭插画。
- 抽卡：使用「抱贝壳 → 举起 → 珍珠浮出 → 结果」的约 2 秒动画，保留慢请求、无候选、失败和减少动态模式。
- 「卡池」：九类贝壳图鉴，类别筛选与搜索取交集，下方仍是真实卡片数据。
- 「添加」：双页手帐容器；左页上传、右页输入，控件仍是可访问的 HTML，移动端自动改为纵向。
- 「记忆」：贝壳月历、按日查看抽取/反馈记录，保留长期偏好、隐私说明和调用记录。
- 响应式：`>=1280px` 三栏，`768–1279px` 左导航＋主内容，`<=767px` 单列＋底部导航。

## 2. 前端关键文件

| 文件 | 用途 |
| --- | --- |
| `web/app/page.tsx` | 四主页、抽卡动画、筛选、上传、历史日历和响应式交互 |
| `web/app/globals.css` | 手绘纸张视觉、双页手帐、贝壳图鉴、动画与断点 |
| `web/lib/contracts/v1.ts` | 共享前端合约，包含 `ActivityHistoryEvent` |
| `web/lib/agent/http-gateway.ts` | 真实 Agent/Supabase Edge Function 网关 |
| `web/lib/agent/mock-gateway.ts` | 未配置真实 Agent 时的演示数据 |
| `web/public/art/yike/` | 网页直接使用的压缩 WebP 素材 |
| `web/scripts/prepare-handdrawn-assets.py` | 白底去除、紧裁切、图片压缩与网页素材派生 |
| `design-assets/yike-handdrawn-v1/` | 原始与生成素材工作区，不被网页 URL 直接暴露 |

## 3. 活动历史接口

前端新增：

```ts
interface ActivityHistoryEvent {
  event_id: string;
  kind: "draw" | "feedback";
  action?: FeedbackAction;
  card_id: string;
  title: string;
  content_category: ContentCategory;
  occurred_at: string;
  is_demo?: boolean;
}
```

`AgentGateway` 新增：

```ts
getActivityHistory(input: { from: string; to: string }): Promise<{
  events: ActivityHistoryEvent[];
}>;
```

对应 Edge Function：

```http
GET activity-history?user_id=<uuid>&from=<ISO>&to=<ISO>
Authorization: Bearer <Supabase access token>
```

- 位置：`agent-delivery-pack/supabase/functions/activity-history/index.ts`
- 日期范围最多 62 天。
- 合并 `recommendation_logs` 中成功抽取和 `feedback_events` 中反馈数据。
- 通过现有用户鉴权和 RLS 隔离，没有新增数据库表。
- 前端接口失败时只显示重试状态，不伪造真实账号历史。

## 4. 环境变量

前端（Vercel）：

```bash
NEXT_PUBLIC_YIKE_AGENT_BASE_URL=
NEXT_PUBLIC_YIKE_USER_ID=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Supabase Edge Functions：

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPENAI_CARD_DRAFT_MODEL=gpt-5
```

`NEXT_PUBLIC_YIKE_AGENT_BASE_URL` 未配置时使用 Mock 网关；配置后前端会要求 Supabase 登录并读取真实用户数据。不要将任何私钥写入 Git。

## 5. 本地验证

```bash
cd yike_team_handoff_clean/web
npm install
npm run dev
npm run lint
npm test
npx next build
```

- 本地预览：`http://localhost:3000`
- Vercel 使用 `vercel.json` 中的 `next build`，不依赖开发服务器。
- 验收建议视口：1440px、1024px、390px。

## 6. 跨团队联调清单

1. 后端同事部署 `activity-history` Edge Function，并确认 `recommendation_logs` / `feedback_events` RLS 策略允许当前用户只读自己的记录。
2. 部署环境确认四个 `NEXT_PUBLIC_*` 值与当前 Supabase 项目一致。
3. 验证真实账号的抽取、反馈和记忆日历是否同时出现，并确认用户间数据不可见。
4. 素材更换时优先替换 `design-assets` 原图后重跑派生脚本，不要直接放入用户原图到 `public/`。
5. 上线前重点回归：抽卡重复点击、慢请求、无候选、上传解析、归档/删除、跨月日历和减少动态模式。

## 7. Git 与回滚

- 本次改造以独立提交合入，不使用强制推送。
- 如需回滚，对该提交执行 `git revert <commit>`，不要重置或覆盖其他同事提交。
- 远端 `main` 有新提交时，先 rebase/合并并逐个解决重叠文件，再运行完整验证。
