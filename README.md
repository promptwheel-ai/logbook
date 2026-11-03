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
[plugin/SKILL.md](plugin/SKILL.md).

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

The history scan is cached in bounded windows. On a measured 20k-commit repo:
43s cold, 0.4s with a prior run on disk, and 4ms on repeat calls in an MCP
session. `LOGBOOK_NO_CACHE=1` forces a rebuild; `LOGBOOK_WINDOW=N` tunes the
window.

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

## Experimental: reviewed decisions and OKF export

Separate from the history layer, and opt-in, Logbook can hold reviewed
decision cards attached to code paths and surface them when a later diff
touches those paths. Cards start as local inert drafts (`annotate-draft`,
`pending`), become authoritative only through an explicit human promotion
recorded on the trusted Git ref (`accept-draft`, `accept-lead`,
`reject-lead`), and are checked against a diff with `check --diff`. A
committed policy can publish lower-authority machine leads (`publish`,
`outcomes`), and the reviewed plane can be projected one-way into an Open
Knowledge Format bundle (`export`).

Nothing in this layer runs unless you call it, and it never converts model
confidence into authority. It is an instrumented alpha: the trust boundary is
hardened and regression-tested, but review adoption and token return are still
being measured, and there are no first-class commands yet to revise or retire
an accepted decision. The workflow, authority tiers, trust model, and evidence
status are documented in [docs/reviewed-decisions.md](docs/reviewed-decisions.md);
the export format in [docs/okf-export.md](docs/okf-export.md).

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
- Code maps explain where code is. Logbook focuses on what happened over time
  and, if you opt in, what a reviewed team decision says about a touched scope.

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

Experimental (opt-in reviewed decisions):

```text
logbook annotate-draft SHA "WHY" [evidence options] [--by WHO]
logbook pending [path]
logbook accept|accept-draft CARDID --by WHO [--file P ...] [--dir P/]
logbook check --diff [--base SHA --head SHA] [--cursor TOKEN]
logbook publish [--candidates FILE]
logbook accept-lead CARDID --by WHO [--claim "corrected text"]
logbook reject-lead CARDID --by WHO
logbook outcomes [path]
logbook export [path] --format okf --out NEW_DIR [--ref REF]
```

## Upgrading to 0.9.8 (unreleased)

- The `## Repo memory` block that `init` writes is now the deterministic
  workflow only: read `LOGBOOK.md`, bounded `context --file` pages per task
  path, verify with `git show`, refresh, `audit`, and `annotate` verified
  why-notes. The `annotate-draft`, `pending`, `accept-draft`, and
  `check --diff` lines left the block; that layer is opt-in and documented in
  `docs/reviewed-decisions.md`. `doctor` requires exactly the lean lines.
- A normal refresh re-pins and reshapes a `## Repo memory` block written by
  any earlier 0.9.x release (0.9.7 included), so `doctor` passes again after
  an upgrade. User-edited blocks are never touched.
- One suppression-idiom table drives the detector, the comment-directive
  filter, and the per-language gating (the derived patterns are byte-identical
  to 0.9.7, so the extractor version did not change). `audit --json` rows now
  carry `testSkip`.
- The CLI is driven by one command table: a flag that a command does not take
  is a usage error instead of being silently ignored.
- The agent skill (`plugin/SKILL.md`) is the lean deterministic-layer text.

## Upgrading to 0.9.7

- `logbook query --json` now honors its filters (`--file`, `--revert`, and
  the rest). It used to print the whole unfiltered ledger. `logbook --json`
  is still the full ledger; `--json` is rejected on commands that have no
  JSON output.
- The reviewed-decision commands are grouped as experimental in `--help` and
  documented in `docs/reviewed-decisions.md`. Nothing about them changed.
- `JOURNEY.md` is no longer written by the default run, and `doctor` no
  longer requires it. `logbook journey` still prints the story; `--compare`
  and its bundled percentile table are gone.
- The npm tarball ships `bin/` only; the research memos under `docs/` stay in
  the repository. Developer-only smoke scripts were removed.
- MCP server 0.6.0 (publishes separately from the core): the
  `logbook_annotate_draft` tool was removed (use the CLI's `annotate-draft`),
  and the server reports its `package.json` version.

## Upgrading from 0.8 or 0.9.0

Existing `annotations.jsonl` rows remain unreviewed digest notes and render
again; `init` does not turn them into a review backlog. Existing 0.9.0 drafts
remain local and inert. In 0.9.1, `annotate` once again means immediate digest
enrichment. A 0.9.0 script that expects `annotate` to return a card ID must use
the explicit `annotate-draft` command instead. If 0.8 wrote annotations to a
custom `--out` directory, move that `annotations.jsonl` to the repository root;
0.9.1 intentionally keeps the note store at one unambiguous location.

## The logbook records what happened; the check verifies what holds

Logbook tells you what history and reviewed decisions say. [promptwheel](https://github.com/promptwheel-ai/promptwheel)
is the check that verifies whether today's claimed improvement came from the
code rather than moving the goalposts.

Apache 2.0.
