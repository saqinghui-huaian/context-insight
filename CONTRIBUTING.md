# 贡献方式

- 插件是**单文件 ESM**（`plugin.js`），没有构建步骤，直接改它。
- 改完必须跑两件事：
  ```bash
  node --check plugin.js
  node scripts/render-check.mjs /path/to/plugin.js   # 期望 RESULT: ALL_OK
  ```
  `render-check` 会喂真实形状的会话/消息/构成数据，真渲染每个组件，并断言
  Token 8 类、Timing 6 段、事件、命令耗时、文件活动等**重建结果非空**——
  图不崩但画空（字段名猜错）会被它抓住。
- 磁盘插件的 className 不经过 Tailwind 构建扫描：任意值（`h-[166px]`、`grid-cols-[…]`）、
  `hover:`、`animate-*` 都会静默失效。尺寸/颜色请写内联 style，交互态与关键帧走注入的
  `<style id="ci-css">`（并记得在 `ctx.onDispose` 里清理）。
- 颜色请区分**主题 chrome**（`--ui-*`，跟随明暗）与**数据身份色**（`DSH.*`，OKLCH 固定色相），
  不要把低饱和的 `--ui-*` 当数据系列色用，也不要用不存在的变量名。
- 新接口字段请先在本机核实再写进代码（可用 `GET /api/sessions?limit=1&offset=0&archived=exclude`
  之类探针看真实返回）。注意 `/api/sessions` 的 `limit` 上限是 100，`archived` 只接受
  `exclude|only|include`，`/messages` 的 `order` 只接受 `oldest|latest`。
