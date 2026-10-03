# Security

agentpane runs inside Claude Code as a mod. It makes no network requests, runs no processes, reads and writes no
files and stores nothing across sessions. Its one action is Stop, which calls Claude Code's own `TaskStop` on your
second press. `claude plugin validate .` lists every hook and call it makes.

To report a security problem, open a [private security advisory](https://github.com/xuanji86/claude-agentpane/security/advisories/new)
rather than a public issue.
