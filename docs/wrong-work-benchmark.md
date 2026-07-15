# The wrong-work experiment

An internal six-task experiment. Six repos (express, flask, zustand,
fastify, svelte, axios), four context conditions (no context / structure
map / LOGBOOK.md / both), identical planning tasks per repo, Sonnet agents,
context supplied only via files. The tasks were deliberately history-dense:
each repo was chosen because its history contains a revert, a finished
migration, or a rejected approach that a plan could collide with.
Scoring: pre-registered 6-item checklists per repo — 3 history items
(cites the relevant reverts; distrusts green where the ledger says to;
avoids re-attempting reverted or already-finished work), 2 structure items,
1 plan-quality item — graded against ground truth verified with
git blame / pickaxe on the actual repos.

## Results

| condition | checklist | history items (18) | structure items (12) |
|---|---|---|---|
| no context        | 47% | 0/18  | 12/12 |
| structure map     | 53% | 1/18  | 12/12 |
| LOGBOOK.md        | 100% | 18/18 | 11/12 |
| both              | 100% | 18/18 | 12/12 |

## The wrong-work rate

Without history, agents planned already-tried or already-finished work in
4 of 6 repos:

- express: preserve/deprecate signatures removed in 2014–2016
- fastify: plan the tap→node:test migration that finished in 2025
- svelte: re-propose optimizations merged and reverted (#12921, #17869, #18294)
- axios: re-propose the reverted CJS-types-from-ESM derivation (#6218/#6729)

With LOGBOOK.md in context: 0 of 6, at ~4.7k additional plan tokens.

## Honest scope

This is a summary of an internal experiment, not a reproducible benchmark
release: the raw transcripts, per-repo prompts, checklists, and scoring
artifacts are not currently published. n=6 repos, planning tasks (not
merged code), tasks selected for history density — a repo without collisions
in its history has nothing here to catch. All six are famous repos; whether
the effect transfers to private repos is unknown — models have fewer priors
about them (which should favor the history file), but their histories may
also be thinner or noisier (which should weaken it). Structure arm is a
deterministic surrogate for structure-mapping tools. Single grader against
pre-registered criteria; a cross-vendor re-grade is planned. A full run
was repeated end-to-end once: 27 of 28 arm-level scores reproduced; the
one change was an improvement caused by a digest-ordering fix.

## Evidence status (updated 2026-07-13)

Read this experiment together with two later, stronger tests. A three-arm
pilot on history-dense tasks favored the artifact (Logbook 7/12
primary-success plans vs 3/12 for raw-git archaeology and 4/12 for a
model-written memo, with zero wrong-work plans). A better-designed
held-out screen (sealed fixtures, blinded raters, intention-to-treat)
then found NO advantage over a strong raw-git instruction on ten new
planning tasks — and traced the gap to retrieval, not the index: the
ledgers contained every sealed lineage item, but task-facing queries
delivered none of them before agents fell back to raw git.

The calibrated claim across all evidence: valuable on sufficiently
difficult, history-dense tasks; not universally better. Retrieval now has
bounded context pages plus a separate structurally ranked diff-time decision
preflight, but that new path has not yet been re-tested on a fresh held-out
sample. No behavioral claim here is upgraded until that test exists.
