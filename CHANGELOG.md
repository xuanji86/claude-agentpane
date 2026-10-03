# Changelog

## 1.1.3 — 2026-10-03

- **Effort stays shown:** 1.1.2 recorded an agent's thinking effort, but the once-a-second list sync rebuilt the record
  without it, so it vanished within a second; the sync now keeps it, like the model.

## 1.1.2 — 2026-10-03

- **Model and effort from the requests:** each agent shows the model and thinking effort its requests actually use
  (`Opus 5.5 (1M) · xhigh`), so an agent spawned without a model (a forked skill such as `/code-review`, an inherited
  model) shows one too, and a spawn alias (`sonnet`) reads as the real model.

## 1.1.1 — 2026-10-03

- **Unfolds again:** a new agent unfolds a pane that folded after the last batch (1.1.0 listed agents at spawn, so none
  looked new), including one spawned while the list was being read.
- An opened run of hundreds of tool calls draws its newest 40 with `… +N earlier calls`, instead of making the engine
  refuse the whole pane.
- An agent's model is kept when it spawns during a sync; with `autoOpen` off, a pane folded by hand stays folded.
- Above the prompt, a running child of a finished parent has its row; a conversation left on an agent no longer listed
  goes back to the list, so the pane can fold; the status line shows while another pane covers this one.
- A tool result's preview reads only its first 8 KB; Stop's consent names the agent by type and id only.

## 1.1.0 — 2026-10-02

- **Light on redraws:** the spinner, the shimmer on `Running…` and every clock run in a surface module (`hooks/live.tsx`)
  on the terminal's own frame clock; the pane no longer redraws five times a second.
- **Listed at spawn:** an agent shows the moment it starts (`agent.spawn`), with the model it runs on.
- **Model, requests and `max_tokens`:** each agent shows its model; its conversation shows its request count; a response
  cut off at the output limit is flagged in red.
- **Other model loops:** loops no listed agent claims (a workflow's agents, compaction and memory forks) are counted
  under the list.
- **Follows the main view:** the agent the main view shows is marked `◂ main view`.
- **Timeline:** the latest batch of agents on one time axis, a bar each, growing on the surface's clock (`hooks/lanes.tsx`).
- **Batch receipt:** once a batch ends, one line: how long it took, its agent time and how much ran in parallel, tool uses
  and tokens.
- **Status line:** `✻ 2 of 4 agents running` under the prompt while the pane is folded or closed (`statusLine`).
- **Main screen:** without fullscreen, a summary of up to eight rows above the prompt, with `▾ hide`.
- **Settings in `/config`:** `autoOpen`, `foldAfter`, `motion`, `toasts`, `keepFinished`, `statusLine`.
- VS Code and mobile, which have no surface modules, draw the live lines and the timeline still instead of blank.
- README: what the mod can reach, what is inferred, settings and troubleshooting. Tests draw the pane on every surface
  at 40–120 columns.

## 1.0.0 — 2026-10-02

First release: the live list of subagents with tokens, each one's conversation in the pane, Stop, finish toasts,
auto-open and fold to a tab above the prompt.
