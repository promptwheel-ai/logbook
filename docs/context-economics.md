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
