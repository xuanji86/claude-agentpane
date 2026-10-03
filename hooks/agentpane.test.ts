import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { addUsage, arrange, finishNotice, clean, cols, describeTool, fmtDuration, fmtTokens, groupSummary, mergeAgents, pickBlocks, preview, shimmer, toolParts, transcriptBlocks, visibleAgents, wrap } from './register'
import type { Block } from './register'

const info = (id: string, status = 'running', parentId?: string) => ({ id, description: `task ${id}`, type: 'Explore', status, ...(parentId && { parentId }) })
const say = (role: 'user' | 'assistant', text: string, toolUses: SessionMessage['toolUses'] = []): SessionMessage => ({ role, text, toolUses })

describe('agents', () => {
  test('first seen and end times carry over from what the pane knew', async () => {
    const one = mergeAgents([], [info('a'), info('b', 'completed')], 1_000)
    expect(one.map(a => [a.id, a.firstSeen, a.seenRunning, a.endedAt])).toEqual([['a', 1_000, true, undefined], ['b', 1_000, false, undefined]])
    const two = mergeAgents(one, [info('a', 'completed'), info('b', 'completed')], 5_000)
    expect(two[0]).toMatchObject({ firstSeen: 1_000, endedAt: 5_000, status: 'completed' })
    expect(mergeAgents(two, [info('a', 'completed')], 9_000)[0]?.endedAt).toBe(5_000)
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
  test('the shimmer is a band of three letters that sweeps across the word', async () => {
    expect(shimmer('Running…', 3)).toEqual([{ text: 'Ru', lit: true }, { text: 'nning…', lit: false }])
    expect(shimmer('Running…', 6).map(p => p.lit)).toEqual([false, true, false])
    expect(shimmer('Running…', 6).map(p => p.text).join('')).toBe('Running…')
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
