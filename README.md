# context-insight —— Hermes 桌面端「上下文洞察」插件

一个**单文件、零依赖**的 Hermes 桌面端插件：把「这次对话的上下文被什么吃掉了、时间花在哪了」
做成可交互的仪表盘。侧边栏入口、独立页面、右侧面板、状态栏 `ctx 41%`、命令面板与快捷键全套。

信息架构对齐 [dsh-context](https://github.com/bowenliang123/dsh-context)（4.8k★）。
dsh-context 本身是 DeepSeek Harness 的插件，**装不进 Hermes**，所以这里用 Hermes 自己的数据面重写了一份。

所有数据都来自你**本机的会话库与网关 RPC**，插件不联网、不上传任何东西。

---

## 安装

> **网络提示（重要）**：安装脚本会校验 `plugin.js.sha256`，校验不过就**不会写入任何东西**。
> 在中国大陆网络下 `raw.githubusercontent.com` / `cdn.jsdelivr.net` 常被连接重置 —— 这时两种办法：
> ① 直接浏览器打开 **Releases** 页面下载 `plugin.js` 手动放置（见方式 2）；
> ② 给脚本指定一个可用镜像：`GH_PROXY=https://gh-proxy.com/ bash install.sh`
> （PowerShell 同理：`$env:GH_PROXY="https://gh-proxy.com/"; iex (iwr -UseBasicParsing ...)`）。
> 镜像是否可用取决于你所在网络，脚本会依次尝试并在全部失败时打印手动安装步骤。

### 方式 1 · 一行命令

macOS / Linux：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/saqinghui-huaian/context-insight/main/install.sh)
```

Windows（PowerShell）：

```powershell
iex (iwr -UseBasicParsing https://raw.githubusercontent.com/saqinghui-huaian/context-insight/main/install.ps1)
```

脚本行为：候选源依次尝试 → 下载 → **sha256 校验** → 写入
`$HERMES_HOME/desktop-plugins/context-insight/plugin.js` → 有 Node 就顺手 `node --check`。
可用环境变量：`HERMES_HOME`、`REPO`、`BRANCH`、`GH_PROXY`、`GH_BASE`（完全自定义源）。

### 方式 2 · 手动放文件

从 [Releases](../../releases) 或仓库首页下载 `plugin.js`，放到磁盘插件目录（目录名用 `context-insight`）：

| 系统 | 路径 |
|---|---|
| Windows | `%LOCALAPPDATA%\hermes\desktop-plugins\context-insight\plugin.js` |
| macOS / Linux | `~/.hermes/desktop-plugins/context-insight/plugin.js` |

App 监听这个目录，**几秒内自动加载**，之后每次保存都热重载。没出现就 `Ctrl+K` → **Reload desktop plugins**。

### 方式 3 · 入口一览

- 侧边栏：`上下文洞察` / `Context insight`
- 路由：`/context-insight`
- 快捷键：`Ctrl/Cmd + Shift + C`
- 命令面板 `Ctrl+K`：`上下文洞察 · 总览`、`· 上下文`、`· 编队`、`· 当前上下文构成`（复制到剪贴板）

---

## 功能

### 总览（Overview）
- **KPI 栏**：会话数 / 计费 Token / 预估成本 / 缓存命中率 / 轮次与步骤 / 工具调用 / 活跃时长
- **每日 Token + 成本成对柱状图**，跟随顶部时间范围（今天 = 当日逐时；7d / 30d / 全部 = 日桶，全部截近半年）
- **活动热力图**：GitHub 式 7 行网格，**固定显示全部（近 182 天），不随时间范围变化**；点击某天只看当天
- **技能加载 / 工具调用 / 命令执行**三个榜单，点击条目可筛选下方会话
- **会话卡片**：输入输出构成环、上下文占用率、成本、工作区、活跃脉冲；支持搜索、按 Token/消息规模排序、按工作区分组、含归档会话
- **占用时间线**与**运行时事件流**（插件自己持续采样写入 `ctx.storage`，重启不丢）

### 上下文（Context）
- **Context Stats**：轮次 / 步骤 / 用户输入条数 / 工具结果条数 / 成本 / 缓存命中 / 归档行数 / tok/s
- **Token Stats**：8 个计费分类 —— 系统提示词、工具定义、注入上下文、技能注入、用户消息、工具调用（参数+结果）、模型思考、模型回答
- **Timing Stats**：模型响应 / 工具参数生成 / 工具执行 / 等待输入 / 其他开销
- **Current Context**：六色堆叠占用条 + 压缩预留区斜纹
- **Context Trend**：每个请求一根堆叠柱，`Step|Turn` × `Total|Delta` 四种组合；悬停看该步组成，点击固定明细并给出「对比上一步」的分类差值与服务商实测读数；压缩/切换等事件直接标在柱顶
- **Context Events**：注入 / 压缩 / 清理 / 模型切换 / 模式与系统通知，带分类计数与筛选
- **File Activity**：读取 / 写入 / 搜索分类，写入带 `+N / −N` 行变化
- **命令执行**：程序分布、每条命令的墙钟耗时与成功/失败状态
- **Context Browser**：逐条消息展开看**实际内容**（role、工具名、display_kind、估算 token）

### 编队（Fleet）
- **Agent 谱系连线图**：父 Agent / 当前 / 子 Agent，运行中的节点绿色脉冲，点选聚焦
- 每个 Agent 一张实时卡：Token 构成环、轮次与步骤、活跃时长、成本、工作区与模型

### 右侧面板与状态栏
- 右栏 `Context` 面板：占用率 + 六色堆叠条 + 迷你时间线 + 分类图例 + 注入的 files 明细
- 状态栏 `ctx 41%` 胶囊，点击直达完整页面

---

## 数据来源（全部本地）

| 用途 | 接口 |
|---|---|
| 每日用量、工具与技能榜单 | `GET /api/analytics/usage?days=N` |
| 会话列表与统计 | `GET /api/sessions?limit=100&offset=N&archived=exclude\|include`（`limit` 上限为 100） |
| 逐条消息重建 | `GET /api/sessions/{id}/messages?order=latest&limit=500&include_compacted=true` |
| 当前上下文构成 | RPC `session.context_breakdown` |
| 会话累计用量 | RPC `session.usage` |
| 实时占用与事件 | `host.state.focusedUsage`、`host.onEvent` |

### 估算口径（界面上凡带 `≈` 的都是估算）
- **消息 token** 用 Hermes 自己的 `chars / 4` 估算；分类拆分同样基于文本长度比例。
- **耗时**按消息时间戳差值分桶：工具执行 = `assistant → tool` 的间隔；等待输入 = 上一条 `assistant → user` 的间隔；模型响应与工具参数生成按该步产出文本/参数长度比例切分；无法归因的计入「其他开销」。
- **上下文窗口构成**优先用后端真实读数（角标会区分 `≈ 估算` 与 `服务商实测`），缺失时由消息重建兜底。
- 消息只取最近 **500 行**，超长会话的趋势从可见窗口起点算起。

---

## 兼容性与边界（装之前请看）

1. **只有 Hermes 桌面端（`hermes desktop`）能用。** Hermes 里有三套互不相通的插件系统：
   - 桌面端插件：`@hermes/plugin-sdk` + `$HERMES_HOME/desktop-plugins/` ← **本插件属于这一套**
   - Web dashboard 插件：`manifest.json` + `window.__HERMES_PLUGIN_SDK__`（完全另一套 API）
   - Python CLI / gateway 插件：又是另一套
   把本文件放进后两者目录里不会有任何效果。
2. **需要较新的桌面端版本。** 数据面依赖 `/api/analytics/usage`、`/api/sessions?archived=`、
   RPC `session.context_breakdown` / `session.usage`。版本过旧不会崩，对应卡片会显示
   「加载失败 · 重试」，其余卡片照常工作（每张卡有独立错误态）。
3. **语言自适应**：按 `navigator.language` 在中/英之间切换，其他语言走英文兜底。
4. **不改动任何 App 源码或配置**，只往磁盘目录放一个文件；卸载 = 删掉该目录，界面自动消失。
5. 磁盘插件的 `className` 不经过 Tailwind 构建扫描，因此所有尺寸/颜色为内联样式，
   hover/active/动画由插件注入的一段 `<style>` 提供，并在 `ctx.onDispose` 里清理。
6. 尊重 `prefers-reduced-motion`：系统开了减弱动效时自动关掉入场/生长/脉冲动画。

---

## 验证脚本

`scripts/render-check.mjs` 是一个执行型冒烟测试：它把插件 SDK 与 React hooks 换成 stub，
喂**真实形状**的会话 / 消息 / 上下文构成数据，真把每个组件跑一遍，再断言重建出来的数据非空。

`node --check` 只能抓语法错，抓不到这两类真问题：

- 字段名猜错 → 组件不崩，但图**永远画空**（真实踩过：把 `analytics.tools` 的 `tool` 猜成 `tool_name`，工具列表全是 `?`）
- `children` 被当成第三个参数（key 槽）传 → 页面空白

```bash
node scripts/render-check.mjs ~/.hermes/desktop-plugins/context-insight/plugin.js
# RESULT: ALL_OK (49 checks)
```

覆盖断言：步骤数、Token 账本 8 类非空、Timing 6 段非空、compact/prune/switch 事件、
命令墙钟耗时与失败状态、文件读/写/搜索与 `±N` 行变化、趋势累计单调性，
以及 4 种时间范围下的整页渲染（Page / OverviewTab / SidePane / GitHubHeat）。

---

## 配色

界面 chrome 走主题变量（`--ui-*`），跟随明暗主题切换；
**数据系列用语义固定身份色**（OKLCH，与 dsh-context 同一套 Tailwind-500 色相），
保证「系统提示词永远是那个蓝紫、工具定义永远是琥珀色」，跨图表一致，浅底深底都可读。
热力图用同一族蓝色的明度 5 档表示浓度。

---

## 常见问题

| 现象 | 处理 |
|---|---|
| 侧边栏没有「上下文洞察」 | 确认文件路径是 `desktop-plugins/context-insight/plugin.js`（多一层或少一层都不加载）；`Ctrl+K` → Reload desktop plugins |
| 出现 `Plugin "context-insight" failed to load` | 十有八九是文件被改坏（语法错）。跑一遍 `node --check plugin.js`；从 Releases 重新下载 |
| 某些卡片显示「加载失败 · 重试」 | 你的桌面端版本没有对应接口/字段，点重试；持续失败请带上报错文本发 issue |
| Token/Timing 里数字都带 `≈` | 正常：这些是本地按 `chars/4` 与时间戳差值重建的估算，不是服务商账单 |
| 想清空它自己记的时间线/偏好 | 设置页 → Context Insight → 清空时间线与偏好 |

---

## 隐私

- 插件只读你本机的 Hermes 会话库和网关 RPC，**没有任何外部网络请求**。
- 自记录的占用时间线存在 `ctx.storage`（该插件作用域的本地存储）里，设置页可一键清空。
- 本仓库不含任何账号、邮箱、绝对路径或凭据。

## 目录结构

```
plugin.js               插件本体（单文件 ESM，无构建步骤）
plugin.js.sha256        发布校验值，安装脚本据此验签
install.sh / install.ps1  一行安装（含镜像回退 + sha256 校验）
scripts/render-check.mjs  执行型冒烟测试（开发用，App 不加载）
README / LICENSE / CHANGELOG / CONTRIBUTING
```

## 许可

MIT —— 见 [LICENSE](LICENSE)。

## 致谢

接口与视觉语义参考 [dsh-context](https://github.com/bowenliang123/dsh-context)。
