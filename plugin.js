// context-insight — Hermes 桌面端「上下文洞察」
// 信息架构对齐 dsh-context（github.com/bowenliang123/dsh-context）README 的功能表，数据面换成 Hermes：
//   · 上下文洞察页面 → 「总览」：KPI 栏 / 每日成对柱状（Token+成本）/ 活动热力图（点击某天只看当天）
//                     / 技能加载 / 工具调用 / 命令执行（点击筛选会话）/ 会话卡片（可按工作区分组）
//   · Context 标签页 → 「上下文」：Context Stats / Token Stats（8 个计费分类）/ Timing Stats（5 段）
//                     / Current Context（六色堆叠 + 压缩预留斜纹）/ Context Trend（请求级堆叠柱：
//                     Step|Turn、Total|Delta、悬停组成、点击固定 + vs 上一步差值 + 服务商实测、事件标记）
//                     / Context Events（Inject|Compact|Prune|Switch|Mode 分类计数与筛选）
//                     / File Activity（读|写|搜索、+N/−N 行变化）/ 命令执行（状态、墙钟耗时、程序分布）
//                     / Context Browser（逐项展开看实际内容）
//   · Fleet 标签页  → 「编队」：Agent 网络（谱系连线、运行中脉冲、点选聚焦）+ 每 Agent 一张实时卡
//   · Context 面板  → 右侧边栏面板（占用率 + 堆叠条 + 迷你时间线 + 分类 + files）
//   · /context 命令 → 命令面板三条 + mod+shift+c；时间范围/粒度/模式写回偏好
//
// 数据面（均已核实字段与枚举）：/api/analytics/usage、/api/sessions（limit≤100、
//   archived∈exclude|only|include、order∈created|recent）、/api/sessions/{id}/messages
//   （order∈oldest|latest、include_compacted）、session.context_breakdown、session.usage、
//   host.state.focusedUsage、host.onEvent。
// 估算标注：消息 token 用 Hermes 自己的 chars/4；耗时来自消息时间戳差值 → 一律带 ≈。
// 磁盘插件的 className 不会被 Tailwind 构建扫描 → 尺寸/颜色内联，hover/动画用注入的 <style>。

import {
  atom, Badge, Button, cn, haptic, host, KEYBINDS_AREA, PANES_AREA,
  PALETTE_AREA, queryClient, relativeTime, ROUTES_AREA, ScrollArea,
  SIDEBAR_NAV_AREA, STATUSBAR_AREAS, useQuery, useValue
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'context-insight'
const DAY_MS = 86400000
const LEDGER_KEY = 'ledger'
const EVENTS_KEY = 'events'
const PREFS_KEY = 'prefs'
const LEDGER_CAP = 4000
const EVENTS_CAP = 600
const SCAN_SESSIONS = 8
const PAGE = 100
const PAGES = 3
const OVERVIEW_AT = 90
const HEAT_DAYS = 182

// ── 色彩：数据系列用语义身份色（与 dsh-context 同一套 Tailwind-500 色相） ──────
const C = {
  stroke: 'var(--ui-stroke-secondary)', t1: 'var(--ui-text-primary)', t2: 'var(--ui-text-secondary)',
  t3: 'var(--ui-text-tertiary)', t4: 'var(--ui-text-quaternary)', accent: 'var(--ui-accent)',
  bg3: 'var(--ui-bg-tertiary)', bg4: 'var(--ui-bg-quaternary)', elevated: 'var(--ui-bg-elevated)',
  red: 'var(--ui-red)', green: 'var(--ui-green)'
}
const DSH = {
  indigo: 'oklch(58.5% 0.204 277)', amber: 'oklch(76.9% 0.167 70)', emerald: 'oklch(69.6% 0.17 162)',
  violet: 'oklch(60.6% 0.25 292)', orange: 'oklch(70.5% 0.213 47)', teal: 'oklch(70.4% 0.14 193)',
  purple: 'oklch(63% 0.28 302)', pink: 'oklch(64.9% 0.23 355)', blue: 'oklch(62.3% 0.214 259)',
  cyan: 'oklch(71.9% 0.15 215)', rose: 'oklch(63.7% 0.23 27)', gray: 'oklch(70.8% 0.027 258)'
}
const BILL = [
  ['system', '系统提示词', 'System prompt', DSH.indigo],
  ['tools', '工具定义', 'Tool definitions', DSH.amber],
  ['injected', '注入上下文', 'Injected context', DSH.violet],
  ['skills', '技能注入', 'Skill injections', DSH.orange],
  ['user', '用户消息', 'User messages', DSH.emerald],
  ['toolcalls', '工具调用', 'Tool calls', DSH.teal],
  ['reasoning', '模型思考', 'Reasoning', DSH.purple],
  ['answers', '模型回答', 'Answers', DSH.pink]
]
const BILLMAP = {}
BILL.forEach((b) => { BILLMAP[b[0]] = { name: b[1], en: b[2], color: b[3] } })
const CUR6 = ['system', 'tools', 'user', 'injected', 'answers', 'toolcalls']
const HEAT_BLUE = ['oklch(92.5% 0.017 255)', 'oklch(84% 0.062 253)', 'oklch(72% 0.115 250)', 'oklch(62.3% 0.214 259)', 'oklch(54% 0.215 262)']
const HUES = [DSH.blue, DSH.teal, DSH.orange, DSH.purple, DSH.emerald, DSH.pink, DSH.amber, DSH.indigo, DSH.rose, DSH.cyan]
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const R = { card: 10, ctrl: 6, chip: 4 }
const CAT_COLOR = { system_prompt: DSH.indigo, tool_definitions: DSH.amber, rules: DSH.violet, skills: DSH.orange, mcp: DSH.rose, subagent_definitions: DSH.blue, memory: DSH.emerald, conversation: DSH.teal }

// ── 注入样式：hover / 动画类对磁盘插件不存在 ─────────────────────────────────
const STYLE_ID = 'ci-css'
const CSS = [
  '@keyframes ci-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  '@keyframes ci-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}',
  '@keyframes ci-pulse{0%,100%{opacity:1}50%{opacity:.2}}',
  '@keyframes ci-shimmer{0%{background-position:-140% 0}100%{background-position:240% 0}}',
  '@keyframes ci-fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
  '.ci-card{animation:ci-in .3s ease-out both;transition:border-color .18s}',
  '.ci-card:hover{border-color:color-mix(in oklab,' + DSH.blue + ' 55%,transparent)!important}',
  '.ci-tile{cursor:pointer;transition:transform .18s,box-shadow .18s,border-color .18s}',
  '.ci-tile:hover{transform:translateY(-2px);box-shadow:0 5px 16px color-mix(in oklab,' + DSH.blue + ' 22%,transparent)}',
  '.ci-tile:active{transform:scale(.99)}',
  '.ci-tile.ci-cur{border-color:' + DSH.blue + '!important}',
  '.ci-tile:hover .ci-title{color:' + DSH.blue + '!important}',
  '.ci-segb{cursor:pointer;transition:background .15s,color .15s}',
  '.ci-row{cursor:pointer;transition:background .15s;border-radius:4px}',
  '.ci-row:hover{background:var(--ui-row-hover-background)}',
  '.ci-chip{cursor:pointer;transition:border-color .15s}',
  '.ci-chip:hover{border-color:' + DSH.blue + '!important}',
  '.ci-bar{transform-box:fill-box;transform-origin:bottom;animation:ci-grow .45s cubic-bezier(.2,.8,.2,1) both}',
  '.ci-stackseg{transition:opacity .18s}',
  '.ci-stack:hover .ci-stackseg{opacity:.5}',
  '.ci-stack .ci-stackseg:hover{opacity:1}',
  '.ci-tip{animation:ci-fade .14s ease-out both;pointer-events:none;z-index:9}',
  '.ci-skel{height:12px;border-radius:4px;background-image:linear-gradient(90deg,transparent,var(--ui-stroke-secondary),transparent);background-size:220% 100%;animation:ci-shimmer 1.3s linear infinite}',
  '.ci-live{animation:ci-pulse 1.5s ease-in-out infinite}',
  '.ci-node{cursor:pointer;transition:opacity .15s}.ci-node:hover{opacity:.8}',
  'button:focus-visible,input:focus-visible{outline:2px solid var(--ui-accent);outline-offset:1px;border-radius:4px}',
  '@media (prefers-reduced-motion:reduce){.ci-card,.ci-bar,.ci-live,.ci-skel,.ci-tip{animation:none!important}}'
].join('\n')
function mountStyle () {
  try {
    let el = document.getElementById(STYLE_ID)
    if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el) }
    el.textContent = CSS
  } catch (e) {}
}
function unmountStyle () { try { const el = document.getElementById(STYLE_ID); if (el) el.remove() } catch (e) {} }

// ── 文案 ─────────────────────────────────────────────────────────────────────
const ZH = ((typeof navigator !== 'undefined' && navigator.language) || 'zh').toLowerCase().startsWith('zh')
const W = {
  zh: {
    page: '上下文洞察', tabDash: '总览', tabCtx: '上下文', tabFleet: '编队', pane: '上下文',
    rToday: '今天', r7: '近 7 天', r30: '近 30 天', rAll: '全部',
    kSessions: '会话', kTokens: '计费 Token', kCost: '预估成本', kCache: '缓存命中率', kTurns: '轮次',
    kSteps: '步骤', kTools: '工具调用', kActive: '活跃时长', subagents: '子 Agent', archived: '已归档',
    trend: '每日 Token 与成本', trendToday: '当日逐时 Token', heat: '活动热力图', heatPick: '点击某天可只看当天', heatMeta: '固定全部 · 近半年，不随时间范围变化',
    skills: '技能加载', tools: '工具调用', cmds: '命令执行', sessCard: '会话', comp: '上下文构成',
    stats: 'Context Stats', tokStats: 'Token Stats', timeStats: 'Timing Stats', curCtx: 'Current Context',
    ctrend: 'Context Trend', events: 'Context Events', files: 'File Activity', cmdRun: '命令执行',
    browser: 'Context Browser', timeline: '占用时间线', runtime: '运行时事件',
    turns: '轮次', steps: '步骤', userIn: '用户输入', realTools: '工具结果', estCost: '估算成本', cacheHit: '缓存命中',
    total: '总计', active: '活跃', reserved: '压缩预留', window: '窗口',
    modelWait: '模型响应', argGen: '工具参数生成', toolRun: '工具执行', waitUser: '等待输入', overhead: '其他开销',
    granStep: 'Step', granTurn: 'Turn', modeTotal: 'Total', modeDelta: 'Delta',
    hoverTip: '悬停看该步组成 · 点击固定明细', pinned: '已固定', unpin: '取消固定', vsPrev: '对比上一步',
    actual: '服务商实测', est: '≈ 估算',
    evAll: '全部', evInject: '注入', evCompact: '压缩', evPrune: '清理', evSwitch: '切换', evMode: '模式',
    fAll: '全部', fRead: '读取', fWrite: '写入', fSearch: '搜索', lines: '行变化', ops: '次操作', filesN: '个文件',
    cmdUnknown: '未知', programs: '程序',
    agents: 'Agent 数', running: '运行中', children: '子 Agent', parent: '父 Agent', noFleet: '这个会话没有子 Agent',
    fleetSum: '编队摘要', network: 'Agent 网络', pickHint: '悬停/点选聚焦',
    noFocus: '当前没有聚焦的会话', noData: '暂无数据', filters: '筛选', clear: '清除',
    clickHint: '点击条目可筛选下方会话（工具/命令筛选只覆盖已扫描的最近会话）', loadFail: '加载失败', retry: '重试', refresh: '刷新', exportJson: '导出 JSON',
    prefs: '偏好（自动记住，页面切换会写回）', pRange: '默认时间范围', pGran: '趋势粒度', pMode: '趋势模式',
    note: '标 ≈ 的数字由消息文本按 chars/4 估算；耗时按消息时间戳差值分桶。',
    showMore: '展开更多', hide: '收起', msgsOf: '条消息（可展开看实际内容）',
    sortUpd: '最近更新', sortTok: 'Token', sortCtx: '消息规模', search: '搜索会话 / 工作区…',
    group: '按工作区', liveSessions: '当前会话', allSessions: '全部（含归档）',
    step: '步', turn: '轮', current: '当前', copyOk: '已复制', copyFail: '复制失败', cleared: '已清空',
    clearAll: '清空时间线与偏好', openFull: '打开完整面板', tps: 'tok/s',
    about: '信息架构对齐 dsh-context；数据全部来自 Hermes 本地会话库与网关 RPC。'
  },
  en: {
    page: 'Context insight', tabDash: 'Overview', tabCtx: 'Context', tabFleet: 'Fleet', pane: 'Context',
    rToday: 'Today', r7: '7 days', r30: '30 days', rAll: 'All',
    kSessions: 'Sessions', kTokens: 'Billed tokens', kCost: 'Est. cost', kCache: 'Cache hit', kTurns: 'Turns',
    kSteps: 'Steps', kTools: 'Tool calls', kActive: 'Active time', subagents: 'sub-agents', archived: 'archived',
    trend: 'Daily tokens & cost', trendToday: 'Today by hour', heat: 'Activity heatmap', heatPick: 'click a day to focus it', heatMeta: 'always all · last 6 months',
    skills: 'Skill loads', tools: 'Tool calls', cmds: 'Commands', sessCard: 'Sessions', comp: 'Composition',
    stats: 'Context Stats', tokStats: 'Token Stats', timeStats: 'Timing Stats', curCtx: 'Current Context',
    ctrend: 'Context Trend', events: 'Context Events', files: 'File Activity', cmdRun: 'Commands',
    browser: 'Context Browser', timeline: 'Occupancy timeline', runtime: 'Runtime events',
    turns: 'Turns', steps: 'Steps', userIn: 'User input', realTools: 'Tool results', estCost: 'Est. cost', cacheHit: 'Cache hit',
    total: 'total', active: 'active', reserved: 'reserved', window: 'window',
    modelWait: 'Model', argGen: 'Tool-arg gen', toolRun: 'Tool run', waitUser: 'User gap', overhead: 'Overhead',
    granStep: 'Step', granTurn: 'Turn', modeTotal: 'Total', modeDelta: 'Delta',
    hoverTip: 'hover a bar for composition · click to pin', pinned: 'Pinned', unpin: 'Unpin', vsPrev: 'vs previous',
    actual: 'provider actual', est: '≈ est',
    evAll: 'all', evInject: 'inject', evCompact: 'compact', evPrune: 'prune', evSwitch: 'switch', evMode: 'mode',
    fAll: 'all', fRead: 'read', fWrite: 'written', fSearch: 'searched', lines: 'line delta', ops: 'ops', filesN: 'files',
    cmdUnknown: 'unknown', programs: 'programs',
    agents: 'Agents', running: 'running', children: 'children', parent: 'parent', noFleet: 'No sub-agents',
    fleetSum: 'Fleet summary', network: 'Agent network', pickHint: 'hover or click',
    noFocus: 'No focused session', noData: 'No data', filters: 'Filters', clear: 'Clear',
    clickHint: 'Click an item to filter sessions (tool/command filters cover only scanned sessions)', loadFail: 'Load failed', retry: 'Retry', refresh: 'Refresh', exportJson: 'Export JSON',
    prefs: 'Preferences (remembered; page switches write back)', pRange: 'Default range', pGran: 'Trend granularity', pMode: 'Trend mode',
    note: 'Values marked ≈ are estimated at chars/4; timing buckets use message timestamp deltas.',
    showMore: 'show more', hide: 'collapse', msgsOf: 'messages (expand for real content)',
    sortUpd: 'Recent', sortTok: 'Tokens', sortCtx: 'Transcript', search: 'search sessions / workspace…',
    group: 'By workspace', liveSessions: 'Active', allSessions: 'All (incl. archived)',
    step: 'steps', turn: 'turns', current: 'current', copyOk: 'Copied', copyFail: 'Copy failed', cleared: 'Cleared',
    clearAll: 'Clear timeline & prefs', openFull: 'Open full panel', tps: 'tok/s',
    about: 'IA mirrors dsh-context; every number comes from the local Hermes session DB or gateway RPC.'
  }
}
const t = (k) => W[ZH ? 'zh' : 'en'][k] || W.en[k] || k
const billName = (k) => (BILLMAP[k] ? (ZH ? BILLMAP[k].name : BILLMAP[k].en) : k)

// ── 小工具 ───────────────────────────────────────────────────────────────────
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v && isFinite(parseFloat(v)) ? parseFloat(v) : 0))
const arr = (v) => (Array.isArray(v) ? v : [])
const estTok = (s) => Math.round(String(s == null ? '' : s).length / 4)
const sumBy = (a, k) => a.reduce((x, d) => x + num(k ? d[k] : d), 0)
function fmtTok (v) {
  const n = num(v)
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 1 : 2) + 'k'
  return String(Math.round(n))
}
function fmtCost (v) { const n = num(v); return n > 0 ? '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(4)) : '—' }
function fmtDur (sec) {
  const s = Math.max(0, Math.round(num(sec)))
  if (!s) return '0s'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (h) return h + 'h' + String(m).padStart(2, '0') + 'm'
  if (m) return m + 'm' + String(r).padStart(2, '0') + 's'
  return r + 's'
}
function fmtPct (v, dp) { const n = num(v); return n.toFixed(dp == null ? (n >= 10 ? 1 : 2) : dp) + '%' }
function dayKey (es) { const d = new Date(es * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
function monLabel (d) { return ZH ? (d.getMonth() + 1) + '月' : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] }
function fmtStamp (ms) { try { return new Date(ms).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' } }
const shortId = (s) => String(s || '').slice(0, 14)
const errMsg = (e) => String((e && e.message) || e || '').slice(0, 170)
const leaf = (p) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-1)[0] || String(p || '—')
function focusedId () { try { return host.state.focusedSessionId.get() || host.state.activeSessionId.get() || null } catch (e) { return null } }
async function api (path) {
  if (typeof window === 'undefined' || !window.hermesDesktop || typeof window.hermesDesktop.api !== 'function') throw new Error('bridge unavailable')
  return window.hermesDesktop.api({ path })
}
const RANGE_DAYS = { today: 1, d7: 7, d30: 30, all: 365 }
const RANGE_KEY = { today: 'rToday', d7: 'r7', d30: 'r30', all: 'rAll' }
const PREF_DEFAULTS = { range: 'd30', gran: 'step', mode: 'total', heat: 'tokens' }
const getStored = (k, d) => { try { const v = STORE ? STORE.get(k, d) : d; return v == null ? d : v } catch (e) { return d } }
function prefsNow () { try { return Object.assign({}, PREF_DEFAULTS, getStored(PREFS_KEY, {})) } catch (e) { return PREF_DEFAULTS } }
function savePref (o) { try { STORE.set(PREFS_KEY, Object.assign(prefsNow(), o)) } catch (e) {} }

// ── 取数 ─────────────────────────────────────────────────────────────────────
async function fetchAnalytics (days) {
  const r = await api('/api/analytics/usage?days=' + days)
  return { daily: arr(r && r.daily), totals: (r && r.totals) || {}, tools: arr(r && r.tools), skills: (r && r.skills) || { top_skills: [], summary: {} } }
}
async function fetchSessions (includeArchived) {
  const out = []; const seen = new Set(); let archivedN = 0
  for (let p = 0; p < PAGES; p++) {
    let rows = []
    try {
      const r = await api('/api/sessions?limit=' + PAGE + '&offset=' + (p * PAGE) + '&min_messages=0&order=recent&archived=' + (includeArchived ? 'include' : 'exclude'))
      rows = arr(r && (r.sessions || r.items))
    } catch (e) {
      if (p === 0) {
        const rpc = await host.request('session.list', { limit: PAGE }).catch(() => null)
        rows = arr(rpc && rpc.sessions)
        if (!rows.length) throw e
      }
    }
    for (const raw of rows) {
      if (raw && raw.archived) archivedN += 1
      const s = normSession(raw)
      if (!s.id || seen.has(s.id)) continue
      seen.add(s.id); out.push(s)
    }
    if (rows.length < PAGE) break
  }
  return { rows: out, archived: archivedN }
}
function normSession (r) {
  r = r || {}
  return {
    id: String(r.id || ''), title: r.title || r.preview || shortId(r.id),
    started: num(r.started_at), last: num(r.last_active) || num(r.started_at),
    durSec: (num(r.ended_at) > num(r.started_at) && num(r.started_at)) ? num(r.ended_at) - num(r.started_at) : 0,
    msgs: num(r.message_count), toolCalls: num(r.tool_call_count), apiCalls: num(r.api_call_count),
    input: num(r.input_tokens), output: num(r.output_tokens),
    cost: num(r.actual_cost_usd) || num(r.estimated_cost_usd),
    model: r.model || '', source: r.source || '', cwd: r.cwd || '',
    preview: typeof r.preview === 'string' ? r.preview : '',
    parent: r._branched_from || r.parent_session_id || null, active: !!r.is_active, archived: !!r.archived,
    internal: !!r.is_internal_child, continuation: r.continuation_kind || null,
    turns: Math.max(0, Math.round(num(r.message_count) / 2))
  }
}
async function fetchMessages (sid) {
  const r = await api('/api/sessions/' + encodeURIComponent(sid) + '/messages?limit=500&offset=0&order=latest&include_compacted=true')
  return arr(r && (r.messages || r.items || r.rows))
}

// ── 从消息重建：Token 分类 / Timing / 请求级趋势 / 事件 / 文件 / 命令 ─────────
const READ_TOOLS = ['read_file', 'read', 'vision_analyze']
const WRITE_TOOLS = ['write_file', 'patch', 'write', 'edit', 'skill_manage']
const SEARCH_TOOLS = ['search_files', 'grep', 'search', 'web_search', 'web_extract']
const CMD_TOOLS = ['terminal', 'execute_code', 'shell', 'bash']
function parseCalls (raw) {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch (e) { return [] } }
  if (!Array.isArray(v)) return []
  return v.map((c) => (c && c.function) || c || {}).filter((f) => f && f.name)
}
function callArgs (f) {
  let a = f.arguments
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch (e) { a = { command: a } } }
  return a && typeof a === 'object' ? a : {}
}
const NOTICE_KINDS = { auto_continue: 1, internal_notification: 1, process_complete: 1, async_delegation_complete: 1, failed_turn: 1, content_refused: 1 }
function pathOf (a) { return String(a.path || a.file_path || a.file || a.pathname || a.pattern || '') }
// 命令归属：terminal 的参数是 command，execute_code 的是 code —— 都要落到「程序名」上
function progOf (name, a) {
  const raw = String(a.command || a.cmd || '').trim()
  if (raw) {
    const cut = raw.replace(/^(?:sudo |doas )+/, '').replace(/^cd +\S+ *(?:&&|;) * */, '').replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+ +)+/, '')
    const first = (cut.split(/[\s|;&]+/)[0] || '').replace(/^['"]+/, '').replace(/['"]+$/, '')
    if (first) return first.slice(0, 28)
  }
  return name === 'execute_code' ? 'python' : String(name || '').slice(0, 28)
}

function rebuild (msgs, bd) {
  const live = [], archived = []
  for (const m of arr(msgs)) { (m && m.active === 0 ? archived : live).push(m) }
  const fixed = { system: 0, tools: 0, injected: 0, skills: 0 }
  for (const c of arr(bd && bd.categories)) {
    const v = num(c.tokens)
    if (c.id === 'system_prompt') fixed.system += v
    else if (c.id === 'tool_definitions') fixed.tools += v
    else if (c.id === 'skills' || c.id === 'mcp' || c.id === 'subagent_definitions') fixed.skills += v
    else fixed.injected += v
  }
  const bill = { system: fixed.system, tools: fixed.tools, injected: fixed.injected, skills: fixed.skills, user: 0, toolcalls: 0, reasoning: 0, answers: 0 }
  const timing = { modelWait: 0, argGen: 0, toolRun: 0, waitUser: 0, other: 0, total: 0, outTokens: 0 }
  const steps = [], events = [], fileOps = [], cmdRows = []
  const toolNames = new Map()
  const run = { user: 0, toolcalls: 0, reasoning: 0, answers: 0 }
  let prev = null, prevRole = '', turn = 0, step = 0
  for (const m of live) {
    const ts = num(m.timestamp)
    const gap = prev && ts ? Math.max(0, Math.min(3600, ts - prev)) : 0
    const role = String(m.role || '')
    const dk = String(m.display_kind || '')
    if (dk === 'model_switch') events.push({ t: ts * 1000, kind: 'switch', step, text: String(m.display_content || m.content || '').slice(0, 70) })
    else if (dk === 'steer' || dk === 'skill_invocation') events.push({ t: ts * 1000, kind: 'inject', step, text: (dk === 'steer' ? 'steer · ' : 'skill · ') + String(m.display_content || m.content || '').slice(0, 60) })
    else if (NOTICE_KINDS[dk]) events.push({ t: ts * 1000, kind: 'mode', step, text: dk + ' · ' + String(m.display_content || m.content || '').slice(0, 56) })
    if (m._compressed_summary === true) events.push({ t: ts * 1000, kind: 'compact', step, text: (ZH ? '压缩摘要行' : 'summary row') })
    if (role === 'assistant') {
      const calls = parseCalls(m.tool_calls)
      const txt = estTok(m.content) + estTok(m.display_content)
      const rea = estTok(m.reasoning) + estTok(m.reasoning_content)
      let arg = 0
      for (const f of calls) {
        arg += estTok(JSON.stringify(callArgs(f))) + Math.round(String(f.name || '').length / 4)
        toolNames.set(f.name, (toolNames.get(f.name) || 0) + 1)
      }
      bill.toolcalls += arg; bill.reasoning += rea; bill.answers += txt
      run.toolcalls += arg; run.reasoning += rea; run.answers += txt
      timing.outTokens += txt + rea
      const denom = Math.max(1, txt + rea + arg)
      timing.modelWait += gap * (txt + rea) / denom
      timing.argGen += gap * arg / denom
      step += 1
      if (prevRole === 'user' || prevRole === '') turn += 1
      const cur = {
        i: step, turn: Math.max(1, turn), ts: ts * 1000, ev: [],
        parts: { system: fixed.system, tools: fixed.tools, injected: fixed.injected, skills: fixed.skills, user: run.user, toolcalls: run.toolcalls, reasoning: run.reasoning, answers: run.answers },
        t: fixed.system + fixed.tools + fixed.injected + fixed.skills + run.user + run.toolcalls + run.reasoning + run.answers,
        label: (ZH ? '步 ' : 'step ') + step + ' · ' + (ZH ? '轮 ' : 'turn ') + Math.max(1, turn)
      }
      steps.push(cur)
      for (const f of calls) {
        const a = callArgs(f)
        const kind = CMD_TOOLS.indexOf(f.name) >= 0 ? 'c' : READ_TOOLS.indexOf(f.name) >= 0 ? 'r' : WRITE_TOOLS.indexOf(f.name) >= 0 ? 'w' : SEARCH_TOOLS.indexOf(f.name) >= 0 ? 's' : null
        if (kind === 'c') {
          const cmd = String(a.command || a.cmd || a.code || a.script || '').trim()
          const prog = progOf(f.name, a)
          if (prog) cmdRows.push({ step, ts: ts * 1000, prog, cmd: cmd.replace(/\s+/g, ' ').slice(0, 150), dur: 0, status: 'unknown' })
        } else if (kind && pathOf(a)) {
          let add = 0, del = 0
          if (kind === 'w') {
            add = Math.max(0, String(a.new_string || a.content || '').split('\n').length - 1)
            del = Math.max(0, String(a.old_string || '').split('\n').length - 1)
          }
          fileOps.push({ step, ts: ts * 1000, kind, path: pathOf(a), add, del })
        }
      }
      prevRole = 'assistant'
    } else if (role === 'tool') {
      const tk = estTok(m.content)
      bill.toolcalls += tk; run.toolcalls += tk
      timing.toolRun += gap
      if (steps.length) { const s = steps[steps.length - 1]; s.parts.toolcalls += tk; s.t += tk }
      if (prevRole === 'assistant' && cmdRows.length) {
        const last = cmdRows[cmdRows.length - 1]
        if (!last.dur) last.dur = gap
        last.status = /(^error|traceback|\berror\b|failed)/.test(String(m.content || '').toLowerCase()) ? 'error' : 'ok'
      }
      prevRole = 'tool'
    } else if (role === 'user') {
      const tk = estTok(m.content) + estTok(m.display_content)
      bill.user += tk; run.user += tk
      timing.waitUser += gap
      if (steps.length) { const s = steps[steps.length - 1]; s.parts.user += tk; s.t += tk }
      prevRole = 'user'
    } else {
      timing.other += gap
      prevRole = role || 'other'
    }
    if (ts) prev = ts
  }
  if (archived.length) {
    const at = num(archived[archived.length - 1].timestamp) * 1000
    const freed = sumBy(arr(archived).map((x) => estTok(x.content)))
    events.unshift({ t: at, kind: 'compact', step: steps.length, text: (ZH ? '回收 ' : 'freed ') + fmtTok(freed) + ' tk · ' + archived.length + (ZH ? ' 行归档' : ' rows'), rows: archived.length })
    events.push({ t: at, kind: 'prune', step: steps.length, text: (ZH ? '归档行 ' : 'archived rows ') + archived.length, rows: archived.length })
  }
  for (const e of events) { const s = steps.find((x) => x.i === e.step); if (s && s.ev.indexOf(e.kind) < 0) s.ev.push(e.kind) }
  for (let i = 1; i < steps.length; i++) {
    const d = num(steps[i].t) - num(steps[i - 1].t)
    if (d < -1) { steps[i].ev.push('compact'); steps[i].drop = -d }
  }
  timing.total = timing.modelWait + timing.argGen + timing.toolRun + timing.waitUser + timing.other
  const byProg = new Map()
  for (const c of cmdRows) byProg.set(c.prog, (byProg.get(c.prog) || 0) + 1)
  const prog = Array.from(byProg.keys()).map((name) => ({ name, count: byProg.get(name) })).sort((a, b) => b.count - a.count).slice(0, 12)
  const tools = Array.from(toolNames.keys()).map((name) => ({ name, count: toolNames.get(name) })).sort((a, b) => b.count - a.count)
  return { steps, events, fileOps: fileOps, prog, tools, cmds: cmdRows, bill, timing, archivedRows: archived.length }
}

// ── 自记录：占用时间线 + 运行时事件 ─────────────────────────────────────────
const $live = atom({ samples: [], events: [] })
let STORE = null
function readLedger () {
  const s = getStored(LEDGER_KEY, []), e = getStored(EVENTS_KEY, [])
  $live.set({ samples: Array.isArray(s) ? s : [], events: Array.isArray(e) ? e : [] })
}
function writeLedger (samples, events) {
  $live.set({ samples, events })
  if (!STORE) return
  try { STORE.set(LEDGER_KEY, samples); STORE.set(EVENTS_KEY, events) } catch (e) {}
}
function pushSample (s) {
  const st = $live.get(), cur = st.samples, last = cur[cur.length - 1]
  if (last && last.s === s.s && Math.abs(num(last.p) - num(s.p)) < 0.6 && s.t - last.t < 15000) return
  const samples = cur.concat([s]).slice(-LEDGER_CAP)
  let events = st.events
  if (last && last.s === s.s && num(last.p) - num(s.p) >= 18) {
    events = events.concat([{ t: s.t, kind: 'compact', sid: s.s, text: num(last.p) + '% → ' + num(s.p) + '%' }]).slice(-EVENTS_CAP)
  }
  writeLedger(samples, events)
}
function pushEvent (e) { const st = $live.get(); writeLedger(st.samples, st.events.concat([e]).slice(-EVENTS_CAP)) }

// ── 通用块 ───────────────────────────────────────────────────────────────────
function Card ({ icon, title, meta, children, error, onRetry, loading }) {
  const body = error
    ? jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }, children: [
        jsx('div', { style: { fontSize: '0.6875rem', color: C.t3, overflowWrap: 'anywhere' }, children: t('loadFail') + ' · ' + errMsg(error) }),
        onRetry ? jsx(Button, { size: 'xs', variant: 'outline', onClick: onRetry, children: t('retry') }) : null
      ] })
    : loading
      ? jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [0, 1, 2, 3, 4].map((i) => jsx('div', { className: 'ci-skel', style: { width: (98 - i * 8) + '%' } }, i)) })
      : children
  return jsxs('div', { className: 'ci-card', style: { display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid ' + C.stroke, borderRadius: R.card, padding: 12, minWidth: 0 }, children: [
    jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid ' + C.stroke, paddingBottom: 6, minWidth: 0 }, children: [
      icon ? jsx('span', { style: { fontSize: '0.6875rem', opacity: 0.7 }, children: icon }) : null,
      jsx('span', { style: { fontSize: '0.75rem', fontWeight: 500, color: C.t1 }, children: title }),
      meta ? jsx('span', { style: { marginLeft: 'auto', fontSize: '0.5625rem', color: C.t4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: meta }) : null
    ] }), body
  ] })
}
function KpiBox ({ title, value, sub }) {
  return jsxs('div', { className: 'ci-card', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, border: '1px solid ' + C.stroke, borderRadius: R.card, padding: '10px 8px', minWidth: 0 }, children: [
    jsx('div', { style: { fontSize: '0.625rem', color: C.t3, maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, children: title }),
    jsx('div', { style: { fontSize: '1.0625rem', fontWeight: 600, color: C.t1, maxWidth: '100%', fontVariantNumeric: 'tabular-nums' }, children: value }),
    jsx('div', { style: { fontSize: '0.5625rem', color: C.t4, maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, children: sub || '' })
  ] })
}
function Seg ({ options, value, onChange }) {
  return jsx('div', { style: { display: 'flex', border: '1px solid ' + C.stroke, borderRadius: R.ctrl, overflow: 'hidden' }, children:
    options.map((o) => jsx('button', { type: 'button', className: 'ci-segb',
      style: { padding: '2px 8px', fontSize: '0.6875rem', border: 0, background: o.v === value ? 'color-mix(in oklab,' + DSH.blue + ' 20%,transparent)' : 'transparent', color: o.v === value ? DSH.blue : C.t3, fontWeight: o.v === value ? 600 : 400 },
      onClick: () => { haptic('tap'); onChange(o.v) }, children: o.l }, o.v)) })
}
function Chip ({ on, children, onClick }, key) {
  return jsx('button', { type: 'button', className: 'ci-chip', onClick: onClick, children: children,
    style: { padding: '2px 8px', fontSize: '0.625rem', borderRadius: R.chip, border: '1px solid ' + (on ? DSH.blue : C.stroke), background: on ? 'color-mix(in oklab,' + DSH.blue + ' 18%,transparent)' : 'transparent', color: on ? DSH.blue : C.t3 } }, key)
}
const Btn = (props, key) => jsx(Button, props, key)
const kv = (k, v) => jsxs('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between', minWidth: 0 }, children: [
  jsx('span', { style: { color: C.t4, flexShrink: 0 }, children: k }),
  jsx('span', { style: { color: C.t2, textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: v })
] })
function RingChart ({ items, center, sub, size, thickness }) {
  const s = size || 132, th = thickness || Math.round(s * 0.16)
  const total = Math.max(1, sumBy(items.map((x) => num(x.value))))
  const r = (s - th) / 2, circ = 2 * Math.PI * r
  let acc = 0
  const arcs = items.map((it) => {
    const frac = num(it.value) / total
    const gapPx = items.length > 1 ? th * 0.16 : 0
    const el = jsx('circle', { cx: s / 2, cy: s / 2, r, fill: 'none', stroke: it.color || C.accent, strokeWidth: th,
      strokeDasharray: Math.max(0, frac * circ - gapPx) + ' ' + (circ - frac * circ + gapPx), strokeDashoffset: -acc * circ,
      transform: 'rotate(-90 ' + (s / 2) + ' ' + (s / 2) + ')' }, it.key)
    acc += frac
    return el
  })
  return jsxs('div', { style: { position: 'relative', width: s + 'px', height: s + 'px', flexShrink: 0 }, children: [
    jsxs('svg', { viewBox: '0 0 ' + s + ' ' + s, style: { width: s + 'px', height: s + 'px' }, children: [
      jsx('circle', { cx: s / 2, cy: s / 2, r, fill: 'none', stroke: C.stroke, strokeWidth: th, opacity: 0.25 }, 'bg'), arcs
    ] }),
    jsxs('div', { style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }, children: [
      jsx('div', { style: { fontSize: s > 100 ? '0.8125rem' : '0.625rem', fontWeight: 600, color: C.t1, fontVariantNumeric: 'tabular-nums' }, children: center }),
      jsx('div', { style: { fontSize: '0.5625rem', color: C.t4, maxWidth: (s - th * 2) + 'px', textAlign: 'center' }, children: sub })
    ] })
  ] })
}
function RingLegend ({ items, unit, onPick, active }) {
  return jsx('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(164px, 1fr))', gap: '4px 14px', minWidth: 0, flex: '1 1 200px' }, children:
    items.map((it, i) => jsxs('div', { className: 'ci-row', onClick: onPick ? () => onPick(it.name) : undefined,
      style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', minWidth: 0, padding: '1px 2px', outline: active && active === it.name ? '1px solid ' + DSH.blue : 'none', borderRadius: 4 }, children: [
        jsx('span', { style: { width: 8, height: 8, borderRadius: 2, background: it.color || HUES[i % HUES.length], flexShrink: 0 } }),
        jsx('span', { style: { color: C.t2, maxWidth: 88, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: it.name }),
        jsx('span', { style: { marginLeft: 'auto', color: C.t4, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, children: unit ? unit(it) : fmtTok(it.value) }),
        jsx('span', { style: { width: 42, textAlign: 'right', color: C.t3, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }, children: fmtPct(num(it.share) * 100) })
      ] }, it.key)) })
}
function BarList ({ items, unit, onPick, active, empty, maxH }) {
  if (!items || !items.length) return jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: empty || t('noData') })
  const max = Math.max(1, ...items.map((i) => num(i.count)))
  return jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: (maxH || 224) + 'px', overflowY: 'auto' }, children:
    items.map((it, i) => jsxs('div', { className: 'ci-row', onClick: onPick ? () => onPick(it.name) : undefined,
      style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, padding: '1px 2px', outline: active && active === it.name ? '1px solid ' + DSH.blue : 'none', borderRadius: 4 }, children: [
      jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', minWidth: 0 }, children: [
        jsx('span', { style: { width: 6, height: 6, borderRadius: 999, background: it.color || HUES[i % HUES.length], flexShrink: 0 } }),
        jsx('span', { style: { color: C.t2, fontFamily: MONO, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: it.name }),
        it.last ? jsx('span', { style: { color: C.t4, fontSize: '0.5625rem', flexShrink: 0 }, children: relativeTime(num(it.last) * 1000) }) : null,
        jsx('span', { style: { color: C.t3, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }, children: unit ? unit(it) : '×' + num(it.count) }
        )
      ] }),
      jsx('div', { style: { height: 3, borderRadius: 999, background: C.stroke, opacity: 0.3, overflow: 'hidden' }, children:
        jsx('div', { style: { height: '100%', width: (num(it.count) / max) * 100 + '%', background: it.color || HUES[i % HUES.length] } }) })
    ] }, (it.name || i) + '-' + i)) })
}
function PairedBars ({ data, height }) {
  const maxT = Math.max(1, ...data.map((d) => num(d.tokens)))
  const maxC = Math.max(1, ...data.map((d) => num(d.cost)))
  const w = 100 / Math.max(1, data.length), bw = Math.min(w * 0.26, 3.2)
  const stepT = Math.max(1, Math.ceil(data.length / 8))
  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [
    jsxs('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', style: { width: '100%', height: (height || 150) + 'px' }, children: [
      [25, 50, 75].map((y) => jsx('line', { x1: 0, y1: y, x2: 100, y2: y, stroke: C.stroke, strokeWidth: 0.3, opacity: 0.5, vectorEffect: 'non-scaling-stroke' }, 'g' + y)),
      jsx('line', { x1: 0, y1: 100, x2: 100, y2: 100, stroke: C.stroke, strokeWidth: 0.7, vectorEffect: 'non-scaling-stroke' }, 'gb'),
      data.map((d, i) => {
        const hT = (num(d.tokens) / maxT) * 84, hC = (num(d.cost) / maxC) * 84, x = i * w + w / 2
        return jsxs('g', { children: [
          jsx('title', { children: (d.hour != null ? d.hour + '时' : d.day) + ' · ' + fmtTok(d.tokens) + ' tk · ' + fmtCost(d.cost) + ' · ' + num(d.sessions) + ' ' + t('kSessions') }, 'ti' + i),
          jsx('rect', { className: 'ci-bar', x: x - bw - 0.3, y: 100 - hT, width: bw, height: hT, rx: 0.7, fill: DSH.blue, opacity: num(d.tokens) ? 0.95 : 0.06, style: { animationDelay: (i * 18) + 'ms' } }, 'a' + i),
          jsx('rect', { className: 'ci-bar', x: x + 0.3, y: 100 - hC, width: bw, height: hC, rx: 0.7, fill: DSH.amber, opacity: num(d.cost) ? 0.92 : 0, style: { animationDelay: (i * 18 + 40) + 'ms' } }, 'b' + i)
        ] }, d.day)
      })
    ] }),
    jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, children: [
      jsx('div', { style: { display: 'flex', gap: 8, fontSize: '0.5625rem', color: C.t4, overflow: 'hidden', whiteSpace: 'nowrap' }, children:
        data.filter((d, i) => i % stepT === 0 || i === data.length - 1).map((d) => jsx('span', { children: d.hour != null ? d.hour + '时' : d.day.slice(5).replace('-', '/') }, d.day)) }),
      jsxs('div', { style: { display: 'flex', gap: 8, fontSize: '0.5625rem', flexShrink: 0 }, children: [
        jsx('span', { style: { color: DSH.blue }, children: 'Token' }),
        jsx('span', { style: { color: DSH.amber }, children: ZH ? '成本' : 'cost' })
      ] })
    ] })
  ] })
}
function GitHubHeat ({ series, mode, cell, onPick, picked }) {
  const key = mode === 'sessions' ? 'sessions' : 'tokens'
  const ord = series.slice().sort((a, b) => (a.day < b.day ? -1 : 1))
  const max = Math.max(1, ...series.map((d) => num(d[key])))
  const lvlOf = (v) => (!v ? 0 : Math.min(4, 1 + Math.sqrt(v / max) * 3 | 0))
  const tipOf = (k, v) => k + ' · ' + (mode === 'sessions' ? v + ' ' + t('kSessions') : fmtTok(v) + ' tk')
  const swatch = (k) => {
    const p = String(k).split('-')
    return ZH ? Number(p[1]) + '/' + Number(p[2]) : p[1] + '/' + p[2]
  }
  // 底部一行：左边是区间起止，右边是浓度图例 —— 和趋势图的「刻度 + 图例」同一排版语言
  const footer = jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '0.5625rem', color: C.t4 }, children: [
    jsx('span', { style: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, children: ord.length ? swatch(ord[0].day) + ' → ' + swatch(ord[ord.length - 1].day) : '—' }),
    jsxs('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }, children: [
      jsx('span', { children: ZH ? '少' : 'less' }),
      HEAT_BLUE.map((col, i) => jsx('span', { style: { width: 9, height: 9, borderRadius: 2, background: col, border: '1px solid ' + C.stroke, display: 'inline-block' } }, i)),
      jsx('span', { children: ZH ? '多' : 'more' })
    ] })
  ] })

  // GitHub 式 7 行网格（列=周，行=星期）+ 月份标签；固定全周期，不随时间范围选择器变化
  const map = new Map(series.map((d) => [d.day, d]))
  const size = cell || 11, gap = 3, step = size + gap
  const cols = Math.max(1, Math.ceil(series.length / 7))
  const cells = [], months = []
  let lastMon = -1
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(Date.now() - ((cols - 1 - c) * 7 + (6 - r)) * DAY_MS)
      const k = dayKey(d.getTime() / 1000)
      const b = map.get(k), v = b ? num(b[key]) : 0
      const lvl = lvlOf(v)
      cells.push(jsxs('g', { children: [
        jsx('title', { children: tipOf(k, v) }, 'ti' + k + r),
        jsx('rect', { x: c * step, y: r * step, width: size, height: size, rx: 2, fill: HEAT_BLUE[lvl],
          stroke: picked === k ? DSH.blue : C.stroke, strokeWidth: picked === k ? 1 : 0.3,
          onClick: b && onPick ? () => onPick(k) : undefined, style: { cursor: b && onPick ? 'pointer' : 'default' } }, 'r' + k + r)
      ] }, k + '-' + r))
      if (r === 0 && d.getDate() <= 7 && d.getMonth() !== lastMon) {
        lastMon = d.getMonth()
        months.push(jsx('text', { x: c * step, y: -3, fontSize: 8, fill: C.t4, children: monLabel(d) }, 'm' + k))
      }
    }
  }
  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
    jsx('svg', { viewBox: '-1 -12 ' + (cols * step + 2) + ' ' + (7 * step + 13), preserveAspectRatio: 'xMinYMid meet',
      style: { width: '100%', height: (7 * step + 13) + 'px' }, children: jsxs('g', { children: [months, cells] }) }),
    footer
  ] })
}

function StackBar ({ parts, used, max, height }) {
  const h = height || 24
  const total = Math.max(1, num(max))
  let acc = 0
  const segs = parts.filter((p) => num(p.value) > 0).map((p) => {
    const wd = (num(p.value) / total) * 100
    const el = jsxs('g', { children: [
      jsx('title', { children: p.name + ' ≈' + fmtTok(p.value) + ' · ' + fmtPct((num(p.value) / total) * 100) }, 'ti'),
      jsx('rect', { className: 'ci-stackseg', x: acc, y: 0, width: wd, height: h, fill: p.color }, 'r')
    ] }, p.key)
    acc += wd
    return el
  })
  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
    jsxs('svg', { className: 'ci-stack', viewBox: '0 0 100 ' + h, preserveAspectRatio: 'none', style: { width: '100%', height: h + 'px', display: 'block', borderRadius: 4, overflow: 'hidden', background: C.bg4 }, children: [
      jsx('defs', { children: jsx('pattern', { id: 'ci-hatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)', children:
        jsx('line', { x1: 0, y1: 0, x2: 0, y2: 4, stroke: C.stroke, strokeWidth: 1.6 }) }) }, 'pat'),
      segs,
      jsx('rect', { x: acc, y: 0, width: Math.max(0, 100 - acc), height: h, fill: 'url(#ci-hatch)', opacity: 0.85 }, 'hatch')
    ] }),
    jsx('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: '0.5625rem', color: C.t4 }, children:
      parts.concat([{ key: 'free', name: t('reserved'), value: Math.max(0, num(max) - num(used)), color: C.stroke }])
        .filter((p) => num(p.value) > 0)
        .map((p) => jsxs('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 }, children: [
          jsx('span', { style: { width: 7, height: 7, borderRadius: 2, background: p.color } }),
          jsx('span', { children: p.name }),
          jsx('span', { style: { fontVariantNumeric: 'tabular-nums' }, children: '≈' + fmtTok(p.value) })
        ] }, p.key)) })
  ] })
}
function Trend ({ steps, mode, gran, onHover, onPin, height }) {
  const h = height || 168
  if (!steps || !steps.length) return jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: t('noData') })
  let data = steps
  if (gran === 'turn') {
    const by = new Map()
    for (const s of steps) { const cur = by.get(s.turn); if (!cur || num(s.t) >= num(cur.t)) by.set(s.turn, s) }
    data = Array.from(by.values())
  }
  const keys = ['system', 'tools', 'injected', 'skills', 'user', 'toolcalls', 'reasoning', 'answers']
  const max = Math.max(1, ...data.map((d) => num(d.t)))
  const w = 100 / Math.max(1, data.length), bw = Math.min(w * 0.8, 5.6)
  const deltas = data.map((d, i) => num(d.t) - (i ? num(data[i - 1].t) : 0))
  const maxAbs = Math.max(1, ...deltas.map((x) => Math.abs(x)))
  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [
    jsx('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', style: { width: '100%', height: h + 'px' },
      onMouseLeave: () => onHover && onHover(null),
      children: jsxs('g', { children: [
        jsx('line', { x1: 0, y1: 100, x2: 100, y2: 100, stroke: C.stroke, strokeWidth: 0.6, vectorEffect: 'non-scaling-stroke' }, 'gb'),
        mode === 'delta' ? jsxs('g', { children: [
          jsx('line', { x1: 0, y1: 50, x2: 100, y2: 50, stroke: C.stroke, strokeWidth: 0.4, vectorEffect: 'non-scaling-stroke' }, 'z'),
          data.map((d, i) => {
            const dv = deltas[i], hh = Math.max(0.6, Math.abs(dv) / maxAbs * 46)
            return jsxs('g', { children: [
              jsx('title', { children: d.label + '  ' + (dv >= 0 ? '+' : '−') + fmtTok(Math.abs(dv)) + ' tk' }, 'ti' + i),
              jsx('rect', { x: i * w + (w - bw) / 2, y: dv >= 0 ? 50 - hh : 50, width: bw, height: hh, fill: dv >= 0 ? DSH.blue : DSH.rose, opacity: 0.92,
                onMouseMove: () => onHover && onHover({ x: i / Math.max(1, data.length - 1), step: d, dv }),
                onClick: () => onPin && onPin(d) }, 'd' + i)
            ] }, 'D' + i)
          })
        ] }, 'delta') : data.map((d, i) => {
          let acc = 0
          const segs = keys.map((k) => {
            const v = num(d.parts[k]), hh = (v / max) * 90
            if (!hh) return null
            const el = jsx('rect', { className: 'ci-stackseg', x: i * w + (w - bw) / 2, y: 100 - acc - hh, width: bw, height: hh, fill: BILLMAP[k].color,
              onMouseMove: () => onHover && onHover({ x: i / Math.max(1, data.length - 1), step: d }),
              onClick: () => onPin && onPin(d) }, k)
            acc += hh
            return el
          })
          return jsxs('g', { children: [
            jsx('title', { children: d.label + ' · ' + fmtTok(d.t) + ' tk' }, 'ti' + i),
            segs,
            arr(d.ev).map((e, n) => jsx('circle', { cx: i * w + w / 2, cy: 3 + n * 4, r: 1.2, fill: e === 'compact' ? DSH.rose : e === 'prune' ? DSH.orange : e === 'switch' ? DSH.blue : DSH.teal }, 'e' + i + n))
          ] }, i)
        })
      ] }) }),
    jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.5625rem', color: C.t4 }, children: [
      jsx('span', { children: (mode === 'delta' ? 'Δ ±' + fmtTok(maxAbs) : fmtTok(max)) + ' · ' + data.length + ' ' + t('step') }),
      jsx('span', { children: t('hoverTip') })
    ] })
  ] })
}
function TipCard ({ tip }) {
  if (!tip || !tip.step) return null
  const d = tip.step
  const left = Math.min(72, Math.max(2, num(tip.x) * 100 - 12))
  return jsxs('div', { className: 'ci-tip', style: { position: 'absolute', left: left + '%', top: 40, width: 208, border: '1px solid ' + C.stroke, borderRadius: R.card, padding: 8, background: C.elevated, boxShadow: '0 6px 20px rgba(0,0,0,.18)' }, children: [
    jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.625rem', color: C.t2 }, children: [
      jsx('span', { children: d.label }),
      jsx('span', { style: { fontVariantNumeric: 'tabular-nums' }, children: tip.dv != null ? (tip.dv >= 0 ? '+' : '−') + fmtTok(Math.abs(tip.dv)) : fmtTok(d.t) })
    ] }),
    jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }, children:
      Object.keys(d.parts).filter((k) => num(d.parts[k]) > 0).map((k) => jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.5625rem' }, children: [
        jsx('span', { style: { width: 6, height: 6, borderRadius: 2, background: BILLMAP[k].color } }),
        jsx('span', { style: { color: C.t3, flex: '1 1 auto' }, children: billName(k) }),
        jsx('span', { style: { color: C.t4, fontVariantNumeric: 'tabular-nums' }, children: '≈' + fmtTok(d.parts[k]) })
      ] }, k)) })
  ] })
}
function Spark ({ points, height }) {
  const h = height || 118
  if (!points || points.length < 2) return jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: t('noData') })
  const max = Math.max(1, ...points.map((p) => num(p.p)))
  const step = 100 / (points.length - 1)
  const d = points.map((p, i) => (i ? 'L' : 'M') + (i * step).toFixed(2) + ' ' + (100 - (num(p.p) / max) * 88 - 6).toFixed(2)).join(' ')
  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [
    jsx('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', style: { width: '100%', height: h + 'px' }, children:
      jsx('path', { d, fill: 'none', stroke: DSH.blue, strokeWidth: 1.2, vectorEffect: 'non-scaling-stroke' }) }),
    jsxs('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.5625rem', color: C.t4 }, children: [
      jsx('span', { children: fmtStamp(num(points[0].t)) }), jsx('span', { children: fmtStamp(num(points[points.length - 1].t)) })
    ] })
  ] })
}
function catsOf (bd) {
  const cats = arr(bd && bd.categories)
  const total = Math.max(1, sumBy(cats.map((c) => num(c.tokens))))
  return cats.map((c) => ({ key: c.id, name: c.label || c.id, value: num(c.tokens), share: num(c.tokens) / total, color: CAT_COLOR[c.id] || c.color || C.accent }))
}
const aggregate = (daily, days) => {
  const map = new Map(); const nowSec = Math.floor(Date.now() / 1000)
  for (let i = 0; i < days; i++) { const k = dayKey(nowSec - (days - 1 - i) * (DAY_MS / 1000)); map.set(k, { day: k, tokens: 0, cost: 0, sessions: 0 }) }
  for (const d of daily) {
    const b = map.get(d.day); if (!b) continue
    b.tokens += num(d.input_tokens) + num(d.output_tokens) + num(d.reasoning_tokens) + num(d.cache_read_tokens) + num(d.cache_write_tokens)
    b.cost += num(d.actual_cost) || num(d.estimated_cost); b.sessions += num(d.sessions)
  }
  return Array.from(map.values())
}
const hourlyFromSessions = (rows) => {
  const nowH = new Date().getHours(), today = dayKey(Date.now() / 1000), map = []
  for (let h = 0; h <= nowH; h++) map.push({ day: 'h' + h, hour: h, tokens: 0, cost: 0, sessions: 0 })
  for (const r of rows) {
    if (dayKey(r.started) !== today) continue
    const b = map[Math.min(new Date(r.started * 1000).getHours(), map.length - 1)]
    if (b) { b.tokens += r.input + r.output; b.cost += r.cost; b.sessions += 1 }
  }
  return map
}
const groupBy = (rows) => {
  const m = new Map()
  for (const r of rows) { const k = r.cwd || r.source || '—'; const a = m.get(k) || []; a.push(r); m.set(k, a) }
  return Array.from(m.keys()).slice(0, 14).map((k) => ({ key: k, rows: m.get(k) }))
}

// ── 总览 Tab ─────────────────────────────────────────────────────────────────
function OverviewTab ({ range, sid, prefs }) {
  const days = RANGE_DAYS[range] || 30
  const [archived, setArchived] = useState(false)
  const [sort, setSort] = useState('updated')
  const [q, setQ] = useState('')
  const [heatMode, setHeatMode] = useState(prefs.heat || 'tokens')
  const [fDay, setFDay] = useState(null)
  const [fTool, setFTool] = useState(null)
  const [fCmd, setFCmd] = useState(null)
  const [grouped, setGrouped] = useState(false)

  const anQ = useQuery({ queryKey: [ID, 'analytics', days], queryFn: () => fetchAnalytics(days), refetchInterval: 120000 })
  const heatQ = useQuery({ queryKey: [ID, 'analytics', HEAT_DAYS], queryFn: () => fetchAnalytics(HEAT_DAYS), staleTime: 300000, refetchInterval: 300000 })
  const seQ = useQuery({ queryKey: [ID, 'sessions', archived], queryFn: () => fetchSessions(archived), refetchInterval: 90000 })
  const bdQ = useQuery({ queryKey: [ID, 'breakdown', sid], enabled: !!sid, refetchInterval: 25000, queryFn: () => host.request('session.context_breakdown', { session_id: sid }) })

  const sess = arr(seQ.data && seQ.data.rows)
  const scanIds = useMemo(() => sess.slice(0, SCAN_SESSIONS).map((r) => r.id).join(','), [sess])
  const scanQ = useQuery({
    queryKey: [ID, 'scan', scanIds], enabled: !!scanIds, staleTime: 300000,
    queryFn: async () => {
      const time = { modelWait: 0, argGen: 0, toolRun: 0, waitUser: 0, other: 0, total: 0 }
      const progs = new Map(), tools = new Map(), cmdIds = {}, toolIds = {}
      let steps = 0
      for (const id of scanIds.split(',').slice(0, SCAN_SESSIONS)) {
        let rec = null
        try { rec = rebuild(await fetchMessages(id), null) } catch (e) { continue }
        steps += rec.steps.length
        time.modelWait += rec.timing.modelWait; time.argGen += rec.timing.argGen
        time.toolRun += rec.timing.toolRun; time.waitUser += rec.timing.waitUser
        time.other += rec.timing.other; time.total += rec.timing.total
        for (const p of rec.prog) { progs.set(p.name, (progs.get(p.name) || 0) + p.count); cmdIds[p.name] = (cmdIds[p.name] || []).concat([id]) }
        for (const x of rec.tools) { tools.set(x.name, (tools.get(x.name) || 0) + x.count); toolIds[x.name] = (toolIds[x.name] || []).concat([id]) }
      }
      const mk = (m) => Array.from(m.keys()).map((name) => ({ name, count: m.get(name) })).sort((a, b) => b.count - a.count).slice(0, 18)
      return { time, cmdList: mk(progs), toolListScan: mk(tools), steps, cmdIds, toolIds }
    }
  })
  const an = Object.assign({ daily: [], totals: {}, tools: [], skills: { top_skills: [], summary: {} } }, anQ.data || {})
  an.daily = arr(an.daily); an.tools = arr(an.tools)
  an.totals = an.totals || {}; an.skills = an.skills || {}
  an.skills.top_skills = arr(an.skills.top_skills); an.skills.summary = an.skills.summary || {}
  const scan = Object.assign({ time: null, cmdList: [], toolListScan: [], steps: 0, cmdIds: {}, toolIds: {} }, scanQ.data || {})
  scan.cmdList = arr(scan.cmdList); scan.toolListScan = arr(scan.toolListScan)
  scan.cmdIds = scan.cmdIds || {}; scan.toolIds = scan.toolIds || {}; scan.time = scan.time || null
  const totals = an.totals || {}
  const archivedN = (seQ.data && seQ.data.archived) || 0

  const tokens = num(totals.total_input) + num(totals.total_output) + num(totals.total_cache_read) + num(totals.total_cache_write) + num(totals.total_reasoning)
  const cacheDen = num(totals.total_input) + num(totals.total_cache_read)
  const cacheHit = cacheDen ? (num(totals.total_cache_read) / cacheDen) * 100 : 0
  const cutoff = Date.now() / 1000 - days * 86400
  const win = range === 'all' ? sess : sess.filter((r) => r.started >= cutoff || r.last >= cutoff)
  const subN = sess.filter((r) => r.internal || r.source === 'subagent').length
  const rangeLabel = range === 'today' ? t('rToday') : range === 'all' ? t('rAll') : days + (ZH ? ' 天' : 'd')

  const toolsList = (arr(an.tools).length ? an.tools : scan.toolListScan.map((x) => ({ tool: x.name, count: x.count })))
    .map((x) => ({ name: String(x.tool || x.name || '?'), count: num(x.count), pct: num(x.percentage) }))
    .filter((x) => x.name && x.name !== '?').sort((a, b) => b.count - a.count).slice(0, 18)
  const skillsList = ((an.skills && an.skills.top_skills) || []).map((x) => ({ name: String(x.skill || '?'), count: num(x.total_count) || (num(x.view_count) + num(x.manage_count)), last: num(x.last_used_at) }))
    .filter((x) => x.name && x.name !== '?').sort((a, b) => b.count - a.count).slice(0, 18)
  const skillSum = (an.skills && an.skills.summary) || {}
  const trendData = range === 'today' ? hourlyFromSessions(sess) : aggregate(an.daily, range === 'all' ? 182 : days)
  const heatSeries = aggregate((heatQ.data && heatQ.data.daily) || [], HEAT_DAYS)

  let rows = sess
  if (fDay) rows = rows.filter((r) => dayKey(r.started) === fDay || dayKey(r.last) === fDay)
  if (fTool) { const hit = scan.toolIds[fTool] || []; rows = rows.filter((r) => hit.indexOf(r.id) >= 0) }
  if (fCmd) { const hit = scan.cmdIds[fCmd] || []; rows = rows.filter((r) => hit.indexOf(r.id) >= 0) }
  const kw = q.trim().toLowerCase()
  if (kw) rows = rows.filter((r) => String(r.title || '').toLowerCase().includes(kw) || String(r.model || '').toLowerCase().includes(kw) || String(r.cwd || '').toLowerCase().includes(kw))
  rows = rows.slice().sort((a, b) => sort === 'tokens' ? (b.input + b.output) - (a.input + a.output) : sort === 'ctx' ? b.msgs - a.msgs : b.last - a.last)
  const chips = [['tool', fTool, () => setFTool(null)], ['cmd', fCmd, () => setFCmd(null)], ['day', fDay, () => setFDay(null)]].filter((x) => x[1])

  const gridPair = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }
  const grid4 = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }
  const gridTile = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }
  const ctxPct = (r) => (!!sid && r.id === sid && bdQ.data) ? num(bdQ.data.context_percent) : null

  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }, children: [
    (anQ.error || seQ.error) ? jsxs('div', { style: { display: 'flex', gap: 8, alignItems: 'center', border: '1px solid ' + C.stroke, borderLeft: '2px solid ' + DSH.rose, borderRadius: R.card, padding: '6px 10px' }, children: [
      jsx('span', { style: { fontSize: '0.6875rem', color: C.t3, overflowWrap: 'anywhere' }, children: t('loadFail') + ' · ' + errMsg(anQ.error || seQ.error) }),
      jsx(Button, { size: 'xs', variant: 'outline', onClick: () => { anQ.refetch(); seQ.refetch() }, children: t('retry') })
    ] }) : null,

    jsx('div', { style: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))' }, children: [
      KpiBox({ title: t('kSessions'), value: String(win.length), sub: t('archived') + ' ' + archivedN + (subN ? ' · ' + t('subagents') + ' ' + subN : '') }),
      KpiBox({ title: t('kTokens'), value: fmtTok(tokens), sub: rangeLabel }),
      KpiBox({ title: t('kCost'), value: fmtCost(num(totals.total_actual_cost) || num(totals.total_estimated_cost)), sub: rangeLabel }),
      KpiBox({ title: t('kCache'), value: cacheDen ? fmtPct(cacheHit) : '—', sub: '≈' + fmtTok(totals.total_cache_read) }),
      KpiBox({ title: t('kTurns'), value: String(sumBy(win.map((r) => r.turns))), sub: t('kSteps') + ' ' + (scan.steps || '≈') }),
      KpiBox({ title: t('kTools'), value: String(sumBy(win.map((r) => r.toolCalls))), sub: scan.time ? t('toolRun') + ' ' + fmtDur(scan.time.toolRun) : '' }),
      KpiBox({ title: t('kActive'), value: fmtDur(sumBy(win.map((r) => r.durSec))), sub: t('realTools') + ' ' + fmtTok(totals.total_api_calls) })
    ] }),

    jsxs('div', { style: gridPair, children: [
      Card({ icon: '📊', title: (range === 'today' ? t('trendToday') : t('trend')) + ' · ' + rangeLabel, meta: fmtTok(sumBy(trendData.map((d) => d.tokens))) + ' tk', error: anQ.error, onRetry: () => anQ.refetch(), loading: anQ.isLoading && !anQ.data, children: PairedBars({ data: trendData, height: 152 }) }),
      Card({ icon: '🕒', title: t('heat'), meta: t('heatMeta'), error: heatQ.error, onRetry: () => heatQ.refetch(), loading: heatQ.isLoading && !heatQ.data, children: jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [
        Seg({ value: heatMode, onChange: (v) => { setHeatMode(v); savePref({ heat: v }) }, options: [{ v: 'sessions', l: t('kSessions') }, { v: 'tokens', l: t('kTokens') }] }),
        GitHubHeat({ series: heatSeries, mode: heatMode, cell: 11, onPick: (k) => setFDay(fDay === k ? null : k), picked: fDay }),
        jsxs('div', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.5625rem', color: C.t4 }, children: [
          jsx('span', { children: fDay || t('heatPick') }),
          fDay ? Btn({ size: 'xs', variant: 'ghost', onClick: () => setFDay(null), children: t('clear') }) : null
        ] })
      ] }) })
    ] }),

    jsxs('div', { style: grid4, children: [
      Card({ icon: '🔌', title: t('skills'), meta: (num(skillSum.distinct_skills_used) || skillsList.length) ? ((num(skillSum.distinct_skills_used) || skillsList.length) + ' · ' + fmtTok(skillSum.total_skill_loads)) : '', loading: anQ.isLoading && !anQ.data, error: anQ.error, children:
        BarList({ items: skillsList, unit: (x) => '×' + x.count }) }),
      Card({ icon: '</>', title: t('tools'), meta: toolsList.length ? String(toolsList.length) + ' · ' + sumBy(toolsList.map((x) => x.count)) : '', loading: anQ.isLoading && !anQ.data, error: anQ.error, children:
        BarList({ items: toolsList, onPick: (n) => setFTool(fTool === n ? null : n), active: fTool, unit: (x) => (x.pct ? x.pct.toFixed(1) + '%' : '×' + x.count) }) }),
      Card({ icon: '>_', title: t('cmds'), meta: scan.cmdList.length ? String(scan.cmdList.length) + ' ' + t('programs') : '', loading: scanQ.isLoading && !scanQ.data, error: scanQ.error, onRetry: () => scanQ.refetch(), children:
        BarList({ items: scan.cmdList, onPick: (n) => setFCmd(fCmd === n ? null : n), active: fCmd }) }),
      Card({ icon: '🧩', title: t('comp'), meta: sid ? shortId(sid) : t('noFocus'), children: bdQ.data && arr(bdQ.data.categories).length
        ? jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, children: [
            RingChart({ items: catsOf(bdQ.data), center: fmtTok(bdQ.data.context_used), sub: t('curCtx'), size: 112 }),
            RingLegend({ items: catsOf(bdQ.data), unit: (x) => '≈' + fmtTok(x.value) })
          ] })
        : jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: t('noFocus') }) })
    ] }),

    jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [
      jsxs('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, children: [
        jsx('span', { style: { fontSize: '0.75rem', fontWeight: 500, color: C.t1 }, children: t('sessCard') }),
        jsx(Badge, { size: 'xs', variant: 'outline', children: String(rows.length) }),
        jsx('input', { style: { height: 26, width: 172, fontSize: '0.6875rem', padding: '0 8px', border: '1px solid ' + C.stroke, borderRadius: R.ctrl, background: 'transparent', color: C.t1, outline: 'none' }, placeholder: t('search'), value: q, onChange: (e) => setQ(e.target.value) }),
        Chip({ on: archived, onClick: () => setArchived((v) => !v), children: archived ? t('allSessions') : t('liveSessions') }),
        Chip({ on: grouped, onClick: () => setGrouped((v) => !v), children: t('group') }),
        chips.length ? jsxs('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }, children: [
          jsx('span', { style: { fontSize: '0.5625rem', color: C.t4 }, children: t('filters') + ':' }),
          chips.map((x) => Chip({ on: true, onClick: x[2], children: x[0] + ': ' + x[1] + ' ✕' }, x[0]))
        ] }) : null,
        jsx('div', { style: { marginLeft: 'auto' }, children: Seg({ value: sort, onChange: setSort, options: [{ v: 'updated', l: t('sortUpd') }, { v: 'tokens', l: t('sortTok') }, { v: 'ctx', l: t('sortCtx') }] }) })
      ] }),
      !rows.length ? jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: t('noData') })
        : grouped
          ? jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 }, children: groupBy(rows).map((g) => jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
              jsxs('div', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.5625rem', color: C.t4 }, children: [
                jsx('span', { style: { fontFamily: MONO, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: g.key }),
                jsx('span', { children: '· ' + g.rows.length })
              ] }),
              jsx('div', { style: gridTile, children: g.rows.slice(0, 12).map((r) => SessionTile({ row: r, ctxPct: ctxPct(r), current: !!sid && r.id === sid }, r.id)) })
            ] }, g.key)) })
          : jsx('div', { style: gridTile, children: rows.slice(0, 30).map((r) => SessionTile({ row: r, ctxPct: ctxPct(r), current: !!sid && r.id === sid }, r.id)) })
    ] }),
    jsx('div', { style: { fontSize: '0.5625rem', color: C.t4, lineHeight: 1.5 }, children: t('clickHint') + ' · ' + t('note') })
  ] })
}

// ── 会话卡片 ─────────────────────────────────────────────────────────────────
function SessionTile ({ row, ctxPct, current }, key) {
  const mx = Math.max(1, row.input + row.output)
  const items = [{ key: 'in', name: 'in', value: row.input, color: DSH.teal }, { key: 'out', name: 'out', value: row.output, color: DSH.purple }]
    .filter((x) => x.value > 0).map((x) => ({ key: x.key, name: x.name, value: x.value, share: x.value / mx, color: x.color }))
  return jsxs('button', { type: 'button', className: cn('ci-tile', current && 'ci-cur'),
    style: { display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', border: '1px solid ' + (current ? DSH.blue : C.stroke), borderRadius: R.card, padding: 12, background: 'transparent', minWidth: 0 },
    onClick: () => openTile(row.id), children: [
    jsxs('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 6, minWidth: 0 }, children: [
      jsx('span', { className: row.active ? 'ci-live' : undefined, style: { width: 6, height: 6, borderRadius: 999, marginTop: 4, flexShrink: 0, background: row.active ? C.green : C.stroke } }),
      jsx('span', { className: 'ci-title', style: { fontSize: '0.75rem', fontWeight: 500, color: C.t1, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: row.title }),
      current ? jsx(Badge, { size: 'xs', variant: 'outline', children: t('current') }) : null,
      row.continuation ? jsx(Badge, { size: 'xs', variant: 'outline', children: t('evCompact') }) : null
    ] }),
    (row.source || row.model) ? jsx('span', { style: { alignSelf: 'flex-start', maxWidth: '100%', fontSize: '0.5625rem', padding: '2px 6px', borderRadius: R.chip, background: C.bg3, color: C.t3, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: (row.source || 'local') + (row.model ? ' · ' + row.model : '') }) : null,
    jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }, children: [
      items.length ? RingChart({ items, center: fmtTok(mx), sub: ctxPct != null ? fmtPct(ctxPct, 1) : row.toolCalls + ' calls', size: 62, thickness: 9 }) : null,
      jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.6875rem', flex: '1 1 auto', minWidth: 0 }, children: [
        kv(t('turns'), row.turns + ' ' + t('turn') + ' · ' + row.toolCalls + ' ' + t('step')),
        kv(t('kTokens'), fmtTok(mx)),
        kv(t('kCost'), fmtCost(row.cost))
      ] })
    ] }),
    jsxs('div', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.5625rem', color: C.t4, minWidth: 0 }, children: [
      jsx('span', { style: { fontFamily: MONO, minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: row.cwd || '—' }),
      jsx('span', { style: { flexShrink: 0 }, children: row.last ? relativeTime(row.last * 1000) : '' })
    ] })
  ] }, key)
}
function openTile (id) {
  haptic('tap')
  try {
    const r = host.openSession(id)
    if (r && typeof r.catch === 'function') r.catch((e) => host.notify({ kind: 'error', message: errMsg(e) }))
  } catch (e) { host.notify({ kind: 'error', message: errMsg(e) }) }
}

// ── 上下文 Tab ───────────────────────────────────────────────────────────────
function ContextTab ({ sid }) {
  const p0 = prefsNow()
  const [gran, setGran] = useState(p0.gran || 'step')
  const [mode, setMode] = useState(p0.mode || 'total')
  const [tip, setTip] = useState(null)
  const [pin, setPin] = useState(null)
  const [evF, setEvF] = useState('all')
  const [fileF, setFileF] = useState('all')
  const [openMsg, setOpenMsg] = useState(6)
  const usageLive = useValue(host.state.focusedUsage) || null

  const bdQ = useQuery({ queryKey: [ID, 'breakdown', sid], enabled: !!sid, refetchInterval: 25000, queryFn: () => host.request('session.context_breakdown', { session_id: sid }) })
  const msgQ = useQuery({ queryKey: [ID, 'messages', sid], enabled: !!sid, queryFn: () => fetchMessages(sid) })
  const useQ = useQuery({ queryKey: [ID, 'usage', sid], enabled: !!sid, queryFn: () => host.request('session.usage', { session_id: sid }).catch(() => null) })

  const msgs = arr(msgQ.data)
  const bd = bdQ.data
  const rec = useMemo(() => rebuild(msgs, bd), [msgs, bd])
  const u = useQ.data || usageLive || {}
  const lastStep = rec.steps.length ? rec.steps[rec.steps.length - 1].t : 0
  const ctxUsed = num(bd && bd.context_used) || num(u.context_used) || lastStep
  const ctxMax = num(bd && bd.context_max) || num(u.context_max) || 1
  const tpsVal = num(u.avg_tps)

  const billItems = BILL.map((b) => ({ key: b[0], name: billName(b[0]), value: num(rec.bill[b[0]]), color: b[3] })).filter((x) => x.value > 0)
  const billTotal = Math.max(1, sumBy(billItems.map((x) => x.value)))
  billItems.forEach((x) => { x.share = x.value / billTotal })
  const tm = rec.timing
  const timeItems = [
    { key: 'modelWait', name: t('modelWait'), value: tm.modelWait, color: DSH.blue },
    { key: 'argGen', name: t('argGen'), value: tm.argGen, color: DSH.amber },
    { key: 'toolRun', name: t('toolRun'), value: tm.toolRun, color: DSH.teal },
    { key: 'waitUser', name: t('waitUser'), value: tm.waitUser, color: DSH.orange },
    { key: 'other', name: t('overhead'), value: tm.other, color: DSH.gray }
  ].filter((x) => x.value > 0)
  const timeTotal = Math.max(1, sumBy(timeItems.map((x) => x.value)))
  timeItems.forEach((x) => { x.share = x.value / timeTotal })
  const curParts = CUR6.map((k) => ({ key: k, name: billName(k), color: BILLMAP[k].color, value: num(rec.bill[k]) }))
  const evCount = (k) => k === 'all' ? rec.events.length : rec.events.filter((e) => e.kind === k).length
  const fileCount = (k) => k === 'all' ? rec.fileOps.length : rec.fileOps.filter((f) => f.kind === k).length
  const files = rec.fileOps.slice().sort((a, b) => b.count - a.count || b.ts - a.ts)
  const grid2 = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' }

  return jsx(ScrollArea, { className: 'h-full w-full', children: jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, position: 'relative' }, children: [
    TipCard({ tip }),
    !sid ? jsx('div', { style: { fontSize: '0.75rem', color: C.t4 }, children: t('noFocus') }) : jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 }, children: [
      Card({ icon: '📊', title: t('stats'), meta: t('window') + ' ' + fmtTok(ctxMax), error: msgQ.error, onRetry: () => msgQ.refetch(), loading: msgQ.isLoading && !msgQ.data, children:
        jsxs('div', { style: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }, children: [
          kv(t('turns'), String(rec.steps.length ? rec.steps[rec.steps.length - 1].turn : 0)),
          kv(t('steps'), String(rec.steps.length)),
          kv(t('userIn'), String(arr(msgs).filter((m) => m && m.role === 'user').length)),
          kv(t('realTools'), String(arr(msgs).filter((m) => m && m.role === 'tool').length)),
          kv(t('estCost'), fmtCost(u.cost_usd)),
          kv(t('cacheHit'), u.cache_hit_pct != null ? fmtPct(u.cache_hit_pct) : '—'),
          kv(t('archived'), String(rec.archivedRows)),
          kv(t('tps'), tpsVal ? tpsVal.toFixed(0) : '—')
        ] }) }),

      jsxs('div', { style: grid2, children: [
        Card({ icon: '🧮', title: t('tokStats'), meta: fmtTok(billTotal) + ' · ' + t('est'), children: billItems.length
          ? jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }, children: [
              RingChart({ items: billItems, center: fmtTok(billTotal), sub: t('total'), size: 132 }),
              RingLegend({ items: billItems, unit: (x) => '≈' + fmtTok(x.value) })
            ] })
          : jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: t('noData') }) }),
        Card({ icon: '⏱', title: t('timeStats'), meta: fmtDur(timeTotal) + ' ' + t('active'), children: timeItems.length
          ? jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }, children: [
              RingChart({ items: timeItems, center: fmtDur(timeTotal), sub: t('active'), size: 132 }),
              RingLegend({ items: timeItems, unit: (x) => fmtDur(x.value) })
            ] })
          : jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: t('noData') }) })
      ] }),

      Card({ icon: '🧱', title: t('curCtx'), meta: fmtTok(ctxUsed) + ' / ' + fmtTok(ctxMax) + ' · ' + fmtPct(num(bd && bd.context_percent) || (ctxUsed / ctxMax * 100), 1), children:
        StackBar({ parts: curParts, used: ctxUsed, max: ctxMax }) }),

      Card({ icon: '📈', title: t('ctrend'), meta: rec.steps.length + ' ' + t('step') + (rec.steps.length > OVERVIEW_AT ? ' · ' + t('overview') || 'overview' : ''), children:
        jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [
          jsxs('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }, children: [
            Seg({ value: gran, onChange: (v) => { setGran(v); savePref({ gran: v }) }, options: [{ v: 'step', l: t('granStep') }, { v: 'turn', l: t('granTurn') }] }),
            Seg({ value: mode, onChange: (v) => { setMode(v); savePref({ mode: v }) }, options: [{ v: 'total', l: t('modeTotal') }, { v: 'delta', l: t('modeDelta') }] })
          ] }),
          Trend({ steps: rec.steps, mode, gran, height: 168, onHover: setTip, onPin: (d) => setPin(d) }),
          pin ? jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid ' + DSH.blue, borderRadius: R.card, padding: 8 }, children: [
            jsxs('div', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.6875rem', flexWrap: 'wrap' }, children: [
              jsx(Badge, { size: 'xs', variant: 'outline', children: t('pinned') }),
              jsx('span', { style: { color: C.t2 }, children: pin.label }),
              jsx('span', { style: { marginLeft: 'auto', color: C.t4, fontVariantNumeric: 'tabular-nums' }, children: t('actual') + ' ' + fmtTok(u.input) + ' in · ' + fmtTok(u.output) + ' out' }),
              Btn({ size: 'xs', variant: 'ghost', onClick: () => setPin(null), children: t('unpin') })
            ] }),
            (() => {
              const i = rec.steps.findIndex((s) => s.i === pin.i)
              if (i < 1) return null
              const p = rec.steps[i - 1]
              const d = num(pin.t) - num(p.t)
              return jsxs('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '0.5625rem' }, children: [
                jsx('span', { style: { color: C.t4 }, children: t('vsPrev') }),
                jsx('span', { style: { color: d >= 0 ? DSH.teal : DSH.rose, fontVariantNumeric: 'tabular-nums' }, children: (d >= 0 ? '+' : '−') + fmtTok(Math.abs(d)) + ' tk' }),
                Object.keys(pin.parts).filter((k) => num(pin.parts[k]) !== num(p.parts[k])).map((k) => {
                  const dd = num(pin.parts[k]) - num(p.parts[k])
                  return jsx('span', { style: { color: C.t3 }, children: billName(k) + ' ' + (dd >= 0 ? '+' : '−') + fmtTok(Math.abs(dd)) }, k)
                })
              ] })
            })()
          ] }) : null
        ] }) }),

      jsxs('div', { style: grid2, children: [
        Card({ icon: '⚡', title: t('events'), meta: String(rec.events.length), children:
          jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [
            jsxs('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: [['all', t('evAll')], ['inject', t('evInject')], ['compact', t('evCompact')], ['prune', t('evPrune')], ['switch', t('evSwitch')], ['mode', t('evMode')]].map((x) =>
              Chip({ on: evF === x[0], onClick: () => setEvF(x[0]), children: x[1] + ' ' + evCount(x[0]) }, x[0])) }),
            rec.events.length ? jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 190, overflowY: 'auto' }, children:
              rec.events.filter((e) => evF === 'all' || e.kind === evF).slice(0, 80).map((e, i) => jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.625rem', minWidth: 0 }, children: [
                jsx('span', { style: { color: C.t4, width: 74, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }, children: fmtStamp(num(e.t)) }),
                jsx('span', { style: { color: e.kind === 'compact' ? DSH.rose : e.kind === 'prune' ? DSH.orange : e.kind === 'switch' ? DSH.blue : DSH.teal, width: 34, flexShrink: 0 }, children: t('ev' + e.kind.charAt(0).toUpperCase() + e.kind.slice(1)) }),
                jsx('span', { style: { color: C.t2, minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: e.text || '' })
              ] }, i + '-' + e.t)) })
              : jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: t('noData') })
          ] }) }),
        Card({ icon: '📁', title: t('files'), meta: rec.fileOps.length + ' ' + t('ops') + ' · ' + files.length + ' ' + t('filesN'), children:
          jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [
            jsxs('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: [['all', t('fAll')], ['r', t('fRead')], ['w', t('fWrite')], ['s', t('fSearch')]].map((x) =>
              Chip({ on: fileF === x[0], onClick: () => setFileF(x[0]), children: x[1] + ' ' + fileCount(x[0]) }, x[0])) }),
            jsxs('div', { style: { display: 'flex', gap: 8, fontSize: '0.5625rem', color: C.t4 }, children: [
              jsx('span', { children: t('lines') + ':' }),
              jsx('span', { style: { color: C.green }, children: '+' + sumBy(rec.fileOps.map((f) => f.add)) }),
              jsx('span', { style: { color: DSH.rose }, children: '−' + sumBy(rec.fileOps.map((f) => f.del)) })
            ] }),
            BarList({ items: files.filter((f) => fileF === 'all' || f.kind === fileF).slice(0, 40).map((f) => ({
              name: leaf(f.path), count: f.count, color: f.kind === 'w' ? DSH.amber : f.kind === 's' ? DSH.violet : DSH.blue, add: f.add, del: f.del
            })), unit: (x) => (x.add || x.del ? '+' + x.add + '/−' + x.del : '×' + x.count) })
          ] }) })
      ] }),

      Card({ icon: '>_', title: t('cmdRun'), meta: rec.cmds.length + ' · ' + t('toolRun') + ' ' + fmtDur(sumBy(rec.cmds.map((c) => c.dur))), children:
        jsxs('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }, children: [
          rec.prog.length ? RingLegend({ items: rec.prog.map((p, i) => ({ key: p.name, name: p.name, value: p.count, share: p.count / Math.max(1, sumBy(rec.prog.map((z) => z.count))), color: HUES[i % HUES.length] })), unit: (x) => '×' + x.count }) : null,
          rec.cmds.length ? jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 176, overflowY: 'auto', flex: '1 1 240px', minWidth: 0 }, children:
            rec.cmds.slice().reverse().slice(0, 60).map((c, i) => jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.625rem', minWidth: 0 }, children: [
              jsx('span', { style: { width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: c.status === 'error' ? DSH.rose : c.status === 'ok' ? C.green : DSH.gray } }),
              jsx('span', { style: { fontFamily: MONO, color: C.t2, width: 68, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: c.prog }),
              jsx('span', { style: { color: C.t4, minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: c.cmd }),
              jsx('span', { style: { color: C.t3, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }, children: c.dur ? fmtDur(c.dur) : t('cmdUnknown') })
            ] }, i + '-' + c.ts)) })
            : jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: t('noData') })
        ] }) }),

      Card({ icon: '🧭', title: t('browser'), meta: Math.min(openMsg, msgs.length) + '/' + msgs.length + ' ' + t('msgsOf'), children:
        jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [
          msgs.slice().reverse().slice(0, openMsg).map((m, i) => jsxs('div', { style: { border: '1px solid ' + C.stroke, borderRadius: R.ctrl, padding: 6, minWidth: 0 }, children: [
            jsxs('div', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.5625rem', color: C.t4 }, children: [
              jsx('span', { style: { color: m.role === 'assistant' ? DSH.pink : m.role === 'tool' ? DSH.teal : DSH.emerald }, children: String(m.role) }),
              m.tool_name ? jsx('span', { style: { fontFamily: MONO }, children: String(m.tool_name) }) : null,
              m.display_kind ? jsx('span', { style: { fontFamily: MONO }, children: String(m.display_kind) }) : null,
              m.active === 0 ? jsx('span', { style: { color: DSH.rose }, children: t('archived') }) : null,
              jsx('span', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }, children: '≈' + fmtTok(estTok(m.content)) + ' tk' })
            ] }),
            jsx('div', { style: { fontSize: '0.625rem', color: C.t3, marginTop: 3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 74, overflow: 'hidden' }, children: String(m.content == null ? '' : m.content).slice(0, 500) }),
            arr(m.tool_calls).length ? jsx('div', { style: { fontSize: '0.5625rem', color: C.t4, marginTop: 3, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: parseCalls(m.tool_calls).map((f) => f.name).join(' · ') }) : null
          ] }, (m.row_id || m.id || i) + '-' + i)),
          jsxs('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [
            openMsg < Math.min(60, msgs.length) ? Btn({ size: 'xs', variant: 'ghost', onClick: () => setOpenMsg((v) => Math.min(60, v + 10)), children: t('showMore') }) : null,
            openMsg > 0 ? Btn({ size: 'xs', variant: 'ghost', onClick: () => setOpenMsg(0), children: t('hide') }) : null,
            jsx('span', { style: { fontSize: '0.5625rem', color: C.t4 }, children: t('note') })
          ] })
        ] }) })
    ] })
  ] }) })
}

// ── 编队 Tab ─────────────────────────────────────────────────────────────────
function FleetTab ({ sid }) {
  const seQ = useQuery({ queryKey: [ID, 'sessions', 'fleet'], queryFn: () => fetchSessions(true), refetchInterval: 90000 })
  const [sel, setSel] = useState(null)
  const sess = arr(seQ.data && seQ.data.rows)
  const cur = sid ? sess.find((r) => r.id === sid) : null
  const parent = cur && cur.parent ? sess.find((r) => r.id === cur.parent) : null
  const kids = cur ? sess.filter((r) => r.parent === cur.id) : []
  const fam = [parent, cur].concat(kids).filter(Boolean)
  const running = fam.filter((r) => r.active).length
  const w = 100, h = 46
  const gridTile = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }
  const cx = (i, n) => (i + 1) * (w / (n + 1))

  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }, children: [
    jsxs('div', { style: { display: 'flex', gap: 14, alignItems: 'center', fontSize: '0.6875rem', color: C.t3, flexWrap: 'wrap' }, children: [
      jsx('span', { style: { fontWeight: 500, color: C.t1 }, children: t('fleetSum') }),
      jsx('span', { children: t('agents') + ' ' + fam.length }),
      jsx('span', { style: { color: running ? C.green : C.t4 }, children: t('running') + ' ' + running }),
      jsx('span', { children: t('children') + ' ' + kids.length }),
      jsx('span', { style: { marginLeft: 'auto', fontFamily: MONO, color: C.t4 }, children: shortId(sid) })
    ] }),
    seQ.error ? Card({ title: t('sessCard'), error: seQ.error, onRetry: () => seQ.refetch(), children: null }) : null,
    fam.length > 1 ? Card({ icon: '🕸', title: t('network'), meta: t('pickHint'), children:
      jsx('svg', { viewBox: '0 0 ' + w + ' ' + h, style: { width: '100%', height: 132 }, children: jsxs('g', { children: [
        parent ? jsx('line', { x1: w / 2, y1: 10, x2: w / 2, y2: 21, stroke: DSH.blue, strokeWidth: 0.5, opacity: 0.7 }, 'lp') : null,
        kids.map((k, i) => jsx('line', { x1: w / 2, y1: 27.5, x2: cx(i, kids.length), y2: 38, stroke: HUES[i % HUES.length], strokeWidth: 0.5, opacity: sel && sel !== k.id ? 0.22 : 0.7, style: { transition: 'opacity .2s' } }, 'lk' + k.id)),
        parent ? jsxs('g', { className: 'ci-node', onClick: () => setSel(parent.id), children: [
          jsx('rect', { x: w / 2 - 13, y: 4, width: 26, height: 6, rx: 2, fill: 'none', stroke: sel === parent.id ? DSH.blue : C.stroke, strokeWidth: 0.6 }, 'rp'),
          jsx('text', { x: w / 2, y: 8.4, fontSize: 3, fill: C.t3, textAnchor: 'middle', children: t('parent') + ' · ' + leaf(parent.title) }, 'tp')
        ] }, 'np') : null,
        cur ? jsxs('g', { className: 'ci-node', onClick: () => setSel(cur.id), children: [
          jsx('rect', { x: w / 2 - 14, y: 21, width: 28, height: 6.5, rx: 2, fill: 'color-mix(in oklab,' + DSH.blue + ' 16%,transparent)', stroke: sel === cur.id ? DSH.blue : C.stroke, strokeWidth: 0.7 }, 'rc'),
          cur.active ? jsx('circle', { className: 'ci-live', cx: w / 2 - 15.5, cy: 24.2, r: 1, fill: C.green }, 'pc') : null,
          jsx('text', { x: w / 2, y: 25.4, fontSize: 3, fill: C.t2, textAnchor: 'middle', children: (cur.title || '').slice(0, 24) }, 'tc')
        ] }, 'nc') : null,
        kids.map((k, i) => jsxs('g', { className: 'ci-node', onClick: () => setSel(k.id), children: [
          jsx('rect', { x: cx(i, kids.length) - 12, y: 38, width: 24, height: 6, rx: 2, fill: 'none', stroke: sel === k.id ? HUES[i % HUES.length] : C.stroke, strokeWidth: 0.6 }, 'rk'),
          k.active ? jsx('circle', { className: 'ci-live', cx: cx(i, kids.length) - 13.5, cy: 41, r: 1, fill: C.green }, 'pk') : null,
          jsx('text', { x: cx(i, kids.length), y: 41.8, fontSize: 2.8, fill: C.t3, textAnchor: 'middle', children: (k.title || '').slice(0, 18) }, 'tk')
        ] }, 'nk' + k.id))
      ] }) }) }) : null,
    fam.length ? jsx('div', { style: gridTile, children: fam.map((r, i) => FleetCard({ row: r, color: HUES[i % HUES.length], selected: sel === r.id }, r.id)) })
      : jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: sid ? t('noFleet') : t('noFocus') })
  ] })
}
function FleetCard ({ row, color, selected }, key) {
  const mx = Math.max(1, row.input + row.output)
  const items = [{ key: 'in', name: 'in', value: row.input, color: DSH.teal }, { key: 'out', name: 'out', value: row.output, color: DSH.purple }]
    .filter((x) => x.value > 0).map((x) => ({ key: x.key, name: x.name, value: x.value, share: x.value / mx, color: x.color }))
  return jsxs('div', { className: cn('ci-tile', 'ci-card', selected && 'ci-cur'), onClick: () => { haptic('tap'); openTile(row.id) },
    style: { display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid ' + (selected ? color : C.stroke), borderRadius: R.card, padding: 12, minWidth: 0, background: 'transparent' }, children: [
    jsxs('div', { style: { display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }, children: [
      jsx('span', { className: row.active ? 'ci-live' : undefined, style: { width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: row.active ? C.green : C.stroke } }),
      jsx('span', { className: 'ci-title', style: { fontSize: '0.75rem', fontWeight: 500, color: C.t1, minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: row.title }),
      row.archived ? jsx(Badge, { size: 'xs', variant: 'outline', children: t('archived') }) : null
    ] }),
    jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }, children: [
      items.length ? RingChart({ items, center: fmtTok(mx), sub: row.toolCalls + ' calls', size: 60, thickness: 9 }) : null,
      jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.6875rem', flex: '1 1 auto', minWidth: 0 }, children: [
        kv(t('turns'), row.turns + ' ' + t('turn') + ' · ' + row.toolCalls + ' ' + t('step')),
        kv(t('kActive'), fmtDur(row.durSec)),
        kv(t('kCost'), fmtCost(row.cost)),
        kv('cwd', leaf(row.cwd) + (row.model ? ' · ' + row.model : ''))
      ] })
    ] })
  ] }, key)
}

// ── 页面壳 ───────────────────────────────────────────────────────────────────
function Page () {
  const p0 = prefsNow()
  const [tab, setTab] = useState('dash')
  const [range, setRange] = useState(p0.range || 'd30')
  const [stamp, setStamp] = useState(0)
  const sid = useValue(host.state.focusedSessionId) || null
  const usage = useValue(host.state.focusedUsage) || null
  const raw = useValue($live)
  const live = { samples: arr(raw && raw.samples), events: arr(raw && raw.events) }
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const grid2 = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' }
  const refresh = () => { haptic('tap'); queryClient.invalidateQueries({ queryKey: [ID] }); window.setTimeout(() => { if (alive.current) setStamp(Date.now()) }, 500) }
  const doExport = async () => {
    try {
      const a = await fetchAnalytics(RANGE_DAYS[range] || 30)
      const s = await fetchSessions(true)
      const ok = await OS.writeClipboard(JSON.stringify({ generated_at: new Date().toISOString(), analytics: a, sessions: s.rows, timeline: live.samples, events: live.events }))
      host.notify({ kind: ok ? 'info' : 'error', message: ok ? t('copyOk') : t('copyFail') })
    } catch (e) { host.notify({ kind: 'error', message: errMsg(e) }) }
  }

  return jsx(ScrollArea, { className: 'h-full w-full', children: jsxs('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '100%' }, children: [
    jsxs('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '14px 16px 0' }, children: [
      jsx('div', { style: { fontSize: '0.9375rem', fontWeight: 600, color: C.t1 }, children: t('page') }),
      jsx('div', { style: { display: 'flex', gap: 4, border: '1px solid ' + C.stroke, borderRadius: R.ctrl, padding: 2 }, children:
        [['dash', t('tabDash')], ['ctx', t('tabCtx')], ['fleet', t('tabFleet')]].map((x) => jsx('button', {
          type: 'button', className: 'ci-segb', onClick: () => { haptic('tap'); setTab(x[0]) },
          style: { padding: '2px 10px', fontSize: '0.6875rem', border: 0, background: tab === x[0] ? 'color-mix(in oklab,' + DSH.blue + ' 20%,transparent)' : 'transparent', color: tab === x[0] ? DSH.blue : C.t3, fontWeight: tab === x[0] ? 600 : 400 }
        }, x[0])) }),
      num(usage && usage.cost_usd) ? jsx(Badge, { size: 'xs', variant: 'outline', children: fmtCost(usage.cost_usd) }) : null,
      jsx('div', { style: { marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, children: [
        stamp ? jsx('span', { style: { fontSize: '0.5625rem', color: C.t4, fontVariantNumeric: 'tabular-nums' }, children: new Date(stamp).toLocaleTimeString() }) : null,
        Seg({ value: range, onChange: (v) => { setRange(v); savePref({ range: v }) }, options: [{ v: 'today', l: t('rToday') }, { v: 'd7', l: t('r7') }, { v: 'd30', l: t('r30') }, { v: 'all', l: t('rAll') }] }),
        Btn({ size: 'xs', variant: 'ghost', onClick: refresh, children: t('refresh') }),
        Btn({ size: 'xs', variant: 'ghost', onClick: doExport, children: t('exportJson') })
      ] })
    ] }),

    tab === 'dash' ? OverviewTab({ range, sid, prefs: p0 }) : null,
    tab === 'ctx' ? ContextTab({ sid }) : null,
    tab === 'fleet' ? FleetTab({ sid }) : null,

    jsxs('div', { style: { display: 'grid', gap: 12, padding: '12px 16px 16px', ...grid2 }, children: [
      Card({ icon: '📉', title: t('timeline'), meta: String(live.samples.length), children: Spark({ points: live.samples }) }),
      Card({ icon: '⚡', title: t('runtime'), meta: String(live.events.length), children: live.events.length
        ? jsx('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 128, overflowY: 'auto' }, children: live.events.slice().reverse().slice(0, 40).map((e, i) => jsxs('div', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.625rem', minWidth: 0 }, children: [
            jsx('span', { style: { color: C.t4, width: 74, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }, children: fmtStamp(num(e.t)) }),
            jsx('span', { style: { color: DSH.rose, flexShrink: 0 }, children: e.kind }),
            jsx('span', { style: { color: C.t3, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: e.text || shortId(e.sid) })
          ] }, i + '-' + e.t)) })
        : jsx('div', { style: { fontSize: '0.6875rem', color: C.t4 }, children: t('noData') }) })
    ] })
  ] }) })
}

// ── 右侧面板 / 状态栏 ────────────────────────────────────────────────────────
function SidePane () {
  const sid = useValue(host.state.focusedSessionId) || null
  const usage = useValue(host.state.focusedUsage) || null
  const raw = useValue($live)
  const live = { samples: arr(raw && raw.samples), events: arr(raw && raw.events) }
  const bdQ = useQuery({ queryKey: [ID, 'breakdown', sid], enabled: !!sid, refetchInterval: 25000, queryFn: () => host.request('session.context_breakdown', { session_id: sid }) })
  const bd = bdQ.data
  const items = bd ? catsOf(bd) : []
  const pct = bd ? num(bd.context_percent) : num(usage && usage.context_percent)
  const pts = sid ? live.samples.filter((x) => x.s === sid) : live.samples
  return jsxs('div', { style: { height: '100%', width: '100%', overflowY: 'auto', padding: 12, fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: 10 }, children: [
    jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, children: [
      jsx('span', { style: { fontWeight: 500, color: C.t1 }, children: t('pane') }),
      bd ? jsx(Badge, { size: 'xs', variant: 'outline', children: bd.context_estimated ? t('est') : t('actual') }) : null
    ] }),
    sid ? jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
      jsxs('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 }, children: [
        jsx('span', { style: { fontSize: '1.0625rem', fontWeight: 600, color: C.t1, fontVariantNumeric: 'tabular-nums' }, children: fmtPct(pct, 1) }),
        jsx('span', { style: { fontSize: '0.6875rem', color: C.t3, fontVariantNumeric: 'tabular-nums' }, children: bd ? fmtTok(bd.context_used) + ' / ' + fmtTok(bd.context_max) : '—' })
      ] }),
      StackBar({ parts: items, used: bd ? num(bd.context_used) : 0, max: bd ? num(bd.context_max) : 1, height: 18 }),
      Spark({ points: pts, height: 66 })
    ] }) : jsx('div', { style: { color: C.t4 }, children: t('noFocus') }),
    items.length ? RingLegend({ items, unit: (x) => '≈' + fmtTok(x.value) }) : null,
    bd && arr(bd.context_files).length
      ? jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [
          jsx('div', { style: { fontSize: '0.625rem', color: C.t3 }, children: 'files' }),
          bd.context_files.slice(0, 12).map((x) => jsxs('div', { className: 'ci-row', style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.625rem', minWidth: 0 }, children: [
            jsx('span', { style: { color: C.t4, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: x.label || x.path }),
            jsx('span', { style: { color: C.t3, fontVariantNumeric: 'tabular-nums' }, children: fmtTok(x.est_tokens) })
          ] }, String(x.path || x.label)))
        ] })
      : null,
    Btn({ size: 'xs', variant: 'ghost', onClick: () => host.navigate('/context-insight'), children: t('openFull') })
  ] })
}
function StatusChip () {
  const usage = useValue(host.state.focusedUsage) || null
  const [pct, setPct] = useState(null)
  useEffect(() => {
    let dead = false
    const tick = async () => {
      const s = focusedId()
      if (!s) { if (!dead) setPct(null); return }
      try { const d = await host.request('session.context_breakdown', { session_id: s }); if (!dead) setPct(num(d && d.context_percent)) } catch (e) {}
    }
    tick()
    const iv = window.setInterval(tick, 30000)
    return () => { dead = true; window.clearInterval(iv) }
  }, [usage && usage.context_used])
  const v = pct == null ? num(usage && usage.context_percent) : pct
  return jsx('button', { type: 'button', className: 'ci-segb',
    style: { padding: '0 6px', fontSize: '0.6875rem', color: !v ? C.t4 : v > 85 ? C.red : C.t3, fontVariantNumeric: 'tabular-nums', border: 0, background: 'transparent' },
    onClick: () => { haptic('tap'); host.navigate('/context-insight') }, children: 'ctx ' + (v ? fmtPct(v, 1) : '—') })
}

let OS = { writeClipboard: async () => false }
export default {
  id: ID,
  name: 'Context Insight',
  register (ctx) {
    STORE = ctx.storage
    OS = ctx.os
    readLedger()
    mountStyle()
    ctx.onDispose(unmountStyle)

    let pending = null
    const sample = () => {
      const s = focusedId()
      if (!s) return
      host.request('session.context_breakdown', { session_id: s }).then((d) => {
        if (!d || !num(d.context_max)) return
        pushSample({ t: Date.now(), s, u: num(d.context_used), m: num(d.context_max), p: num(d.context_percent), src: d.context_source || '' })
      }).catch(() => {})
    }
    const schedule = () => { if (pending) return; pending = ctx.setTimeout(() => { pending = null; sample() }, 1500) }
    ctx.onEvent('message.complete', schedule)
    ctx.onEvent('session.usage', schedule)
    ctx.onEvent('session.reclaimed', () => { const s = focusedId(); if (s) pushEvent({ t: Date.now(), kind: 'switch', sid: s, text: 'reclaim' }); schedule() })
    ctx.onEvent('sessions.changed', () => queryClient.invalidateQueries({ queryKey: [ID, 'sessions'] }))
    const unsub = host.state.focusedSessionId.subscribe(() => schedule())
    ctx.onDispose(() => { try { if (typeof unsub === 'function') unsub() } catch (e) {} })
    sample()
    ctx.setInterval(sample, 45000)

    const copyComposition = () => {
      const s = focusedId()
      if (!s) { host.notify({ kind: 'info', message: t('noFocus') }); return }
      host.request('session.context_breakdown', { session_id: s }).then((d) => {
        const lines = arr(d.categories).map((c) => (c.label || c.id) + '\t' + c.tokens + ' tk').join('\n')
        OS.writeClipboard(d.model + ' · ' + d.context_used + '/' + d.context_max + ' (' + d.context_percent + '%)\n' + lines)
        host.notify({ kind: 'info', message: t('copyOk') })
      }).catch((e) => host.notify({ kind: 'error', message: errMsg(e) }))
    }

    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, title: t('page'), data: { path: '/context-insight' }, render: () => jsx(Page, {}) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, order: 260, data: { path: '/context-insight', label: t('page'), codicon: 'dashboard' } },
      { id: 'pane', area: PANES_AREA, title: t('pane'), data: { placement: 'right', width: '290px' }, render: () => jsx(SidePane, {}) },
      { id: 'chip', area: STATUSBAR_AREAS.right, order: 135, render: () => jsx(StatusChip, {}) },
      { id: 'cmd-open', area: PALETTE_AREA, title: t('page'), data: { id: ID + '.open', label: t('page') + ' · ' + t('tabDash'), action: ID + '.open', run: () => host.navigate('/context-insight') } },
      { id: 'cmd-ctx', area: PALETTE_AREA, title: t('tabCtx'), data: { id: ID + '.ctx', label: t('page') + ' · ' + t('tabCtx'), run: () => host.navigate('/context-insight') } },
      { id: 'cmd-fleet', area: PALETTE_AREA, title: t('tabFleet'), data: { id: ID + '.fleet', label: t('page') + ' · ' + t('tabFleet'), run: () => host.navigate('/context-insight') } },
      { id: 'cmd-copy', area: PALETTE_AREA, title: t('curCtx'), data: { id: ID + '.copy', label: t('page') + ' · ' + t('curCtx'), run: copyComposition } },
      { id: 'kb-open', area: KEYBINDS_AREA, title: t('page'), data: { id: ID + '.open', label: t('page'), defaults: ['mod+shift+c'], run: () => host.navigate('/context-insight') } }
    ])

    const pr = prefsNow()
    ctx.registerSettingsPage({
      id: 'main', title: 'Context Insight',
      render: () => jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 16, fontSize: '0.75rem', color: C.t2 }, children: [
        jsx('div', { style: { fontSize: '0.6875rem', lineHeight: 1.6 }, children: t('about') }),
        jsx('div', { style: { fontSize: '0.5625rem', color: C.t4, lineHeight: 1.5 }, children: t('note') }),
        jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
          jsx('div', { style: { fontSize: '0.625rem', color: C.t3 }, children: t('prefs') }),
          kv(t('pRange'), t(RANGE_KEY[pr.range]) + ' · ' + t('pGran') + ': ' + pr.gran + ' · ' + t('pMode') + ': ' + pr.mode),
          kv(t('timeline'), String($live.get().samples.length))
        ] }),
        Btn({ size: 'xs', variant: 'outline', onClick: () => {
          try { if (STORE) { STORE.remove(LEDGER_KEY); STORE.remove(EVENTS_KEY); STORE.remove(PREFS_KEY) } } catch (e) {}
          $live.set({ samples: [], events: [] })
          host.notify({ kind: 'info', message: t('cleared') })
        }, children: t('clearAll') })
      ] })
    })
  }
}
