# Regex vs AST: measured, not argued (2026-07-10)

We parsed the pre- and post-commit versions of changed files with REAL
parsers (Babel for JS/TS, Python stdlib `ast`) for 1,587 assert-touching
commits sampled across the top-2,500-repo corpus, and compared AST
ground-truth assertion deltas against this tool's regex extractor on the
same commits.

| metric | result |
|---|---|
| commits compared (parseable pre/post pairs) | 1,587 |
| direction agreement (asserts up / down / flat) | **92%** |
| assert-delta error, median | 2 |
| assert-delta error, p90 | 21 |
| commits AST-flagged for assertion downgrade (strong→weak) | 7 (~0.4%) |
| …of which survive hand review (named-matcher class) | 2 — detector catches 2/2 |
| …AST-heuristic false positives (np.all() wrappers, or-widened conditions, .startswith counted weak) | 5 |
| commits with AST-confirmed test-skips added | 14 |

## Honest reading

- **Direction is what the digest uses, and direction is 92% right.** The
  logbook flags "this commit weakened assertions" as a lead; leads need
  direction, not exact counts.
- **Magnitude has a tail** (p90 error = 21): regex counts lines, AST counts
  nodes — multi-assert lines and reformat-heavy commits diverge. This is why
  every number in LOGBOOK.md is a lead, not a verdict, and why the agent
  reading it is instructed to `git show` before acting.
- **Assertion downgrades are rare in the wild** (~0.4% flagged; ~0.1%
  confirmed) — which is exactly what makes them worth a tripwire. The
  detector ships in 0.2.0 scoped to the class that can be judged precisely:
  named matchers (toEqual→toBeTruthy, assertEqual→assertTrue). On that
  class its recall against AST ground truth was 2/2.
- **The sharpest finding cuts the other way:** hand-reviewing the AST flags
  showed even real parsers can't cheaply judge bare-assert strength —
  `np.all()` wrappers and or-widened conditions read as "weakening" to a
  syntax heuristic and are nothing of the sort. Precision there needs
  semantics beyond syntax. We deliberately do not claim that class.
- AST parsing cost ~30-60x the full regex pass, needed a dependency tree,
  and failed to parse both file versions in half the sampled commits
  (renames, non-JS/Py languages, syntax eras). A zero-dep core with
  measured 92% directional calibration is the right trade; AST enters as
  an opt-in pack, not the core.

Method: sample = up to 2 assert-touching, test-file commits per corpus repo
(3,167 sampled; 1,587 with parseable pairs); parsers count assertion call
nodes with a strong/weak classification; comparison per commit against the
extractor's del/add_asserts on identical shas. Harness preserved in the
private corpus records.
