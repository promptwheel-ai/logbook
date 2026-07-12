# The wrong-work benchmark

Six repos (express, flask, zustand, fastify, svelte, axios), four context
conditions (no context / structure map / LOGBOOK.md / both), identical
planning tasks per repo, Sonnet agents, context supplied only via files.
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

n=6 repos, planning tasks (not merged code), famous repos — which
understates the private-repo case, where model priors are near zero and
the history file is the only source of these facts. Structure arm is a
deterministic surrogate for structure-mapping tools. Single grader against
pre-registered criteria; a cross-vendor re-grade is planned. A full run
was repeated end-to-end once: 27 of 28 arm-level scores reproduced; the
one change was an improvement caused by a digest-ordering fix.

Cross-vendor spot-check (Codex CLI, gpt-5.6-sol): with one AGENTS.md line
and no mention of the logbook, its plan opened with "read LOGBOOK.md —
especially do-not-retry" in 4 of 4 runs across effort tiers; without the
file, 0 of 4 runs consulted the history at any effort, including a 191k-token
maximum-effort run that read code, tests, and build configs but never ran
git log.
