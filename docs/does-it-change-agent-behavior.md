# Does LOGBOOK.md actually change agent behavior?

An A/B test, 2026-07-10. Two fresh agent sessions (same model, same prompt),
asked to plan a refactor of `useShallow` in zustand. One received zustand's
4.4KB LOGBOOK.md in context. Neither had tools or repo access — planning only.

Relevant fact both could have used: zustand merged a useShallow refactor in
PR #2701 and **reverted it** in #2703 (2024-09-15). The logbook's
do-not-retry list records this.

## Control (no logbook) — competent and blind

> Before touching any code, I'd read `src/react/shallow.ts`,
> `src/vanilla/shallow.ts` [...] extract that caching pattern into one small
> internal helper [...] keep the change behavior-preserving only [...] check
> existing test coverage [...] confirm there's no open PR/issue already
> tackling this [...] run the full test suite plus the size-limit check.

Good engineering hygiene. Zero awareness that this exact refactor was tried
and rolled back. It would have re-attempted #2701.

## Treatment (with logbook) — starts from the failure that already happened

> Before touching anything, I'd pull up PR #2701 and its revert #2703
> (2024-09-15, "revert useShallow refactor") — that's a direct prior attempt
> at this exact task that failed, so understanding what broke is the
> precondition for not repeating it, not an optional nice-to-have. [...]
> Given the do-not-retry precedent, I'd favor a narrow, additive refactor
> [...] since #817 shows overload removal in similar context-adjacent code
> was also reverted for breaking types. I'd also check the oversight ledger —
> 9 assertion-weakening commits — to see if any touched useShallow's existing
> tests, since a refactor that passes a weakened test suite could be hiding
> the same regression that caused the 2024 revert. [...] type-level
> regressions are the pattern here, not runtime bugs, so I'd weight TS
> compilation across the supported TS version matrix over just unit test
> passing.

Unprompted, it: (1) treated the prior revert as the starting point, (2)
derived the repo's characteristic failure class (type regressions) by
synthesizing across multiple do-not-retry entries, (3) connected the
assertion-weakening ledger to test trustworthiness, and (4) planned to pin
the old failure mode with a test before refactoring.

## Honest scope

One trial, one scenario, planning-only. The scenario was chosen because it is
the tool's core claim (do-not-retry), not at random. Reproduce it: run
`npx @promptwheel/logbook` on any repo with a meaningful revert history
(the median top-2,500 repo has 10 reverts) and ask an agent to plan a change
adjacent to a reverted one, with and without LOGBOOK.md in context.

---

# Round 2: generic tasks, no revert priming (same day)

Four more runs — onboarding brief on flask, modernization risk assessment on
express. Tasks never mention history. These are famous repos, which makes
them the HARDEST test: the control agent has deep training knowledge.

## What the controls got right

Both controls were genuinely strong — training data covers famous repos
(flask's sansio split and Werkzeug coupling; express's path-to-regexp CVE
history and prototype monkey-patching). On world-famous code, a fresh agent
is not blind.

## What only the logbook added (verbatim excerpts)

flask treatment:
> Two reverts are directly load-bearing for helpers.py work: the 2015 revert
> of "Add safe_join root check" (helpers.py owns path-safety logic) and the
> 2019 revert of "move app context push to before request matching" [...]
> both were "obviously correct" changes that shipped and got rolled back.
> [...] 82 suppression commits and 47 assertion-weakening events mean
> existing green tests around helpers.py can't be trusted as proof of
> correctness [...] I'd audit which suppressions touch helpers.py before
> treating current passing tests as a real safety net.

express treatment:
> Response.js carries a security scar: the open-redirect allow-list fix
> needed a second pass [...] it already fooled one round of review. [...]
> the 2017 Buffer.from-when-available swap [was] already tried and rolled
> back — so before touching buffer handling, confirm the new approach
> differs materially from what was already reverted. [...] re-enable/tighten
> [the weakened assertions] first so you have a real regression net.

A modernization pass on express would try `Buffer.from` — it is the textbook
modernization — and the do-not-retry list is the only thing standing between
the agent and a re-attempt of a known rollback.

## The honest reading

On famous repos, the logbook's value is a LAYER (commit-level facts training
can't hold: which reverts bite this module, whether the test net is
trustworthy, where security fixes needed two passes) on top of strong priors.
On PRIVATE repos — the actual target user — the control has no priors at all:
training data has never seen your company's history. Famous-repo tests
understate the private-repo value.
