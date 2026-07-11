# Context economics: the logbook vs raw git log

Measured across a random 400-repo sample of the top-2,500 GitHub repos
(tokens ≈ chars/4; 20k-commit windows; sample data preserved).

| source | median tokens | vs logbook |
|---|---|---|
| LOGBOOK.md | **798** | — |
| `git log --oneline` | 16,133 | 20× |
| `git log` (full messages) | 83,279 | 104× |

- **34% of repos' full git logs exceed a 150k-token context window entirely.**
- 44% of repos' `--oneline` logs alone exceed 20k tokens.
- Full-log/logbook ratio: p25 36× · median 104× · p75 216× · max 2,534×.
- An agent that re-derives history each session pays the difference every
  time. Over 100 sessions vs the full log: ~8M tokens.

And the raw log is not just bigger — it is missing the analysis. The
suppression ledger and assertion-weakening events come from reading DIFFS
(`git log -p`, typically 1,000×+ the logbook's size); no token budget spent
on `--oneline` can surface them. The logbook is a table of contents that
also did the reading.

## Over a month / a year

Per session that would otherwise ingest history: ~15.3k tokens saved vs
`--oneline`, ~82.5k vs the full log (median repo). Every fresh context —
including every subagent — pays it again.

| usage | sessions/mo | saved/mo (oneline → full) | saved/yr |
|---|---|---|---|
| solo, light (5 fresh contexts/day) | ~110 | 1.7M → 9.1M | 20M → 109M |
| solo, heavy (20/day incl. subagents) | ~440 | 6.7M → 36M | 81M → 436M |
| team of 5, heavy | ~2,200 | 34M → 181M | 405M → 2.2B |

Honest framing: most agents today read no history at all — for them the
logbook ADDS the knowledge for 798 tokens rather than saving 82k. The
savings apply to sessions that would have pulled the log; the deeper point
is context pressure (raw logs crowd out code) and impossibility (for 34% of
top repos the full log exceeds the window entirely).
