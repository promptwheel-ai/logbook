# logbook

[![ci](https://github.com/promptwheel-ai/logbook/actions/workflows/ci.yml/badge.svg)](https://github.com/promptwheel-ai/logbook/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/%40promptwheel%2Flogbook?label=npm)](https://www.npmjs.com/package/@promptwheel/logbook)

**Git history is large. When coding agents do not inspect it, they can
re-propose approaches a repository already rejected.**

Logbook turns a repository's Git history into memory an agent can use: a
deterministic recall layer (hotspots, reverted approaches, suppressions,
assertion weakening, and bounded history queries) plus durable notes an agent
writes down after it investigates why a change happened.

Everything runs locally. The CLI has zero npm dependencies, reads raw Git
objects for evidence checks, and never sends repository data anywhere.
Node.js 18 or newer is required.

```bash
npx -y @promptwheel/logbook@latest init
```

`init` analyzes the repo, writes the history artifacts, and installs a compact
workflow in `AGENTS.md`, `CLAUDE.md`, or `.cursorrules` so the agent reads
history before it plans: read `LOGBOOK.md`, page each task path with
`context --file`, verify leads with `git show`, refresh, `audit`, and
`annotate` what it verified. The same workflow ships as an agent skill in
[plugin/skills/logbook/SKILL.md](plugin/skills/logbook/SKILL.md).

Its output, shortened:

```text
  1,326 commits · 322 files · 7.3 years · 354 authors

  ✓ wrote LOGBOOK.md     hotspots · do-not-retry · suppression ledger
  ✓ wrote events.jsonl   1,326 structured events
```

The examples below use `logbook` as the binary name. Run them through the exact
package above, or install `@promptwheel/logbook@latest` locally or globally.

## Quick start

```bash
logbook                                      # refresh the history artifacts
logbook context --file src/cache.ts --revert # bounded history for a path
logbook audit                                # what is still suppressed, and since when
logbook query --json --file src/cache.ts     # the same events as JSONL
logbook doctor                               # read-only artifact and wiring health
```

`context` returns history in pages of at most 20 events and 8 KiB; repeat the
identical filters with each `NEXT` cursor until `END complete`.

When an agent investigates why a prior change happened during real work, it can
preserve the result immediately, with no prompt or human gate:

```bash
logbook annotate <commit> "why this approach was rejected" --by codex
```

The note is durably appended to `annotations.jsonl` and appears in
`LOGBOOK.md` before the command exits. It is always labeled machine-authored
and unreviewed and is bounded in the startup digest. An optional exact quote
can be attached with `--span`, `--side`, and (for diff evidence)
`--evidence-file`; a quote that does not ground in raw Git objects is rejected
rather than guessed.

## What it stores

| Path | Purpose |
|---|---|
| `LOGBOOK.md` | Bounded history brief for agents: hotspots, do-not-retry reverts, suppressions, weakened assertions, and fragile areas |
| `events.jsonl` | Structured deterministic history events for tools and queries |
| `annotations.jsonl` | Durable machine-authored notes, shown in the digest as explicitly unreviewed leads |

Commit `annotations.jsonl` to share the notes with the team, or add it to
`.gitignore` to keep them local to one checkout.

## History queries and context economics

`context` preserves filtered `query` order but emits pages of at most 20 events
and 8 KiB. A cursor is bound to the repository HEAD, filters, analysis window,
and ordered event set, so a stale or edited cursor is rejected instead of
silently drifting.

The history scan is cached in bounded windows. On a history of tens of
thousands of commits a cold run takes tens of seconds, a warm run that reuses
the ledger on disk is well under a second, and a repeat call with an unchanged
HEAD in an MCP session is milliseconds. `LOGBOOK_NO_CACHE=1` forces a rebuild;
`LOGBOOK_WINDOW=N` tunes the window.

In a random 400-repo sample of the top 2,500 GitHub repositories, the median
`LOGBOOK.md` was about 1,000 estimated tokens while the median full `git log`
was 82× larger. See [context economics](docs/context-economics.md) and the
[bounded context format](docs/context-format.md).

## Integrate: CLI, MCP, or import

Three surfaces over the same deterministic history layer:

- **CLI + JSON.** `logbook query --json` (filtered, 200 rows unless you pass `--limit`) and
  `logbook --json` (the full ledger) emit JSONL you can shell from any language. `logbook audit
  --json` returns the live suppressions as one array. The JSON is cache-invariant (byte-identical
  with and without `LOGBOOK_NO_CACHE=1`), so it is safe to parse in CI.
- **MCP.** [`@promptwheel/logbook-mcp`](mcp) (bin `logbook-mcp`) serves the history to an agent
  over the Model Context Protocol: a Claude Code or other MCP client reads hotspots,
  do-not-retry reverts, and suppression signals without shelling anything.
- **Import.** The package is importable and importing it never runs the CLI. `queryEvents`,
  `analyze`, `auditHead`, and `hotspots` are exported for advanced in-process use; the scan and
  cache entry points take explicit options, so the CLI and MCP are the first-class surfaces for
  most integrations.

The paired check engine, [promptwheel](https://github.com/promptwheel-ai/promptwheel), has the
matching surface. Both are described in its
[INTEGRATE.md](https://github.com/promptwheel-ai/promptwheel/blob/main/INTEGRATE.md).

## Evidence status

An internal six-task planning experiment on history-dense repos found that
agents without history re-proposed already-tried or already-finished work in
4 of 6 repos and 0 of 6 with `LOGBOOK.md` in context, at about 4.7k extra plan
tokens. A later sealed held-out screen on ten new tasks found no advantage over
a strong raw-Git instruction, and traced the gap to retrieval rather than the
index. The calibrated claim is: valuable on sufficiently difficult,
history-dense tasks; not universally better. Details and limits are in
[wrong-work-benchmark.md](docs/wrong-work-benchmark.md) and
[does-it-change-agent-behavior.md](docs/does-it-change-agent-behavior.md).

## Honest scope

- Findings are leads, not verdicts. A suppression means "look here," not
  misconduct.
- Detection is deterministic regex over commit subjects and diffs. It misses
  history erased by squash/rebase and anything never committed.
- Shallow clones starve historical analysis; fetch the missing history before
  treating absence as evidence.
- Code maps explain where code is. Logbook focuses on what happened over time.

## Command reference

```text
logbook init [path]
logbook [path] [--json]
logbook audit [path] [--json [--file P ...] [--ref REF]]
logbook doctor [path]
logbook query [path] [filters] [--json]
logbook context [path] [filters] [--cursor TOKEN]
logbook annotate SHA "WHY" [optional evidence] [--by WHO]
```

`logbook --help` lists every filter and option.

## Upgrading

0.11.0 removes `logbook refine`, `logbook journey`, and `--out`. Both commands
now fail with `not a git repository`, and `--out` is an unknown option.
Artifacts always go to the repository root. The `analyze` result no longer
carries `first`, `last`, `threshold`, `mentor`, `abyss`, `winter`, or `trials`,
and `renderJourneyAnsi`, `journeyBeats`, `almanacStats`, `GATE_PAT`, and
`MENTOR_PAT` are no longer exported. The event and `--json` shapes, the five MCP
tools, and `doctor` did not change. MCP server 0.8.0 requires this core.

0.10.0 removed the experimental reviewed-decision layer and the OKF export:
`annotate-draft`, `pending`, `accept`/`accept-draft`, `accept-lead`,
`reject-lead`, `check`, `publish`, `outcomes`, and `export`. Files that layer left
behind (`.logbook/`, `decision-cards.jsonl`, `annotation-reviews.jsonl`) are
ignored and can be deleted by hand.

From any release, a normal refresh rewrites a `## Repo memory` block that an
earlier release generated, so `doctor` passes after an upgrade. User-edited
blocks are never touched. Existing `annotations.jsonl` rows stay unreviewed
digest notes. A `JOURNEY.md` left by a release before 0.9.7 is ignored and can
be deleted. If 0.8 wrote annotations to a custom directory, move that
`annotations.jsonl` to the repository root. Earlier notes are in the git history
of this file.

## The logbook records what happened; the check verifies what holds

Logbook tells you what history says. [promptwheel](https://github.com/promptwheel-ai/promptwheel)
is the check that verifies whether today's claimed improvement came from the
code rather than moving the goalposts.

Apache 2.0.
