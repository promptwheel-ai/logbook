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

```text
  1,326 commits · 322 files · 7.3 years · 354 authors

  ✓ wrote LOGBOOK.md     hotspots · do-not-retry · suppression ledger
  ✓ wrote events.jsonl   structured history events
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
logbook journey                              # the repo's story, in color
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
rather than guessed. `logbook refine` lists notable history that has no note
yet; it does not generate claims.

## What it stores

| Path | Purpose |
|---|---|
| `LOGBOOK.md` | Bounded history brief for agents: hotspots, do-not-retry reverts, suppressions, weakened assertions, and fragile areas |
| `events.jsonl` | Structured deterministic history events for tools and queries |
| `annotations.jsonl` | Durable machine-authored notes, shown in the digest as explicitly unreviewed leads |

Commit `annotations.jsonl` to share the notes with the team, or add it to
`.gitignore` to keep them local to one checkout. `logbook journey` prints the
repository's story to the terminal and writes no file.

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

- **CLI + JSON.** `logbook query --json` (filtered) and `logbook --json` (the full ledger)
  emit JSONL you can shell from any language. The JSON is cache-invariant (byte-identical with
  and without `LOGBOOK_NO_CACHE=1`), so it is safe to parse in CI.
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
logbook [path]
logbook journey [path]
logbook audit [path]
logbook doctor [path]
logbook query [path] [filters] [--json]
logbook context [path] [filters] [--cursor TOKEN]
logbook annotate SHA "WHY" [optional evidence] [--by WHO]
logbook refine [path] [--limit N]
```

## Upgrading to 0.10.0

- The experimental reviewed-decision layer and the OKF export are gone:
  `annotate-draft`, `pending`, `accept`/`accept-draft`, `accept-lead`,
  `reject-lead`, `check`, `publish`, `outcomes`, and `export`. Nothing read them
  by default, and they saw no use.
- Files that layer left behind (`.logbook/`, `decision-cards.jsonl`,
  `annotation-reviews.jsonl`) are ignored and can be deleted by hand. They stay
  classified as generated, so they do not appear as hot spots.
- `refine` now skips only commits that have a note in `annotations.jsonl`, and
  `doctor` no longer looks at `.logbook/drafts`.
- A normal refresh re-pins a `## Repo memory` block written by any earlier
  release, including the plane template that named the removed commands, so
  `doctor` passes again after an upgrade. User-edited blocks are never touched.
- `init`, the digest, `events.jsonl`, `query`, `audit`, `annotate`, `context`,
  `journey`, `doctor`, and the five MCP tools are otherwise unchanged. The event
  and `--json` shapes did not change.
- MCP server 0.7.0 requires this core. Its tools are the same five.

## Upgrading to 0.9.10

- A reused `events.jsonl` is no longer trusted as written: on every reuse a
  random sample of its rows is re-derived from git, and any mismatch rebuilds
  the ledger. A hand-edited or committed ledger cannot be served as history.
- The writer refuses to replace a `LOGBOOK.md` that logbook did not write
  (no generated-through stamp) or an `events.jsonl` that is not a ledger, so a
  hand-written file with either name is left alone instead of overwritten.
- The four patch scans run with `--no-textconv --no-ext-diff`, so a repo's
  diff drivers and textconv filters never shape what the detector reads.
- MCP server 0.6.x (publishes separately): every tool call is confined to the
  server's working directory plus `LOGBOOK_MCP_ROOTS`; a workspace that is
  part of a repository (a folder the repository tracks files under, such as
  `monorepo/packages/foo`) resolves to that repository's root, and a scratch
  folder that merely sits inside some repository is not widened. The
  published tarball carries an `npm-shrinkwrap.json` seeded from the tested
  lock. `logbook_query` is capped at 1000 rows and returns the untrusted-
  evidence warning as a second content block; `logbook_annotate` is marked
  destructive.
- `bin/logbook.mjs` is tracked executable again (the tarball's bin carries
  the mode bit).

## Upgrading to 0.9.8

- The `## Repo memory` block that `init` writes is now the deterministic
  workflow only: read `LOGBOOK.md`, bounded `context --file` pages per task
  path, verify with `git show`, refresh, `audit`, and `annotate` verified
  why-notes. The `annotate-draft`, `pending`, `accept-draft`, and
  `check --diff` lines left the block. `doctor` requires exactly the lean lines.
- A normal refresh re-pins and reshapes a `## Repo memory` block written by
  any earlier 0.9.x release (0.9.7 included), so `doctor` passes again after
  an upgrade. User-edited blocks are never touched.
- One suppression-idiom table drives the detector, the comment-directive
  filter, and the per-language gating (the derived patterns are byte-identical
  to 0.9.7, so the extractor version did not change). `audit --json` rows now
  carry `testSkip`.
- The CLI is driven by one command table: a flag that a command does not take
  is a usage error instead of being silently ignored.
- The agent skill (`plugin/skills/logbook/SKILL.md`) is the lean deterministic-layer text.

## Upgrading to 0.9.7

- `logbook query --json` now honors its filters (`--file`, `--revert`, and
  the rest). It used to print the whole unfiltered ledger. `logbook --json`
  is still the full ledger; `--json` is rejected on commands that have no
  JSON output.
- `JOURNEY.md` is no longer written by the default run, and `doctor` no
  longer requires it. `logbook journey` still prints the story; `--compare`
  and its bundled percentile table are gone.
- The npm tarball ships `bin/` only; the research memos under `docs/` stay in
  the repository. Developer-only smoke scripts were removed.
- MCP server 0.6.0 (publishes separately from the core): the
  `logbook_annotate_draft` tool was removed, and the server reports its `package.json` version.

## Upgrading from 0.8 or 0.9.0

Existing `annotations.jsonl` rows remain unreviewed digest notes and render
again. In 0.9.1, `annotate` once again means immediate digest enrichment. If
0.8 wrote annotations to a
custom `--out` directory, move that `annotations.jsonl` to the repository root;
0.9.1 intentionally keeps the note store at one unambiguous location.

## The logbook records what happened; the check verifies what holds

Logbook tells you what history says. [promptwheel](https://github.com/promptwheel-ai/promptwheel)
is the check that verifies whether today's claimed improvement came from the
code rather than moving the goalposts.

Apache 2.0.
