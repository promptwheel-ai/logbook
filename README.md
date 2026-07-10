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
npx @promptwheel/logbook --json       # events to stdout (writes nothing)

# era-scoped archaeology
npx @promptwheel/logbook --since 2024-01-01 --until 2025-01-01
```

Options: `-n/--max N` (commit cap, default 20000) · `--compare` · `--out DIR` · `-q/--quiet`

`--compare` uses a percentile table baked into the CLI from a 1,000-repo fleet
run — still zero dependencies and zero network calls.

## Honest scope

- Findings are **leads, not verdicts**. A suppression commit means "a human
  should look here," not misconduct. Large assertion removals are usually
  feature deletions — they're tagged as such.
- Detection is regex over commit subjects and diffs (lineage: a calibrated
  classifier from a 1,800-PR study of agent-authored code). It will miss
  clever evasions and flag some innocents. That's the right trade for a
  zero-dependency tool that runs in seconds.
- Shallow clones starve the analysis — the logbook will tell you to
  `git fetch --unshallow`.

## The logbook records; the referee judges

This tool is one half of a pair. The logbook tells you a test was skipped
in March. [promptwheel](https://github.com/promptwheel-ai/promptwheel) — the
referee — proves whether today's "win" came from the code or from editing the
tests. Past tense and present tense of the same question: *did this actually
improve?*

MIT.
