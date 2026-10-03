# python3 assets/make_previews.py — draws the README previews of the pane in Claude Code's dark theme:
# every run placed and sized by terminal column, as a fullscreen terminal lays the pane beside the transcript.
import html, os, unicodedata

OUT = os.path.dirname(os.path.abspath(__file__))
CW, LH, FS, PAD = 8.4, 19, 14, 18
C = dict(bg='#1f1f1f', fg='#e8e8e8', dim='#8a8a8a', faint='#5c5c5c', claude='#d77757', shimmer='#eb9f7f',
         ok='#4eba65', err='#ff6b80', line='#4a4a4a')


def w(s):
    return sum(2 if unicodedata.east_asian_width(ch) in 'WF' else 1 for ch in s)


def runs(col, row, parts):
    """parts: (text, color[, bold]) laid left to right from column `col` on text row `row`."""
    out = []
    for text, color, *bold in parts:
        body = text.strip()
        if body:
            lead = len(text) - len(text.lstrip())
            x, y = PAD + (col + lead) * CW, PAD + 14 + row * LH
            b = ' font-weight="700"' if bold else ''
            out.append(f'<text x="{x:.1f}" y="{y}" fill="{C[color]}"{b} textLength="{w(body) * CW:.1f}" '
                       f'lengthAdjust="spacingAndGlyphs">{html.escape(body)}</text>')
        col += w(text)
    return out


def clip(parts, room):
    """Cut a row of parts to `room` columns, ending in an ellipsis, as the transcript wraps beside the pane."""
    out, used = [], 0
    for text, color, *bold in parts:
        if used + w(text) <= room:
            out.append((text, color, *bold))
            used += w(text)
            continue
        keep = ''
        for ch in text:
            if used + w(keep) + w(ch) > room - 1:
                break
            keep += ch
        out.append((keep + '…', color, *bold))
        break
    return out


def vline(col, row0, row1, color='line'):
    x = PAD + col * CW + CW / 2
    return f'<line x1="{x:.1f}" y1="{PAD + row0 * LH}" x2="{x:.1f}" y2="{PAD + row1 * LH}" stroke="{C[color]}" stroke-width="1.2"/>'


def hline(col0, col1, row, color='line'):
    y = PAD + row * LH + LH / 2
    return f'<line x1="{PAD + col0 * CW:.1f}" y1="{y}" x2="{PAD + col1 * CW:.1f}" y2="{y}" stroke="{C[color]}" stroke-width="1"/>'


def draw(name, cols, rows, items):
    width, height = PAD * 2 + cols * CW, PAD * 2 + rows * LH
    doc = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" '
           f'viewBox="0 0 {width:.0f} {height:.0f}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" '
           f'font-size="{FS}"><rect width="100%" height="100%" rx="10" fill="{C["bg"]}"/>' + ''.join(items) + '</svg>')
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        f.write(doc)


def scene(name, left, pane, split, cols=112, rows=24):
    """left: transcript rows; pane: rows drawn right of the divider at column `split`, after the handle."""
    items = []
    for r, parts in enumerate(left):
        items += runs(1, r, clip(parts, split - 3))
    items.append(vline(split, 0, rows - 2))
    mid = (rows - 2) // 2 - 2
    for i, g in enumerate(['╷', '│', '▸', '│', '╵']):
        items += runs(split + 1, mid + i, [(g, 'dim')])
    items += runs(cols - 2, 0, [('×', 'dim')])
    for r, parts in enumerate(pane):
        items += runs(split + 3, r, parts)
    items.append(hline(0, cols, rows - 2))
    items += runs(1, rows - 1, [('>', 'fg', 1)])
    items.append(f'<rect x="{PAD + 3 * CW:.1f}" y="{PAD + (rows - 1) * LH + 2}" width="{CW:.1f}" height="16" fill="{C["fg"]}" opacity="0.7"/>')
    draw(name, cols, rows, items)


TRANSCRIPT = [
    [('> refactor the parser and update every caller', 'fg', 1)],
    [],
    [('⏺ ', 'fg'), ("I'll split this across three agents.", 'fg')],
    [],
    [('⏺ ', 'claude'), ('Agent', 'fg', 1), ('(Refactor the parser)', 'fg')],
    [('  ⎿  ', 'dim'), ('Running in the background', 'dim')],
    [('⏺ ', 'claude'), ('Agent', 'fg', 1), ('(Find every caller of parse())', 'fg')],
    [('  ⎿  ', 'dim'), ('Running in the background', 'dim')],
    [('⏺ ', 'ok'), ('Agent', 'fg', 1), ('(Draft the migration)', 'fg')],
    [('  ⎿  ', 'dim'), ('Done (9 tool uses · 188k tokens · 2m 3s)', 'dim')],
]

LIST = [
    [('✻ ', 'claude'), ('Agents', 'fg', 1), ('               2 running · 1 done', 'dim')],
    [],
    [('⏺ ', 'claude'), ('general-purpose(Refactor the parser)', 'fg')],
    [('  ⎿  ', 'dim'), ('Bash(npm test -- parser)', 'dim')],
    [('     +6 more tool uses', 'dim')],
    [('  ✶ ', 'claude'), ('Run', 'claude'), ('nin', 'shimmer'), ('g…', 'claude'), (' (1m 12s · 412k in · 1.9k out)', 'dim')],
    [],
    [('⏺ ', 'claude'), ('Explore(Find every caller of parse())', 'fg')],
    [('  ⎿  ', 'dim'), ('Grep(parse\\()', 'dim')],
    [('     +2 more tool uses', 'dim')],
    [('  ✶ ', 'claude'), ('Running…', 'claude'), (' (24s · 61k in · 540 out)', 'dim')],
    [],
    [('⏺ ', 'ok'), ('Plan(Draft the migration)', 'fg')],
    [('  ⎿  Done (9 tool uses · 188k tokens · 2m 3s)', 'dim')],
    [], [], [], [], [], [],
    [('click an agent to open it', 'dim')],
]
scene('pane.svg', TRANSCRIPT[:8] + [[]] * 0, LIST, split=60)

CONVERSATION = [
    [('← ', 'dim'), ('⏺ ', 'claude'), ('general-purpose', 'fg', 1), ('(Refactor the parser)', 'fg'), ('     [ ■ Stop ]', 'dim')],
    [('  ⎿  Running · 7 tool uses · 1m 12s', 'dim')],
    [('     412k in (398k cached) · 1.9k out · context 64k', 'dim')],
    [],
    [('> Refactor src/parser.ts into a tokenizer and a', 'dim')],
    [('  parser, keep the public API, update the tests…', 'dim')],
    [],
    [('⏺ ', 'ok'), ('Read 3 files, ran 2 commands', 'fg'), (' (click to expand)', 'dim')],
    [],
    [('⏺ ', 'fg'), ('The tokenizer now lives in ', 'fg'), ('src/tokenize.ts', 'shimmer'), ('.', 'fg')],
    [('  The parser takes its tokens; next, the tests.', 'fg')],
    [],
    [('⏺ ', 'ok'), ('Bash', 'fg', 1), ('(npm test -- parser)', 'fg')],
    [('  ⎿  ', 'dim'), ('PASS  test/parser.test.ts (41 tests)', 'dim')],
    [('     … +3 lines', 'dim')],
    [],
    [('⏺ ', 'claude'), ('Edit', 'fg', 1), ('(callers.ts)', 'fg')],
    [('  ⎿  ', 'dim'), ('Running…', 'claude')],
    [], [],
    [],
    [('▲ ▼ ', 'dim'), ('● live', 'ok'), ('                      b back · k/j scroll', 'dim')],
]
scene('conversation.svg', TRANSCRIPT[:3], CONVERSATION, split=40)

# Folded: the tab above the prompt.
items = runs(1, 0, [('⏺ ', 'fg'), ('All three agents are done; the parser is split.', 'fg')])
items += runs(64, 2, [('[ ◂ Agents ✓ 2 ⊘ 1 ]', 'dim')]) + runs(88, 2, [('[-]', 'dim')])
items.append(hline(0, 92, 3))
items += runs(1, 4, [('>', 'fg', 1)])
items.append(f'<rect x="{PAD + 3 * CW:.1f}" y="{PAD + 4 * LH + 2}" width="{CW:.1f}" height="16" fill="{C["fg"]}" opacity="0.7"/>')
draw('tab.svg', 92, 5, items)
