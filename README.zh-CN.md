<div align="center">

# agentpane

**在对话旁边看着你的 subagent 干活。**<br>
Claude Code 会话派出的每个 subagent、它此刻在做什么、用了多少 token，点一下就能看它的完整对话。

[![Version](https://img.shields.io/badge/version-1.1.1-d77757.svg)](https://github.com/xuanji86/claude-agentpane/releases)
[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-c678dd.svg)](https://code.claude.com/docs/en/plugins/mods/overview)
[![License: MIT](https://img.shields.io/badge/license-MIT-4eba65.svg)](LICENSE)

[English](README.md) · **中文**（界面为英文）

<img src="assets/pane.svg" alt="对话旁边的 Agents 面板" width="760">

</div>

## 为什么做这个

Claude 把活分给 subagent 时，终端里每个 agent 只有一行，外加底部一个列表。**agentpane** 是一个 [mod](https://code.claude.com/docs/en/plugins/mods/overview)：把它们放进侧边面板，按 Claude Code 自己的写法显示，点开就能在原地看每个 agent 的对话。

## 功能

| | |
| --- | --- |
| **实时列表** | `⏺ 类型(描述)`、正在调用的工具、`+N more tool uses`，以及 `✶ Running… (1m 12s · Opus 5.5 · 412k in · 1.9k out)`；agent 一启动就出现 |
| **嵌套 agent** | agent 自己派出的子 agent 缩进显示在它下面 |
| **token 与模型** | 每个 agent 的输入（含缓存占比）、输出、上下文大小和请求次数，取自 API 返回的用量；回复因 `max_tokens` 被截断时标红 |
| **其他模型循环** | 不属于任何已列出 agent 的模型循环（workflow 派出的 agent、压缩和记忆分支），在列表底部计数 |
| **时间轴** | 最近一批 agent 画在同一条时间轴上，每个一条：哪些同时在跑、哪个最慢，一眼可见 |
| **批次汇总** | 一批跑完后：`✓ 4 agents in 31s · 1m 18s of agent time (2.5× in parallel) · 21 tool uses · 190k tokens` |
| **状态行** | pane 折叠或关闭时，输入框下方显示 `✻ 2 of 4 agents running` |
| **跟随主视图** | 你从 Claude Code 底部列表打开的那个 agent，会标上 `◂ main view` |
| **对话** | 点开 agent：任务说明、Markdown 显示的回复、工具调用及结果，连续的调用折叠成一行 |
| **停止** | 先点 `■ Stop` 再点 `Confirm stop`，通过 Claude Code 的 TaskStop 结束运行中的 agent |
| **完成提醒** | agent 结束时弹提示，多个同时结束合成一条 |
| **自动展开/折叠** | 有 agent 启动就打开，最后一个结束 10 秒后折叠成输入框上方的标签 |
| **主题色** | 用 Claude Code 自己的主题色，深色、浅色、色盲友好主题都会跟着变 |
| **重绘轻** | 转动、流光、计时和时间轴在终端自己的帧时钟上运行，pane 只在有变化时重绘 |
| **非全屏也能用** | 没有 fullscreen 时，在输入框上方显示最多 8 行的摘要 |

## 安装

需要 **Claude Code 2.1.287 或更高版本**（mod，即函数 hooks，从这个版本开始提供）；已在 2.1.288 上测试。侧边停靠需要 fullscreen 界面（`/tui fullscreen`）；非全屏时 agentpane 显示为输入框上方的摘要。mod 目前是早期功能，接口可能随版本变化，如果新版本导致 pane 失效，这里会发修复版。

```text
/plugin marketplace add xuanji86/claude-agentpane
/plugin install agentpane@claude-agentpane
```

<details>
<summary>也可以在终端里安装</summary>

```sh
claude plugin marketplace add xuanji86/claude-agentpane
claude plugin install agentpane@claude-agentpane
```

</details>

## 使用

<table>
<tr>
<td width="60%" valign="top">

**看对话**：点一个 agent

<img src="assets/conversation.svg" alt="加宽后的 pane 里显示一个 agent 的对话" width="100%">

pane 会加宽。`▲` `▼` 翻页（`k` `j`），`←` 返回（`b`）；往回翻时 agent 继续输出，视图也不会被顶走。点折叠的工具调用组可以展开。

</td>
<td width="40%" valign="top">

**折叠**：pane 左边线上的 `▸` 把手

<img src="assets/tab.svg" alt="输入框上方的标签" width="100%">

pane 隐藏，输入框上方留一个带计数的标签，点它重新打开；有新 agent 启动时也会自动打开。

</td>
</tr>
</table>

- `/agentpane` 打开或关闭 pane。
- 点标题栏的 `3 done` 可以隐藏已完成的 agent（还在跑的子 agent 仍会显示）。
- 自动打开只发生在 Claude Code 允许"未经请求打开 pane"的宽度：至少 144 列（你手动打开过一次后降到 110 列）。更窄时用 `/agentpane` 打开。
- `b` `k` `j` 只在 pane 持有键盘时生效：打开对话时它会拿到键盘（输入框为空时），按 `Esc` 还给输入框。

## 设置

在 `/config` 里改，或写在 `settings.json` 的 `pluginConfigs["agentpane"].options` 下：

| 选项 | 默认 | 含义 |
| --- | --- | --- |
| `autoOpen` | `true` | 有 agent 启动时自动打开 pane |
| `foldAfter` | `10` | 最后一个 agent 结束多少秒后折叠；`0` 表示一直开着 |
| `motion` | `true` | 转动和流光动画；关掉后图标静止，计时照常走 |
| `toasts` | `true` | agent 结束时弹提示 |
| `keepFinished` | `8` | 列表保留多少个已完成的 agent（1–30） |
| `statusLine` | `true` | pane 不在屏幕上时，在输入框下方显示运行中的 agent |

## 它能接触到什么

agentpane 只负责看，唯一的动作是你按下 Stop。每个 hook 都原样放行事件。

| 它看到 | 通过 |
| --- | --- |
| 本会话的 agent 及其状态 | `$.agent.list()`、`agent.spawn` |
| 每个 agent 的工具调用（名称和简短参数） | `tool.call` |
| 每个 agent 的 token 用量和停止原因 | `turn.step` |
| 你打开时，该 agent 的对话记录 | `$.session.messages({ agentId })` |
| 主视图正在显示哪个 agent | pane 的 `view` |

pane 之外它只画三样东西：输入框上方的标签、完成提示，和一行状态（`$.ui.status`）。

它**不**联网、不运行外部命令、不读写文件、不跨会话保存任何东西，也不调用模型。唯一的动作是停止：在你第二次按下时调用 Claude Code 自带的 `TaskStop`，传过去的 agent 名字经过清理和截断。对话文字在显示前会去掉控制字符、双向控制符和零宽字符，并截断长度。`claude plugin validate .` 会列出它挂了哪些 hook、调用了什么。

## 哪些是推断的，不是实测的

- **开始时间** 是 pane 第一次看到这个 agent 的时间：派出时；如果 agentpane 加载时它已经在跑，则是下一次轮询时。
- **token** 从 agentpane 加载后开始统计；之前已结束的 agent 没有数字。
- **其他模型循环** 无法区分 workflow 派出的 agent 和压缩分支，两者都是"不属于任何已列出 agent 的模型循环"。
- **工具次数** 是 pane 看到的调用次数，只对它看着跑起来的 agent 显示。
- **一批** 指中间没有空闲满一分钟、接连跑起来的 agent；时间轴和汇总只算最近一批。agent 时间是各自运行时间之和，
  `2.5× in parallel` 就是这个和除以整批的实际用时。

## 限制

- **主视图归你：** mod 无法把 Claude Code 的主视图切到某个 agent，这件事交给底部 agent 列表（↓ 再 Enter）；agentpane 在 pane 里显示对话，并标出主视图正在看的那个。
- **workflow 派出的 agent** 没有名字可列：引擎不把它们交给 mod，只能在"其他模型循环"里计数。

## 排错

**pane 不出现。** 确认 `claude --version` 是 2.1.287 或更高，执行 `/reload-plugins`，再执行 `/agentpane`。终端窄于 144 列时，Claude Code 不会自动打开没人请求的 pane，`/agentpane` 在任何宽度都能打开。对话里如果有以 `agentpane:` 开头的灰色行，会写明哪个 hook 失败了或 pane 为什么被拒绝，欢迎带上它[提 issue](https://github.com/xuanji86/claude-agentpane/issues)。

**`b` `k` `j` 没反应。** pane 需要拿到键盘：在 pane 里点一下，或者在输入框为空时打开一个对话。

**动画太多。** 在 `/config` 里把 `motion` 设成 `false`。

## 开发

```sh
git clone https://github.com/xuanji86/claude-agentpane
cd claude-agentpane
claude plugin validate .
claude plugin test .
claude --plugin-dir .        # 或把目录加到 CLAUDE_CODE_PLUGIN_DIRS
```

从目录加载 mod 的会话里，每次保存文件都会自动重新加载。测试会把 pane 画在所有界面（终端、桌面、VS Code、手机）上，宽度从 40 到 120 列。`python3 assets/make_previews.py` 重新生成 README 里的图。改动记录见 [CHANGELOG.md](CHANGELOG.md)。欢迎提 issue 和 pull request。

## 许可证

[MIT](LICENSE) © Anji Xu
