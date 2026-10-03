import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { addUsage, arrange, batchReceipt, finishNotice, clean, cols, describeTool, fmtTokens, latestBatch, statusOf, groupSummary, mergeAgents, parseConfig, pickBlocks, prettyModel, preview, spawned, stepLoop, toolParts, transcriptBlocks, visibleAgents, wrap } from './register'
import type { Block } from './register'
import { fmtDuration, laneRows } from './time'

const info = (id: string, status = 'running', parentId?: string) => ({ id, description: `task ${id}`, type: 'Explore', status, ...(parentId && { parentId }) })
const say = (role: 'user' | 'assistant', text: string, toolUses: SessionMessage['toolUses'] = []): SessionMessage => ({ role, text, toolUses })

describe('agents', () => {
  test('first seen and end times carry over from what the pane knew', async () => {
    const one = mergeAgents([], [info('a'), info('b', 'completed')], 1_000)
    expect(one.map(a => [a.id, a.firstSeen, a.seenRunning, a.endedAt])).toEqual([['a', 1_000, true, undefined], ['b', 1_000, false, undefined]])
    const two = mergeAgents(one, [info('a', 'completed'), info('b', 'completed')], 5_000)
    expect(two[0]).toMatchObject({ firstSeen: 1_000, endedAt: 5_000, status: 'completed' })
    expect(mergeAgents(two, [info('a', 'completed')], 9_000)[0]?.endedAt).toBe(5_000)
    expect(mergeAgents(two, [info('a')], 600_000)[0]).toMatchObject({ firstSeen: 600_000, status: 'running' }) // resumed: a new run
    expect(mergeAgents(two, [info('a')], 600_000)[0]?.endedAt).toBeUndefined()
  })
  test('the list keeps every running agent and the eight that finished last, by when they ended', async () => {
    let all = mergeAgents([], [info('long'), ...Array.from({ length: 9 }, (_, i) => info(`s${i}`))], 0)
    all = mergeAgents(all, [info('long'), ...Array.from({ length: 9 }, (_, i) => info(`s${i}`, 'completed'))], 1_000)
    all = mergeAgents(all, [info('long', 'completed'), ...Array.from({ length: 9 }, (_, i) => info(`s${i}`, 'completed'))], 2_000)
    const shown = visibleAgents(all).map(a => a.id)
    expect(shown.length).toBe(8)
    expect(shown).toContain('long') // the last to end, though the first to start
  })
  test('agents group under their parents; hiding finished ones lifts their running children out', async () => {
    const all = mergeAgents([], [info('done', 'completed'), info('p'), info('c', 'completed', 'p'), info('g', 'running', 'c'), info('orphan', 'running', 'gone'), info('q', 'completed'), info('r', 'running', 'q')], 0)
    const both = arrange(visibleAgents(all))
    expect(both.running.map(t => [t.agent.id, t.kids.map(k => `${k.agent.id}:${k.depth}`)])).toEqual([['p', ['c:1', 'g:2']], ['orphan', []]])
    expect(both.finished.map(t => [t.agent.id, t.kids.map(k => k.agent.id)])).toEqual([['done', []], ['q', ['r']]])
    const live = arrange(visibleAgents(all), true)
    expect(live.running.map(t => t.agent.id)).toEqual(['p', 'g', 'orphan', 'r'])
    expect(live.finished).toEqual([])
  })
  test('tool calls read in a few words', async () => {
    expect(describeTool('Bash', { command: 'npm test\n  --watch' })).toBe('Bash(npm test --watch)')
    expect(describeTool('Read', { file_path: '/a/b/register.tsx' })).toBe('Read(register.tsx)')
    expect(describeTool('Grep', { pattern: 'TODO' })).toBe('Grep(TODO)')
    expect(describeTool('mcp__github__list_issues', {})).toBe('github:list_issues')
    expect(describeTool('TodoWrite', { todos: [] })).toBe('TodoWrite')
  })
  test('token use sums over an agent\'s responses; context is the latest request', async () => {
    const one = addUsage(undefined, { input_tokens: 100, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 2_000, output_tokens: 300 })
    const two = addUsage(one, { input_tokens: 20, cache_read_input_tokens: 52_000, cache_creation_input_tokens: 500, output_tokens: 80 })
    expect(two).toEqual({ input: 104_620, cached: 102_000, output: 380, context: 52_600, requests: 2 })
    expect([fmtTokens(950), fmtTokens(12_345), fmtTokens(99_960), fmtTokens(312_400), fmtTokens(999_800), fmtTokens(1_240_000)]).toEqual(['950', '12.3k', '100k', '312k', '1M', '1.2M'])
  })
  test('finishing agents make one toast: by name when alone, counted when several', async () => {
    const before = mergeAgents([], [info('a'), info('b'), info('c', 'completed')], 0)
    expect(finishNotice(before, mergeAgents(before, [info('a'), info('b'), info('c', 'completed')], 5_000), 5_000)).toBeNull()
    const one = mergeAgents(before, [info('a', 'failed'), info('b'), info('c', 'completed')], 5_000)
    expect(finishNotice(before, one, 5_000)).toBe('Explore(task a) ✗ failed · 5s')
    const two = mergeAgents(before, [info('a', 'completed'), info('b', 'failed'), info('c', 'completed')], 5_000)
    expect(finishNotice(before, two, 5_000)).toBe('✓ 2 agents finished · ✗ 1 failed')
  })
  test('durations read as Claude Code writes them', async () => {
    expect([fmtDuration(5_000), fmtDuration(80_000), fmtDuration(725_000), fmtDuration(3_725_000)]).toEqual(['5s', '1m 20s', '12m 5s', '1h 2m'])
  })
  test('model ids read as their names', async () => {
    expect([prettyModel('claude-sonnet-5-5'), prettyModel('claude-haiku-4-5-20251001'), prettyModel('claude-opus-5-5[1m]'), prettyModel('sonnet'), prettyModel(undefined)]).toEqual(['Sonnet 5.5', 'Haiku 4.5', 'Opus 5.5 (1M)', 'sonnet', ''])
  })
  test('settings fall back to their defaults and stay in range', async () => {
    expect(parseConfig(undefined)).toEqual({ autoOpen: true, foldAfterMs: 10_000, motion: true, toasts: true, keepFinished: 8, statusLine: true })
    expect(parseConfig({ autoOpen: false, foldAfter: 0, keepFinished: 99, motion: 'no', statusLine: false })).toEqual({ autoOpen: false, foldAfterMs: 0, motion: true, toasts: true, keepFinished: 30, statusLine: false })
  })
  test('the latest batch begins after a quiet minute, and a running agent holds it open', async () => {
    const ran = (id: string, firstSeen: number, endedAt?: number, status = 'completed') =>
      ({ id, description: id, type: 'Explore', status, firstSeen, seenRunning: true, ...(endedAt !== undefined && { endedAt }) })
    const ids = (list: { id: string }[]) => list.map(a => a.id)
    expect(ids(latestBatch([ran('old', 0, 10_000), ran('a', 100_000, 130_000), ran('b', 120_000, 200_000), ran('c', 250_000, 260_000)]))).toEqual(['a', 'b', 'c'])
    expect(ids(latestBatch([ran('long', 0, undefined, 'running'), ran('late', 500_000, 510_000)]))).toEqual(['long', 'late'])
    expect(ids(latestBatch([{ ...ran('seen-done', 0, 1_000), seenRunning: false }, ran('a', 2_000, 3_000)]))).toEqual(['a'])
  })
  test('a finished batch says how long it took, how much ran side by side and what it used', async () => {
    const ran = (id: string, firstSeen: number, endedAt: number, status = 'completed') => ({ id, description: id, type: 'Explore', status, firstSeen, seenRunning: true, endedAt })
    const batch = [ran('a', 0, 20_000), ran('b', 0, 30_000), ran('c', 10_000, 30_000)]
    const act = { a: { text: 'Read(x)', tools: 3 }, b: { text: 'Bash(ls)', tools: 2 } }
    const tok = { a: { input: 1_000, cached: 0, output: 500, context: 1_500, requests: 1 } }
    expect(batchReceipt(batch, act, tok)).toEqual({ failed: false, text: '3 agents in 30s · 1m 10s of agent time (2.3× in parallel) · 5 tool uses · 1.5k tokens' })
    expect(batchReceipt([ran('a', 0, 20_000), ran('b', 0, 30_000, 'failed')], {}, {})).toEqual({ failed: true, text: '1 done · 1 failed in 30s · 50s of agent time (1.7× in parallel)' })
    expect(batchReceipt([ran('a', 0, 10_000), ran('b', 10_000, 20_000)], {}, {})?.text).toBe('2 agents in 20s · 20s of agent time') // one after the other
    expect(batchReceipt([ran('parent', 0, 100_000), { ...ran('child', 5_000, 95_000), parentId: 'parent' }, ran('other', 0, 100_000)], {}, {})?.text)
      .toBe('3 agents in 1m 40s · 3m 20s of agent time (2.0× in parallel)') // the child runs inside its parent's time
    expect(batchReceipt([ran('a', 0, 10_000), ran('b', 0, 10_000, 'paused')], {}, {})?.text).toBe('1 done · 1 paused in 10s · 20s of agent time (2.0× in parallel)')
    expect(batchReceipt([ran('a', 0, 10_000)], {}, {})).toBeNull()
    expect(batchReceipt([ran('a', 0, 10_000), { ...ran('b', 0, 0), status: 'running' }], {}, {})).toBeNull()
  })
  test('the status line counts the batch while it runs, and clears when it is done', async () => {
    const a = (id: string, status: string) => ({ id, description: id, type: 'Explore', status, firstSeen: 0, seenRunning: true })
    expect(statusOf([a('r', 'running')])).toBe('✻ 1 agent running')
    expect(statusOf([a('r', 'running'), a('s', 'running'), a('d', 'completed'), a('f', 'failed')])).toBe('✻ 2 of 4 agents running · ✗ 1 failed')
    expect(statusOf([a('d', 'completed')])).toBeUndefined()
  })
  test('lanes share one axis, to now while one runs and to the last end once all have ended', async () => {
    const lane = (from: number, to: number | null) => ({ name: 'x', mark: '✓', color: '', dim: false, from, to })
    expect(laneRows([lane(0, 10_000), lane(5_000, null)], 20_000, 20)).toEqual([
      { before: 0, bar: 10, after: 10, ms: 10_000 },
      { before: 5, bar: 15, after: 0, ms: 15_000 },
    ])
    expect(laneRows([lane(0, 10_000), lane(5_000, 20_000)], 90_000, 20).map(g => g.after)).toEqual([10, 0]) // not stretched to now
    expect(laneRows([lane(0, 20_000), lane(20_000, 20_000)], 20_000, 20)[1]).toEqual({ before: 19, bar: 1, after: 0, ms: 0 }) // never empty
    expect(laneRows([], 0, 20)).toEqual([])
  })
  test('a spawn is listed at once, keeps its model past the next poll, and waits a moment for the list', async () => {
    const a = { id: 'n', description: 'new', type: 'Explore', status: 'running', firstSeen: 0, seenRunning: true, model: 'claude-sonnet-5-5' }
    const listed = spawned([], a)
    expect(mergeAgents(listed, [], 5_000).map(x => x.id)).toEqual(['n']) // the engine's list has not caught up
    expect(mergeAgents(listed, [], 20_000)).toEqual([]) // nor ever did
    expect(mergeAgents(listed, [info('n')], 2_000)[0]?.model).toBe('claude-sonnet-5-5')
  })
  test('loops no agent claims are counted by request', async () => {
    expect(stepLoop(stepLoop({}, 'w', 1), 'w', 5)).toEqual({ w: { firstSeen: 1, lastSeen: 5, requests: 2 } })
  })
  test('responses cut at the output limit are counted', async () => {
    const u = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    expect(addUsage(addUsage(undefined, u, 'max_tokens'), u, 'end_turn').truncated).toBe(1)
    expect(addUsage(undefined, u, 'end_turn')).not.toHaveProperty('truncated')
  })
})

describe('transcript', () => {
  test('wrapping breaks at spaces and counts wide characters as two', async () => {
    expect(wrap('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps'])
    expect(wrap('x'.repeat(20), 8)).toEqual(['xxxxxxxx', 'xxxxxxxx', 'xxxx'])
    expect(wrap('中文字符测试', 8).every(r => cols(r) <= 8)).toBe(true)
  })
  test('injected reminders, controls and bidi marks are left out', async () => {
    expect(clean('a<system-reminder>secret</system-reminder>b\u001b[31m‮')).toBe('ab[31m')
  })
  test('a conversation reads as its brief, replies, and each run of tool calls as one group', async () => {
    const msgs = [
      say('user', 'Find every mod example.'),
      say('assistant', 'Looking.', [
        { tool_use_id: '1', tool: 'Glob', input: { pattern: '**/*.tsx' }, text: 'a.tsx\nb.tsx' },
        { tool_use_id: '2', tool: 'Read', input: { file_path: '/x/a.tsx' }, text: 'nope', isError: true },
      ]),
      say('user', ''),
      say('assistant', '', [{ tool_use_id: '3', tool: 'Bash', input: { command: 'ls' } }]),
      say('assistant', 'Found **two**.'),
    ]
    const blocks = transcriptBlocks(msgs)
    expect(blocks.map(b => b.kind)).toEqual(['prompt', 'reply', 'tools', 'reply'])
    const group = blocks[2]
    expect(group?.kind === 'tools' && group.key).toBe('1')
    expect(group?.kind === 'tools' && group.calls.map(c => [c.name, c.arg, c.state, c.result])).toEqual([
      ['Glob', '**/*.tsx', 'ok', ['a.tsx', 'b.tsx']],
      ['Read', 'a.tsx', 'error', ['nope']],
      ['Bash', 'ls', 'running', []],
    ])
    expect(group?.kind === 'tools' && groupSummary(group.calls)).toBe('Searched for 1 pattern, read 1 file, ran 1 command')
    expect(groupSummary([...(group?.kind === 'tools' ? group.calls.slice(1) : []), ...(group?.kind === 'tools' ? group.calls.slice(2) : []), { id: 'x', name: 'github:list', arg: '', state: 'ok', result: [], more: 0 }])).toBe('Read 1 file, ran 2 commands, called github:list')
  })
  test('a call an ended agent never answered reads as interrupted, not running', async () => {
    const msgs = [say('assistant', '', [{ tool_use_id: '1', tool: 'Bash', input: { command: 'sleep 99' } }])]
    expect(transcriptBlocks(msgs).map(b => b.kind === 'tools' && b.calls[0]?.state)).toEqual(['running'])
    expect(transcriptBlocks(msgs, true).map(b => b.kind === 'tools' && b.calls[0]?.state)).toEqual(['stopped'])
  })
  test('arguments and result lines are cut to length, so no drawn text nears the engine\'s limit', async () => {
    expect(toolParts('Bash', { command: 'x'.repeat(20_000) }).arg.length).toBeLessThanOrEqual(300)
    expect(preview('y'.repeat(20_000)).result[0]!.length).toBeLessThanOrEqual(500)
  })
  test('the blocks drawn stay within the count and the text budget, newest when live, from the top when scrolled', async () => {
    const reply = (n: number): Block => ({ kind: 'reply', text: `${n} ${'z'.repeat(5_000)}` })
    const blocks = Array.from({ length: 30 }, (_, i) => reply(i))
    const live = pickBlocks(blocks, null)
    expect(live.at(-1)).toBe(blocks[29])
    expect(live.length).toBeLessThan(15) // 30 × 5k is over the 60k budget
    const back = pickBlocks(blocks, 3)
    expect(back[0]).toBe(blocks[3])
    expect(pickBlocks([{ kind: 'reply', text: 'q'.repeat(200_000) }], null).length).toBe(1) // one always shows
  })
  test('a result previews its first three non-empty lines', async () => {
    expect(preview('a\n\nb\nc\nd\ne')).toEqual({ result: ['a', 'b', 'c'], more: 2 })
    expect(preview('')).toEqual({ result: [], more: 0 })
  })
})
