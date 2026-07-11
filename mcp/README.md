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

## Setup (Claude Desktop / any MCP client)

```json
{
  "mcpServers": {
    "logbook": { "command": "npx", "args": ["-y", "@promptwheel/logbook-mcp"] }
  }
}
```

## Performance

Three cache layers: session memo per HEAD (repeat calls: 4ms), disk reuse
of events.jsonl with incremental append (0.4s on a 20k-commit repo after
any prior run), and windowed cold builds that emit MCP progress
notifications — compliant clients reset their timeout on progress, so even
the ~43s worst-case cold build cannot time out. Zero network calls; the
analysis is git, running locally.

MIT. The logbook records; the referee judges.
