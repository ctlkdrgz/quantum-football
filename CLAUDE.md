# quantFoot: agent workflow

Default for every Claude chat in this workspace (set 2026-11-01, overrides earlier "edit ws root directly" instructions):

1. Work in your own git worktree under `.claude/worktrees/<name>` on a chat-branch `claude/<topic>`, created from local `master` (not `origin/master`).
2. Commit at least once per resolved prompt, more often when useful.
3. For a distinct piece of work, branch a feature branch off the chat-branch (`claude/<topic>-<feature>`), test it, merge it into the chat-branch, delete it.
4. Never push, never merge into `master`, never edit the ws root checkout: the user does pulls and merges there.
5. Don't run the game; tests bind port 0 on loopback.
