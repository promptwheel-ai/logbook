# logbook

[![ci](https://github.com/promptwheel-ai/logbook/actions/workflows/ci.yml/badge.svg)](https://github.com/promptwheel-ai/logbook/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/%40promptwheel%2Flogbook)](https://www.npmjs.com/package/@promptwheel/logbook)

**Coding agents often skip git history. It is large, and an arbitrary slice
can give the wrong picture.**

Every feature gets added by someone who can read the code but not the
decisions behind it: the module that was rewritten three times, the approach
that was tried and reverted, the "fix" last quarter that was actually a
skipped test. Fresh agent sessions often start without those decisions. Code
maps (Graphify and friends) tell them where things are, not what happened. The
logbook mines the existing git history — up to the newest 20,000 commits — and
writes a compact recall layer that your agent is instructed to consult.

```
npx -y @promptwheel/logbook init
```

One line: it reads the history, writes the brief, and adds a history workflow to
your agent config (AGENTS.md, CLAUDE.md, or .cursorrules).

```
  1,326 commits · 322 files · 7.3 years · 354 authors

  ✓ wrote LOGBOOK.md     hotspots · do-not-retry · suppression ledger
  ✓ wrote events.jsonl   1,326 structured events
  ✓ wrote JOURNEY.md     the repo's story, told back to you
```

![logbook running on zustand: files written, then the colorized journey and Almanac](https://raw.githubusercontent.com/promptwheel-ai/logbook/master/logbook-journey.gif)

Single file. Zero npm dependencies. It never touches your source code or
git history, and no repository data leaves your machine — it writes only
its own brief files (and `init` adds a block to your agent config).

## Why "logbook"

Because you need a compact index of the decisions its detectors can recover
without pulling every book out of the library. In a random 400-repo sample of
the top 2,500 GitHub repositories, 34% of full logs exceeded a 150k-token
context estimate. Logbook turns that record into a bounded brief and
verifiable leads; it does not claim complete decision recall.

## The three artifacts

| File | What it is | Who it's for |
|---|---|---|
| `LOGBOOK.md` | The brief a fresh session needs: hotspots, **do-not-retry** (reverted approaches), the **suppression ledger** (the times a test was skipped or a warning hushed), assertion-weakening events, fragile areas | Your agent. Drop it in context — `CLAUDE.md` can point at it |
| `events.jsonl` | One structured event per analyzed commit: shape (src/test/config/docs), adds/dels, suppressions found in the diff, assertion deltas | Your tools. The data layer |
| `JOURNEY.md` | Your repo's history as a hero's journey: The Call, The Threshold, The Abyss, The Long Winter, the Whispered Bargains | You. Run `logbook journey` to see it in color |

## Usage

```bash
npx @promptwheel/logbook              # analyze the current repo
npx @promptwheel/logbook path/to/repo # or any repo
npx @promptwheel/logbook journey      # the story, in color (writes nothing)
npx @promptwheel/logbook journey --compare  # rank your almanac vs the top 2,500 GitHub repos
npx @promptwheel/logbook audit        # what is STILL suppressed in HEAD, and since when
npx @promptwheel/logbook doctor       # read-only artifact/wiring/skill/query health check
npx @promptwheel/logbook context --file path/to/file --revert  # bounded, paged query view
npx @promptwheel/logbook context --file src/a.ts --file src/b.ts # multi-path OR query
npx @promptwheel/logbook annotate SHA "why it happened" --by WHO   # persist WHY a commit happened
npx @promptwheel/logbook --json       # events to stdout (writes nothing)

# era-scoped archaeology
npx @promptwheel/logbook --since 2024-01-01 --until 2025-01-01
```

Options: `-n/--max N` (commit cap, default 20000) · `--compare` · `--out DIR` · `-q/--quiet`

`context` preserves the filtered `query` order but serializes it into pages of
at most 20 events and 8 KiB, with an opaque `NEXT` cursor and explicit
`END complete`. It is a delivery format, not relevance ranking; use `query`
when you need the raw JSONL interface. A cursor is bound to the repository
HEAD, filters, analysis window, and ordered event set; if any changes, restart
from the first page. Repeat `--file` to match commits touching any supplied
path; remaining filters still combine with that union. Repeat the same filters
with every `NEXT` cursor. On a default-window cold run, the CLI creates or refreshes
`events.jsonl` after page one so `NEXT` pages reuse the scan; it never changes
source or Git history. Non-default `-n` or `--since`/`--until` windows remain
uncached, so each CLI page rescans that explicit window. Across 7,123 measured
events, the 0.8 representation used 72.7% fewer bytes than the raw rows
([method and scope](docs/context-format.md)).

## The ledger is batched

The expensive part (scanning 20k commits of diffs) runs once, in bounded
windows, and every consumer reuses it: if `events.jsonl` is present and
matches HEAD it is loaded instantly; if new commits landed, only they are
scanned and merged. Measured on a 20k-commit repo: 43s cold, 0.4s with a
prior run on disk, 4ms on repeat calls in an MCP session. Escape hatches:
`LOGBOOK_NO_CACHE=1` forces a full rebuild; `LOGBOOK_WINDOW=N` tunes the
scan window.

`--compare` uses a percentile table baked into the CLI from a 2,500-repo fleet
run — still zero dependencies and zero network calls.

## Trust and diagnostics

Git subjects, paths, authors, and annotations are repository-controlled input.
Logbook stores the event record unchanged, but sanitizes those values when it
renders Markdown or agent-facing audit output and labels the result as untrusted
evidence. Generated files are replaced atomically one at a time; the two
Markdown artifacts carry matching HEAD, event-count, scope, and ledger-hash
records that bind `events.jsonl`. A multi-file refresh is not transactional, so
an interrupted bundle is detected on the next check.

Run the read-only doctor when a report looks stale or when filing a bug:

```bash
npx -y @promptwheel/logbook@latest doctor
```

It checks generated-record freshness and ledger integrity, current agent wiring
(including a shadowing `AGENTS.override.md`), an installed Logbook skill, and a
real path query. It does not separately hash user edits to the Markdown prose.
It writes nothing, returns nonzero on a failed check, and prints a compact report
suitable for pasting into an issue or launch-thread reply.

## Wire it into your agent

`logbook init` does this for you. Manually, it's one block in your
CLAUDE.md (or AGENTS.md / .cursorrules) so every fresh session is instructed
to read the history first:

```markdown
## Repo memory
Before planning or editing:
1. Read LOGBOOK.md at the repo root completely before any history query.
2. Use the raw history inventory as orientation, not a task-level risk score.
   Inspect task-relevant do-not-retry, test-trust, and reviewed-annotation
   entries regardless of repo-wide totals.
3. For complete do-not-retry coverage, inspect all relevant paths:
   npx -y @promptwheel/logbook context --file path/to/file --revert
   Repeat --file for each other relevant path. If output says NEXT, repeat the
   identical filters with --cursor TOKEN until END complete before concluding.
4. Treat findings as leads, not verdicts. Verify claims with git show SHA and
   confirm that the constraint still applies to the current tree.
Refresh the record: npx -y @promptwheel/logbook
Check what is still silenced: npx -y @promptwheel/logbook audit
When you investigate WHY a listed commit happened and verify it in the
diffs, persist it (replace SHA, the sentence, and MODEL with your own
model name; never annotate guesses):
npx -y @promptwheel/logbook annotate SHA "one specific sentence" --by MODEL
```

Wiring installs the history workflow instead of relying on the agent to invent
it. It is still an instruction, not a guarantee; observed consultation remains
imperfect, so confirm it for high-risk work.

## Lazy enrichment: the record says WHAT, your agent persists WHY

The ledger can tell you a refactor was reverted; it can't tell you it was
reverted because webpack4 broke. Your agent figures that out anyway the
first time a task collides with the revert — `annotate` keeps the finding
instead of discarding it at session end:

```bash
logbook annotate c08adc2 "WeakMap cache added to dodge a React-Compiler lint warning; reverted to direct ref mutation" --by claude
```

LOGBOOK.md is updated immediately (a later session that finds fresh
artifacts on disk may never re-run the CLI), and the do-not-retry entry
carries the why:

```
- 2024-09-15 c08adc2 revert useShallow refactor in #2701 (#2703)
  - why (inferred by claude, 2026-07-11): WeakMap cache added to dodge a React-Compiler lint warning; reverted to direct ref mutation
```

Annotations live in `annotations.jsonl` — sha-keyed (immutable, so they
never go stale as facts), attributed, dated, last write per commit wins.
They are **judgments layered on the record, never mixed into it**: the
deterministic ledger stays untouched, the whys render with provenance and
a disclaimer. Measured on the A/B benchmark: an agent whose logbook carried
the whys stated real failure causes as design constraints at plan time
(+2% read tokens), where the un-enriched agent planned an investigation —
and, on zustand, guessed the cause wrong. One caution: annotations age as
constraints even though they never invalidate as facts — a "broke webpack4"
reason stops binding once webpack4 is dead, so the date is always shown.
Commit the file for a shared team memory, or gitignore it for a private one.

## The audit: archaeology becomes a to-do list

`logbook audit` joins the ledger's dates with what is still true in HEAD:

```
  describe.skip  test/express.static.js:137  since 2019-05-02 (7.2y)

  1 live suppression · oldest 7.2 years
```

That is express, today: its static-file test suite has been skipped for
seven years. The ledger tells you when it happened; the audit tells you it
is still happening. And when a suppression has been removed and RE-added,
the audit shows the fight log: `re-silenced ×3 (+-++--+)` — a test someone
keeps trying to fix, and keeps losing to.

## Context economics

In a random 400-repo sample of the top 2,500, the median LOGBOOK.md was
**~1,000 estimated tokens**. The sample's median full `git log` was 82× that,
and 34% exceeded a 150k-token estimate. This is potential context avoided only
when a session would otherwise ingest raw history:
[docs/context-economics.md](docs/context-economics.md).

## Does it actually change agent behavior?

On selected history-dense planning tasks, yes—with an important boundary. In a
later screen of ten new, less history-selected tasks, the packaged Logbook arm
did not beat strong raw-Git instructions (2/10 safe plans versus 3/10). Every
known receipt was indexed, but none reached the agents through Logbook queries,
identifying retrieval and consumption as the bottleneck. See the evidence-status
note in [docs/wrong-work-benchmark.md](docs/wrong-work-benchmark.md). In the
original A/B test, an agent asked to plan a `useShallow`
refactor in zustand walked straight into re-attempting a refactor that was
merged and reverted in 2024. The same agent with LOGBOOK.md in context
started from the revert, inferred the repo's characteristic failure class
from the do-not-retry list, and planned to pin the old failure with a test
first. Full transcripts: [docs/does-it-change-agent-behavior.md](docs/does-it-change-agent-behavior.md).

In a six-task internal experiment across deliberately history-dense planning
tasks, agents without supplied history proposed already-reverted or completed
work in 4 of 6 tasks; agents supplied the full generated LOGBOOK.md did so in
0 of 6, for about +4.7k tokens of context. This was planning-only, internally
graded, and selected for historical landmines. Method and scope:
[docs/wrong-work-benchmark.md](docs/wrong-work-benchmark.md).

## Honest scope

- Findings are **leads, not verdicts**. A suppression commit means "a human
  should look here," not misconduct. Large assertion removals are usually
  feature deletions — they're tagged as such.
- Detection is regex over commit subjects and diffs (lineage: a calibrated
  classifier from a 1,800-PR study of agent-authored code). It will miss
  clever evasions and flag some innocents. That's the right trade for a
  zero-dependency tool that runs in seconds — and it's a deliberate division
  of labor: the logbook is the cheap, deterministic recall layer; the agent
  reading it is the precision layer that triages leads against the task.
- It reads what survived. Squash and rebase erase in-branch attempts (a
  tried-then-reverted change nets to zero in the squashed diff), and
  uncommitted experiments were never visible at all. The logbook
  complements an agent journaling during the work — `annotate` is the
  bridge for exactly that — it does not replace it.
- Shallow clones starve the analysis — the logbook will tell you to
  `git fetch --unshallow`.

## The logbook records; the referee judges

This tool is one half of a pair. The logbook tells you a test was skipped
in March. [promptwheel](https://github.com/promptwheel-ai/promptwheel) — the
referee — proves whether today's "win" came from the code or from editing the
tests. Past tense and present tense of the same question: *did this actually
improve?*

MIT.
