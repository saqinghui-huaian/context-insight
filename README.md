# context-insight · Hermes 桌面端「上下文洞察」插件

一个纯本地、零依赖安装的 Hermes 桌面端插件：把「这次对话的上下文到底被什么吃掉了、时间花在哪里」
做成可交互的仪表盘。信息架构对齐 [dsh-context](https://github.com/bowenliang123/dsh-context)，
但 dsh-context 是 DeepSeek Harness 的插件，装不进 Hermes —— 所以这里用 Hermes 自己的数据面重写了一遍。

**页面 = 三个标签（总览 / 上下文 / 编队）+ 右侧 Context 面板 + 状态栏 `ctx 41%`；范围选择器与命令面板入口在页头。**

## 安装

把本仓库的 `plugin.js` 放到磁盘插件目录即可，**无需重启**：

```
Windows: %LOCALAPPDATA%\hermes\desktop-plugins\context-insight\plugin.js
macOS/Linux: ~/.hermes/desktop-plugins/context-insight/plugin.js
```

然后在桌面端按 `Ctrl+K` → **Reload desktop plugins**（改文件内容也会触发热重载）。
侧边栏出现「上下文洞察」，默认快捷键 `Ctrl/Cmd + Shift + C`，命令面板里也有三条入口。

## 功能

### 总览
- KPI 栏：会话 / 计费 Token / 预估成本 / 缓存命中率 / 轮次+步骤 / 工具调用 / 活跃时长
- 每日 **Token + 成本成对柱状图**，跟随顶部时间范围（今天=当日逐时，7d、30d、全部=近半年）
- **活动热力图**：固定显示全部（近 182 天），不随时间范围变化；点击某天可只看当天
- 技能加载 / 工具调用 / 命令执行列表（点击条目可筛选下方会话）
- 会话卡片：输入输出构成环、上下文占用、成本、工作区；支持搜索、排序、按工作区分组、含归档

### 上下文
- **Context Stats**：轮次、步骤、用户输入条数、工具结果条数、成本、缓存命中、归档行数、tok/s
- **Token Stats**：8 个计费分类（系统提示词 / 工具定义 / 注入上下文 / 技能注入 / 用户消息 /
  工具调用 / 模型思考 / 模型回答）
- **Timing Stats**：模型响应 / 工具参数生成 / 工具执行 / 等待输入 / 其他开销
- **Current Context**：六色堆叠条 + 压缩预留区斜纹
- **Context Trend**：每个请求一根堆叠柱，Step|Turn × Total|Delta 四种组合；悬停看该步组成、
  点击固定明细并给出「对比上一步」的分类差值与服务商实测；压缩/切换等事件直接标在柱上
- **Context Events**：注入 / 压缩 / 清理 / 模型切换 / 模式与系统通知，分类计数与筛选
- **File Activity**：读取 / 写入 / 搜索，写入带 `+N/−N` 行变化统计
- **命令执行**：程序分布环、每条命令的墙钟耗时与成功/失败状态
- **Context Browser**：逐条消息展开看实际内容（含 role、工具名、display_kind、估算 token）
- 占用时间线（自记录采样）+ 运行时事件流

### 编队（Fleet）
- Agent 谱系连线图：父 Agent / 当前 / 子 Agent，运行中的节点绿色脉冲，点选聚焦
- 每个 Agent 一张实时卡：Token 构成环、轮次、活跃时长、成本、工作区与模型

## 数据来源（全部本地，不联网）

| 用途 | 接口 |
|---|---|
| 每日用量、工具、技能 | `GET /api/analytics/usage?days=N` |
| 会话列表与统计 | `GET /api/sessions?limit=100&offset=N&archived=exclude\|include`（`limit` 上限 100） |
| 逐条消息重建 | `GET /api/sessions/{id}/messages?order=latest&limit=500&include_compacted=true` |
| 当前上下文构成 | RPC `session.context_breakdown` |
| 实时占用 | `host.state.focusedUsage` + `host.onEvent` |

估算口径（界面上都带 `≈`）：
- 消息 token 用 Hermes 自己的 `chars / 4` 估算；
- 耗时按消息时间戳差值分桶（工具执行 = assistant→tool 的间隔，等待输入 = 上一条 assistant→user 的间隔，
  模型响应与参数生成按该步产出文本/参数长度比例切分）；
- 上下文窗口构成优先用后端真实读数，缺失时由消息重建。

## 验证脚本

`scripts/render-check.mjs` 是给磁盘插件用的执行型冒烟测试：它把插件 SDK 与 React hooks 换成 stub，
喂真实形状的会话/消息/构成数据，真的把每个组件跑一遍。`node --check` 只能抓语法错，抓不到
「字段名猜错 → 图永远画空」和「children 被当成 key 参数传 → 页面空白」这两类问题，这个脚本可以。

```bash
node scripts/render-check.mjs /path/to/desktop-plugins/context-insight/plugin.js
# RESULT: ALL_OK (49 checks)
```

断言覆盖：steps 数、Token 账本 8 类非空、Timing 6 段非空、compact/prune/switch 事件、
命令墙钟耗时与失败状态、文件读写搜索与 ±行变化、趋势累计单调性，以及 4 种时间范围下的整页渲染。

## 配色

界面 chrome 用主题变量（`--ui-*`），跟随明暗主题；**数据系列用语义固定身份色**（OKLCH，与
dsh-context 同一套 Tailwind-500 色相），保证同一分类在任何图里都是同一个颜色，浅色深色都可读。

## 已知边界
- 单文件插件，className 不走 Tailwind 构建，所有尺寸/颜色为内联样式，交互态与动画由注入的 `<style>` 提供。
- 消息只取最近 500 行（长会话的趋势从可见窗口起点算起）。
- 「工具执行耗时」依赖 tool 回执时间戳配对，异步/后台进程会归入「其他开销」。

## 许可
MIT
