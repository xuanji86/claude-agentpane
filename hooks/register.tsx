import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, RenderChildren, RenderElement, SessionMessage, TurnUsage } from 'claude-code'

import type { AgentpaneAgent as Agent, AgentpaneLoop as Loop, AgentpaneTokens as Tokens } from '../types'
import { fmtDuration, laneRows } from './time'
import type { Lane } from './time'

const PANE = 'agents'
const TITLE = 'Agents'
// lazy: polls the engine's agent list every second, as no agent-status event reaches a mod; move to one if it lands.
const SYNC_MS = 1_000
const CONFIRM_MS = 5_000 // a pressed Stop waits this long for the press that confirms it
const SPAWN_GRACE_MS = 10_000 // a spawn the engine's list does not show yet stays this long
const LOOP_SHOWN_MS = 60_000 // a model loop no agent claims shows while it made a request this recently
const LOOP_KEPT_MS = 300_000 // and is forgotten after this long
const INLINE_ROWS = 8 // the pane above the prompt, where it cannot dock: a summary
const INLINE_READ_ROWS = 24 // and while it shows one conversation
const PROMPT_LINES = 4 // a prompt is the agent's brief: its head is enough
const PREVIEW_LINES = 3 // of a tool's result
const MAX_BLOCKS = 40 // of a conversation, drawn at most
// The engine refuses a tree with a text over 10,000 characters, or over 100,000 in all: stay well under.
const MAX_ARG = 300 // characters of a tool call's argument kept
const MAX_LINE = 500 // characters of one result line kept
const MAX_REPLY = 6_000 // characters of one reply drawn as Markdown
const TEXT_BUDGET = 60_000 // characters of a conversation drawn at once
const GROUP_BUDGET = 30_000 // characters of one opened run of tool calls: its newest calls
const GROUP_CALLS = 40 // and at most this many of them
const PREVIEW_SCAN = 8_192 // characters of a tool's result read for its preview
const MIN_ROWS = 3
const BATCH_GAP_MS = 60_000 // an agent started this long after the last one ended begins a new batch
const MAX_LANES = 8 // rows of the time axis
const DUR_COLS = 8 // a lane's clock, right-aligned

const agents = atom({ plugin: 'agentpane', key: 'agents' } as const, [])
const activity = atom({ plugin: 'agentpane', key: 'activity' } as const, {})
const viewing = atom({ plugin: 'agentpane', key: 'viewing' } as const, null)
const scrollTop = atom({ plugin: 'agentpane', key: 'scrollTop' } as const, null)
const rev = atom({ plugin: 'agentpane', key: 'rev' } as const, 0)
const expanded = atom({ plugin: 'agentpane', key: 'expanded' } as const, [])
const folded = atom({ plugin: 'agentpane', key: 'folded' } as const, false)
const tab = atom({ plugin: 'agentpane', key: 'tab' } as const, false)
const tokens = atom({ plugin: 'agentpane', key: 'tokens' } as const, {})
const loops = atom({ plugin: 'agentpane', key: 'loops' } as const, {})
const confirmStop = atom({ plugin: 'agentpane', key: 'confirmStop' } as const, null)
const hideDone = atom({ plugin: 'agentpane', key: 'hideDone' } as const, false)

// Colors are theme keys, so the pane follows the person's theme (dark, light, colorblind) as Claude Code's
// own rows do. The spinner and shimmer live in live.tsx, on the surface's frame clock.
const WIDE_SHARE = 0.62 // of the terminal, for the pane while it shows one agent's conversation
const MIN_WIDE = 60
const HANDLE_COLS = 2 // the hide handle's column, against the pane's left edge: its glyph and one space
const RIGHT_MARGIN = 1 // matches that one space on the right, so the content sits centred
// The handle: a tab several rows tall, each row of it a press target, so a click anywhere on it lands.
const HANDLE = ['╷ ', '│ ', '▸ ', '│ ', '╵ ']
const CLOSE_MARK_COLS = 3 // the engine draws its close mark over the end of the pane's first row
const BAND_RIGHT_PAD = 5 // clear of the engine's [-] band toggle at the band's top right

// The person's settings (`/config`, or pluginConfigs.agentpane.options in settings.json).
export type Config = { autoOpen: boolean; foldAfterMs: number; motion: boolean; toasts: boolean; keepFinished: number; statusLine: boolean }
export const parseConfig = (options: unknown): Config => {
  const o = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d)
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    autoOpen: bool(o.autoOpen, true),
    foldAfterMs: num(o.foldAfter, 10, 0, 3600) * 1000,
    motion: bool(o.motion, true),
    toasts: bool(o.toasts, true),
    keepFinished: num(o.keepFinished, 8, 1, 30),
    statusLine: bool(o.statusLine, true),
  }
}
let cfg = parseConfig(undefined) // set by register from the options it is given

// "claude-sonnet-5-5" -> "Sonnet 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5"; anything else as given.
export const prettyModel = (id: string | undefined) => {
  if (!id) return ''
  const m = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/.exec(id)
  if (!m) return id
  const [, family = '', major, minor, wide] = m
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}${wide ? ' (1M)' : ''}`
}

// How hard it is asked to think, as its requests name it: 'high', or a number where the model takes a budget.
export const prettyEffort = (effort: string | number | undefined) =>
  effort === undefined || effort === '' ? '' : typeof effort === 'number' ? `effort ${effort}` : effort

// What an agent runs on, for a detail line: 'Opus 5.5 (1M) · high'.
export const runsOn = (a: { model?: string; effort?: string | number }) =>
  [prettyModel(a.model), prettyEffort(a.effort)].filter(Boolean).join(' · ')

// How a status reads and shows, wherever an agent's status is drawn.
export const look = (status: string): { word: string; mark: string; color?: string; dim?: boolean } =>
  status === 'running' ? { word: 'Running', mark: '✻', color: 'claude' }
  : status === 'completed' ? { word: 'Done', mark: '✓', color: 'success' }
  : status === 'failed' ? { word: 'Failed', mark: '✗', color: 'error' }
  : status === 'killed' ? { word: 'Stopped', mark: '⊘', dim: true }
  : { word: status, mark: '·', dim: true }

// Terminal columns a string takes: East Asian wide and fullwidth characters and emoji take two.
// lazy: range table, not full Unicode East Asian Width; upgrade to a generated table if a script draws wrong.
export const cols = (s: string) => {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
    n += wide ? 2 : 1
  }
  return n
}

// Cut text to `max` columns with an ellipsis.
export const fit = (s: string, max: number) => {
  if (cols(s) <= max) return s
  let out = ''
  let n = 1
  for (const ch of s) {
    if (n + cols(ch) > max) break
    n += cols(ch)
    out += ch
  }
  return `${out}…`
}

// Text from the agents' transcripts: no control, escape or bidi characters; tabs as spaces; reminders the
// engine injected left out.
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g
export const clean = (s: string) =>
  s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/\t/g, '  ').replace(UNSAFE, '').trim()
const oneLine = (s: string) => clean(s).replace(/\s+/g, ' ')

// Word-wrap to `width` columns; a word longer than a line is cut where the line ends.
export const wrap = (text: string, width: number): string[] => {
  const w = Math.max(8, width)
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    let n = 0
    for (const ch of para) {
      if (n + cols(ch) > w) {
        const cut = line.lastIndexOf(' ')
        if (cut > 0 && cut >= line.length / 2) {
          out.push(line.slice(0, cut))
          line = line.slice(cut + 1)
        } else {
          out.push(line)
          line = ''
        }
        n = cols(line)
      }
      line += ch
      n += cols(ch)
    }
    out.push(line.trimEnd())
  }
  return out
}

// A tool call in Claude Code's words: "Bash(npm test)", "Read(register.tsx)", "github:list_issues".
export const toolParts = (tool: string, input: Record<string, unknown>) => {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const base = (p: string) => p.split(/[\\/]/).pop() ?? p
  const arg =
    tool === 'Bash' ? s('command')
    : ['Read', 'Write', 'Edit', 'NotebookEdit'].includes(tool) ? base(s('file_path') || s('notebook_path'))
    : tool === 'Grep' || tool === 'Glob' ? s('pattern')
    : tool === 'WebFetch' ? s('url')
    : tool === 'WebSearch' ? s('query')
    : tool === 'Agent' ? s('description')
    : tool === 'Skill' ? s('skill')
    : ''
  return { name: tool.startsWith('mcp__') ? tool.split('__').slice(1).join(':') : tool, arg: fit(oneLine(arg), MAX_ARG) }
}
export const describeTool = (tool: string, input: Record<string, unknown>) => {
  const { name, arg } = toolParts(tool, input)
  return arg ? `${name}(${arg})` : name
}

// The engine's list over what the pane knew: when each was first seen, and when it was first seen done.
export const mergeAgents = (before: readonly Agent[], list: readonly AgentInfo[], now: number): Agent[] => {
  const prev = new Map(before.map(a => [a.id, a]))
  const listed = new Set(list.map(a => a.id))
  // A spawn the hook recorded that the engine's list does not show yet: kept a moment, not dropped.
  const pending = before.filter(a => !listed.has(a.id) && a.status === 'running' && now - a.firstSeen < SPAWN_GRACE_MS)
  const merged = list.map(info => {
    const old = prev.get(info.id)
    const running = info.status === 'running'
    const seenRunning = (old?.seenRunning ?? false) || running
    const endedAt = running ? undefined : (old?.endedAt ?? (seenRunning ? now : undefined))
    const resumed = running && old?.endedAt !== undefined // ended, then sent a message: a new run from now
    return {
      id: info.id, description: info.description, type: info.type, status: info.status,
      ...(info.name && { name: info.name }), ...(info.parentId && { parentId: info.parentId }),
      firstSeen: resumed ? now : (old?.firstSeen ?? now), seenRunning, ...(endedAt !== undefined && { endedAt }),
      ...(old?.model && { model: old.model }),
    }
  })
  return [...merged, ...pending]
}

// A spawn as the pane records it the moment it starts, before the engine's list shows it.
export const spawned = (list: readonly Agent[], a: Agent): Agent[] =>
  list.some(x => x.id === a.id) ? list.map(x => (x.id === a.id ? { ...x, model: a.model ?? x.model } : x)) : [...list, a]

// A model loop no agent claims, one more request.
export const stepLoop = (all: Readonly<Record<string, Loop>>, id: string, now: number): Record<string, Loop> => {
  const old = all[id]
  return { ...all, [id]: { firstSeen: old?.firstSeen ?? now, lastSeen: now, requests: (old?.requests ?? 0) + 1 } }
}

// What the list shows: every running agent and the most recently finished ones, in the engine's order.
export const visibleAgents = (all: readonly Agent[], keep = 8): Agent[] => {
  const ended = (a: Agent, i: number) => [a.endedAt ?? a.firstSeen, i] as const
  const recent = all
    .map((a, i) => ({ a, key: ended(a, i) }))
    .filter(({ a }) => a.status !== 'running')
    .sort((x, y) => y.key[0] - x.key[0] || y.key[1] - x.key[1])
    .slice(0, keep)
    .map(({ a }) => a)
  return all.filter(a => a.status === 'running' || recent.includes(a))
}

// Pure: the list as groups, each agent whose parent is not listed heading one with its descendants under
// it; running groups first. With `onlyRunning`, finished agents are left out and their running children
// head groups of their own.
export const arrange = (shown: readonly Agent[], onlyRunning = false) => {
  const list = onlyRunning ? shown.filter(a => a.status === 'running') : shown
  const ids = new Set(list.map(a => a.id))
  const under = (id: string) => {
    const out: { agent: Agent; depth: number }[] = []
    const walk = (parent: string, depth: number) => {
      if (depth > 3) return // a loop in the parents, or a tree deeper than the pane can indent
      for (const a of list) if (a.parentId === parent) out.push({ agent: a, depth }), walk(a.id, depth + 1)
    }
    walk(id, 1)
    return out
  }
  const tops = list.filter(a => !a.parentId || !ids.has(a.parentId)).map(a => ({ agent: a, kids: under(a.id) }))
  return { running: tops.filter(t => t.agent.status === 'running'), finished: tops.filter(t => t.agent.status !== 'running') }
}

const elapsed = (a: Agent, now: number) => (a.seenRunning ? fmtDuration((a.endedAt ?? now) - a.firstSeen) : '')

// One response's usage added to an agent's tally; `context` is what its latest request carried.
export const addUsage = (
  t: Tokens | undefined,
  u: Pick<TurnUsage, 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'>,
  stopReason: string | null = null,
): Tokens => {
  const input = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const truncated = (t?.truncated ?? 0) + (stopReason === 'max_tokens' ? 1 : 0)
  return {
    ...(truncated && { truncated }),
    input: (t?.input ?? 0) + input,
    cached: (t?.cached ?? 0) + u.cache_read_input_tokens,
    output: (t?.output ?? 0) + u.output_tokens,
    context: input + u.output_tokens,
    requests: (t?.requests ?? 0) + 1,
  }
}

// "950", "12.3k", "312k", "1.2M".
export const fmtTokens = (n: number) =>
  n < 1000 ? String(n) : n < 99_950 ? `${+(n / 1000).toFixed(1)}k` : n < 999_500 ? `${Math.round(n / 1000)}k` : `${+(n / 1_000_000).toFixed(1)}M`

export type CallState = 'running' | 'ok' | 'error' | 'stopped'
export type Call = { id: string; name: string; arg: string; state: CallState; result: string[]; more: number }
export type Block =
  | { kind: 'prompt'; text: string }
  | { kind: 'reply'; text: string }
  | { kind: 'tools'; key: string; calls: Call[] }
const STATE_COLOR: Record<CallState, string> = { running: 'claude', ok: 'success', error: 'error', stopped: 'inactive' }

// A tool's result as its first lines, each cut to length, and how many more it had.
// Only the head is cleaned and split; the rest, often megabytes, is counted by its newlines.
export const preview = (text: string) => {
  const lines = clean(text.slice(0, PREVIEW_SCAN)).split('\n').map(l => l.trimEnd()).filter(l => l.trim())
  let rest = 0 // lazy: counts blank lines past the head too; exact would need the whole text split
  for (let i = text.indexOf('\n', PREVIEW_SCAN); i !== -1; i = text.indexOf('\n', i + 1)) rest++
  return { result: lines.slice(0, PREVIEW_LINES).map(l => fit(l, MAX_LINE)), more: Math.max(0, lines.length - PREVIEW_LINES) + rest }
}

// Pure: an agent's conversation as blocks: its brief (and any later message to it), each reply, and each
// run of tool calls between them as one group. A call left unanswered by an agent that `ended` was cut off.
export const transcriptBlocks = (msgs: readonly SessionMessage[], ended = false): Block[] => {
  const out: Block[] = []
  for (const m of msgs) {
    const text = clean(m.text)
    if (m.role === 'user') {
      if (text) out.push({ kind: 'prompt', text })
      continue
    }
    if (text) out.push({ kind: 'reply', text })
    for (const use of m.toolUses) {
      const { name, arg } = toolParts(use.tool, use.input)
      const state: CallState = use.text === undefined ? (ended ? 'stopped' : 'running') : use.isError ? 'error' : 'ok'
      const call: Call = { id: use.tool_use_id, name, arg, state, ...(use.text === undefined ? { result: [], more: 0 } : preview(use.text)) }
      const last = out[out.length - 1]
      if (last?.kind === 'tools') last.calls.push(call)
      else out.push({ kind: 'tools', key: use.tool_use_id, calls: [call] })
    }
  }
  return out
}

// Pure: the blocks to draw, within MAX_BLOCKS and the text budget: from `top` down when scrolled back, the
// newest otherwise. Always at least one.
export const pickBlocks = (blocks: readonly Block[], top: number | null) => {
  const size = (b: Block) =>
    b.kind === 'tools' ? b.calls.reduce((n, c) => n + c.arg.length + c.result.join('').length + 40, 0) : Math.min(b.text.length, MAX_REPLY) + 40
  const out: Block[] = []
  let used = 0
  const take = (b: Block | undefined, add: (b: Block) => void) => {
    if (!b || out.length >= MAX_BLOCKS) return false
    used += size(b)
    if (used > TEXT_BUDGET && out.length) return false
    add(b)
    return true
  }
  if (top === null) for (let i = blocks.length - 1; take(blocks[i], b => out.unshift(b)); i--);
  else for (let i = Math.max(0, top); take(blocks[i], b => out.push(b)); i++);
  return out
}

// Pure: the newest calls of an opened run that fit GROUP_BUDGET and GROUP_CALLS (always one), and how many
// earlier ones are left out: an agent that only calls tools makes one run of hundreds.
export const lastCalls = (calls: readonly Call[]) => {
  let used = 0
  let from = calls.length
  while (from > 0 && calls.length - from < GROUP_CALLS) {
    const c = calls[from - 1]!
    used += c.arg.length + c.result.join('').length + 40
    if (used > GROUP_BUDGET && from < calls.length) break
    from--
  }
  return { shown: calls.slice(from), hidden: from }
}

// A run of tool calls in Claude Code's words: "Read 3 files, ran 2 commands".
const VERBS: Record<string, [string, string, string]> = {
  Read: ['read', 'file', 'files'], Bash: ['ran', 'command', 'commands'], Edit: ['edited', 'file', 'files'],
  Write: ['wrote', 'file', 'files'], NotebookEdit: ['edited', 'notebook', 'notebooks'], Grep: ['searched for', 'pattern', 'patterns'],
  Glob: ['searched for', 'pattern', 'patterns'], WebFetch: ['fetched', 'page', 'pages'], WebSearch: ['searched the web', 'time', 'times'],
  Agent: ['ran', 'agent', 'agents'],
}
export const groupSummary = (calls: readonly Call[]) => {
  const counts = new Map<string, number>()
  for (const c of calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1)
  const parts = [...counts].map(([name, n]) => {
    const verb = VERBS[name]
    return verb ? `${verb[0]} ${n} ${n === 1 ? verb[1] : verb[2]}` : `called ${name}${n > 1 ? ` ${n} times` : ''}`
  })
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
const groupState = (calls: readonly Call[]): CallState =>
  calls.some(c => c.state === 'running') ? 'running'
  : calls.some(c => c.state === 'error') ? 'error'
  : calls.some(c => c.state === 'stopped') ? 'stopped'
  : 'ok'

// An agent's name as the pane, its toasts and its Stop say it: type and description, cleaned and cut.
const nameOf = (a: Agent, max = 60) => `${fit(oneLine(a.type), 30)}(${fit(oneLine(a.description || a.type), max)})`

// Pure: the toast for agents that finished since the last look, or null when none did.
export const finishNotice = (before: readonly Agent[], after: readonly Agent[], now: number) => {
  const ended = after.filter(a => a.status !== 'running' && before.some(b => b.id === a.id && b.status === 'running'))
  if (!ended.length) return null
  if (ended.length === 1) {
    const a = ended[0]!
    const l = look(a.status)
    const t = elapsed(a, now)
    return `${nameOf(a, 40)} ${l.mark} ${l.word.toLowerCase()}${t ? ` · ${t}` : ''}`
  }
  const failed = ended.filter(a => a.status === 'failed').length
  return `✓ ${ended.length} agents finished${failed ? ` · ✗ ${failed} failed` : ''}`
}

const uses = (n: number) => `${n} tool use${n === 1 ? '' : 's'}`

// Pure: the latest batch, oldest first: the agents that ran, back from the newest to a start more than
// BATCH_GAP_MS after everything before it had ended.
export const latestBatch = (all: readonly Agent[]): Agent[] => {
  const ran = all.filter(a => a.seenRunning).sort((x, y) => x.firstSeen - y.firstSeen)
  let start = 0
  let reach = -Infinity // when the agents so far had all ended; never, while one runs
  ran.forEach((a, i) => {
    if (a.firstSeen > reach + BATCH_GAP_MS) start = i
    reach = Math.max(reach, a.status === 'running' ? Infinity : (a.endedAt ?? a.firstSeen))
  })
  return ran.slice(start)
}

// Pure: what a batch of two or more came to, once none of it runs: how long it took, how much agent time
// that was and so how much ran side by side, and what it used.
export const batchReceipt = (
  batch: readonly Agent[],
  act: Readonly<Record<string, { tools: number }>>,
  tok: Readonly<Record<string, Tokens>>,
) => {
  if (batch.length < 2 || batch.some(a => a.status === 'running')) return null
  const end = (a: Agent) => a.endedAt ?? a.firstSeen
  const wall = Math.max(...batch.map(end)) - Math.min(...batch.map(a => a.firstSeen))
  // An agent's subagents run inside its own time: only the agents at the top of the batch add to it.
  const work = batch.filter(a => !batch.some(p => p.id === a.parentId)).reduce((n, a) => n + end(a) - a.firstSeen, 0)
  const count = (s: string) => batch.filter(a => a.status === s).length
  const tools = batch.reduce((n, a) => n + (act[a.id]?.tools ?? 0), 0)
  const used = batch.reduce((n, a) => n + (tok[a.id] ? tok[a.id]!.input + tok[a.id]!.output : 0), 0)
  const together = wall > 0 ? work / wall : 1
  const who = count('completed') === batch.length
    ? `${batch.length} agents`
    : [...new Set(['completed', 'failed', 'killed', ...batch.map(a => a.status)])]
        .map(s => (count(s) ? `${count(s)} ${look(s).word.toLowerCase()}` : '')).filter(Boolean).join(' · ')
  return {
    failed: count('failed') > 0,
    text: [
      `${who} in ${fmtDuration(wall)}`,
      `${fmtDuration(work)} of agent time${together >= 1.2 ? ` (${together.toFixed(1)}× in parallel)` : ''}`,
      tools ? uses(tools) : '',
      used ? `${fmtTokens(used)} tokens` : '',
    ].filter(Boolean).join(' · '),
  }
}

// Pure: the status line under the prompt while a batch runs, or undefined to clear it.
export const statusOf = (batch: readonly Agent[]) => {
  const running = batch.filter(a => a.status === 'running').length
  if (!running) return undefined
  const failed = batch.filter(a => a.status === 'failed').length
  const of = running === batch.length ? `${running} agent${running === 1 ? '' : 's'} running` : `${running} of ${batch.length} agents running`
  return `${look('running').mark} ${of}${failed ? ` · ${look('failed').mark} ${failed} failed` : ''}`
}

// Module state that nothing draws from (a reload resets it to "nothing opened yet").
let autoOpened = false // the mod opened the pane unasked, rather than the person
let closedByPerson = false // closed by hand while agents ran: stays shut until a new one starts
let foldingAway = false // the close under way is a fold: the tab above the prompt brings the pane back
let foldWhenIdle = false // agents ran while the pane was open: fold it once they are all done
let isFullscreen: boolean | undefined // from the last drawing: only the fullscreen layout docks a pane
let lastPlacement: string | null = null
let lastColumns = 0 // the terminal's width, from the last drawing
let lastRunningAt = 0
let armedAt = 0 // when Stop was pressed once
// The status line as last set, so it is set only when it changes; null: not yet by this module, so a line a
// reload left behind is cleared on the first sync.
let lastStatus: string | undefined | null = null
let viewingId: string | null = null // the conversation on screen, for the events that redraw it
let transcript = { key: '', blocks: [] as Block[] } // that conversation's blocks, read once per change
// lazy: one sync at a time by a module flag; a slow agent.list only skips ticks.
let syncing = false
// Agents the spawn hook listed since the last sync: new to the pane, though the list already holds them.
const spawnedSinceSync = new Set<string>()

// Never rejects. Keeps the list current, opens the pane when an agent starts, folds it once they are done.
async function sync($: EngineInterface) {
  if (syncing) return
  syncing = true
  try {
    const now = await $.clock.now()
    const info = await $.agent.list()
    const before = await read($, agents)
    let list = mergeAgents(before, info, now)
    // Written over the list as it stands then, so an agent the spawn hook records meanwhile keeps its model.
    if (JSON.stringify(list) !== JSON.stringify(before)) list = await update($, agents, cur => mergeAgents(cur, info, now))
    const notice = finishNotice(before, list, now)
    if (notice && cfg.toasts) $.ui.toast(notice)
    const ids = new Set(list.map(a => a.id))
    if (Object.keys(await read($, activity)).some(id => !ids.has(id)))
      await update($, activity, m => Object.fromEntries(Object.entries(m).filter(([id]) => ids.has(id))))

    const running = list.filter(a => a.status === 'running')
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    // A new agent unfolds the pane, whoever folded or closed it, and shows the list.
    const fresh = running.some(a => spawnedSinceSync.has(a.id) || !before.some(b => b.id === a.id))
    for (const a of list) spawnedSinceSync.delete(a.id) // a spawn recorded after this list was read waits for the next
    if (fresh) {
      closedByPerson = false
      // With autoOpen off the pane stays shut, and a fold the person made keeps its tab.
      if (!pane && cfg.autoOpen) await showList($, { clearFold: true })
    }
    // The conversation on screen belongs to an agent no longer listed (/clear): back to the list, so it can fold.
    const open = await read($, viewing)
    if (open && !ids.has(open)) await showList($)
    if (running.length) lastRunningAt = now
    if (pane && running.length) foldWhenIdle = true
    if (!pane && running.length && cfg.autoOpen && !closedByPerson && !(await read($, folded))) {
      autoOpened = true
      await openPane($, 'list') // docked beside a fullscreen transcript, else the summary above the prompt
    } else if (
      pane && foldWhenIdle && !running.length && cfg.foldAfterMs > 0 && now - lastRunningAt >= cfg.foldAfterMs &&
      !pane.isFocused && !(await read($, viewing))
    ) {
      await foldAway($) // all done; not while the person reads a conversation
    }
    // Folded, the tab above the prompt stands in for the pane while the session has agents to show.
    const showTab = (await read($, folded)) && list.length > 0
    if (showTab !== (await read($, tab))) await update($, tab, () => showTab)
    if ((await read($, confirmStop)) && now - armedAt > CONFIRM_MS) await update($, confirmStop, () => null)

    // Loops that turned out to be agents, or went quiet long ago, are forgotten; tokens of neither go too.
    const loopsNow = await read($, loops)
    const keptLoops = Object.fromEntries(Object.entries(loopsNow).filter(([id, l]) => !ids.has(id) && now - l.lastSeen < LOOP_KEPT_MS))
    if (Object.keys(keptLoops).length !== Object.keys(loopsNow).length) await update($, loops, () => keptLoops)
    const kept = (id: string) => ids.has(id) || id in keptLoops
    if (Object.keys(await read($, tokens)).some(id => !kept(id)))
      await update($, tokens, m => Object.fromEntries(Object.entries(m).filter(([id]) => kept(id))))

    // Under the prompt while a batch runs and the pane is not on screen (folded, closed, or waiting for room).
    const placed = cfg.statusLine && (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced && p.isShown)
    const status = cfg.statusLine && !placed ? statusOf(latestBatch(list)) : undefined
    if (status !== lastStatus) {
      lastStatus = status
      $.ui.status(status)
    }
  } catch {
    // the next tick tries again
  } finally {
    syncing = false
  }
}

// Back to the list, live, nothing armed; `clearFold` also clears the fold.
async function showList($: EngineInterface, { clearFold = false } = {}) {
  await update($, viewing, () => null)
  await update($, scrollTop, () => null)
  await update($, expanded, () => [])
  await update($, confirmStop, () => null)
  if (clearFold) await update($, folded, () => false)
}

// The pane sized for what it shows: docked, at its usual width or widened to read a conversation; above the
// prompt, a summary's rows or a conversation's. `focus` asks for the keyboard (granted over an empty
// composer), so the conversation's b/k/j keys work.
async function openPane($: EngineInterface, view: 'list' | 'conversation', focus = false) {
  const docked = lastPlacement ? lastPlacement === 'dock' : isFullscreen !== false
  const columns = docked && view === 'conversation' && lastColumns ? Math.max(MIN_WIDE, Math.round(lastColumns * WIDE_SHARE)) : undefined
  const rows = docked ? undefined : view === 'conversation' ? INLINE_READ_ROWS : INLINE_ROWS
  await $.ui.open({ id: PANE, title: TITLE, ...(columns && { columns }), ...(rows && { rows }), ...(focus && { focus: true as const }) })
}

// Fold: the pane closes, so the transcript has the width back, and a tab above the prompt reopens it.
async function foldAway($: EngineInterface) {
  await update($, folded, () => true)
  await update($, tab, () => true)
  foldingAway = true
  try {
    await $.ui.close({ id: PANE })
  } finally {
    foldingAway = false
  }
}

// The person unfolds it from the tab: theirs now, so it folds again only after agents run in it.
async function unfold($: EngineInterface) {
  await update($, folded, () => false)
  await update($, tab, () => false)
  closedByPerson = false
  autoOpened = false
  foldWhenIdle = (await read($, agents)).some(a => a.status === 'running')
  await openPane($, (await read($, viewing)) ? 'conversation' : 'list')
}

// Stop a running agent with Claude Code's own TaskStop, on the person's confirmed press of Stop.
async function stopAgent($: EngineInterface, a: Agent) {
  const name = nameOf(a)
  const done = (await $.tool
    // The consent reads to the engine as the person's words: the type and id, never the description a model wrote.
    .call({ tool: 'TaskStop', task_id: a.id, consent: `The user pressed "Stop" on the ${JSON.stringify(fit(oneLine(a.type), 30))} agent ${fit(a.id, 40)} in the agents pane` } as never)
    .catch((err: unknown) => ({ deny: String(err) }))) as { deny?: string; isError?: boolean; text?: string }
  const why = done.deny || (done.isError ? oneLine(String(done.text ?? '')) || 'the tool reported an error' : '')
  if (why) $.ui.toast(`Could not stop ${name}: ${fit(why, 120)}`)
}

// The conversation on screen changed: draw it again.
const redraw = ($: EngineInterface, agentId: string | undefined) => {
  if (agentId && agentId === viewingId) void update($, rev, n => n + 1).catch(() => undefined)
}

export const register: Register = (on, options) => {
  cfg = parseConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agentpane', description: 'Show or hide the pane of running agents' })
    $.clock.every(SYNC_MS, () => void sync($))
    return next(e)
  })

  on('command.run', { command: 'agentpane' }, async $ => {
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    if (pane?.isPlaced) {
      await $.ui.close({ id: PANE })
      return { text: 'Agents pane closed.' }
    }
    autoOpened = false // opened by hand: the mod leaves it open
    closedByPerson = false
    foldWhenIdle = false
    await update($, folded, () => false)
    await update($, tab, () => false)
    await openPane($, 'list', true) // asked for, so placed even where an unasked pane waits
    return { text: 'Agents pane opened.' }
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE && !('deny' in result && result.deny)) {
      foldWhenIdle = false
      autoOpened = false
      await update($, confirmStop, () => null)
      if (!foldingAway) {
        // closed by hand (its close mark, Esc, ctrl+x x, /agentpane) while agents run: stays shut until a new one starts
        closedByPerson = (await read($, agents)).some(a => a.status === 'running')
        await update($, viewing, () => null)
      }
    }
    return result
  })

  // What each agent is doing: its latest tool call; and its conversation, if on screen, grows.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const text = describeTool(e.tool, e as unknown as Record<string, unknown>)
      void update($, activity, m => ({ ...m, [id]: { text, tools: (m[id]?.tools ?? 0) + 1 } })).catch(() => undefined)
      redraw($, id)
    }
    const result = await next(e)
    redraw($, id)
    return result
  })

  // An agent is listed the moment it starts, with the model it runs on, ahead of the next poll.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const id = started.agentId
    if (id && !started.deny) {
      const a: Agent = {
        id, description: e.description, type: e.subagentType, status: 'running',
        ...(e.parentAgentId && { parentId: e.parentAgentId }), ...(e.name && { name: e.name }),
        firstSeen: await $.clock.now(), seenRunning: true, ...(started.model && { model: started.model }),
      }
      spawnedSinceSync.add(id)
      void update($, agents, list => spawned(list, a)).catch(() => undefined)
    }
    return started
  })

  // What each agent's responses cost, as the API reported each one; a response grows its conversation. A
  // loop no listed agent claims (a workflow's agent, a compaction or memory fork) is counted on its own.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const id = e.agentId
    if (id) {
      const usage = result?.usage
      if (usage) void update($, tokens, m => ({ ...m, [id]: addUsage(m[id], usage, result.stopReason) })).catch(() => undefined)
      const listed = (await read($, agents)).find(a => a.id === id)
      // The model and effort its requests name, as the engine resolved them: an agent whose spawn named no model (a
      // forked skill, an inherited model) still shows what it runs on, and an alias the spawn gave ('sonnet') reads as
      // the real id. Effort is the step's alone (a spawn reports none); absent for a model without it.
      if (listed && ((e.model && listed.model !== e.model) || listed.effort !== e.effort)) {
        const ran = { ...(e.model && { model: e.model }), effort: e.effort }
        void update($, agents, l => l.map(a => (a.id === id ? { ...a, ...ran } : a))).catch(() => undefined)
      }
      if (!listed) {
        const now = await $.clock.now()
        void update($, loops, l => stepLoop(l, id, now)).catch(() => undefined)
      }
    }
    redraw($, id)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = els
    // Live lines run on the surface's own frame clock where it has one (terminal, desktop); elsewhere they are
    // static. Every surface's table names Client, but on the others it draws nothing: ask by surface.
    const Client = (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in els ? els.Client : null
    lastPlacement = e.props.placement
    lastColumns = e.viewport?.columns ?? lastColumns
    isFullscreen = e.viewport?.isFullscreen ?? isFullscreen
    const inline = e.props.placement === 'inline' // above the prompt: a summary, no handle
    const W = Math.max(22, e.props.bodyColumns - (inline ? 0 : HANDLE_COLS) - RIGHT_MARGIN) // the content, right of the handle
    const viewed = e.props.view?.agentId ?? null // the agent the person has open in the main view
    const rows = Math.max(MIN_ROWS + 6, e.props.scroll.bodyRows)
    const now = await $.clock.now()
    const all = await read($, agents)
    const act = await read($, activity)
    const tok = await read($, tokens)
    const id = await read($, viewing)
    const agent = id ? all.find(a => a.id === id) : undefined
    viewingId = agent ? agent.id : null
    const runningCount = all.filter(a => a.status === 'running').length
    const doneCount = all.length - runningCount
    const hint = (text: string) => <Text dimColor wrap="truncate-end">{text}</Text>
    const alertOf = (a: Agent) => (tok[a.id]?.truncated ? `max_tokens ×${tok[a.id]!.truncated}` : '')
    // A running agent's spinner, shimmering "Running…" and clock, redrawn by the surface, not by this hook.
    const liveLine = (a: Agent, pad: string, detail: string) =>
      Client && a.seenRunning ? (
        <Client key={`live-${a.id}`} module="./live.tsx" props={{ since: a.firstSeen, now, pad, detail, alert: alertOf(a), motion: cfg.motion, clockOnly: false }} />
      ) : (
        <Text wrap="truncate-end">
          <Text color="claude">{`${pad}  ✻ Running…`}</Text>
          <Text dimColor>{` (${[elapsed(a, now), detail].filter(Boolean).join(' · ')}`}</Text>
          {alertOf(a) ? <Text color="error">{` · ${alertOf(a)}`}</Text> : null}
          <Text dimColor>)</Text>
        </Text>
      )
    const clock = (a: Agent) =>
      Client && a.status === 'running' && a.seenRunning ? (
        <Client key={`clock-${a.id}`} module="./live.tsx" props={{ since: a.firstSeen, now, pad: '', detail: '', alert: '', motion: false, clockOnly: true }} />
      ) : (
        <Text dimColor>{elapsed(a, now)}</Text>
      )
    // The first row, clear of the engine's close mark at its end.
    const header = (left: RenderChildren, right: RenderChildren) => (
      <Box width={W - CLOSE_MARK_COLS} justifyContent="space-between">
        {left}
        {typeof right === 'string' ? <Text dimColor>{right}</Text> : right}
      </Box>
    )
    // A handle on the pane's left edge, halfway down: ▸ hides the pane. Above the prompt there is no edge to hold.
    const withHandle = (body: RenderChildren) =>
      inline ? (
        <Box flexDirection="column" width={W}>
          {body}
        </Box>
      ) : (
      <Box flexDirection="row">
        <Box key="handle" flexDirection="column" width={HANDLE_COLS} flexShrink={0}>
          {Array.from({ length: Math.max(0, Math.floor((rows - HANDLE.length) / 2)) }, () => <Text> </Text>)}
          {HANDLE.map((glyph, i) => (
            <Button
              key={glyph.startsWith('▸') ? 'collapse' : `collapse-${i}`}
              label={glyph}
              plain
              dimColor
              hover={{ color: 'claude', bold: true }}
              onPress={() => foldAway($)}
            />
          ))}
        </Box>
        <Box flexDirection="column" width={W} height={rows}>
          {body}
        </Box>
      </Box>
      )

    // One agent's conversation, as Claude Code draws its own: > the brief, ⏺ replies and tool calls, ⎿ results.
    if (agent) {
      const key = `${agent.id}:${await read($, rev)}:${agent.status}`
      if (transcript.key !== key) {
        const msgs = await $.session.messages({ agentId: agent.id })
        transcript = { key, blocks: Array.isArray(msgs) ? transcriptBlocks(msgs, agent.status !== 'running') : [] }
      }
      const blocks = transcript.blocks
      const open = new Set(await read($, expanded))
      const armed = await read($, confirmStop)
      const savedTop = await read($, scrollTop)
      const top = savedTop === null ? null : Math.min(savedTop, Math.max(0, blocks.length - 1))
      const shown = pickBlocks(blocks, top)
      const newer = top === null ? 0 : blocks.length - top - 1 // blocks after the one at the top
      const used = tok[agent.id]
      const l = look(agent.status)
      const leave = async () => {
        await showList($)
        await openPane($, 'list') // back to the usual size
      }
      const toggle = (k: string) => update($, expanded, list => (list.includes(k) ? list.filter(x => x !== k) : [...list, k]))
      const result = (c: Call) =>
        c.state === 'running' ? [<Text color="claude">{'  ⎿  Running…'}</Text>]
        : c.state === 'stopped' ? [<Text dimColor>{'  ⎿  Interrupted'}</Text>]
        : [
            ...(c.result.length ? c.result : ['(No output)']).map((r, i) => (
              <Text color={c.state === 'error' ? 'error' : undefined} dimColor={c.state !== 'error'} wrap="truncate-end">
                {`${i ? '     ' : '  ⎿  '}${r}`}
              </Text>
            )),
            ...(c.more ? [<Text dimColor>{`     … +${c.more} line${c.more === 1 ? '' : 's'}`}</Text>] : []),
          ]
      const call = (c: Call) => (
        <Box flexDirection="column" flexShrink={0}>
          <Text wrap="truncate-end">
            <Text color={STATE_COLOR[c.state]}>⏺ </Text>
            <Text bold>{c.name}</Text>
            <Text>{c.arg ? `(${c.arg})` : ''}</Text>
          </Text>
          {result(c)}
        </Box>
      )
      const block = (b: Block): RenderElement => {
        if (b.kind === 'prompt') {
          const lines = wrap(b.text.slice(0, PROMPT_LINES * W * 2), W - 2)
          return (
            <Box flexDirection="column" flexShrink={0} marginTop={1}>
              {lines.slice(0, PROMPT_LINES).map((line, i) => (
                <Text dimColor wrap="truncate-end">{`${i ? '  ' : '> '}${line}`}</Text>
              ))}
              {lines.length > PROMPT_LINES ? <Text dimColor>{'  …'}</Text> : null}
            </Box>
          )
        }
        if (b.kind === 'reply') {
          const text = b.text.length > MAX_REPLY ? `${b.text.slice(0, MAX_REPLY)}\n\n… (${b.text.length - MAX_REPLY} more characters)` : b.text
          return (
            <Box flexDirection="row" flexShrink={0} marginTop={1}>
              <Text>⏺ </Text>
              <Box flexDirection="column" width={W - 2}>
                <Markdown text={text} />
              </Box>
            </Box>
          )
        }
        if (b.calls.length === 1) return <Box flexShrink={0} marginTop={1}>{call(b.calls[0]!)}</Box>
        const isOpen = open.has(b.key)
        const opened = lastCalls(b.calls)
        const live = b.calls.find(c => c.state === 'running')
        const failed = b.calls.find(c => c.state === 'error')
        return (
          <Box key={`grp-${b.key}`} flexDirection="column" flexShrink={0} marginTop={1}>
            <Box>
              <Text color={STATE_COLOR[groupState(b.calls)]}>⏺ </Text>
              <Button key={`group-${b.key}`} label={groupSummary(b.calls)} plain hover={{ color: 'claude' }} onPress={() => toggle(b.key)} />
              <Text dimColor>{isOpen ? ' (click to collapse)' : ' (click to expand)'}</Text>
            </Box>
            {isOpen ? (
              <Box flexDirection="column" paddingLeft={2}>
                {opened.hidden ? <Text dimColor>{`… +${opened.hidden} earlier call${opened.hidden === 1 ? '' : 's'}`}</Text> : null}
                {opened.shown.map(call)}
              </Box>
            ) : live ? (
              <Text color="claude" wrap="truncate-end">{`  ⎿  ${live.name}${live.arg ? `(${live.arg})` : ''} · Running…`}</Text>
            ) : failed ? (
              <Text color="error" wrap="truncate-end">{`  ⎿  ${failed.name} failed: ${failed.result[0] ?? ''}`}</Text>
            ) : null}
          </Box>
        )
      }
      const arm = async () => {
        armedAt = await $.clock.now()
        await update($, confirmStop, () => agent.id)
      }
      return withHandle([
        header(
          <Box>
            <Button key="back" label="←" hotkey="b" dimColor onPress={leave} />
            <Text color={l.color} dimColor={l.dim}> ⏺ </Text>
            <Text bold>{fit(oneLine(agent.type), 20)}</Text>
            <Text>{`(${fit(oneLine(agent.description), Math.max(8, W - 42 - cols(agent.type)))})`}</Text>
          </Box>,
          <Box>
            {clock(agent)}
            {agent.status !== 'running' ? null : armed === agent.id ? (
              <Button key="stop" label="Confirm stop" variant="primary" onPress={() => update($, confirmStop, () => null).then(() => stopAgent($, agent))} />
            ) : (
              <Button key="stop" label="■ Stop" dimColor onPress={arm} />
            )}
          </Box>,
        ),
        <Text wrap="truncate-end">
          <Text dimColor>
            {`  ⎿  ${[l.word, act[agent.id] ? uses(act[agent.id]!.tools) : '', runsOn(agent), viewed === agent.id ? 'also in the main view' : ''].filter(Boolean).join(' · ')}`}
          </Text>
          {alertOf(agent) ? <Text color="error">{` · ${alertOf(agent)}`}</Text> : null}
        </Text>,
        <Text dimColor wrap="truncate-end">
          {used
            ? `     ${fmtTokens(used.input)} in (${fmtTokens(used.cached)} cached) · ${fmtTokens(used.output)} out · context ${fmtTokens(used.context)} · ${used.requests} request${used.requests === 1 ? '' : 's'}`
            : '     no token figures yet'}
        </Text>,
        // Live: the newest blocks, anchored to the bottom (the oldest cut at the top). Scrolled back: from the
        // block at `top` down, so a block taller than the pane shows its start and new blocks do not move it.
        <Box height={rows - 5} flexDirection="column" justifyContent={top === null ? 'flex-end' : 'flex-start'} overflow="hidden">
          {shown.length ? shown.map(block) : <Text dimColor>Its conversation is not available yet.</Text>}
        </Box>,
        <Text> </Text>,
        <Box width={W} justifyContent="space-between">
          <Box>
            <Button key="older" label="▲" hotkey="k" dimColor onPress={() => update($, scrollTop, v => Math.max(0, (v ?? blocks.length - 1) - 1))} />
            <Button
              key="newer"
              label="▼"
              hotkey="j"
              dimColor
              onPress={() => update($, scrollTop, v => (v === null || v + 1 >= blocks.length - 1 ? null : v + 1))}
            />
            {top === null ? (
              <Text color="success"> ● live</Text>
            ) : (
              <Button key="live" label={newer > 0 ? `⇣ ${newer} newer` : '⇣ live'} onPress={() => update($, scrollTop, () => null)} />
            )}
          </Box>
          {hint(e.props.isFocused ? 'b back · k/j scroll · esc to prompt ' : 'click here for keys b/k/j ')}
        </Box>,
      ])
    }

    // The list, as Claude Code draws an Agent call: ⏺ Type(description), ⎿ what it does, and a status line.
    const shown = visibleAgents(all, cfg.keepFinished)
    const hidingDone = await read($, hideDone)
    const { running, finished } = arrange(shown, hidingDone)
    const goTo = async (to: string) => {
      await showList($)
      await update($, viewing, () => to)
      await openPane($, 'conversation', true)
    }
    // Model loops no agent claims, recently active: a workflow's agents, compaction and memory forks.
    const quiet = Object.entries(await read($, loops)).filter(([, x]) => now - x.lastSeen < LOOP_SHOWN_MS)
    const loopsLine = quiet.length
      ? `⏺ ${quiet.length} other model loop${quiet.length === 1 ? '' : 's'} (workflow agents or forks) · ${quiet.reduce((n, [, x]) => n + x.requests, 0)} requests · ${fmtTokens(quiet.reduce((n, [lid]) => n + (tok[lid]?.input ?? 0), 0))} in`
      : ''
    // The latest batch on one time axis (two agents or more, where there is room), and once it has ended,
    // what it came to.
    const batch = latestBatch(all)
    const receipt = batchReceipt(batch, act, tok)
    const receiptLine = receipt ? (
      <Text wrap="truncate-end">
        <Text color={receipt.failed ? 'error' : 'success'}>{receipt.failed ? '✗ ' : '✓ '}</Text>
        <Text dimColor>{receipt.text}</Text>
      </Text>
    ) : null
    const nameCols = Math.min(30, Math.floor(W * 0.38))
    const barCols = W - 2 - nameCols - 1 - DUR_COLS
    const onAxis = batch.length >= 2 && barCols >= 8 ? batch.slice(-Math.min(MAX_LANES, Math.floor(rows / 3))) : []
    const lanes: Lane[] = onAxis.map(a => {
      const l = look(a.status)
      const name = fit(oneLine(a.description || a.type), nameCols)
      return {
        name: name + ' '.repeat(Math.max(0, nameCols - cols(name))), mark: l.mark, color: l.color ?? '', dim: !!l.dim,
        from: a.firstSeen, to: a.status === 'running' ? null : (a.endedAt ?? a.firstSeen),
      }
    })
    const axisTitle = ` timeline${onAxis.length < batch.length ? ` · latest ${onAxis.length} of ${batch.length}` : ''} `
    const axis = lanes.length ? (
      <Box flexDirection="column" flexShrink={0} marginTop={1}>
        <Text dimColor wrap="truncate-end">{`──${axisTitle}${'─'.repeat(Math.max(0, W - 2 - axisTitle.length))}`}</Text>
        {Client ? (
          <Client key="lanes" module="./lanes.tsx" props={{ lanes, now, bar: barCols }} />
        ) : (
          laneRows(lanes, now, barCols).map((g, i) => (
            <Text wrap="truncate-end">
              <Text color={lanes[i]!.color || undefined} dimColor={lanes[i]!.dim}>{`${lanes[i]!.mark} `}</Text>
              <Text>{lanes[i]!.name}</Text>
              <Text dimColor>{` ${'·'.repeat(g.before)}`}</Text>
              <Text color={lanes[i]!.color || undefined} dimColor={lanes[i]!.dim}>{'━'.repeat(g.bar)}</Text>
              <Text dimColor>{`${'·'.repeat(g.after)}${fmtDuration(g.ms).padStart(DUR_COLS)}`}</Text>
            </Text>
          ))
        )}
        {receiptLine}
      </Box>
    ) : receiptLine ? (
      <Box flexShrink={0} marginTop={1}>
        {receiptLine}
      </Box>
    ) : null
    const mark = (a: Agent) => (viewed === a.id ? ' ◂ main view' : '')
    const counts = <Box key="counts">
      <Text dimColor>{runningCount ? `${runningCount} running` : ''}</Text>
      <Text dimColor>{runningCount && doneCount ? ' · ' : ''}</Text>
      {doneCount ? (
        <Button key="toggle-done" label={hidingDone ? `${doneCount} done (show)` : `${doneCount} done`} plain dimColor hover={{ color: 'claude', underline: true }} onPress={() => update($, hideDone, v => !v)} />
      ) : null}
    </Box>

    // Above the prompt (no fullscreen to dock in): a summary of at most INLINE_ROWS rows.
    if (inline) {
      const live = all.filter(a => a.status === 'running') // a finished parent's running children too
      const SHOW = INLINE_ROWS - 3
      const ended = (s2: string) => all.filter(a => a.status === s2).length
      const tally = ['completed', 'failed', 'killed'].map(s2 => (ended(s2) ? `${look(s2).mark} ${ended(s2)} ${look(s2).word.toLowerCase()}` : '')).filter(Boolean)
      return (
        <Box flexDirection="column" width={W}>
          {header(
            <Text>
              <Text color="claude">✻ </Text>
              <Text bold>Agents</Text>
            </Text>,
            <Box>
              {counts}
              <Text> </Text>
              <Button key="collapse" label="▾ hide" dimColor onPress={() => foldAway($)} />
            </Box>,
          )}
          {live.slice(0, SHOW).map(a => {
            const room = Math.max(10, Math.floor(W * 0.45))
            return (
              <Box key={`row-${a.id}`} width={W} justifyContent="space-between">
                <Box>
                  <Text color="claude">⏺ </Text>
                  <Button key={`agent-${a.id}`} label={fit(nameOf(a, room), room)} plain hover={{ color: 'claude', underline: true }} onPress={() => goTo(a.id)} />
                  <Text dimColor wrap="truncate-end">{act[a.id] ? `  ⎿ ${fit(act[a.id]!.text, Math.max(6, W - room - 14))}` : ''}</Text>
                </Box>
                {clock(a)}
              </Box>
            )
          })}
          {live.length > SHOW ? <Text dimColor>{`  +${live.length - SHOW} more running`}</Text> : null}
          {receiptLine ?? (tally.length || loopsLine ? <Text dimColor wrap="truncate-end">{[tally.join(' · '), loopsLine.replace('⏺ ', '')].filter(Boolean).join(' · ')}</Text> : null)}
          {shown.length ? null : <Text dimColor>No agents yet.</Text>}
        </Box>
      )
    }
    const agentBlock = (a: Agent, depth: number) => {
      const pad = '    '.repeat(depth)
      const l = look(a.status)
      const doing = act[a.id]
      const used = tok[a.id]
      const t = elapsed(a, now)
      const model = runsOn(a)
      const lines: RenderChildren[] = [
        <Box key={`row-${a.id}`}>
          <Text color={l.color} dimColor={l.dim}>{`${pad}⏺ `}</Text>
          <Button key={`agent-${a.id}`} label={fit(nameOf(a, W), W - cols(pad) - 2 - cols(mark(a)))} plain hover={{ color: 'claude', underline: true }} onPress={() => goTo(a.id)} />
          <Text color="claude">{mark(a)}</Text>
        </Box>,
      ]
      if (a.status === 'running') {
        if (doing) {
          lines.push(<Text dimColor wrap="truncate-end">{`${pad}  ⎿  ${fit(doing.text, W)}`}</Text>)
          if (doing.tools > 1) lines.push(<Text dimColor>{`${pad}     +${doing.tools - 1} more tool use${doing.tools === 2 ? '' : 's'}`}</Text>)
        }
        lines.push(liveLine(a, pad, [model, used ? `${fmtTokens(used.input)} in` : '', used ? `${fmtTokens(used.output)} out` : ''].filter(Boolean).join(' · ')))
      } else {
        const detail = [doing ? uses(doing.tools) : '', used ? `${fmtTokens(used.input + used.output)} tokens` : '', model, t].filter(Boolean).join(' · ')
        lines.push(
          <Text wrap="truncate-end">
            <Text color={a.status === 'failed' ? 'error' : undefined} dimColor={a.status !== 'failed'}>{`${pad}  ⎿  ${l.word}${detail ? ` (${detail})` : ''}`}</Text>
            {alertOf(a) ? <Text color="error">{` · ${alertOf(a)}`}</Text> : null}
          </Text>,
        )
      }
      return lines
    }
    const group = ({ agent: a, kids }: { agent: Agent; kids: { agent: Agent; depth: number }[] }) => (
      <Box flexDirection="column" marginTop={1}>
        {agentBlock(a, 0)}
        {kids.flatMap(k => agentBlock(k.agent, k.depth))}
      </Box>
    )
    return withHandle(
      <Box flexDirection="column" height={rows} justifyContent="space-between">
        <Box flexDirection="column" flexShrink={1} overflow="hidden">
          {header(
            <Text>
              <Text color="claude">✻ </Text>
              <Text bold>Agents</Text>
            </Text>,
            counts,
          )}
          {shown.length ? null : <Text dimColor>No agents yet. They show here while they run.</Text>}
          {running.map(group)}
          {finished.map(group)}
          {loopsLine ? (
            <Box marginTop={1}>
              <Text dimColor wrap="truncate-end">{loopsLine}</Text>
            </Box>
          ) : null}
        </Box>
        <Box flexDirection="column" flexShrink={0}>
          {axis}
          {hint(shown.length ? `click an agent to open it${doneCount ? ' · click "done" to hide finished ones' : ''}` : '')}
        </Box>
      </Box>,
    )
  })

  // Folded: a tab at the right edge above the prompt, with the agents' counts, brings the pane back.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    isFullscreen = e.viewport?.isFullscreen ?? isFullscreen
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    // What the plugins beneath drew stays. Never hand the band itself back: it would not be drawn again
    // when the tab comes or goes.
    const below = await next(e).catch(() => null)
    if (!(await read($, tab))) return <Box flexDirection="column">{below}</Box>
    const all = await read($, agents)
    const count = (s: string) => all.filter(a => a.status === s).length
    const running = count('running')
    const label = [
      '◂ Agents',
      running ? `${look('running').mark} ${running}` : '',
      ...['completed', 'failed', 'killed'].map(s => (count(s) ? `${look(s).mark} ${count(s)}` : '')),
    ].filter(Boolean).join(' ')
    return (
      <Box flexDirection="column">
        {below}
        <Box justifyContent="flex-end" paddingRight={BAND_RIGHT_PAD}>
          <Button key="agents-tab" label={label} dimColor onPress={() => unfold($)} />
        </Box>
      </Box>
    )
  })
}
