#!/usr/bin/env node
// 磁盘桌面插件的渲染冒烟测试：语法检查抓不到的 ReferenceError / 数据形状错，
// 用 stub 把 SDK + React hooks 换掉后真跑一遍组件与取数函数。
// 用法: node render-check.mjs <plugin.js>
// 关键：useQuery 必须按 queryKey 返回「有数据」的载荷 —— 空数据路径会掩盖
// 只在有数据时才触发的 bug（实例：一次 fuzzy patch 把 `cats.map((c) => (` 外层
// 吞掉，语法合法、空数据不报错、有构成数据即 `c is not defined`）。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const target = process.argv[2]
if (!target) { console.error('usage: render-check.mjs <plugin.js>'); process.exit(2) }
const src = fs.readFileSync(target, 'utf8')

const PRELUDE = /* js */ `
// 全部挂 globalThis：插件若自己声明同名组件，以它自己的为准，永不撞声明
const g = globalThis
g.DAY = 86400000
g.host = { state: { focusedSessionId: { get: () => 'sess-1', subscribe: () => () => {} }, activeSessionId: { get: () => null },
  focusedUsage: { get: () => ({ context_percent: 41, context_used: 90000, context_max: 220000, cost_usd: 0.12, cache_hit_pct: 88 }) } },
  request: async (m) => { const s = String(m || '')
    if (s.includes('breakdown')) return g.BREAKDOWN
    if (s.includes('usage')) return g.USAGE
    if (s.includes('list')) return { sessions: g.SESS }
    return { sessions: [] } },
  notify: () => {}, navigate: () => {}, openSession: () => {}, onEvent: () => () => {},
  paneVisibility: () => ({ get: () => true }), setInterval: () => 0, setTimeout: () => 0, profileRoutes: () => [] }
g.atom = (v) => ({ get: () => v, set: () => {} })
g.useValue = (a) => (a && a.get ? a.get() : a)
g.computed = (f) => ({ get: () => f() })
g.queryClient = { invalidateQueries: () => {} }
;['Badge','Button','ScrollArea','Skeleton','EmptyState','ErrorState','CopyButton','Codicon','Input','SearchField','Separator','Switch','StatusDot','Tip','Tooltip','Contribute','WorkspacePageHeaderControl','GlyphSpinner','Loader','DecodeText','LogView','SandboxedFrame'].forEach((n) => { g[n] = n })
g.cn = (...a) => a.filter(Boolean).join(' ')
g.icons = new Proxy({}, { get: () => () => null })
g.haptic = () => {}
g.relativeTime = () => '刚刚'
g.fmtDateTime = () => 'x'
g.fmtDayTime = () => 'x'
g.coarseElapsed = () => ({ unit: 's', value: 0 })
g.profileColor = () => '#888'
g.profileColorSoft = () => '#aaa'
g.useI18n = () => (k) => k
g.usePluginI18n = () => (k) => k
g.pluginSettingsHref = (id) => '/settings/plugins/' + id
g.evaluateRuntimeReadiness = () => ({ ready: true })
g.useMutation = () => ({ mutate: () => {} })
g.useQuery = (o) => { const k = String((o && o.queryKey || []).join('|'))
  const ok = (d) => ({ data: d, error: null, isLoading: false, refetch: () => {} })
  if (k.includes('scan')) return ok(g.SCAN)
  if (k.includes('messages')) return ok(g.msgs())
  if (k.includes('analytic')) return ok(g.ANALYTICS)
  if (k.includes('usage')) return ok(g.USAGE)
  if (k.includes('breakdown')) return ok(g.BREAKDOWN)
  if (k.includes('session')) return ok({ rows: g.SESS, total: 2, sessions: g.SESS, archived: 1 })
  return ok(null) }
g.useState = (v) => [typeof v === 'string' && g.RANGES && g.RANGES.indexOf(v) >= 0 ? (g.__RANGE__ || v) : v, () => {}]
g.RANGES = ['today', 'd7', 'd30', 'all']
g.useMemo = (f) => f()
g.useRef = (v) => ({ current: v })
g.useEffect = (f) => { try { f() } catch (e) { throw new Error('effect: ' + e.message) } }
g.useCallback = (f) => f
// children 放进 props 才是对的；把 children 数组当第三个参数（key 槽）传 = 页面永远空白
g.jsx = (t, p, k) => { if (Array.isArray(k) && p && !('children' in p)) throw new Error('jsx misuse: children passed as key slot -> ' + String(t)); return { t, p, k } }
g.jsxs = g.jsx
g.PANES_AREA = 'panes'; g.ROUTES_AREA = 'routes'; g.SIDEBAR_NAV_AREA = 'nav'; g.KEYBINDS_AREA = 'keybinds'; g.PALETTE_AREA = 'palette'
g.STATUSBAR_AREAS = { left: 'sb.l', right: 'sb.r' }; g.TITLEBAR_AREAS = { left: 't.l', center: 't.c', right: 't.r' }
g.COMPOSER_AREAS = { modelPill: 'cp.pill' }; g.SESSION_ROW_AREAS = { leading: 'sr.a', trailing: 'sr.b' }
g.KANBAN_CARD_AREAS = { badges: 'kb.b' }; g.THEMES_AREA = 'themes'; g.APPEARANCE_AREAS = { extra: 'ap.e' }
g.SETTINGS_PLUGINS_AREA = 'settings.plugins'; g.WORKSPACE_PAGE_HEADER_AREA = 'wph'; g.SIDEBAR_NAV_PREFS_AREA = 'navp'
g.MODEL_MENU_ROW_AREA = 'mmr'; g.TOOL_MEDIA_RENDERER_AREA = 'tm'
g.ANALYTICS = { daily: [{ day: new Date().toISOString().slice(0, 10), input_tokens: 900000, output_tokens: 30000, cache_read_tokens: 3000000, reasoning_tokens: 20000, estimated_cost: 0.5, actual_cost: 0, sessions: 2, api_call_count: 30 }],
  totals: { total_input: 4e6, total_output: 120000, total_cache_read: 9e6, total_cache_write: null, total_reasoning: 80000, total_estimated_cost: 2.2, total_actual_cost: 0, total_sessions: 140, total_api_calls: 830 },
  tools: [{ tool: 'terminal', count: 95, percentage: 56.5 }, { tool: 'read_file', count: 19, percentage: 11.3 }],
  skills: { summary: { distinct_skills_used: 3, total_skill_loads: 5 }, top_skills: [{ skill: 'browser', total_count: 4, view_count: 3, manage_count: 1, last_used_at: Date.now() / 1000, percentage: 60 }] }, by_model: [] }
g.BREAKDOWN = { categories: [{ id: 'system_prompt', label: 'sys', tokens: 6000 }, { id: 'tool_definitions', label: 'tools', tokens: 17000 }, { id: 'skills', label: 'skills', tokens: 1200 }, { id: 'conversation', label: 'conv', tokens: 184000 }], context_used: 207000, context_max: 220000, context_percent: 94, context_estimated: true, model: 'm', context_files: [{ label: 'AGENTS.md', path: 'AGENTS.md', est_tokens: 900 }] }
g.SESS = [{ id: 'sess-1', title: 'A', started_at: Date.now() / 1000 - 3600, last_active: Date.now() / 1000 - 60, ended_at: Date.now() / 1000, message_count: 44, tool_call_count: 21, api_call_count: 30, input_tokens: 200000, output_tokens: 1500, estimated_cost_usd: 0.2, model: 'm', source: 'desktop', cwd: 'C:/work/alpha', preview: 'p', is_active: true, archived: false },
  { id: 'sess-2', title: 'B', started_at: Date.now() / 1000 - 86400, last_active: Date.now() / 1000 - 80000, ended_at: Date.now() / 1000 - 80000, message_count: 12, tool_call_count: 4, input_tokens: 90000, output_tokens: 900, actual_cost_usd: 0.01, model: 'm2', source: 'cron', cwd: 'C:/work/beta', _branched_from: 'sess-1', continuation_kind: 'compression' }]
// 真实形状的会话行：role / content / reasoning / tool_calls / display_kind / active / token_count
// 覆盖 read→write(patch +N/−N)→terminal(error)→execute_code→model_switch→压缩归档行→search
 g.BASE = 1760000000
g.NL = String.fromCharCode(10)
g.msgs = () => [
  { row_id: 1, role: 'user', content: '帮我改一下这个插件', display_content: '帮我改一下这个插件', timestamp: g.BASE + 0, token_count: 12, active: 1 },
  { row_id: 2, role: 'assistant', content: '好的，先看文件内容', reasoning: '需要先读源码确认字段名', tool_calls: [{ function: { name: 'read_file', arguments: JSON.stringify({ path: 'a.js' }) } }], timestamp: g.BASE + 20, token_count: 300, active: 1 },
  { row_id: 3, role: 'tool', tool_name: 'read_file', content: 'x'.repeat(1400), timestamp: g.BASE + 22, active: 1 },
  { row_id: 4, role: 'assistant', content: '', tool_calls: [{ function: { name: 'patch', arguments: JSON.stringify({ path: 'a.js', old_string: ['x','y'].join(g.NL), new_string: ['a','b','c'].join(g.NL) }) } }], timestamp: g.BASE + 60, active: 1 },
  { row_id: 5, role: 'tool', tool_name: 'patch', content: 'ok', timestamp: g.BASE + 70, active: 1 },
  { row_id: 6, role: 'assistant', content: '跑一下检查', tool_calls: [{ function: { name: 'terminal', arguments: JSON.stringify({ command: 'node --check a.js' }) } }], timestamp: g.BASE + 90, active: 1 },
  { row_id: 7, role: 'tool', tool_name: 'terminal', content: 'error: unexpected token', timestamp: g.BASE + 120, active: 1 },
  { row_id: 8, role: 'user', content: '继续修', timestamp: g.BASE + 300, token_count: 6, active: 1 },
  { row_id: 9, role: 'assistant', content: '模型切换为 m2', display_kind: 'model_switch', timestamp: g.BASE + 310, active: 1 },
  { row_id: 10, role: 'assistant', content: '再用 execute_code 验证数据形状', reasoning: '要断言非空', tool_calls: [{ function: { name: 'execute_code', arguments: JSON.stringify({ code: 'print(1)' }) } }], timestamp: g.BASE + 330, token_count: 400, active: 1 },
  { row_id: 11, role: 'tool', tool_name: 'execute_code', content: '1', timestamp: g.BASE + 340, active: 1 },
  { row_id: 12, role: 'user', content: 'old transcript that got compacted ' + 'y'.repeat(900), timestamp: g.BASE + 350, active: 0, compacted: 1 },
  { row_id: 13, role: 'user', content: '压缩后的延续', display_kind: 'continuation', timestamp: g.BASE + 360, active: 1 },
  { row_id: 14, role: 'assistant', content: '收尾', tool_calls: [{ function: { name: 'search_files', arguments: JSON.stringify({ pattern: 'Button' }) } }], timestamp: g.BASE + 370, active: 1 },
  { row_id: 15, role: 'tool', tool_name: 'search_files', content: '12 matches', timestamp: g.BASE + 372, active: 1 },
  { row_id: 16, role: 'assistant', content: '完成', display_content: '完成', timestamp: g.BASE + 380, active: 1 }
]
g.MSGS = g.msgs()
g.USAGE = { input: 320000, output: 21000, reasoning: 8000, cache_read: 4100000, cache_write: 0, cost_usd: 1.4, cache_hit_pct: 92.4, avg_latency: 4.2, avg_tps: 161, context_used: 207000, context_max: 220000, context_percent: 94, compressions: 2 }
g.SCAN = { time: { modelWait: 320, argGen: 40, toolRun: 420, waitUser: 60, other: 5, total: 845, outTokens: 9000 }, cmdList: [{ name: 'node', count: 41 }], toolListScan: [{ name: 'terminal', count: 95 }], steps: 120, cmdIds: { node: ['sess-1'] }, toolIds: { terminal: ['sess-1'] } }
g.window = { hermesDesktop: { api: async (r) => { const q = String((r && r.path) || '')
  if (q.includes('analytics')) return g.ANALYTICS
  if (q.includes('/messages')) return { messages: g.msgs() }
  if (q.includes('analytics')) return g.ANALYTICS
  return { sessions: g.SESS, total: 2, limit: 100, offset: 0 } }, setInterval: () => 0, clearInterval: () => {} } }
g.window.setInterval = () => 0
  g.window.clearInterval = () => {}
g.setInterval = () => 0
g.clearInterval = () => {}
g.document = { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } }
try { Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true }) } catch (e) { /* Node 26: 只读全局，用内置 en-US 即可 */ }
g.getComputedStyle = () => new Proxy({}, { get: () => '' })
`

// 剥 import：逐行扫描（CRLF 安全，且能处理跨行的具名导入块）
const lines = src.split(/\r?\n/)
const kept = []
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  if (/^\s*import\b/.test(l)) {
    let j = i
    while (j < lines.length && !/from\s+['"][^'"]+['"];?\s*$/.test(lines[j])) j++
    i = j
    continue
  }
  kept.push(l)
}
const BODY = kept.join('\n').replace('export default {', 'const PLUGIN = {')

const TAIL = /* js */ `
const out = []
const run = (label, fn) => { try { const r = fn && fn(); if (r && r.then) return r.then(() => out.push('ok   ' + label), (e) => out.push('FAIL ' + label + ' -> ' + e.constructor.name + ': ' + e.message + ' | ' + ((e.stack || '').split('\\n')[1] || '').trim())); out.push('ok   ' + label) } catch (e) { out.push('FAIL ' + label + ' -> ' + e.constructor.name + ': ' + e.message + ' | ' + ((e.stack || '').split('\\n')[1] || '').trim()) } }
const must = (cond, msg) => { if (!cond) throw new Error('assert: ' + msg) }
const getFn = (n) => { try { return eval('typeof ' + n + " === 'function' ? " + n + ' : null') } catch (e) { return null } }
const RECB = (() => { const rb = getFn('rebuild'); if (!rb) return null; try { return rb(g.msgs(), g.BREAKDOWN) } catch (e) { out.push('FAIL rebuild -> ' + e.message); return null } })()
const argFor = { Bars: { data: [{ day: 'x', tokens: 10, sessions: 1, cost: 0 }, { day: 'y', hour: 9, tokens: 4, sessions: 1, cost: 0 }], height: 168 }, Bars7: {},
  GitHubHeat: { series: [{ day: new Date().toISOString().slice(0, 10), tokens: 10, sessions: 1 }], mode: 'tokens', cell: 11 },
  RingChart: { items: [{ key: 'a', name: 'x', value: 10, share: .5, color: '#fff' }], center: '1', sub: 's' },
  RingLegend: { items: [{ key: 'a', name: 'x', value: 10, share: .5, color: '#fff' }], unit: (v) => String(v) },
  BarList: { items: [{ name: 't', count: 9 }], unit: () => 'x' }, Spark: { points: [{ t: Date.now(), p: 10 }, { t: Date.now(), p: 30 }] },
  SessionTile: { row: { id: 's', title: 't', input: 1, output: 2, toolCalls: 3, turns: 1, cost: 0, started: Date.now() / 1000, last: Date.now() / 1000, preview: 'p', source: 'l', model: 'm', active: true, continuation: null }, ctxPct: 10, current: false },
  Card: { title: 't', children: null }, KpiBox: { title: 'a', value: 'b', sub: 'c' }, Seg: { options: [{ v: 1, l: 'a' }], value: 1, onChange: () => {} },
  Notice: { error: new Error('x'), onRetry: () => {} }, Pane: {}, SidePane: {}, ContextPane: {}, Dashboard: {}, Page: {}, StatusChip: {},
  Chip: { on: true, children: 'x', onClick: () => {} },
  PairedBars: { data: [{ day: new Date().toISOString().slice(0, 10), tokens: 10, sessions: 1, cost: 0.1 }], height: 168 },
  OverviewTab: { range: 'd30', sid: 'sess-1', prefs: { heat: 'tokens', range: 'd30' } },
  ContextTab: { sid: 'sess-1' }, FleetTab: { sid: 'sess-1' },
  TipCard: { tip: { x: 0.5, step: RECB && RECB.steps[1] } },
  FleetCard: { row: { id: 's', title: 't', input: 100, output: 20, toolCalls: 3, turns: 2, cost: 0.1, durSec: 900, active: true, archived: false, cwd: 'C:/w', model: 'm' }, color: '#0ff', selected: true },
  StackBar: { parts: [{ key: 'system', name: 's', value: 1000, color: '#f0f' }], used: 1500, max: 2200 },
  Trend: { steps: (RECB && RECB.steps) || [], mode: 'total', gran: 'step', onHover: () => {}, onPin: () => {} } }
const CANDIDATES = ['Dashboard', 'ContextPage', 'Page', 'SidePane', 'ContextPane', 'Pane', 'StatusChip', 'OverviewTab', 'ContextTab', 'FleetTab', 'Chip', 'Bars', 'PairedBars', 'StackedBars', 'Heatmap', 'GitHubHeat', 'Donut', 'RingChart', 'Sparkline', 'Spark', 'RingLegend', 'BarList', 'SessionCard', 'SessionTile', 'Card', 'Panel', 'KpiBox', 'Kpi', 'Seg', 'Notice', 'Trend', 'StackBar', 'TipCard', 'FleetCard', 'SessionRow']
let n = 0
for (const name of CANDIDATES) { const fn = getFn(name); if (!fn) continue; n++; run('render ' + name, () => fn(argFor[name] || {})) }
if (!n) out.push('FAIL no renderable component found')
for (const mode of ['total', 'delta']) for (const gran of ['step', 'turn']) {
  const fn = getFn('Trend'); if (!fn) continue
  run('render Trend [' + mode + '/' + gran + ']', () => fn({ steps: (RECB && RECB.steps) || [], mode, gran, onHover: () => {}, onPin: () => {} }))
}
for (const R of ['today', 'd7', 'd30', 'all']) {
  g.__RANGE__ = R
  for (const name of ['Dashboard', 'SidePane', 'Bars', 'GitHubHeat', 'OverviewTab', 'Page']) {
    const fn = getFn(name); if (!fn) continue
    run('render ' + name + ' [range=' + R + ']', () => fn(argFor[name] || {}))
  }
}
g.__RANGE__ = null
// —— 数据重建断言：图不崩 ≠ 图里有数，字段猜错会永远画空 ——
if (RECB) {
  run('data: steps', () => { must(RECB.steps.length >= 4, 'steps>=4 got ' + RECB.steps.length) })
  run('data: token ledger 8 类', () => {
    const b = RECB.bill
    for (const k of ['system', 'tools', 'user', 'injected', 'skills', 'toolcalls', 'reasoning', 'answers']) must(k in b, '缺 bill key ' + k)
    must(b.system > 0, 'system=0（context_breakdown 字段没读对）')
    must(b.tools > 0, 'tools=0（context_breakdown 字段没读对）')
    must(b.user > 0, 'user=0（role/content 形状不对）')
    must(b.toolcalls > 0, 'toolcalls=0（tool_calls/arguments 形状不对）')
    must(b.reasoning > 0, 'reasoning=0（reasoning 字段名不对）')
    must(b.answers > 0, 'answers=0')
  })
  run('data: timing 6 段', () => {
    const x = RECB.timing
    for (const k of ['modelWait', 'argGen', 'toolRun', 'waitUser', 'other', 'total']) must(k in x, '缺 timing key ' + k)
    must(x.total > 0, 'timing.total=0（timestamp 差值没算）')
    must(x.toolRun > 0, 'toolRun=0（tool 回执时间戳没配对）')
    must(x.waitUser > 0, 'waitUser=0')
  })
  run('data: events', () => {
    const kinds = RECB.events.map((e) => e.kind)
    must(kinds.indexOf('compact') >= 0, '无 compact 事件（active/compacted 行没识别）got ' + kinds.join(','))
    must(kinds.indexOf('prune') >= 0, '无 prune 事件')
    must(kinds.indexOf('switch') >= 0, '无 switch 事件（display_kind 不对）')
  })
  run('data: commands', () => {
    must(RECB.cmds.length >= 2, 'cmds>=2 got ' + RECB.cmds.length + '（工具名→命令映射不对）')
    must(RECB.cmds.some((c) => c.dur > 0), '无墙钟耗时（tool 回执没配对）')
    must(RECB.cmds.some((c) => c.status === 'error'), '无失败状态（回执内容没判错）')
    must(RECB.prog.length >= 1, '无程序分布')
  })
  run('data: file activity', () => {
    const kinds = RECB.fileOps.map((f) => f.kind)
    must(kinds.indexOf('r') >= 0, '无读取')
    must(kinds.indexOf('w') >= 0, '无写入（patch/write_file 参数名不对）')
    must(kinds.indexOf('s') >= 0, '无搜索')
    must(RECB.fileOps.some((f) => f.add > 0 && f.del > 0), '无 +N/−N 行变化')
  })
  run('data: trend parts 键齐全且单调', () => {
    const s = RECB.steps.find((x) => x.parts.user > 0) || RECB.steps[0]
    for (const k of ['system', 'tools', 'user', 'injected', 'skills', 'toolcalls', 'reasoning', 'answers']) must(k in s.parts, 'trend parts 缺 ' + k)
    for (let i = 1; i < RECB.steps.length; i++) {
      if (RECB.steps[i].drop) continue
      must(RECB.steps[i].t >= RECB.steps[i - 1].t - 1, '第 ' + i + ' 步累计单调性破了')
    }
  })
}
run('plugin.register', () => { const P = (typeof PLUGIN !== 'undefined' ? PLUGIN : (typeof plugin !== 'undefined' ? plugin : null))
  if (!P || typeof P.register !== 'function') throw new Error('no default export with register()')
  const regs = []
  P.register({ id: 'x', source: 'plugin:x', storage: { get: (k, d) => d, set: () => {}, remove: () => {} }, os: { writeClipboard: async () => true, notify: () => {}, openExternal: async () => true, revealPath: async () => true },
    setTimeout: () => 0, setInterval: () => 0, addEventListener: () => () => {}, onEvent: () => {}, onDispose: () => {}, rest: async () => ({}), socket: () => () => {},
    register: (c) => regs.push(c), registerMany: (cs) => regs.push(...cs), registerSettingsPage: (c) => regs.push(c), files: { requestFolder: () => null, readText: async () => '' }, pet: { say: () => () => {}, clear: () => {}, visible: { get: () => false } }, i18n: { register: () => () => {}, t: (k) => k } })
  if (!regs.length) throw new Error('registered 0 contributions') })
console.log(out.join('\\n'))
const bad = out.filter((l) => l.startsWith('FAIL'))
console.log(bad.length ? 'RESULT: ' + bad.length + ' FAILURES' : 'RESULT: ALL_OK (' + out.length + ' checks)')
process.exitCode = bad.length ? 1 : 0
`

const tmp = path.join(os.tmpdir(), 'hermes-render-check-' + Date.now() + '.mjs')
fs.writeFileSync(tmp, PRELUDE + '\n' + BODY + '\n' + TAIL, 'utf8')
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })
} catch (e) {
  console.error('SYNTAX FAIL\n' + (e.stderr || '').toString())
  process.exit(1)
}
try {
  console.log(execFileSync(process.execPath, [tmp], { encoding: 'utf8', timeout: 60000 }))
} catch (e) {
  console.log((e.stdout || '') + (e.stderr || ''))
}
