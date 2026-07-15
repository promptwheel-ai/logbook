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
`npx -y @promptwheel/logbook@0.9.0` on any repo with a meaningful revert history (the
median in our random 400-repo sample had 10 reverts) and ask an agent to plan a
change adjacent to a reverted one, with and without LOGBOOK.md in context.

---

# Round 2: generic tasks, no revert priming (same day)

Four more runs — onboarding brief on flask, modernization risk assessment on
express. Tasks never mention history. These famous repos give the control
agent unusually strong training priors.

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

A modernization pass on express may try `Buffer.from`; the do-not-retry list
is one direct way to surface the known rollback before planning.

## The honest reading

On famous repos, the logbook's value is a LAYER (commit-level facts training
can't hold: which reverts bite this module, whether the test net is
trustworthy, where security fixes needed two passes) on top of strong priors.
Private repositories may have weaker model priors, but transfer in either
direction is untested. These runs establish only that supplied commit-level
history can add information on the selected public tasks.

---

# Round 3: does DEPTH pay? (shallow 800-token vs deep ~3k-token, same task)

Same express risk-assessment task. The deep variant was a HAND-BUILT mockup
of a possible v0.2 output: all 22 reverts, per-file revert history for the
three hotspot files, and a "notable events" highlight (a Dec-2025 revert of
a CVE security patch that also deleted 9 assertions). At the time, the
released tool did not emit this format; the current digest now includes
deterministic per-file and notable-event views. This round remains evidence
about the direction because its deep arm was hand-built, not generated by
that code.

## What the extra ~2k tokens bought (verbatim)

> response.js (392 commits, 5 reverts) is the single riskiest file to touch:
> reverted fixes there — infinite loop on `res.send(status)`, JSON charset
> removal, error messaging for null/undefined `res.status` — all show that
> content-negotiation and status-handling code has non-obvious behavioral
> contracts that "obvious" cleanups keep breaking. [...] The single most
> alarming data point is the 2025-12-01 revert of the CVE-2024-51999
> security patch, which also stripped 9 assertions — meaning a real
> vulnerability class was reintroduced with the tests that would have caught
> it removed in the same commit [...] treat any diff that removes or weakens
> assertions as a hard stop [...] given how normalized that anti-pattern
> already is in this repo's history (38 prior instances).

The shallow arm could not say any of that: the CVE revert wasn't in its
10-revert sample, and per-file attribution didn't exist.

## Result of this selected trial

In this selected trial, curated depth changed the plan. What paid was (1)
file-keyed revert history and (2) notable-event highlighting, not longer
flat lists. The 800-token digest is the right default (context economics);
the promising design example is per-file sections + a notable-events section
at ~2-4k tokens. Honest scope: n=1 per arm, one repo, deep variant
hand-curated—not validation of the current product format.
