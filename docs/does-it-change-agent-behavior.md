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
