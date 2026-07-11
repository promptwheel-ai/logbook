# logbook

**Graphify maps where the code is. The logbook records what happened and why.**

A code graph can't tell you that the payments module was rewritten three times,
that the auth approach was tried and reverted, or that a "fix" last quarter was
actually a skipped test. That's the decision layer — the thing agents most need
and least have. The logbook reads your git history and writes it down.

```
npx @promptwheel/logbook
```

```
  1,326 commits · 322 files · 7.3 years · 354 authors

  ✓ wrote LOGBOOK.md     hotspots · do-not-retry · suppression ledger
  ✓ wrote events.jsonl   1,326 structured events
  ✓ wrote JOURNEY.md     the repo's story, told back to you
```

![logbook running on zustand: files written, then the colorized journey and Almanac](https://raw.githubusercontent.com/promptwheel-ai/logbook/master/logbook-journey.gif)

Single file. Zero dependencies. Read-only — it never mutates your repo.

## Why "logbook"

Sailors measured speed by throwing a wooden log off the stern and counting the
knots in the line as it paid out. The record of those readings became the
ship's log. That's why speed is in knots, and that's why programmers call them
logs. Your repo has been keeping one for years. This reads it back.

## The three artifacts

| File | What it is | Who it's for |
|---|---|---|
| `LOGBOOK.md` | The brief a fresh session needs: hotspots, **do-not-retry** (reverted approaches), the **suppression ledger** (every time a test was skipped or a warning hushed), assertion-weakening events, fragile areas | Your agent. Drop it in context — `CLAUDE.md` can point at it |
| `events.jsonl` | One structured event per commit: shape (src/test/config/docs), adds/dels, suppressions found in the diff, assertion deltas | Your tools. The data layer |
| `JOURNEY.md` | Your repo's history as a hero's journey: The Call, The Threshold, The Abyss, The Long Winter, the Whispered Bargains | You. Run `logbook journey` to see it in color |

## Usage

```bash
npx @promptwheel/logbook              # analyze the current repo
npx @promptwheel/logbook path/to/repo # or any repo
npx @promptwheel/logbook journey      # the story, in color (writes nothing)
npx @promptwheel/logbook journey --compare  # rank your almanac vs the top 1,000 GitHub repos
npx @promptwheel/logbook audit        # what is STILL suppressed in HEAD, and since when
npx @promptwheel/logbook --json       # events to stdout (writes nothing)

# era-scoped archaeology
npx @promptwheel/logbook --since 2024-01-01 --until 2025-01-01
```

Options: `-n/--max N` (commit cap, default 20000) · `--compare` · `--out DIR` · `-q/--quiet`

`--compare` uses a percentile table baked into the CLI from a 1,000-repo fleet
run — still zero dependencies and zero network calls.

## Wire it into your agent (30 seconds)

Commit LOGBOOK.md, then add this to your CLAUDE.md (or AGENTS.md /
.cursorrules) so every fresh session reads the history without being asked:

```markdown
## Repo memory
Read LOGBOOK.md before proposing changes — especially the do-not-retry
list and fragile areas. Refresh with: npx -y @promptwheel/logbook
Check what is still silenced: npx -y @promptwheel/logbook audit
```

Passive beats invoked: the agent doesn't have to decide to look — the
history is simply in front of it.

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
keeps trying to fix, and keeps losing to. Instant on normal repos; up to ~a minute on 20k-commit
monsters (the ledger build, not the scan).

## Context economics

The median top-2,500 repo's LOGBOOK.md is **~1,000 tokens**. Its raw `git log`
is 82× that — and for a third of repos the full log doesn't fit in a 150k
context window at all. Measured across 400 repos:
[docs/context-economics.md](docs/context-economics.md).

## Does it actually change agent behavior?

Yes — measurably. In an A/B test, an agent asked to plan a `useShallow`
refactor in zustand walked straight into re-attempting a refactor that was
merged and reverted in 2024. The same agent with LOGBOOK.md in context
started from the revert, inferred the repo's characteristic failure class
from the do-not-retry list, and planned to pin the old failure with a test
first. Full transcripts: [docs/does-it-change-agent-behavior.md](docs/does-it-change-agent-behavior.md).

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
- Shallow clones starve the analysis — the logbook will tell you to
  `git fetch --unshallow`.

## The logbook records; the referee judges

This tool is one half of a pair. The logbook tells you a test was skipped
in March. [promptwheel](https://github.com/promptwheel-ai/promptwheel) — the
referee — proves whether today's "win" came from the code or from editing the
tests. Past tense and present tense of the same question: *did this actually
improve?*

MIT.
