# quantFoot: agent workflow

Default for every Claude chat in this workspace (set 2026-11-01, overrides earlier "edit ws root directly" instructions):

1. Before working, `git fetch local`. Create a new chat-branch from `local/master` if it exists, else from local `master` (never `origin/master`); on an existing chat-branch, fast-forward to `local/claude/<topic>` if it is ahead.
2. Work in your own git worktree under `.claude/worktrees/<name>` on a chat-branch `claude/<topic>`.
3. Commit at least once per resolved prompt, more often when useful.
4. After every commit, `git push local <branch>` (no `-u`: the sandbox blocks writes to `.git/config`).
5. For a distinct piece of work, branch a feature branch off the chat-branch (`claude/<topic>-<feature>`), test it, merge it into the chat-branch, delete it.
6. Never push to `origin`, never push or merge into `master`, never edit the ws root checkout: the user does merges there.
7. Don't run the game; tests bind port 0 on loopback.

Remotes: `origin` is GitHub over ssh (unreachable from the sandbox); `local` is `/home/ppc/dev/barerepos/quantFoot.git`.
