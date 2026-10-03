<div align="center">

# agentpane

**在对话旁边看着你的 subagent 干活。**<br>
Claude Code 会话派出的每个 subagent、它此刻在做什么、用了多少 token，点一下就能看它的完整对话。

[![Version](https://img.shields.io/badge/version-1.0.0-d77757.svg)](https://github.com/xuanji86/claude-agentpane/releases)
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
| **实时列表** | `⏺ 类型(描述)`、正在调用的工具、`+N more tool uses`，以及 `✶ Running… (1m 12s · 412k in · 1.9k out)` |
| **嵌套 agent** | agent 自己派出的子 agent 缩进显示在它下面 |
| **token** | 每个 agent 的输入（含缓存占比）、输出和上下文大小，取自 API 返回的用量 |
| **对话** | 点开 agent：任务说明、Markdown 显示的回复、工具调用及结果，连续的调用折叠成一行 |
| **停止** | 先点 `■ Stop` 再点 `Confirm stop`，通过 Claude Code 的 TaskStop 结束运行中的 agent |
| **完成提醒** | agent 结束时弹提示，多个同时结束合成一条 |
| **自动展开/折叠** | 有 agent 启动就打开，最后一个结束 10 秒后折叠成输入框上方的标签 |
| **主题色** | 用 Claude Code 自己的主题色，深色、浅色、色盲友好主题都会跟着变 |

## 安装

需要 **Claude Code 2.1.287 或更高版本**（mod，即函数 hooks，从这个版本开始提供）；已在 2.1.288 上测试。侧边停靠需要 fullscreen 界面（`/tui fullscreen`）。mod 目前是早期功能，接口可能随版本变化，如果新版本导致 pane 失效，这里会发修复版。

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
- 自动打开只发生在能停靠的地方：fullscreen 终端至少 144 列（你手动打开过一次后降到 110 列）。

## 限制

- **主视图归你：** mod 无法把 Claude Code 的主视图切到某个 agent，这件事交给底部 agent 列表（↓ 再 Enter）；agentpane 在 pane 里显示对话。
- **workflow 派出的 agent** 不会列出：引擎不把它们交给 mod。
- **token 数字** 从 agentpane 加载后开始统计，之前已结束的 agent 没有数字。
- `b` `k` `j` 只在 pane 持有键盘时生效：打开对话时它会拿到键盘（输入框为空时），按 `Esc` 还给输入框。

## 隐私与安全

所有数据都留在本机：agentpane 只读取本会话自己的 agent 列表、工具调用、token 用量和对话记录，不联网。对话文字在显示前会去掉控制字符、双向控制符和零宽字符，并截断长度。停止只在你第二次按下时执行，传给 TaskStop 的 agent 名字经过清理和截断。

## 开发

```sh
git clone https://github.com/xuanji86/claude-agentpane
cd claude-agentpane
claude plugin validate .
claude plugin test .
claude --plugin-dir .        # 或把目录加到 CLAUDE_CODE_PLUGIN_DIRS
```

从目录加载 mod 的会话里，每次保存文件都会自动重新加载。`python3 assets/make_previews.py` 重新生成 README 里的图。欢迎提 issue 和 pull request。

## 许可证

[MIT](LICENSE) © Anji Xu
