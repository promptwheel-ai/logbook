# @promptwheel/logbook-mcp

[`@promptwheel/logbook`](https://github.com/promptwheel-ai/logbook) over MCP -
git history as agent memory, for clients without a shell (Claude Desktop,
Cursor, and any MCP client).

## Tools

- **logbook_digest** - the history digest: hotspots, do-not-retry reverts,
  suppression ledger, fragile areas, notable events, per-file history.
- **logbook_audit** - what is STILL suppressed in HEAD and since when
  (blame-dated), with re-silencing fight logs.
- **logbook_query** - precision filters over the full commit-event record
  (file / revert / suppress / weaken / downgrade / grep / since / until).
- **logbook_context** - the same filtered order in deterministic pages capped
  at 20 events and 8 KiB. Follow its opaque `NEXT` cursor until `END complete`;
  it compacts delivery but does not rank relevance. Cursors reject changed
  HEADs, filters, analysis windows, or event order instead of silently drifting.
  Pass `files` for a multi-path OR query; remaining filters stay AND constraints.
- **logbook_annotate** - persist an immediately visible, explicitly unreviewed
  digest note after an agent investigates a change. Optional exact evidence is
  raw-object verified. Notes never become reviewed-decision authority.

## Workspace

Every tool call is confined to the directory the server was started in (the session's working
directory under Claude Code and most clients) plus any roots listed in the `LOGBOOK_MCP_ROOTS`
environment variable (a path list). A `repo` argument anywhere else is refused, for reading and for
writing. When that directory sits inside a repository (a session opened in `monorepo/packages/foo`),
the tools work on the repository's root, as the CLI does: the root is derived from git, never taken
from the caller.

The reviewed-decision layer (drafts, leads, `check --diff`, OKF export) is
experimental, opt-in, and CLI-only; see the core package's
`docs/reviewed-decisions.md`. Nothing requires an agent to run `check --diff`
before finishing work.

## Upgrading

- From 0.5.x: `logbook_annotate_draft` is gone. A caller that needs an inert
  review card runs the CLI: `logbook annotate-draft SHA "WHY" ...`.
- From 0.5.0: `logbook_annotate` writes an unreviewed digest note and does not
  return a card ID.

## Setup

Claude Desktop (JSON config):

```json
{
  "mcpServers": {
    "logbook": { "command": "npx", "args": ["-y", "@promptwheel/logbook-mcp@latest"] }
  }
}
```

Codex CLI (TOML - `~/.codex/config.toml`, or per-project `.codex/config.toml`):

```toml
[mcp_servers.logbook]
command = "npx"
args = ["-y", "@promptwheel/logbook-mcp@latest"]
```

or the one-liner:
`codex mcp add logbook -- npx -y @promptwheel/logbook-mcp@latest`.
Exposing tools is not the same as using them - keep an AGENTS.md line telling
the agent when to call logbook_digest.

## Performance

Three cache layers: session memo per HEAD (repeat calls: 4ms), disk reuse
of events.jsonl with incremental append (0.4s on the 20k-commit repo we
measured - the ledger must exist, i.e. a CLI run or logbook_annotate wrote it;
a random sample of reused rows is re-derived from git on every reuse; the
read-only tools keep their cache in memory and write nothing), and
windowed cold builds that emit MCP progress notifications. Clients can opt
in to resetting their timeout on progress (the official TypeScript SDK
uses `resetTimeoutOnProgress: true`); without that opt-in, a cold build on
a large repo can still hit the client's timeout - run the CLI once to
create the ledger if that bites. Zero network calls; the analysis is git,
running locally.

## Releasing

The server reports the version in its own `package.json`. `server.json` (the
MCP Registry listing) is not read at runtime and must be bumped by hand to the
same number; the behavioral test fails when the two drift.

Apache 2.0. The logbook records what happened; the check verifies what holds.
