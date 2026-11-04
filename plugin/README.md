# logbook (Claude Code plugin)

Your repository's git history as memory, in one install: the five logbook tools through a pinned
MCP server, plus the skill that tells Claude when to read it. Everything runs on your machine
against the repository in front of it. Nothing leaves it.

## Install

```
/plugin marketplace add promptwheel-ai/logbook
/plugin install logbook@logbook
```

## What you get

- **Five tools**, served by `@promptwheel/logbook-mcp@0.6.0`: `logbook_context` (the ranked
  history for the files you are touching), `logbook_query` (filtered events: reverts, weakened tests,
  suppressions, by file or since a date), `logbook_digest` (the whole-repo brief), `logbook_audit`
  (the live suppression debt still silenced in HEAD), and `logbook_annotate` (a reviewed note on a
  commit, as a decision card).
- **The skill** (`/logbook:logbook`, and used on its own when a repo carries a `LOGBOOK.md`): how to
  read the history before planning, diagnosing, or editing, and how to treat its entries as leads to
  verify, not conclusions.

The same engine powers the memory half of [Sawbuck](https://sawbuck.ai/memory) and the `logbook`
skill inside the `promptwheel` plugin. Install this one when you want the tools, not only the skill.

## What this plugin runs, writes, and sends (the full list)

**Programs it runs.** One: the MCP server `npx -y @promptwheel/logbook-mcp@0.6.0`, started by
Claude Code at session start from `.mcp.json`, pinned to that exact version, fixed arguments, no
shell. The server runs the `@promptwheel/logbook@0.9.8` engine in process; it reads `git log`
and `git diff` for the repository the tools are pointed at. The skill tells Claude to run the same
engine through `npx -y @promptwheel/logbook@0.9.8` for the commands the tools do not cover.
Both need Node 18 or newer and npm on your PATH.

**Files it writes.** Inside the repository it analyzes: `events.jsonl` (one event per commit) and
`LOGBOOK.md` (the brief), the engine's cache of that repository's own git history, which includes the
commit author names already in the git log; `decision-cards.jsonl` and `annotations.jsonl` when you
use `logbook_annotate`. Nothing is written anywhere else.

**What it sends, and where.** Nothing. The engine is deterministic and never calls a model or the
network; the MCP server speaks to Claude Code over stdio on your machine. The only network traffic is
npm fetching the pinned packages on first use. There is no telemetry.

**Hooks.** None. The plugin registers no hooks and no mod; it is a skill and an MCP server.
