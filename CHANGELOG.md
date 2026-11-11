# Changelog

## v1.0.0 — 首个可分享版本

- 三标签页信息架构（总览 / 上下文 / 编队）+ 右侧 Context 面板 + 状态栏 `ctx` 胶囊 + 命令面板 4 条 + `Ctrl/Cmd+Shift+C`
- Token Stats 8 个计费分类、Timing Stats 5 段 + 总计、Current Context 六色堆叠带压缩预留斜纹
- Context Trend 请求级堆叠柱：`Step|Turn` × `Total|Delta`，悬停组成浮层、点击固定 + 对比上一步分类差值 + 服务商实测读数、事件标在柱顶
- Context Events（注入/压缩/清理/模型切换/模式与通知）、File Activity（`+N/−N` 行变化）、命令执行（墙钟耗时 + 成功/失败 + 程序分布）、Context Browser（逐条看实际内容）
- 活动热力图固定全周期（近 182 天），每日 Token+成本柱跟随时间范围选择器
- 编队：Agent 谱系连线 + 运行中脉冲 + 每 Agent 实时卡
- 占用时间线与运行时事件自记录（`ctx.storage`），时间范围/趋势粒度/模式写回偏好
- `scripts/render-check.mjs`：49 项执行型渲染 + 数据非空断言
- 界面中/英自适应；配色区分主题 chrome 与数据身份色；尊重 `prefers-reduced-motion`
