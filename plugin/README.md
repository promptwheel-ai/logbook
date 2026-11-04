# logbook (Claude Code plugin)

Your repository's git history as memory, in one install: the five logbook tools through a pinned
MCP server, plus the skill that tells Claude when to read them. Everything runs on your machine
against the repository you opened. Nothing leaves it.

## Install

```
/plugin marketplace add promptwheel-ai/logbook
/plugin install logbook@logbook
```

## What you get

- **Five tools**, served by `@promptwheel/logbook-mcp@0.6.4`: `logbook_context` (the history for
  the files you are touching, newest first, in bounded pages: a deterministic order, not a relevance
  ranking), `logbook_query` (filtered events:
  reverts, weakened tests, suppressions, by file or since a date, at most 1,000 rows), `logbook_digest`
  (the whole-repo brief), `logbook_audit` (the live suppression debt still silenced in HEAD), and
  `logbook_annotate` (an unreviewed note on a commit, shown in the digest).
- **The skill** (`/logbook:logbook`, and used on its own when a repo carries a `LOGBOOK.md`): when
  to read the history before planning, diagnosing, or editing, and how to treat its entries as leads
  to verify, not conclusions. It tells Claude to use the tools above first.

The same engine powers the memory half of [Sawbuck](https://sawbuck.ai/memory) and the `logbook`
skill inside the `promptwheel` plugin. Install this one when you want the tools, not only the skill.

## What this plugin runs, writes, and sends (the full list)

**Programs it runs.** Two, both from npm, both pinned, no shell. The MCP server
`npx -y @promptwheel/logbook-mcp@0.6.4` is started by Claude Code at session start from `.mcp.json`
and runs the `@promptwheel/logbook@0.9.10` engine in process. The skill may also tell Claude to run
`npx -y @promptwheel/logbook@0.9.10 ...` through its Bash tool for the commands the tools do not
cover, under Claude Code's normal permission prompt. Both need Node 18 or newer and npm on your PATH.
On Windows outside WSL, Claude Code starts MCP servers through `cmd /c`; edit the plugin's
`.mcp.json` to `"command": "cmd", "args": ["/c", "npx", ...]` if the server does not start.

**Where it can reach.** The server answers only for repositories inside the directory it was started
in, which under Claude Code is the session's working directory, plus any roots you list in the
`LOGBOOK_MCP_ROOTS` environment variable. A `repo` argument that resolves anywhere else is refused,
for reading and for writing alike. When the session's directory is part of a repository (a session
opened in `monorepo/packages/foo`, a folder the repository tracks files under), the tools work on that
repository's root, as the CLI does: the root is derived from git, never taken from the caller. A
scratch folder that merely sits inside some repository without being tracked by it is not widened.

**Files it writes.** Only `logbook_annotate` writes, and only inside the repository it is called on:
`annotations.jsonl` (your note), then a refreshed `LOGBOOK.md` and `events.jsonl` (the brief and the
engine's cache of that repository's own git history, which includes the commit author names already
in the git log), plus a short-lived lock file inside that repository's `.git` directory while it
writes. It refuses to replace a `LOGBOOK.md` or `events.jsonl` that logbook did not write. The four
read tools write nothing. When the engine reuses a cached `events.jsonl`, it re-derives a random
sample of the rows from git first and rebuilds the whole record on any mismatch, so an edited
ledger is not served.

**What it sends, and where.** Nothing. The engine is deterministic and never calls a model or the
network; the MCP server speaks to Claude Code over stdio on your machine. The only network traffic is
npm fetching the pinned packages on first use. There is no telemetry.

**What Claude reads.** Commit subjects, author names, and paths come from the repository and are
shown to Claude as evidence. The digest, audit, and context tools escape that text; the query tool
returns it as raw JSON by contract and attaches a warning block saying so.

**Hooks.** None. The plugin registers no hooks and no mod; it is a skill and an MCP server.
