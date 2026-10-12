<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 前端约定

这些规则来自本项目与 FlowPlan、xmu_ai_course、lvjian、linli 踩过的坑。`pnpm test:web`（`scripts/check_web_conventions.mjs`）会拦下其中能静态检查的部分；新发现一类回潮，就给它加一条规则。

## 视觉方向：去框（2026-10-13 定）
- 不用描边框分层，靠色调：卡片（`.card-surface`、`.workspace-frame` 等）比页面底色亮一档，不加边框和常驻阴影；卡片里的嵌套块、输入框、下拉都下沉一档（`--inset`），聚焦时才回到 `--surface` 并出现蓝色边和光圈。
- 一页里只有一层「卡」，卡里最多再有一层下沉块；不要卡里套带框的框。同类条目用细分隔线（`--line`），不包框。
- 次要按钮是浅灰实底（`--rim`，悬停 `--rim-strong`），只有主按钮用品牌色实底；危险按钮是淡红底、无边框。
- 浮层（弹窗、下拉列表、提示、命令面板）用实色 `--overlay-bg` 加阴影，不加边框；外壳（顶栏、侧栏的玻璃效果）和悬浮的侧栏收起按钮保持原样。
- 虚线只留给「待放置 / 空位」类区域（未放置工位、虚拟分组空位）和「未填写」标签，守卫脚本会拦截其他虚线。
- 页面层的空状态像卡片一样上浮一档（`--surface`），不用虚线框。
- 圆角只有四档：`--radius-micro` 6px（标签、按键、小圆点等约 12px 高的小件）、`--radius-control` 10px（按钮、输入框、页签、列表行）、`--radius-card` 16px（卡片、面板）、`--radius-overlay` 20px（弹窗、命令面板），胶囊用 `999px`。

## 视觉与 token
- 字号只用 `globals.css` 里的 `--text-*`，圆角只用上面四档 `--radius-*`（另允许 `0`、`50%`、`999px`）。不为单个场景写散值。
- 最小字号 12px；正文和辅助文字在所有底色上对比度 ≥ 4.5:1（含彩色标签在自身浅底上）。新增颜色先算对比度。
- 颜色走语义 token（`--ink`、`--ink-soft`、`--accent-*`、`--danger`、`--warning`、`--success`），浅色、深色两套都要定义；每个 `var(--x)` 都必须有定义。

## 控件
- 下拉一律用 `components/Select`，不用原生 `<select>`：文字不截断、列表走 portal 不被弹窗裁切、跟随主题，并保留隐藏的原生 select 做 `required` 校验。
- 确认与提示一律用 `confirmDialog` / `noticeDialog`（`components/ConfirmDialog`），不用 `confirm()` / `alert()`：桌面版 pywebview 不一定弹得出原生对话框。不可逆操作用 `danger: true`，焦点默认落在「取消」。
- 操作结果用 `toast()` 或 `<Notice>`：提示叠放、互不覆盖，成功自动消失，错误需手动关闭。
- 中文输入法组字期间不响应 Enter / Escape：键盘处理先判断 `isComposing`。

## 弹窗与浮层
- 模态层统一用 `useModalLayer`：锁滚动、Tab 焦点循环、关闭后归还焦点；多层叠加时只有最上层响应键盘。
- 含输入框的弹窗不因 Esc 或点遮罩关闭，只能点关闭按钮，防止丢掉已输入的内容。
- 弹窗里的下拉按 Esc 只收起下拉（`preventDefault` 后弹窗不再处理）。

## 加载与布局
- 后台外壳（顶栏、侧栏）先出现，会话校验和加载状态只占内容区。
- `next/dynamic` 必须内联写 `{ loading }`：没有它就没有 Suspense 边界，首次加载会挂起整个工作区。
- `html { scrollbar-gutter: stable }` 防止弹窗锁滚动、内容长短变化时页面左右跳动。
- 服务端渲染的组件不能在渲染时读 `window` / `navigator` / `localStorage`；要在首帧生效的偏好（主题、侧栏收起、平台快捷键提示）由 `layout.tsx` 的预绘制脚本写到 `<html data-*>`，再由 CSS 生效。
- 会横向滚动的宽表加 `sticky-first-col`，表格所在的面板设 `--table-bg`。
- 手机和触屏上输入框、下拉为 16px，避免 iOS 聚焦时放大页面。

## 导航与可访问性
- 后台切换分区时更新 `document.title`、在 `aria-live` 区域播报，并把焦点移到新分区的 h1（首次打开、弹窗打开或用户已移动焦点时不移动）。
- 学生端的房间、视图（`view=list`）、教研中心筛选（`major=`）写在地址里，刷新和分享链接都保持原样。

## 验收
- 改界面后在浏览器里真实点击：浅色、深色各看一遍，再看 375px 手机宽和窄窗口，确认没有整页横向滚动、控制台没有报错（含 hydration 报错）。
