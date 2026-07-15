# Context economics: the logbook vs raw git log

Measured across a random 400-repo sample of the top-2,500 GitHub repos
(tokens ≈ chars/4; 20k-commit windows; sample data preserved).

| source | median tokens | ratio of aggregate medians vs logbook |
|---|---|---|
| LOGBOOK.md (v0.2, incl. per-file history) | **1,019** | — |
| `git log --oneline` | 16,133 | 16× |
| `git log` (full messages) | 83,279 | 82× |

- **34% of repos' full git logs exceed a 150k-token context window entirely.**
- 44% of repos' `--oneline` logs alone exceed 20k tokens.
- Per-repository full-log/logbook ratio distribution: p25 36× · median 104× ·
  p75 216× · max 2,534×. This differs from the 82× ratio of the two aggregate
  medians above.
- A session that would otherwise ingest the full history avoids that context
  difference. Over 100 such sessions, the estimate is ~8M tokens.

And the raw log is not just bigger — it is missing the analysis. The
suppression ledger and assertion-weakening events come from reading DIFFS
(`git log -p`, typically 1,000×+ the logbook's size); no token budget spent
on `--oneline` can surface them. The logbook is a table of contents that
also did the reading.

## Potential context avoided over a month / a year

Per session that would otherwise ingest history: ~15.1k tokens saved vs
`--oneline`, ~82.3k vs the full log (median repo). Every fresh context —
including every subagent — pays it again.

| hypothetical usage | sessions/mo ingesting history | potential avoided/mo (oneline → full) | potential avoided/yr |
|---|---|---|---|
| solo, light (5 fresh contexts/day) | ~110 | 1.7M → 9.1M | 20M → 109M |
| solo, heavy (20/day incl. subagents) | ~440 | 6.7M → 36M | 81M → 436M |
| team of 5, heavy | ~2,200 | 34M → 181M | 405M → 2.2B |

Honest framing: in our baseline runs, agents often read no history — for those
sessions the logbook ADDS the knowledge for ~1k tokens rather than saving 82k.
The savings apply to sessions that would have pulled the log; the deeper point
is context pressure (raw logs crowd out code) and impossibility (for 34% of
top repos the full log exceeds the window entirely).
