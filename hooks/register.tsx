import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, RenderChildren, RenderElement, SessionMessage, TurnUsage } from 'claude-code'

import type { AgentpaneAgent as Agent, AgentpaneTokens as Tokens } from '../types'

const PANE = 'agents'
const TITLE = 'Agents'
// lazy: polls the engine's agent list every second, as no agent-status event reaches a mod; move to one if it lands.
const SYNC_MS = 1_000
const FRAME_MS = 200 // the list's spinners and shimmer, only while it shows a running agent
const FOLD_AFTER_MS = 10_000 // the pane folds away this long after the last agent finished
const CONFIRM_MS = 5_000 // a pressed Stop waits this long for the press that confirms it
const MAX_FINISHED = 8
const PROMPT_LINES = 4 // a prompt is the agent's brief: its head is enough
const PREVIEW_LINES = 3 // of a tool's result
const MAX_BLOCKS = 40 // of a conversation, drawn at most
// The engine refuses a tree with a text over 10,000 characters, or over 100,000 in all: stay well under.
const MAX_ARG = 300 // characters of a tool call's argument kept
const MAX_LINE = 500 // characters of one result line kept
const MAX_REPLY = 6_000 // characters of one reply drawn as Markdown
const TEXT_BUDGET = 60_000 // characters of a conversation drawn at once
const MIN_ROWS = 3

const agents = atom({ plugin: 'agentpane', key: 'agents' } as const, [])
const activity = atom({ plugin: 'agentpane', key: 'activity' } as const, {})
const viewing = atom({ plugin: 'agentpane', key: 'viewing' } as const, null)
const scrollTop = atom({ plugin: 'agentpane', key: 'scrollTop' } as const, null)
const rev = atom({ plugin: 'agentpane', key: 'rev' } as const, 0)
const tick = atom({ plugin: 'agentpane', key: 'tick' } as const, 0)
const expanded = atom({ plugin: 'agentpane', key: 'expanded' } as const, [])
const folded = atom({ plugin: 'agentpane', key: 'folded' } as const, false)
const tab = atom({ plugin: 'agentpane', key: 'tab' } as const, false)
const tokens = atom({ plugin: 'agentpane', key: 'tokens' } as const, {})
const frame = atom({ plugin: 'agentpane', key: 'frame' } as const, 0)
const confirmStop = atom({ plugin: 'agentpane', key: 'confirmStop' } as const, null)
const hideDone = atom({ plugin: 'agentpane', key: 'hideDone' } as const, false)

// Claude Code's own spinner glyphs, out and back. Colors are theme keys, so the pane follows the person's
// theme (dark, light, colorblind) as Claude Code's own rows do.
const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const WIDE_SHARE = 0.62 // of the terminal, for the pane while it shows one agent's conversation
const MIN_WIDE = 60
const HANDLE_COLS = 2 // the hide handle's column, against the pane's left edge: its glyph and one space
const RIGHT_MARGIN = 1 // matches that one space on the right, so the content sits centred
// The handle: a tab several rows tall, each row of it a press target, so a click anywhere on it lands.
const HANDLE = ['╷ ', '│ ', '▸ ', '│ ', '╵ ']
const CLOSE_MARK_COLS = 3 // the engine draws its close mark over the end of the pane's first row
const BAND_RIGHT_PAD = 5 // clear of the engine's [-] band toggle at the band's top right

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
  return list.map(info => {
    const old = prev.get(info.id)
    const running = info.status === 'running'
    const seenRunning = (old?.seenRunning ?? false) || running
    const endedAt = running ? undefined : (old?.endedAt ?? (seenRunning ? now : undefined))
    return {
      id: info.id, description: info.description, type: info.type, status: info.status,
      ...(info.name && { name: info.name }), ...(info.parentId && { parentId: info.parentId }),
      firstSeen: old?.firstSeen ?? now, seenRunning, ...(endedAt !== undefined && { endedAt }),
    }
  })
}

// What the list shows: every running agent and the most recently finished ones, in the engine's order.
export const visibleAgents = (all: readonly Agent[]): Agent[] => {
  const ended = (a: Agent, i: number) => [a.endedAt ?? a.firstSeen, i] as const
  const recent = all
    .map((a, i) => ({ a, key: ended(a, i) }))
    .filter(({ a }) => a.status !== 'running')
    .sort((x, y) => y.key[0] - x.key[0] || y.key[1] - x.key[1])
    .slice(0, MAX_FINISHED)
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

// As Claude Code's own status lines read a duration: "8s", "1m 13s", "1h 2m".
export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}
const elapsed = (a: Agent, now: number) => (a.seenRunning ? fmtDuration((a.endedAt ?? now) - a.firstSeen) : '')

// A word with a band of light across it, as Claude Code's spinner verb shimmers: runs of base or shimmer.
export const shimmer = (text: string, step: number): { text: string; lit: boolean }[] => {
  const chars = [...text]
  const at = (step % (chars.length + 6)) - 3
  const out: { text: string; lit: boolean }[] = []
  chars.forEach((ch, i) => {
    const lit = Math.abs(i - at) <= 1
    const last = out[out.length - 1]
    if (last && last.lit === lit) last.text += ch
    else out.push({ text: ch, lit })
  })
  return out
}

// One response's usage added to an agent's tally; `context` is what its latest request carried.
export const addUsage = (t: Tokens | undefined, u: Pick<TurnUsage, 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'>): Tokens => {
  const input = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return {
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
export const preview = (text: string) => {
  const lines = clean(text).split('\n').map(l => l.trimEnd()).filter(l => l.trim())
  return { result: lines.slice(0, PREVIEW_LINES).map(l => fit(l, MAX_LINE)), more: Math.max(0, lines.length - PREVIEW_LINES) }
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

// Module state that nothing draws from (a reload resets it to "nothing opened yet").
let autoOpened = false // the mod opened the pane unasked; only such a pane does the mod close for being inline
let closedByPerson = false // closed by hand while agents ran: stays shut until a new one starts
let closingItself = false // the close under way is the mod's own
let foldingAway = false // the close under way is a fold: the tab above the prompt brings the pane back
let foldWhenIdle = false // agents ran while the pane was open: fold it once they are all done
let inlineOnly = false // this surface seated an unasked pane inline: no more unasked opening
let isFullscreen: boolean | undefined // from the last drawing: only the fullscreen layout docks a pane
let lastPlacement: string | null = null
let lastColumns = 0 // the terminal's width, from the last drawing
let lastRunningAt = 0
let armedAt = 0 // when Stop was pressed once
let viewingId: string | null = null // the conversation on screen, for the events that redraw it
let transcript = { key: '', blocks: [] as Block[] } // that conversation's blocks, read once per change
let listIsLive = false // the pane shows the list with an agent running: its spinners and shimmer move
// lazy: one sync at a time by a module flag; a slow agent.list only skips ticks.
let syncing = false

// Never rejects. Keeps the list current, opens the pane when an agent starts, folds it once they are done.
async function sync($: EngineInterface) {
  if (syncing) return
  syncing = true
  try {
    const now = await $.clock.now()
    const before = await read($, agents)
    const list = mergeAgents(before, await $.agent.list(), now)
    if (JSON.stringify(list) !== JSON.stringify(before)) await update($, agents, () => list)
    const notice = finishNotice(before, list, now)
    if (notice) $.ui.toast(notice)
    const ids = new Set(list.map(a => a.id))
    if (Object.keys(await read($, activity)).some(id => !ids.has(id)))
      await update($, activity, m => Object.fromEntries(Object.entries(m).filter(([id]) => ids.has(id))))
    if (Object.keys(await read($, tokens)).some(id => !ids.has(id)))
      await update($, tokens, m => Object.fromEntries(Object.entries(m).filter(([id]) => ids.has(id))))

    const running = list.filter(a => a.status === 'running')
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    // A new agent unfolds the pane, whoever folded or closed it, and shows the list.
    if (running.some(a => !before.some(b => b.id === a.id))) {
      closedByPerson = false
      if (!pane) await showList($, { clearFold: true })
    }
    if (running.length) lastRunningAt = now
    if (pane && running.length) foldWhenIdle = true
    if (pane && autoOpened && lastPlacement === 'inline') {
      inlineOnly = true // not a sidebar here: leave the opening to the person
      await closeItself($)
    } else if (!pane && running.length && !closedByPerson && !inlineOnly && isFullscreen !== false && !(await read($, folded))) {
      autoOpened = true
      await openPane($, false)
    } else if (pane && foldWhenIdle && !running.length && now - lastRunningAt >= FOLD_AFTER_MS && !pane.isFocused && !(await read($, viewing))) {
      await foldAway($) // all done; not while the person reads a conversation
    }
    // Folded, the tab above the prompt stands in for the pane while the session has agents to show.
    const showTab = (await read($, folded)) && list.length > 0
    if (showTab !== (await read($, tab))) await update($, tab, () => showTab)
    if ((pane || showTab) && running.length) await update($, tick, n => n + 1) // the clocks run
    listIsLive = !!pane && running.length > 0 && !(await read($, viewing))
    if ((await read($, confirmStop)) && now - armedAt > CONFIRM_MS) await update($, confirmStop, () => null)
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

// The pane at its usual width, or widened to read one agent's conversation (docked only).
// `focus` asks for the keyboard (granted over an empty composer), so the conversation's b/k/j keys work.
async function openPane($: EngineInterface, wide: boolean, focus = false) {
  const columns = wide && lastPlacement === 'dock' && lastColumns ? Math.max(MIN_WIDE, Math.round(lastColumns * WIDE_SHARE)) : undefined
  await $.ui.open({ id: PANE, title: TITLE, ...(columns && { columns }), ...(focus && { focus: true as const }) })
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
  await openPane($, !!(await read($, viewing)))
}

// Stop a running agent with Claude Code's own TaskStop, on the person's confirmed press of Stop.
async function stopAgent($: EngineInterface, a: Agent) {
  const name = nameOf(a)
  const done = (await $.tool
    .call({ tool: 'TaskStop', task_id: a.id, consent: `The user pressed "Stop" on ${name} in the agents pane` } as never)
    .catch((err: unknown) => ({ deny: String(err) }))) as { deny?: string; isError?: boolean; text?: string }
  const why = done.deny || (done.isError ? oneLine(String(done.text ?? '')) || 'the tool reported an error' : '')
  if (why) $.ui.toast(`Could not stop ${name}: ${fit(why, 120)}`)
}

async function closeItself($: EngineInterface) {
  closingItself = true
  try {
    await $.ui.close({ id: PANE })
  } finally {
    closingItself = false
  }
}

// The conversation on screen changed: draw it again.
const redraw = ($: EngineInterface, agentId: string | undefined) => {
  if (agentId && agentId === viewingId) void update($, rev, n => n + 1).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agentpane', description: 'Show or hide the pane of running agents' })
    $.clock.every(SYNC_MS, () => void sync($))
    $.clock.every(FRAME_MS, () => void (listIsLive && update($, frame, n => n + 1).catch(() => undefined)))
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
    await openPane($, false, true) // asked for, so placed even where an unasked pane waits
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
        if (!closingItself) closedByPerson = (await read($, agents)).some(a => a.status === 'running')
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

  // What each agent's responses cost, as the API reported each one; a response grows its conversation.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const id = e.agentId
    const usage = result?.usage
    if (id && usage) void update($, tokens, m => ({ ...m, [id]: addUsage(m[id], usage) })).catch(() => undefined)
    redraw($, id)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    lastPlacement = e.props.placement
    lastColumns = e.viewport?.columns ?? lastColumns
    isFullscreen = e.viewport?.isFullscreen ?? isFullscreen
    const W = Math.max(22, e.props.bodyColumns - HANDLE_COLS - RIGHT_MARGIN) // the content, right of the handle
    const rows = Math.max(MIN_ROWS + 6, e.props.scroll.bodyRows)
    const now = await $.clock.now()
    const all = await read($, agents)
    const act = await read($, activity)
    const tok = await read($, tokens)
    const id = await read($, viewing)
    const docked = e.props.placement === 'dock'
    const agent = id ? all.find(a => a.id === id) : undefined
    viewingId = agent ? agent.id : null
    // The list moves at the frame rate, a conversation once a second.
    const step = agent ? await read($, tick) : await read($, frame)
    const spin = SPIN[step % SPIN.length] ?? '✻'
    const runningCount = all.filter(a => a.status === 'running').length
    const doneCount = all.length - runningCount
    const uses = (n: number) => `${n} tool use${n === 1 ? '' : 's'}`
    const hint = (text: string) => <Text dimColor wrap="truncate-end">{text}</Text>
    // The first row, clear of the engine's close mark at its end.
    const header = (left: RenderChildren, right: RenderChildren) => (
      <Box width={W - CLOSE_MARK_COLS} justifyContent="space-between">
        {left}
        {typeof right === 'string' ? <Text dimColor>{right}</Text> : right}
      </Box>
    )
    // A handle on the pane's left edge, halfway down: ▸ hides the pane.
    const withHandle = (body: RenderChildren) => (
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
      const t = elapsed(agent, now)
      const l = look(agent.status)
      const leave = async () => {
        await showList($)
        if (docked) await openPane($, false) // back to the usual width
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
                {b.calls.map(call)}
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
          agent.status !== 'running' ? (
            ''
          ) : armed === agent.id ? (
            <Button key="stop" label="Confirm stop" variant="primary" onPress={() => update($, confirmStop, () => null).then(() => stopAgent($, agent))} />
          ) : (
            <Button key="stop" label="■ Stop" dimColor onPress={arm} />
          ),
        ),
        <Text dimColor wrap="truncate-end">
          {`  ⎿  ${[l.word, act[agent.id] ? uses(act[agent.id]!.tools) : '', t].filter(Boolean).join(' · ')}`}
        </Text>,
        <Text dimColor wrap="truncate-end">
          {used
            ? `     ${fmtTokens(used.input)} in (${fmtTokens(used.cached)} cached) · ${fmtTokens(used.output)} out · context ${fmtTokens(used.context)}`
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
    const shown = visibleAgents(all)
    const hidingDone = await read($, hideDone)
    const { running, finished } = arrange(shown, hidingDone)
    const goTo = async (to: string) => {
      await showList($)
      await update($, viewing, () => to)
      await openPane($, docked, true)
    }
    const agentBlock = (a: Agent, depth: number) => {
      const pad = '    '.repeat(depth)
      const l = look(a.status)
      const doing = act[a.id]
      const used = tok[a.id]
      const t = elapsed(a, now)
      const lines: RenderChildren[] = [
        <Box key={`row-${a.id}`}>
          <Text color={l.color} dimColor={l.dim}>{`${pad}⏺ `}</Text>
          <Button key={`agent-${a.id}`} label={fit(nameOf(a, W), W - cols(pad) - 2)} plain hover={{ color: 'claude', underline: true }} onPress={() => goTo(a.id)} />
        </Box>,
      ]
      if (a.status === 'running') {
        if (doing) {
          lines.push(<Text dimColor wrap="truncate-end">{`${pad}  ⎿  ${fit(doing.text, W)}`}</Text>)
          if (doing.tools > 1) lines.push(<Text dimColor>{`${pad}     +${doing.tools - 1} more tool use${doing.tools === 2 ? '' : 's'}`}</Text>)
        }
        const detail = [t, used ? `${fmtTokens(used.input)} in` : '', used ? `${fmtTokens(used.output)} out` : ''].filter(Boolean).join(' · ')
        lines.push(
          <Text wrap="truncate-end">
            <Text color="claude">{`${pad}  ${spin} `}</Text>
            {shimmer('Running…', step).map(part => (
              <Text color={part.lit ? 'claudeShimmer' : 'claude'}>{part.text}</Text>
            ))}
            <Text dimColor>{detail ? ` (${detail})` : ''}</Text>
          </Text>,
        )
      } else {
        const detail = [doing ? uses(doing.tools) : '', used ? `${fmtTokens(used.input + used.output)} tokens` : '', t].filter(Boolean).join(' · ')
        lines.push(
          <Text color={a.status === 'failed' ? 'error' : undefined} dimColor={a.status !== 'failed'} wrap="truncate-end">
            {`${pad}  ⎿  ${l.word}${detail ? ` (${detail})` : ''}`}
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
            <Box key="counts">
              <Text dimColor>{runningCount ? `${runningCount} running` : ''}</Text>
              <Text dimColor>{runningCount && doneCount ? ' · ' : ''}</Text>
              {doneCount ? (
                <Button key="toggle-done" label={hidingDone ? `${doneCount} done (show)` : `${doneCount} done`} plain dimColor hover={{ color: 'claude', underline: true }} onPress={() => update($, hideDone, v => !v)} />
              ) : null}
            </Box>,
          )}
          {shown.length ? null : <Text dimColor>No agents yet. They show here while they run.</Text>}
          {running.map(group)}
          {finished.map(group)}
        </Box>
        {hint(shown.length ? `click an agent to open it${doneCount ? ' · click "done" to hide finished ones' : ''}` : '')}
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
    const spin = SPIN[(await read($, tick)) % SPIN.length] ?? '✻'
    const all = await read($, agents)
    const count = (s: string) => all.filter(a => a.status === s).length
    const running = count('running')
    const label = [
      '◂ Agents',
      running ? `${spin} ${running}` : '',
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
