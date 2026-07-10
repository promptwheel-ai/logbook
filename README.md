# historian

**Graphify maps where the code is. The historian maps what happened and why.**

A code graph can't tell you that the payments module was rewritten three times,
that the auth approach was tried and reverted, or that a "fix" last quarter was
actually a skipped test. That's the decision layer — the thing agents most need
and least have. The historian reads your git history and writes it down.

```
npx @promptwheel/historian
```

```
  1,326 commits · 181 files · 7 years · 132 authors

  ✓ wrote HISTORIAN.md   hotspots · do-not-retry · suppression ledger
  ✓ wrote events.jsonl   1,326 structured events
  ✓ wrote JOURNEY.md     the repo's story, told back to you
```

Single file. Zero dependencies. Read-only — it never mutates your repo.

## The three artifacts

| File | What it is | Who it's for |
|---|---|---|
| `HISTORIAN.md` | The brief a fresh session needs: hotspots, **do-not-retry** (reverted approaches), the **suppression ledger** (every time a test was skipped or a warning hushed), assertion-weakening events, fragile areas | Your agent. Drop it in context — `CLAUDE.md` can point at it |
| `events.jsonl` | One structured event per commit: shape (src/test/config/docs), adds/dels, suppressions found in the diff, assertion deltas | Your tools. The data layer |
| `JOURNEY.md` | Your repo's history as a hero's journey: The Call, The Threshold, The Abyss, The Long Winter, the Whispered Bargains | You. Run `historian journey` to see it in color |

## Usage

```bash
npx @promptwheel/historian              # analyze the current repo
npx @promptwheel/historian path/to/repo # or any repo
npx @promptwheel/historian journey      # the story, in color (writes nothing)
npx @promptwheel/historian --json       # events to stdout (writes nothing)

# era-scoped archaeology
npx @promptwheel/historian --since 2024-01-01 --until 2025-01-01
```

Options: `-n/--max N` (commit cap, default 5000) · `--out DIR` · `-q/--quiet`

## Honest scope

- Findings are **leads, not verdicts**. A suppression commit means "a human
  should look here," not misconduct. Large assertion removals are usually
  feature deletions — they're tagged as such.
- Detection is regex over commit subjects and diffs (lineage: a calibrated
  classifier from a 1,800-PR study of agent-authored code). It will miss
  clever evasions and flag some innocents. That's the right trade for a
  zero-dependency tool that runs in seconds.
- Shallow clones starve the analysis — the historian will tell you to
  `git fetch --unshallow`.

## The historian records; the referee judges

This tool is one half of a pair. The historian tells you a test was skipped
in March. [promptwheel](https://github.com/promptwheel-ai/promptwheel) — the
referee — proves whether today's "win" came from the code or from editing the
tests. Past tense and present tense of the same question: *did this actually
improve?*

MIT.
