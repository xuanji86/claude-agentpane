<div align="center">

# agentpane

**See your subagents at work, beside the conversation.**<br>
Every subagent a Claude Code session runs, what it is doing right now, what it costs in tokens, and its whole conversation one click away.

[![Version](https://img.shields.io/badge/version-1.0.0-d77757.svg)](https://github.com/xuanji86/claude-agentpane/releases)
[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-c678dd.svg)](https://code.claude.com/docs/en/plugins/mods/overview)
[![License: MIT](https://img.shields.io/badge/license-MIT-4eba65.svg)](LICENSE)

**English** · [中文](README.zh-CN.md)

<img src="assets/pane.svg" alt="The agents pane beside the transcript" width="760">

</div>

## Why

When Claude fans work out to subagents, the terminal shows one line per agent and a footer list. **agentpane** is a
[mod](https://code.claude.com/docs/en/plugins/mods/overview) that keeps them in a side pane, drawn the way Claude
Code draws its own rows, and opens each one's conversation in place.

## Features

| | |
| --- | --- |
| **Live list** | `⏺ Type(description)`, the tool call it runs now, `+N more tool uses`, and `✶ Running… (1m 12s · 412k in · 1.9k out)` |
| **Nested agents** | An agent's own subagents sit indented under it |
| **Tokens** | Input (cached share shown), output and context size per agent, from the API's own usage figures |
| **Conversations** | Click an agent: its brief, replies in Markdown, tool calls with their results, runs of calls folded into one line |
| **Stop** | `■ Stop`, then `Confirm stop`, ends a running agent through Claude Code's TaskStop |
| **Notices** | A toast when an agent finishes, one for several at once |
| **Opens and folds itself** | Opens when an agent starts, folds 10 s after the last one ends, to a tab above the prompt |
| **Theme colours** | Claude Code's own theme keys: follows dark, light and colourblind themes |

## Install

Needs a Claude Code build with mods (function hooks), and the fullscreen layout (`/tui fullscreen`) for a side pane.

```text
/plugin marketplace add xuanji86/claude-agentpane
/plugin install agentpane@claude-agentpane
```

<details>
<summary>From a terminal instead</summary>

```sh
claude plugin marketplace add xuanji86/claude-agentpane
claude plugin install agentpane@claude-agentpane
```

</details>

## Use

<table>
<tr>
<td width="60%" valign="top">

**A conversation** — click an agent

<img src="assets/conversation.svg" alt="One agent's conversation in the widened pane" width="100%">

The pane widens to read it. `▲` `▼` step through it (`k` `j`), `←` goes back (`b`); scrolled back, the view holds
still while the agent writes on. Click a folded run of tool calls to open it.

</td>
<td width="40%" valign="top">

**Folded** — the `▸` handle on the pane's left edge

<img src="assets/tab.svg" alt="The tab above the prompt" width="100%">

The pane hides and a tab above the prompt keeps the counts. Click it to bring the pane back; a new agent brings it back by itself.

</td>
</tr>
</table>

- `/agentpane` opens or closes the pane.
- `3 done` in the header hides the finished agents (their running children stay in sight).
- The pane opens unasked only where it can dock: a fullscreen terminal at least 144 columns wide (110 once you have opened it yourself).

## Limits

- **The main view stays yours.** A mod cannot switch Claude Code's main view to an agent; the footer's agent list
  (↓ then Enter) does that. agentpane shows the conversation in the pane instead.
- **Workflow agents** are not listed: the engine does not hand them to mods.
- **Token figures** start when agentpane loads; agents that finished before then show none.
- The keys `b` `k` `j` work while the pane holds the keyboard: it takes it when you open a conversation (over an empty
  prompt), `Esc` gives it back.

## Privacy and safety

Everything stays on your machine: agentpane reads the session's own agent list, tool calls, token usage and
transcripts, and makes no network calls. Text from transcripts is stripped of control, bidi and zero-width
characters and cut to length before it is drawn. Stop runs only on your second press, naming the agent in a
cleaned, shortened line.

## Develop

```sh
git clone https://github.com/xuanji86/claude-agentpane
cd claude-agentpane
claude plugin validate .
claude plugin test .
claude --plugin-dir .        # or add the folder to CLAUDE_CODE_PLUGIN_DIRS
```

A session that loaded the mod from its folder reloads it each time you save a file. `python3 assets/make_previews.py`
redraws the README pictures. Issues and pull requests are welcome.

## License

[MIT](LICENSE) © Anji Xu
