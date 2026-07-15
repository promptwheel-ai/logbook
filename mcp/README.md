# @promptwheel/logbook-mcp

[`@promptwheel/logbook`](https://github.com/promptwheel-ai/logbook) over MCP —
git history as agent memory, for clients without a shell (Claude Desktop,
Cursor, and any MCP client).

## Tools

- **logbook_digest** — the history digest: hotspots, do-not-retry reverts,
  suppression ledger, fragile areas, notable events, per-file history.
- **logbook_audit** — what is STILL suppressed in HEAD and since when
  (blame-dated), with re-silencing fight logs.
- **logbook_query** — precision filters over the full commit-event record
  (file / revert / suppress / weaken / downgrade / grep / since / until).
- **logbook_context** — the same filtered order in deterministic pages capped
  at 20 events and 8 KiB. Follow its opaque `NEXT` cursor until `END complete`;
  it compacts delivery but does not rank relevance. Cursors reject changed
  HEADs, filters, analysis windows, or event order instead of silently drifting.
  Pass `files` for a multi-path OR query; remaining filters stay AND constraints.
- **logbook_annotate** — create a local, inert decision draft after an agent
  investigates a revert or suppression. Its exact quote is verified against raw
  Git objects and the tool returns the full card ID. It never grants authority:
  a human must promote it with `logbook accept-draft CARD_ID --by WHO` and commit
  the readable decision/review files.

## Setup

Claude Desktop (JSON config):

```json
{
  "mcpServers": {
    "logbook": { "command": "npx", "args": ["-y", "@promptwheel/logbook-mcp"] }
  }
}
```

Codex CLI (TOML — `~/.codex/config.toml`, or per-project `.codex/config.toml`):

```toml
[mcp_servers.logbook]
command = "npx"
args = ["-y", "@promptwheel/logbook-mcp"]
```

or the one-liner: `codex mcp add logbook -- npx -y @promptwheel/logbook-mcp`.
Exposing tools is not the same as using them — keep an AGENTS.md line telling
the agent when to call logbook_digest.

## Performance

Three cache layers: session memo per HEAD (repeat calls: 4ms), disk reuse
of events.jsonl with incremental append (0.4s on the 20k-commit repo we
measured — the ledger must exist, i.e. a CLI run wrote it; the MCP server
itself keeps its cache in memory and does not write events.jsonl), and
windowed cold builds that emit MCP progress notifications. Clients can opt
in to resetting their timeout on progress (the official TypeScript SDK
uses `resetTimeoutOnProgress: true`); without that opt-in, a cold build on
a large repo can still hit the client's timeout — run the CLI once to
create the ledger if that bites. Zero network calls; the analysis is git,
running locally.

MIT. The logbook records; the referee judges.
